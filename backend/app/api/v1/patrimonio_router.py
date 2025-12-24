# backend/app/api/v1/patrimonio_router.py

"""
API v1 - PATRIMONIO (viviendas, locales, etc.)

Basado en backend/routers/patrimonio.py de la v2, manteniendo:

- Rutas:
    /patrimonios
    /patrimonios/picker
    /patrimonios/{id}
    /patrimonios/{id}/activar
    /patrimonios/{id}/inactivar
    /patrimonios/{id}/disponible...
    /patrimonios/{id}/compra (GET/POST/PUT)

- Reglas:
    * ID: VIVIENDA-XXXXXX, generado en backend.
    * Calle/número/escalera/piso/puerta/localidad/referencia SIEMPRE
      en MAYÚSCULAS y sin tildes.
    * direccion_completa se compone en backend.
    * Campo disponible y campos de compra se tratan con getattr/hasattr
      por compatibilidad con distintas versiones de la BD.

Además, en v3:

- TODOS los patrimonios están ligados a un user_id.
- Cada usuario solo puede ver y modificar sus propios patrimonios.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.patrimonio import (
    PatrimonioSchema,
    PatrimonioCreate,
    PatrimonioUpdate,
    PatrimonioPickerOut,
    PatrimonioCompraIn,
    PatrimonioCompraOut,
)
from backend.app.utils.text_utils import normalize_upper_ascii
from backend.app.utils.id_utils import generate_patrimonio_id
from backend.app.api.v1.auth_router import require_user

router = APIRouter(
    prefix="/patrimonios",
    tags=["patrimonios"],
)

# ---------- Helpers de texto/dirección ----------


def _componer_direccion_completa(
    calle: Optional[str],
    numero: Optional[str],
    escalera: Optional[str],
    piso: Optional[str],
    puerta: Optional[str],
    localidad: Optional[str],
) -> str:
    """
    Construye la dirección completa a partir de los distintos campos.

    Solo añade las partes que no son None, separadas por comas.
    """
    parts: list[str] = []
    if calle:
        parts.append(str(calle))
    if numero:
        parts.append(f"Nº {numero}")
    if escalera:
        parts.append(f"ESC {escalera}")
    if piso:
        parts.append(f"PISO {piso}")
    if puerta:
        parts.append(f"PUERTA {puerta}")
    if localidad:
        parts.append(str(localidad))
    return ", ".join(parts)


def _generar_referencia(
    calle: Optional[str],
    numero: Optional[str],
    localidad: Optional[str],
) -> str:
    """
    Genera una referencia automática a partir de:

    - Primera palabra de la calle (hasta 7 caracteres).
    - Número.
    - Primera palabra de la localidad (hasta 7 caracteres).

    Todo en MAYÚSCULAS y sin tildes (ya viene normalizado).
    """
    if not calle:
        return "SIN_CALLE"

    base = calle.split()[0][:7]
    if numero:
        base = f"{base}{numero}"
    if localidad:
        suf = localidad.split()[0][:7]
        base = f"{base}_{suf}"

    return base.upper()


def _coerce_row(r: models.Patrimonio) -> dict:
    """
    Convierte un objeto Patrimonio de SQLAlchemy en un dict
    compatible con PatrimonioSchema.

    - tipo_inmueble: se normaliza a str.
    - fecha_adquisicion: se serializa como ISO (YYYY-MM-DD) si existe.
    - disponible: se lee solo si existe la columna.
    """
    ti = getattr(r, "tipo_inmueble", None)
    tipo_inm = str(getattr(ti, "value", ti)) if ti is not None else "VIVIENDA"
    fa = getattr(r, "fecha_adquisicion", None)
    fa_iso = fa.isoformat()[:10] if fa else None

    return {
        "id": r.id,
        "calle": r.calle or None,
        "numero": r.numero or None,
        "escalera": r.escalera or None,
        "piso": r.piso or None,
        "puerta": r.puerta or None,
        "localidad": r.localidad or None,
        "referencia": r.referencia or None,
        "direccion_completa": r.direccion_completa or None,
        "tipo_inmueble": tipo_inm,
        "fecha_adquisicion": fa_iso,
        "activo": bool(getattr(r, "activo", True)),
        "disponible": getattr(r, "disponible", None),
        "superficie_m2": getattr(r, "superficie_m2", None),
        "superficie_construida": getattr(r, "superficie_construida", None),
        "participacion_pct": getattr(r, "participacion_pct", None),
        "habitaciones": getattr(r, "habitaciones", None),
        "banos": getattr(r, "banos", None),
        "garaje": bool(getattr(r, "garaje", False)),
        "trastero": bool(getattr(r, "trastero", False)),
    }


# ---------- Cálculos adquisición (COMPRA) ----------


def _compute_financials(payload: PatrimonioCompraIn) -> Tuple[Optional[float], Optional[float]]:
    """
    Calcula impuestos_eur y total_inversion con la lógica:

    - ITP € = max(valor_compra, valor_referencia cuando exista) * (impuestos_pct/100)
    - total_inversion = valor_compra + (ITP € si hay) + notaria + agencia + reforma_adecuamiento
    """
    base = payload.valor_compra
    if payload.valor_referencia is not None and payload.valor_referencia > base:
        base_for_tax = payload.valor_referencia
    else:
        base_for_tax = base

    imp_eur: Optional[float] = None
    if payload.impuestos_pct is not None:
        imp_eur = round((payload.impuestos_pct / 100.0) * base_for_tax, 2)

    total: Optional[float] = base
    for x in [imp_eur, payload.notaria, payload.agencia, payload.reforma_adecuamiento]:
        if x is not None:
            total += x

    return imp_eur, total


# ----------- Rutas -----------


# 1) Picker
@router.get(
    "/picker",
    response_model=List[PatrimonioPickerOut],
    summary="Listado reducido de patrimonios para pickers",
)
def picker_patrimonios(
    activos: bool = Query(True, description="Filtrar solo activos (por defecto True)."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
) -> List[PatrimonioPickerOut]:
    """
    Devuelve un listado reducido de viviendas para desplegables SOLO del usuario actual:

    - id
    - referencia (o id si no hay)
    - direccion_completa
    """
    q = (
        db.query(models.Patrimonio)
        .filter(
            models.Patrimonio.user_id == current_user.id,
            models.Patrimonio.activo == activos,
        )
        .order_by(models.Patrimonio.referencia.asc())
    )
    rows = q.all()
    out: List[PatrimonioPickerOut] = []
    for r in rows:
        out.append(
            PatrimonioPickerOut.model_validate(
                {
                    "id": r.id,
                    "referencia": r.referencia or r.id,
                    "direccion_completa": r.direccion_completa or "",
                }
            )
        )
    return out


# 2) Listado
@router.get(
    "",
    response_model=List[PatrimonioSchema],
    summary="Listar patrimonios",
)
def listar_patrimonios(
    activos: Optional[bool] = Query(
        None,
        description="Si se indica, filtra por activo true/false.",
    ),
    disponibles: Optional[bool] = Query(
        None,
        description="Si se indica, filtra por disponible true/false (si existe la columna).",
    ),
    ordenar: Optional[str] = Query(
        "asc",
        pattern="^(asc|desc)$",
        description="asc|desc por fecha_adquisicion.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve el listado de patrimonios del usuario con filtros opcionales:

    - activos: True/False (si es None, no filtra).
    - disponibles: True/False (solo si existe la columna).
    - ordenar: 'asc' o 'desc' por fecha_adquisicion y referencia.
    """
    q = db.query(models.Patrimonio).filter(
        models.Patrimonio.user_id == current_user.id
    )
    if activos is not None:
        q = q.filter(models.Patrimonio.activo == activos)
    if hasattr(models.Patrimonio, "disponible") and (disponibles is not None):
        q = q.filter(models.Patrimonio.disponible == disponibles)

    # Orden por fecha (nulls last) y referencia
    if ordenar == "asc":
        q = q.order_by(
            models.Patrimonio.fecha_adquisicion.asc(),
            models.Patrimonio.referencia.asc(),
        )
    else:
        q = q.order_by(
            models.Patrimonio.fecha_adquisicion.desc(),
            models.Patrimonio.referencia.asc(),
        )

    res = q.all()
    return [_coerce_row(r) for r in res]


# 3) Detalle
@router.get(
    "/{patrimonio_id}",
    response_model=PatrimonioSchema,
    summary="Detalle de un patrimonio",
)
def get_patrimonio(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve los datos completos de un patrimonio por ID del usuario actual.

    - 404 si no existe o no pertenece al usuario.
    """
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    return _coerce_row(row)


# 4) Crear
@router.post(
    "",
    response_model=PatrimonioSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Crear patrimonio",
)
def crear_patrimonio(
    payload: PatrimonioCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un nuevo patrimonio (vivienda) para el usuario actual.

    Reglas:
    - Genera ID con formato VIVIENDA-XXXXXX.
    - Convierte calle/numero/escalera/piso/puerta/localidad/referencia
      a MAYÚSCULAS sin tildes.
    - Si no se envía referencia, se genera automáticamente.
    - Compone direccion_completa en backend.
    - tipo_inmueble por defecto 'VIVIENDA' si no se indica.
    - Guarda user_id = usuario autenticado.
    """
    new_id = generate_patrimonio_id(db)

    calle = normalize_upper_ascii(payload.calle)
    numero = normalize_upper_ascii(payload.numero)
    escalera = normalize_upper_ascii(payload.escalera)
    piso = normalize_upper_ascii(payload.piso)
    puerta = normalize_upper_ascii(payload.puerta)
    localidad = normalize_upper_ascii(payload.localidad)
    referencia_in = normalize_upper_ascii(payload.referencia)

    referencia = referencia_in or _generar_referencia(calle, numero, localidad)
    direccion = _componer_direccion_completa(
        calle, numero, escalera, piso, puerta, localidad
    )

    tipo_inmueble = normalize_upper_ascii(
        getattr(payload, "tipo_inmueble", None) or "VIVIENDA"
    )

    row = models.Patrimonio(
        id=new_id,
        user_id=current_user.id,
        calle=calle or None,
        numero=numero or None,
        escalera=escalera or None,
        piso=piso or None,
        puerta=puerta or None,
        localidad=localidad or None,
        referencia=referencia,
        direccion_completa=direccion,
        tipo_inmueble=tipo_inmueble,
        fecha_adquisicion=getattr(payload, "fecha_adquisicion", None),
        activo=True,
        # disponible: solo si existe en el modelo/BD
        **(
            {"disponible": bool(getattr(payload, "disponible", True))}
            if hasattr(models.Patrimonio, "disponible")
            else {}
        ),
        superficie_m2=getattr(payload, "superficie_m2", None),
        superficie_construida=getattr(payload, "superficie_construida", None),
        participacion_pct=getattr(payload, "participacion_pct", None),
        habitaciones=getattr(payload, "habitaciones", None),
        banos=getattr(payload, "banos", None),
        garaje=bool(getattr(payload, "garaje", False)),
        trastero=bool(getattr(payload, "trastero", False)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _coerce_row(row)


# 5) Actualizar
@router.put(
    "/{patrimonio_id}",
    response_model=PatrimonioSchema,
    summary="Actualizar patrimonio",
)
def actualizar_patrimonio(
    patrimonio_id: str,
    payload: PatrimonioUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un patrimonio existente del usuario actual.

    - 404 si no existe o no pertenece al usuario.
    - Convierte campos de texto relevantes a MAYÚSCULAS sin tildes.
    - Recompone direccion_completa con los datos actualizados.
    """
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )

    for field in [
        "calle",
        "numero",
        "escalera",
        "piso",
        "puerta",
        "localidad",
        "tipo_inmueble",
        "fecha_adquisicion",
        "activo",
        "superficie_m2",
        "superficie_construida",
        "participacion_pct",
        "habitaciones",
        "banos",
        "garaje",
        "trastero",
        "referencia",
    ]:
        if hasattr(payload, field) and getattr(payload, field) is not None:
            val = getattr(payload, field)
            # Campos de texto que deben ir en mayúsculas sin tildes
            if field in (
                "calle",
                "numero",
                "escalera",
                "piso",
                "puerta",
                "localidad",
                "referencia",
                "tipo_inmueble",
            ):
                val = normalize_upper_ascii(val)
            setattr(row, field, val)

    # disponible si existe en el modelo
    if (
        hasattr(models.Patrimonio, "disponible")
        and hasattr(payload, "disponible")
        and (payload.disponible is not None)
    ):
        setattr(row, "disponible", bool(payload.disponible))

    row.direccion_completa = _componer_direccion_completa(
        row.calle, row.numero, row.escalera, row.piso, row.puerta, row.localidad
    )

    db.commit()
    db.refresh(row)
    return _coerce_row(row)


# 6) Activar/Inactivar
@router.patch(
    "/{patrimonio_id}/activar",
    response_model=PatrimonioSchema,
    summary="Marcar patrimonio como activo",
)
def activar_patrimonio(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un patrimonio como ACTIVO (del usuario actual).

    - 404 si no existe o no pertenece al usuario.
    """
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    row.activo = True
    db.commit()
    db.refresh(row)
    return _coerce_row(row)


@router.patch(
    "/{patrimonio_id}/inactivar",
    response_model=PatrimonioSchema,
    summary="Marcar patrimonio como inactivo",
)
def inactivar_patrimonio(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un patrimonio como INACTIVO (del usuario actual).

    - 404 si no existe o no pertenece al usuario.
    """
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    row.activo = False
    db.commit()
    db.refresh(row)
    return _coerce_row(row)


# 7) Disponible / No disponible
@router.patch(
    "/{patrimonio_id}/disponible/{flag}",
    response_model=PatrimonioSchema,
    summary="Marcar patrimonio como disponible/no disponible (flag)",
)
def set_disponible_flag(
    patrimonio_id: str,
    flag: bool,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca un patrimonio como disponible o no, usando un flag booleano.

    - 404 si no existe o no pertenece al usuario.
    - 400 si la columna 'disponible' no existe en el modelo/BD.
    """
    row = db.get(models.Patrimonio, patrimonio_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )
    if not hasattr(row, "disponible"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La columna 'disponible' no existe en Patrimonio.",
        )
    row.disponible = bool(flag)
    db.commit()
    db.refresh(row)
    return _coerce_row(row)


@router.patch(
    "/{patrimonio_id}/disponible",
    response_model=PatrimonioSchema,
    summary="Marcar patrimonio como disponible",
)
def marcar_disponible(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Atajo para marcar disponible=True (usuario actual).
    """
    return set_disponible_flag(patrimonio_id, True, db, current_user)


@router.patch(
    "/{patrimonio_id}/no_disponible",
    response_model=PatrimonioSchema,
    summary="Marcar patrimonio como NO disponible",
)
def marcar_no_disponible(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Atajo para marcar disponible=False (usuario actual).
    """
    return set_disponible_flag(patrimonio_id, False, db, current_user)


# 8) Compra (GET / POST / PUT)
@router.get(
    "/{patrimonio_id}/compra",
    response_model=Optional[PatrimonioCompraOut],
    summary="Obtener datos de compra de un patrimonio",
)
def get_compra(
    patrimonio_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve los datos de compra de un patrimonio del usuario actual.

    - 404 si el patrimonio no existe o no pertenece al usuario.
    - Si no existe registro de compra → None.
    """
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )

    row = db.get(models.PatrimonioCompra, patrimonio_id)
    if not row:
        return None

    return PatrimonioCompraOut(
        patrimonio_id=patrimonio_id,
        valor_compra=row.valor_compra,
        valor_referencia=getattr(row, "valor_referencia", None),
        impuestos_pct=getattr(row, "impuestos_pct", None),
        impuestos_eur=getattr(row, "impuestos_eur", None),
        notaria=getattr(row, "notaria", None),
        agencia=getattr(row, "agencia", None),
        reforma_adecuamiento=getattr(row, "reforma_adecuamiento", None),
        total_inversion=getattr(row, "total_inversion", None),

        # ✅ AÑADIR ESTO
        valor_mercado=getattr(row, "valor_mercado", None),
        valor_mercado_fecha=getattr(row, "valor_mercado_fecha", None),

        notas=getattr(row, "notas", None),
        created_at=getattr(row, "created_at", None),
        updated_at=getattr(row, "updated_at", None),
        activo=getattr(row, "activo", None) if hasattr(row, "activo") else None,
    )


@router.post(
    "/{patrimonio_id}/compra",
    response_model=PatrimonioCompraOut,
    summary="Crear o actualizar datos de compra (upsert)",
)
def crear_o_actualizar_compra(
    patrimonio_id: str,
    payload: PatrimonioCompraIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea o actualiza los datos de compra de un patrimonio (upsert) del usuario actual.

    - 404 si el patrimonio no existe o no pertenece al usuario.
    - Calcula impuestos_eur y total_inversion con _compute_financials.
    - notas se deja en el formato que venga (NO se fuerza a mayúsculas).
    """
    patr = db.get(models.Patrimonio, patrimonio_id)
    if not patr or patr.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patrimonio no encontrado",
        )

    row = db.get(models.PatrimonioCompra, patrimonio_id)  # PK = patrimonio_id
    imp_eur, total = _compute_financials(payload)

    if row is None:
        row = models.PatrimonioCompra(
            patrimonio_id=patrimonio_id,
            valor_compra=payload.valor_compra,
            valor_referencia=payload.valor_referencia,
            impuestos_pct=payload.impuestos_pct,
            impuestos_eur=imp_eur,
            notaria=payload.notaria,
            agencia=payload.agencia,
            reforma_adecuamiento=payload.reforma_adecuamiento,
            total_inversion=total,
            notas=payload.notas,
        )
        db.add(row)
    else:
        row.valor_compra = payload.valor_compra
        row.valor_referencia = payload.valor_referencia
        row.impuestos_pct = payload.impuestos_pct
        row.impuestos_eur = imp_eur
        row.notaria = payload.notaria
        row.agencia = payload.agencia
        row.reforma_adecuamiento = payload.reforma_adecuamiento
        row.total_inversion = total
        row.notas = payload.notas

    db.commit()
    db.refresh(row)
    return get_compra(patrimonio_id, db, current_user)


@router.put(
    "/{patrimonio_id}/compra",
    response_model=PatrimonioCompraOut,
    summary="Actualizar datos de compra (upsert, alias de POST)",
)
def actualizar_compra_upsert(
    patrimonio_id: str,
    payload: PatrimonioCompraIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Alias de POST /{patrimonio_id}/compra para mantener compatibilidad.
    """
    return crear_o_actualizar_compra(patrimonio_id, payload, db, current_user)
