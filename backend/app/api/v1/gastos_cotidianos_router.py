# backend/app/api/v1/gastos_cotidianos_router.py

"""
Router de GASTOS COTIDIANOS para GapptoMobile v3.

Migrado desde backend/routers/gastosCotidianos.py de v2, manteniendo:

- Generación de ID GASTO_COTIDIANO-XXXXXX.
- Validación de que tipo_id pertenece al segmento COTIDIANOS.
- Mapeos canon/legacy de tipos.
- Ajustes de:
    * contenedores en GASTOS (presupuesto gestionable).
    * liquidez en CUENTAS_BANCARIAS.
- Lógica específica para ELECTRICIDAD (marcar contenedor pagado, etc.).
- Endpoints:
    * get por id.
    * sugerir_cuenta.
    * crear / actualizar / borrar.

Cambios v3 importantes:
- Se usa backend.app.db.session.get_db y backend.app.db.models.
- Se añade seguridad multiusuario:
    * Cada GastoCotidiano se guarda con user_id = current_user.id.
    * Todos los accesos a gastos cotidianos verifican que el registro
      pertenezca al usuario autenticado.
    * Los contenedores GASTO que se usan para presupuesto se buscan
      filtrando por user_id.
- Se respeta la regla:
    * TODO lo que insertamos en BD va en MAYÚSCULAS, excepto OBSERVACIONES.
"""

from __future__ import annotations

import secrets
import string
from typing import Optional, List, Dict

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    Query,
    status,
)
from sqlalchemy.orm import Session
    # extract no se usa finalmente, pero se deja si luego añadimos listados
from sqlalchemy import extract, or_, and_, func
from sqlalchemy.exc import IntegrityError, DataError

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.gastos_cotidianos import (
    GastoCotidianoSchema,
    GastoCotidianoCreateSchema,
    GastoCotidianoUpdateSchema,
)
from backend.app.schemas.gastos_cotidianos import ALLOWED_EVENTOS  # opcional

from backend.app.utils.common import safe_float, adjust_liquidez
from backend.app.utils.id_utils import generate_gasto_cotidiano_id
from backend.app.core.constants import SEGMENTO_COTIDIANOS_ID
from backend.app.api.v1.auth_router import require_user
from backend.app.utils.text_utils import normalize_upper

router = APIRouter(tags=["gastos_cotidianos"])

# =======================================================
# Normalización de tipo_id: canónico ↔ legacy (filtrado)
# =======================================================
CANON = {
    "COMIDA": "COM-TIPOGASTO-311A33BD",
    "ELECTRICIDAD": "ELE-TIPOGASTO-47CC77E5",
    "GASOLINA": "TIP-GASOLINA-SW1ZQO",
    "ROPA": "ROP-TIPOGASTO-S227BB",
    "RESTAURANTES": "RES-TIPOGASTO-26ROES",
    "TRANSPORTE": "TRA-TIPOGASTO-RB133Z",
    "HOTELES": "HOT-TIPOGASTO-357FDG",
    "PEAJES": "PEA-TIPOGASTO-7HDY89",
    "MANTENIMIENTO_VEHICULO": "MAV-TIPOGASTO-BVC356",
}

# legacy → canon (rellenar si usas IDs antiguos)
LEGACY_TO_CANON: Dict[str, str] = {
    # "RES-TIPOGASTO-AA877CE4": CANON["RESTAURANTES"],
    # "TIP-ROPA-AZHQPH":        CANON["ROPA"],
}


def _canon_of(tipo_id: str) -> str:
    """
    Devuelve el tipo canónico de un tipo:
    - Si es legacy y está en el mapa, devuelve el canónico.
    - Si no, devuelve el mismo valor.
    """
    return LEGACY_TO_CANON.get(tipo_id, tipo_id)


def _tipo_equivalents(tipo_id: str) -> set[str]:
    """
    Conjunto de equivalentes que deben considerarse en filtros:
    - Si llega un legacy → {legacy, canon}
    - Si llega un canon  → {canon, legacy(s) conocidos}
    """
    canon = _canon_of(tipo_id)
    eq = {canon}
    for legacy, c in LEGACY_TO_CANON.items():
        if c == canon:
            eq.add(legacy)
    return eq


# -------------------------------------------------------
# Validación de negocio: tipo_id debe ser de COTIDIANOS
# -------------------------------------------------------

def _ensure_tipo_in_cotidianos(db: Session, tipo_id: Optional[str]):
    """
    Valida que el tipo_gasto referenciado:
      - exista
      - tenga segmento_id == COT-12345 (SEGMENTO_COTIDIANOS_ID)
    """
    if not tipo_id:
        raise HTTPException(
            status_code=422, detail="tipo_id es obligatorio."
        )
    tid = _canon_of(tipo_id)
    tipo: models.TipoGasto | None = db.get(models.TipoGasto, tid)
    if not tipo:
        raise HTTPException(
            status_code=422, detail="tipo_id no existe."
        )
    if getattr(tipo, "segmento_id", None) != SEGMENTO_COTIDIANOS_ID:
        raise HTTPException(
            status_code=422,
            detail=(
                "Solo se permiten tipos del segmento COTIDIANOS "
                f"(segmento_id = {SEGMENTO_COTIDIANOS_ID})."
            ),
        )


# ==========================
# Helpers de ajuste en GASTO
# ==========================
TARGET_GESTIONABLE_BY_COTIDIANO = {
    # Vehículo (agregado en el contenedor gasolina)
    "TIP-GASOLINA-SW1ZQO": "TIP-GASOLINA-SW1ZQO",
    "PEA-TIPOGASTO-7HDY89": "TIP-GASOLINA-SW1ZQO",
    "MAV-TIPOGASTO-BVC356": "TIP-GASOLINA-SW1ZQO",
    # Ocio (agregado en el contenedor restaurantes/ocio)
    "RES-TIPOGASTO-26ROES": "RES-TIPOGASTO-26ROES",
    "HOT-TIPOGASTO-357FDG": "RES-TIPOGASTO-26ROES",
    "TRA-TIPOGASTO-RB133Z": "RES-TIPOGASTO-26ROES",
    "ACT-TIPOGASTO-2X9H1Q": "RES-TIPOGASTO-26ROES",
}


def _container_tipo_for_cotidiano(tipo_id: str | None) -> str | None:
    if not tipo_id:
        return None
    return TARGET_GESTIONABLE_BY_COTIDIANO.get(tipo_id, tipo_id)


def _find_target_gasto(
    db: Session,
    tipo_id: str,
    user_id: str | None = None,
) -> Optional[models.Gasto]:
    """
    Busca el Gasto 'objetivo' a ajustar para un tipo dado.

    Criterio:
    - tipo_id = tipo indicado.
    - activo=True.
    - Si se pasa user_id, solo gastos de ese usuario.
    - Ordenado por fecha desc, id desc (último gasto activo de ese tipo).
    """
    q = (
        db.query(models.Gasto)
        .filter(models.Gasto.tipo_id == tipo_id, models.Gasto.activo.is_(True))
    )
    if user_id:
        q = q.filter(models.Gasto.user_id == user_id)

    q = q.order_by(models.Gasto.fecha.desc(), models.Gasto.id.desc())
    return q.first()


# ===== Liquidez: helpers =====

def _cuenta_of_target_gasto(
    db: Session,
    tipo_id: str | None,
    user_id: str | None = None,
) -> str | None:
    """
    Devuelve la cuenta_id del Gasto 'contenedor' asociado a un tipo cotidiano.

    - Si no hay contenedor o no se encuentra, devuelve None.
    - Se respeta user_id para aislar datos entre usuarios.
    """
    if not tipo_id:
        return None

    cont_tipo = _container_tipo_for_cotidiano(tipo_id)
    if not cont_tipo:
        return None

    g = _find_target_gasto(db, cont_tipo, user_id=user_id)
    if not g:
        return None

    # Varios posibles campos legacy:
    for attr in ("cuenta_id", "cuenta_bancaria_id", "cuentabancaria_id"):
        if hasattr(g, attr) and getattr(g, attr) is not None:
            return str(getattr(g, attr))

    if hasattr(g, "cuenta") and getattr(g, "cuenta") is not None and hasattr(
        g.cuenta, "id"
    ):
        return str(g.cuenta.id)

    return None


def _apply_delta_to_gasto_importe(
    db: Session,
    tipo_id: str,
    delta: float,
    force_pagado: bool = False,
    user_id: str | None = None,
) -> Optional[dict]:
    """
    Aplica un delta al 'importe' del Gasto objetivo (por tipo_id) DEL USUARIO.

    - delta < 0  => consume presupuesto.
    - delta > 0  => devuelve presupuesto.
    - No se capa a 0: se permite negativo (sobrepasar presupuesto).
    - force_pagado=True  => pagado=True siempre.
    - force_pagado=False => pagado=(nuevo_importe <= 0).
    """
    if not tipo_id:
        return None

    target = _find_target_gasto(db, tipo_id, user_id=user_id)
    if not target:
        return None

    old_val = safe_float(target.importe)
    new_val = old_val + float(delta)

    target.importe = new_val
    if force_pagado:
        target.pagado = True
    else:
        target.pagado = new_val <= 0

    nombre = getattr(target, "nombre", None) or target.id
    return {
        "gasto_id": target.id,
        "gasto_nombre": nombre,
        "old": old_val,
        "new": new_val,
        "exceeded": new_val < 0,
    }


def _adjust_container_and_liquidez(
    db: Session,
    tipo_id: str | None,
    cuenta_id: str | None,
    delta: float,
    force_pagado: bool = False,
    user_id: str | None = None,
) -> Optional[dict]:
    """
    Aplica un delta al contenedor en GASTOS y a la liquidez de la cuenta asociada
    DEL USUARIO indicado.

    - Ajusta el contenedor (si existe):
        importe_nuevo = importe_viejo + delta
        pagado:
          * force_pagado=True  => pagado=True
          * force_pagado=False => pagado=(nuevo_importe <= 0)
    - Ajusta CUENTAS_BANCARIAS.liquidez con el mismo delta.
    """
    delta = float(delta or 0.0)
    if not tipo_id or delta == 0.0:
        return None

    cont_tipo = _container_tipo_for_cotidiano(tipo_id)
    info = None
    if cont_tipo:
        info = _apply_delta_to_gasto_importe(
            db,
            tipo_id=cont_tipo,
            delta=delta,
            force_pagado=force_pagado,
            user_id=user_id,
        )

    eff_cuenta_id = cuenta_id or _cuenta_of_target_gasto(
        db, tipo_id, user_id=user_id
    )
    if eff_cuenta_id:
        adjust_liquidez(db, eff_cuenta_id, delta)

    return info


# --------------------------
# GET por id
# --------------------------
@router.get("/{gasto_id}", response_model=GastoCotidianoSchema)
def get_gasto_cotidiano(
    gasto_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve un gasto cotidiano por id usando SOLO el ORM.

    - Verifica que el gasto exista.
    - Verifica que gasto.user_id == current_user.id (multiusuario).
    - Si no se encuentra o no pertenece al usuario, devuelve 404.
    """
    obj = db.get(models.GastoCotidiano, gasto_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(
            status_code=404,
            detail="Gasto cotidiano no encontrado",
        )
    return obj

# --------------------------
# LISTAR (GET collection)
# --------------------------
@router.get("/", response_model=List[GastoCotidianoSchema])
def list_gastos_cotidianos(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    pagado: Optional[bool] = Query(None),
    tipo_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Búsqueda libre (evento/observaciones)"),
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista gastos cotidianos del usuario autenticado.

    Filtros soportados:
    - month/year: filtra por fecha
    - pagado
    - tipo_id (canon/legacy equivalentes)
    - q: búsqueda en evento/observaciones
    - limit/offset
    """

    qry = db.query(models.GastoCotidiano).filter(
        models.GastoCotidiano.user_id == current_user.id
    )

    # Filtro por mes/año (fecha)
    if year is not None:
        qry = qry.filter(extract("year", models.GastoCotidiano.fecha) == year)
    if month is not None:
        qry = qry.filter(extract("month", models.GastoCotidiano.fecha) == month)

    # pagado
    if pagado is not None:
        qry = qry.filter(models.GastoCotidiano.pagado.is_(pagado))

    # tipo_id con equivalentes canon/legacy
    if tipo_id:
        tipo_id = normalize_upper(tipo_id)
        eq = _tipo_equivalents(tipo_id)
        qry = qry.filter(models.GastoCotidiano.tipo_id.in_(list(eq)))

    # búsqueda libre
    if q:
        qq = f"%{q.strip().upper()}%"
        qry = qry.filter(
            or_(
                func.upper(func.coalesce(models.GastoCotidiano.evento, "")).like(qq),
                func.upper(func.coalesce(models.GastoCotidiano.observaciones, "")).like(qq),
            )
        )

    # Orden + paginación
    qry = qry.order_by(models.GastoCotidiano.fecha.desc(), models.GastoCotidiano.id.desc())
    qry = qry.offset(offset).limit(limit)

    return qry.all()

# --------------------------
# SUGERIR CUENTA
# --------------------------
@router.get("/sugerir_cuenta")
def sugerir_cuenta(
    tipo_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Devuelve la cuenta_id sugerida según el contenedor del tipo cotidiano indicado.

    - Valida que tipo_id sea COTIDIANOS.
    - Busca el contenedor GASTO del usuario actual (user_id).
    - Si no hay contenedor -> sin sugerencia.
    """
    _ensure_tipo_in_cotidianos(db, tipo_id)
    cuenta_id = _cuenta_of_target_gasto(
        db, tipo_id, user_id=current_user.id
    )
    if not cuenta_id:
        return {"cuenta_id": None}

    cta = db.get(models.CuentaBancaria, cuenta_id)
    if not cta or cta.user_id != current_user.id:
        return {"cuenta_id": None}

    return {
        "cuenta_id": cuenta_id,
        "anagrama": getattr(cta, "anagrama", None)
        or getattr(cta, "nombre", None),
        "liquidez": getattr(cta, "liquidez", None),
    }


# --------------------------
# CREAR
# --------------------------
@router.post("/", status_code=status.HTTP_201_CREATED)
def create_gasto_cotidiano(
    gasto_in: GastoCotidianoCreateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un GastoCotidiano para el usuario autenticado:

    - Asigna user_id = current_user.id.
    - Normaliza a MAYÚSCULAS tipo_id, proveedor_id y evento.
      (OBSERVACIONES se mantiene como venga).
    - Valida que tipo_id sea del segmento COTIDIANOS.
    - Ajusta el contenedor GASTO del usuario y la liquidez de su cuenta.
    """
    payload = gasto_in.model_dump()
    payload["pagado"] = bool(payload.get("pagado"))

    # Normalización a MAYÚSCULAS (excepto observaciones)
    if payload.get("tipo_id") is not None:
        payload["tipo_id"] = normalize_upper(payload["tipo_id"])
    if payload.get("proveedor_id") is not None:
        payload["proveedor_id"] = normalize_upper(payload["proveedor_id"])
    if payload.get("evento") is not None:
        payload["evento"] = normalize_upper(payload["evento"])
    # OBSERVACIONES se deja tal cual (puede tener minúsculas, etc.)

    # user_id del propietario
    payload["user_id"] = current_user.id

    # ID generado en backend
    payload.pop("id", None)
    payload["id"] = generate_gasto_cotidiano_id(db)

    tipo_id = payload.get("tipo_id")
    cuenta_id = payload.get("cuenta_id")

    _ensure_tipo_in_cotidianos(db, tipo_id)

    canon_tipo = _canon_of(tipo_id) if tipo_id else None
    is_electricidad = canon_tipo == CANON["ELECTRICIDAD"]

    try:
        db_obj = models.GastoCotidiano(**payload)
        db.add(db_obj)

        importe_val = safe_float(payload.get("importe"))
        # Insertar GC => RESTA contenedor + liquidez
        delta_budget = -importe_val

        info = None
        if delta_budget != 0.0 and tipo_id:
            info = _adjust_container_and_liquidez(
                db,
                tipo_id=tipo_id,
                cuenta_id=cuenta_id,
                delta=delta_budget,
                force_pagado=is_electricidad,
                user_id=current_user.id,
            )

        db.commit()
        db.refresh(db_obj)

        if info:
            if info["exceeded"]:
                msg = (
                    f"Te has pasado {info['new']:.2f}€ en el gasto "
                    f"{info['gasto_nombre']} de lo presupuestado. "
                    "Marcado como PAGADO."
                )
            else:
                if info["new"] > 0:
                    msg = "Insertado. Dentro de presupuesto."
                elif info["new"] == 0:
                    msg = (
                        "Insertado. Presupuesto justo (0€) "
                        "y marcado como PAGADO."
                    )
                else:
                    msg = (
                        "Insertado. Presupuesto sobrepasado "
                        "(importe negativo) y marcado como PAGADO."
                    )
        else:
            msg = "Insertado (no se ha encontrado contenedor para ajustar)."

        return {
            "message": msg,
            "data": GastoCotidianoSchema.model_validate(db_obj),
        }

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"IntegrityError: {str(e.orig)}"
        )
    except DataError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"DataError: {str(e.orig)}"
        )


# --------------------------
# ACTUALIZAR
# --------------------------
@router.put("/{gasto_id}")
def update_gasto_cotidiano(
    gasto_id: str,
    gasto_in: GastoCotidianoUpdateSchema,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza un gasto cotidiano del usuario actual:

    - Verifica que el gasto exista y pertenezca al usuario.
    - Aplica cambios a campos permitidos.
    - Recalcula el impacto en el contenedor GASTO del usuario y su liquidez:
        * Revierte primero el importe antiguo.
        * Aplica después el importe nuevo.
    """
    db_obj = db.get(models.GastoCotidiano, gasto_id)
    if not db_obj or db_obj.user_id != current_user.id:
        raise HTTPException(
            status_code=404, detail="Gasto cotidiano no encontrado"
        )

    data = gasto_in.model_dump(exclude_unset=True)

    # Normalizamos a mayúsculas lo que toca (tipo/proveedor/evento)
    if "tipo_id" in data and data["tipo_id"]:
        data["tipo_id"] = normalize_upper(data["tipo_id"])
    if "proveedor_id" in data and data["proveedor_id"]:
        data["proveedor_id"] = normalize_upper(data["proveedor_id"])
    if "evento" in data and data["evento"] is not None:
        data["evento"] = normalize_upper(data["evento"])
    # OBSERVACIONES se mantiene como venga

    old_tipo_id = db_obj.tipo_id
    old_cuenta_id = db_obj.cuenta_id
    old_importe = safe_float(db_obj.importe)

    if "pagado" in data:
        db_obj.pagado = bool(data.get("pagado"))
    if "fecha" in data and data["fecha"] is not None:
        db_obj.fecha = data["fecha"]
    if "tipo_id" in data and data["tipo_id"]:
        _ensure_tipo_in_cotidianos(db, data["tipo_id"])
        db_obj.tipo_id = data["tipo_id"]
    if "proveedor_id" in data and data["proveedor_id"]:
        db_obj.proveedor_id = data["proveedor_id"]
    if "importe" in data and data["importe"] is not None:
        db_obj.importe = safe_float(data["importe"])
    if "litros" in data:
        db_obj.litros = (
            None if data["litros"] is None else safe_float(data["litros"])
        )
    if "km" in data:
        db_obj.km = None if data["km"] is None else safe_float(data["km"])
    if "precio_litro" in data:
        db_obj.precio_litro = (
            None
            if data["precio_litro"] is None
            else safe_float(data["precio_litro"])
        )
    if "evento" in data:
        db_obj.evento = data["evento"]
    if "observaciones" in data:
        db_obj.observaciones = data["observaciones"]
    if "cuenta_id" in data:
        db_obj.cuenta_id = data["cuenta_id"] or None

    new_tipo_id = db_obj.tipo_id
    new_cuenta_id = db_obj.cuenta_id
    new_importe = safe_float(db_obj.importe)

    canon_new = _canon_of(new_tipo_id) if new_tipo_id else None
    is_electricidad_new = canon_new == CANON["ELECTRICIDAD"]

    try:
        info_new = None

        # Revertimos efecto viejo (sobre contenedor + liquidez del usuario)
        if old_tipo_id and old_importe != 0.0:
            _adjust_container_and_liquidez(
                db,
                tipo_id=old_tipo_id,
                cuenta_id=old_cuenta_id,
                delta=+old_importe,
                force_pagado=False,
                user_id=current_user.id,
            )

        # Aplicamos efecto nuevo
        if new_tipo_id and new_importe != 0.0:
            info_new = _adjust_container_and_liquidez(
                db,
                tipo_id=new_tipo_id,
                cuenta_id=new_cuenta_id,
                delta=-new_importe,
                force_pagado=is_electricidad_new,
                user_id=current_user.id,
            )

        db.commit()
        db.refresh(db_obj)

        if info_new:
            if info_new["exceeded"]:
                msg = (
                    f"Ajuste aplicado: te has pasado {info_new['new']:.2f}€ "
                    f"en el gasto {info_new['gasto_nombre']} de lo "
                    "presupuestado. Marcado como PAGADO."
                )
            else:
                if info_new["new"] > 0:
                    msg = "Ajuste aplicado, dentro de presupuesto."
                elif info_new["new"] == 0:
                    msg = (
                        "Ajuste aplicado: presupuesto justo (0€) "
                        "y marcado como PAGADO."
                    )
                else:
                    msg = (
                        "Ajuste aplicado: presupuesto sobrepasado "
                        "(importe negativo) y marcado como PAGADO."
                    )
        else:
            msg = "Actualizado sin contenedor asociado o sin importe."

        return {
            "message": msg,
            "data": GastoCotidianoSchema.model_validate(db_obj),
        }

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"IntegrityError: {str(e.orig)}"
        )
    except DataError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"DataError: {str(e.orig)}"
        )


# --------------------------
# BORRAR
# --------------------------
@router.delete("/{gasto_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gasto_cotidiano(
    gasto_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Borra un gasto cotidiano del usuario:

    - Verifica propiedad (user_id).
    - Revierte el efecto en contenedor GASTO y liquidez.
    - En caso de ELECTRICIDAD, desmarca el contenedor como pagado.
    """
    db_obj = db.get(models.GastoCotidiano, gasto_id)
    if not db_obj or db_obj.user_id != current_user.id:
        raise HTTPException(
            status_code=404, detail="Gasto cotidiano no encontrado"
        )

    old_tipo_id = db_obj.tipo_id
    old_cuenta_id = db_obj.cuenta_id
    old_importe = safe_float(db_obj.importe)

    try:
        # Revertir presupuesto/liq.
        if old_tipo_id and old_importe != 0.0:
            _adjust_container_and_liquidez(
                db,
                tipo_id=old_tipo_id,
                cuenta_id=old_cuenta_id,
                delta=+old_importe,
                force_pagado=False,
                user_id=current_user.id,
            )

        # Caso ELECTRICIDAD: contenedor deja de estar "pagado"
        canon_tipo = _canon_of(old_tipo_id) if old_tipo_id else None
        if canon_tipo == CANON["ELECTRICIDAD"]:
            cont_tipo = _container_tipo_for_cotidiano(old_tipo_id)
            if cont_tipo:
                target = _find_target_gasto(
                    db, cont_tipo, user_id=current_user.id
                )
                if target:
                    target.pagado = False

        db.delete(db_obj)
        db.commit()
        return None

    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"IntegrityError: {str(e.orig)}"
        )
    except DataError as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"DataError: {str(e.orig)}"
        )
