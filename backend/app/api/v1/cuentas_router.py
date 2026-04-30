"""
Ruta: backend/app/api/v1/cuentas_router.py
Versión: 2.2.0
Descripción:
API v1 - CUENTAS BANCARIAS

Responsabilidades:
- Gestionar las cuentas bancarias del usuario autenticado.
- Validar que el banco asociado sea de la rama 'Bancos y financieras'.
- Exponer contadores reales de registros asociados.
- Permitir configurar participación de cuenta.

Endpoints:
- GET    /api/v1/cuentas          -> listar cuentas
- GET    /api/v1/cuentas/{id}     -> obtener una cuenta
- POST   /api/v1/cuentas          -> crear una cuenta
- PUT    /api/v1/cuentas/{id}     -> actualizar una cuenta
- DELETE /api/v1/cuentas/{id}     -> eliminar una cuenta

Regla de participación:
- participacion_pct se guarda como porcentaje:
    100 = cuenta propia completa
    50  = cuenta compartida al 50%
- No afecta a movimientos reales.
- Se usa para calcular liquidez ponderada en Home.
"""

from __future__ import annotations

from typing import List, Optional, Dict

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.cuentas import (
    CuentaBancariaUpdate,
    CuentaBancariaRead,
)
from backend.app.utils.id_utils import generate_cuenta_bancaria_id
from backend.app.utils.proveedor_utils import ensure_proveedor_es_banco
from backend.app.api.v1.auth_router import require_user


router = APIRouter(
    prefix="/cuentas",
    tags=["cuentas"],
)


class CuentaBancariaCreateBody(BaseModel):
    """
    Body para CREATE.

    Nota:
    - user_id opcional se acepta por compatibilidad, pero se ignora.
    - liquidez_inicial ahora sí se persiste al crear.
    - participacion_pct permite cuentas compartidas.
    """
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(
        ...,
        description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).",
    )
    liquidez_inicial: Optional[float] = Field(0.0, description="Liquidez inicial de la cuenta.")
    participacion_pct: float = Field(
        100.0,
        ge=0.01,
        le=100.0,
        description="Porcentaje de participación. 100=total, 50=mitad.",
    )
    activo: Optional[bool] = Field(True, description="Estado activo/inactivo.")
    user_id: Optional[int] = Field(None, description="(Ignorado) Se toma del token.")


def _normalize_spaces(text: str) -> str:
    if not text:
        return ""
    return " ".join(text.strip().split())


def _build_anagrama(nombre_banco: str, referencia: str) -> str:
    ref = _normalize_spaces(referencia or "")
    banco = _normalize_spaces(nombre_banco or "")
    if ref and banco:
        return f"{ref} - {banco}"
    return ref or banco


def _safe_participacion_pct(value) -> float:
    """
    Normaliza participación de cuenta.

    Compatibilidad:
    - None o valores inválidos => 100
    - Rango válido: 0.01 a 100
    """
    try:
        val = float(value)
    except Exception:
        return 100.0

    if val <= 0:
        return 100.0
    if val > 100:
        return 100.0

    return round(val, 2)


def _get_cuenta_for_user(
    db: Session,
    cuenta_id: str,
    current_user: models.User,
) -> models.CuentaBancaria:
    obj = (
        db.query(models.CuentaBancaria)
        .filter(
            models.CuentaBancaria.id == cuenta_id,
            models.CuentaBancaria.user_id == current_user.id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Cuenta bancaria no encontrada")
    return obj


def _build_count_map(query_rows: list[tuple[str, int]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for fk_id, qty in query_rows:
        key = str(fk_id or "").strip()
        if not key:
            continue
        out[key] = int(qty or 0)
    return out


def _merge_count_maps(*maps: Dict[str, int]) -> Dict[str, int]:
    merged: Dict[str, int] = {}
    for mp in maps:
        for key, value in mp.items():
            merged[key] = merged.get(key, 0) + int(value or 0)
    return merged


def _make_relation_counts(defs: list[tuple[str, str, Dict[str, int]]], entity_id: str) -> list[dict]:
    rows: list[dict] = []
    for key, label, mp in defs:
        count = int(mp.get(entity_id, 0))
        if count > 0:
            rows.append({
                "key": key,
                "label": label,
                "count": count,
            })
    return rows


def _get_cuenta_relation_maps(
    db: Session,
    current_user: models.User,
) -> dict[str, Dict[str, int]]:
    gastos_rows = (
        db.query(models.Gasto.cuenta_id, func.count(models.Gasto.id))
        .filter(
            models.Gasto.cuenta_id.isnot(None),
            models.Gasto.user_id == current_user.id,
        )
        .group_by(models.Gasto.cuenta_id)
        .all()
    )

    ingresos_rows = (
        db.query(models.Ingreso.cuenta_id, func.count(models.Ingreso.id))
        .filter(
            models.Ingreso.cuenta_id.isnot(None),
            models.Ingreso.user_id == current_user.id,
        )
        .group_by(models.Ingreso.cuenta_id)
        .all()
    )

    cotidianos_rows = (
        db.query(models.GastoCotidiano.cuenta_id, func.count(models.GastoCotidiano.id))
        .filter(
            models.GastoCotidiano.cuenta_id.isnot(None),
            models.GastoCotidiano.user_id == current_user.id,
        )
        .group_by(models.GastoCotidiano.cuenta_id)
        .all()
    )

    movimientos_origen_rows = (
        db.query(models.MovimientoCuenta.cuenta_origen_id, func.count(models.MovimientoCuenta.id))
        .filter(
            models.MovimientoCuenta.cuenta_origen_id.isnot(None),
            models.MovimientoCuenta.user_id == current_user.id,
        )
        .group_by(models.MovimientoCuenta.cuenta_origen_id)
        .all()
    )

    movimientos_destino_rows = (
        db.query(models.MovimientoCuenta.cuenta_destino_id, func.count(models.MovimientoCuenta.id))
        .filter(
            models.MovimientoCuenta.cuenta_destino_id.isnot(None),
            models.MovimientoCuenta.user_id == current_user.id,
        )
        .group_by(models.MovimientoCuenta.cuenta_destino_id)
        .all()
    )

    return {
        "gastos": _build_count_map(gastos_rows),
        "ingresos": _build_count_map(ingresos_rows),
        "gastos_cotidianos": _build_count_map(cotidianos_rows),
        "movimientos_origen": _build_count_map(movimientos_origen_rows),
        "movimientos_destino": _build_count_map(movimientos_destino_rows),
    }


def _serialize_cuenta(
    obj: models.CuentaBancaria,
    associated_count: int,
    relation_counts: Optional[list[dict]] = None,
) -> dict:
    return {
        "id": obj.id,
        "banco_id": obj.banco_id,
        "referencia": obj.referencia,
        "anagrama": obj.anagrama,
        "liquidez": float(obj.liquidez or 0),
        "liquidez_inicial": float(obj.liquidez_inicial or 0),
        "participacion_pct": _safe_participacion_pct(getattr(obj, "participacion_pct", 100.0)),
        "user_id": int(obj.user_id),
        "activo": bool(obj.activo),
        "associated_count": int(associated_count or 0),
        "relation_counts": relation_counts or [],
    }


@router.get(
    "/",
    response_model=List[CuentaBancariaRead],
    summary="Listar cuentas bancarias (usuario actual)",
)
@router.get(
    "",
    response_model=List[CuentaBancariaRead],
    include_in_schema=False,
)
def list_cuentas_bancarias(
    banco_id: Optional[str] = Query(
        None,
        description="Si se indica, filtra solo las cuentas de este banco/proveedor.",
    ),
    activo: Optional[bool] = Query(
        None,
        description="Si se indica, filtra por estado activo/inactivo.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    q = (
        db.query(models.CuentaBancaria)
        .filter(models.CuentaBancaria.user_id == current_user.id)
    )

    if banco_id:
        q = q.filter(models.CuentaBancaria.banco_id == banco_id)

    if activo is not None:
        q = q.filter(models.CuentaBancaria.activo == activo)

    items = q.order_by(models.CuentaBancaria.id).all()

    relation_maps = _get_cuenta_relation_maps(db, current_user)
    relation_defs = [
        ("gastos", "Gastos", relation_maps["gastos"]),
        ("ingresos", "Ingresos", relation_maps["ingresos"]),
        ("gastos_cotidianos", "Gastos cotidianos", relation_maps["gastos_cotidianos"]),
        ("movimientos_origen", "Movimientos origen", relation_maps["movimientos_origen"]),
        ("movimientos_destino", "Movimientos destino", relation_maps["movimientos_destino"]),
    ]

    merged = _merge_count_maps(
        relation_maps["gastos"],
        relation_maps["ingresos"],
        relation_maps["gastos_cotidianos"],
        relation_maps["movimientos_origen"],
        relation_maps["movimientos_destino"],
    )

    return [
        _serialize_cuenta(
            item,
            merged.get(item.id, 0),
            _make_relation_counts(relation_defs, item.id),
        )
        for item in items
    ]


@router.get(
    "/{cuenta_id}",
    response_model=CuentaBancariaRead,
    summary="Obtener una cuenta bancaria por ID (usuario actual)",
)
def get_cuenta_bancaria(
    cuenta_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = _get_cuenta_for_user(db, cuenta_id, current_user)

    relation_maps = _get_cuenta_relation_maps(db, current_user)
    relation_defs = [
        ("gastos", "Gastos", relation_maps["gastos"]),
        ("ingresos", "Ingresos", relation_maps["ingresos"]),
        ("gastos_cotidianos", "Gastos cotidianos", relation_maps["gastos_cotidianos"]),
        ("movimientos_origen", "Movimientos origen", relation_maps["movimientos_origen"]),
        ("movimientos_destino", "Movimientos destino", relation_maps["movimientos_destino"]),
    ]

    merged = _merge_count_maps(
        relation_maps["gastos"],
        relation_maps["ingresos"],
        relation_maps["gastos_cotidianos"],
        relation_maps["movimientos_origen"],
        relation_maps["movimientos_destino"],
    )

    return _serialize_cuenta(
        obj,
        merged.get(obj.id, 0),
        _make_relation_counts(relation_defs, obj.id),
    )


@router.post(
    "/",
    response_model=CuentaBancariaRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una cuenta bancaria (usuario actual)",
)
@router.post(
    "",
    response_model=CuentaBancariaRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def create_cuenta_bancaria(
    cuenta_in: CuentaBancariaCreateBody,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)

    liquidez_inicial = float(cuenta_in.liquidez_inicial or 0.0)
    if liquidez_inicial < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La liquidez inicial no puede ser negativa.",
        )

    new_id = generate_cuenta_bancaria_id(db)
    referencia = _normalize_spaces(cuenta_in.referencia).upper()
    anagrama = _build_anagrama(proveedor.nombre, referencia)

    obj = models.CuentaBancaria(
        id=new_id,
        banco_id=cuenta_in.banco_id,
        referencia=referencia,
        anagrama=anagrama,
        liquidez_inicial=liquidez_inicial,
        liquidez=liquidez_inicial,
        participacion_pct=_safe_participacion_pct(cuenta_in.participacion_pct),
        user_id=current_user.id,
        activo=True if cuenta_in.activo is None else bool(cuenta_in.activo),
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)

    return _serialize_cuenta(obj, 0, [])


@router.put(
    "/{cuenta_id}",
    response_model=CuentaBancariaRead,
    summary="Actualizar una cuenta bancaria (usuario actual)",
)
def update_cuenta_bancaria(
    cuenta_id: str,
    cuenta_in: CuentaBancariaUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    obj = _get_cuenta_for_user(db, cuenta_id, current_user)

    recalc_anagrama = False
    proveedor = None

    if cuenta_in.banco_id is not None and cuenta_in.banco_id != obj.banco_id:
        proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)
        obj.banco_id = cuenta_in.banco_id
        recalc_anagrama = True

    if cuenta_in.referencia is not None and cuenta_in.referencia != obj.referencia:
        obj.referencia = _normalize_spaces(cuenta_in.referencia).upper()
        recalc_anagrama = True

    if cuenta_in.anagrama is not None:
        obj.anagrama = cuenta_in.anagrama
        recalc_anagrama = False

    if getattr(cuenta_in, "liquidez", None) is not None:
        if float(cuenta_in.liquidez) < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La liquidez no puede ser negativa.",
            )
        obj.liquidez = float(cuenta_in.liquidez)

    if getattr(cuenta_in, "liquidez_inicial", None) is not None:
        if float(cuenta_in.liquidez_inicial) < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La liquidez inicial no puede ser negativa.",
            )
        obj.liquidez_inicial = float(cuenta_in.liquidez_inicial)

    if getattr(cuenta_in, "participacion_pct", None) is not None:
        obj.participacion_pct = _safe_participacion_pct(cuenta_in.participacion_pct)

    if getattr(cuenta_in, "activo", None) is not None:
        obj.activo = bool(cuenta_in.activo)

    if recalc_anagrama:
        if proveedor is None and obj.banco_id:
            proveedor = db.get(models.Proveedor, obj.banco_id)
        if proveedor:
            obj.anagrama = _build_anagrama(proveedor.nombre, obj.referencia or "")

    db.commit()
    db.refresh(obj)

    relation_maps = _get_cuenta_relation_maps(db, current_user)
    relation_defs = [
        ("gastos", "Gastos", relation_maps["gastos"]),
        ("ingresos", "Ingresos", relation_maps["ingresos"]),
        ("gastos_cotidianos", "Gastos cotidianos", relation_maps["gastos_cotidianos"]),
        ("movimientos_origen", "Movimientos origen", relation_maps["movimientos_origen"]),
        ("movimientos_destino", "Movimientos destino", relation_maps["movimientos_destino"]),
    ]

    merged = _merge_count_maps(
        relation_maps["gastos"],
        relation_maps["ingresos"],
        relation_maps["gastos_cotidianos"],
        relation_maps["movimientos_origen"],
        relation_maps["movimientos_destino"],
    )

    return _serialize_cuenta(
        obj,
        merged.get(obj.id, 0),
        _make_relation_counts(relation_defs, obj.id),
    )


@router.delete(
    "/{cuenta_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una cuenta bancaria",
)
def delete_cuenta_bancaria(
    cuenta_id: str,
    db: Session = Depends(get_db),
):
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None