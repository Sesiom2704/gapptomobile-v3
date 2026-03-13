"""
Ruta: backend/app/api/v1/cuentas_router.py
Versión: 2.0.0
Descripción:
API v1 - CUENTAS BANCARIAS

Responsabilidades:
- Gestionar las cuentas bancarias del usuario autenticado.
- Validar que el banco asociado sea de la rama 'Bancos y financieras'.
- Exponer contadores reales de registros asociados.

Endpoints:
- GET    /api/v1/cuentas          -> listar cuentas
- GET    /api/v1/cuentas/{id}     -> obtener una cuenta
- POST   /api/v1/cuentas          -> crear una cuenta
- PUT    /api/v1/cuentas/{id}     -> actualizar una cuenta
- DELETE /api/v1/cuentas/{id}     -> eliminar una cuenta

Cambios de esta versión:
- Se añade `associated_count` en lectura de cuentas bancarias.
- El contador se calcula desde relaciones reales:
    * gastos
    * ingresos
    * gastos_cotidianos
    * movimientos_origen
    * movimientos_destino
- Se mantiene el anagrama unificado:
    "REFERENCIA - NOMBRE DEL BANCO"
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


# ============================================================
# Schemas locales (solo para CREATE)
# ============================================================

class CuentaBancariaCreateBody(BaseModel):
    """
    Body para CREATE.

    Motivo:
    - Evita 422 si el schema de create externo no coincide con este flujo.
    - El backend siempre asigna user_id desde el usuario autenticado.

    Nota:
    - Aceptamos user_id opcional por compatibilidad, pero se ignora.
    """
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(
        ...,
        description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).",
    )
    activo: Optional[bool] = Field(True, description="Estado activo/inactivo.")
    user_id: Optional[int] = Field(None, description="(Ignorado) Se toma del token.")


# ============================================================
# Helpers internos
# ============================================================

def _normalize_spaces(text: str) -> str:
    """strip() y colapsa múltiples espacios internos en uno."""
    if not text:
        return ""
    return " ".join(text.strip().split())


def _build_anagrama(nombre_banco: str, referencia: str) -> str:
    """
    Regla unificada con la UI:
    ANAGRAMA = "REFERENCIA - NOMBRE DEL BANCO"
    """
    ref = _normalize_spaces(referencia or "")
    banco = _normalize_spaces(nombre_banco or "")
    if ref and banco:
        return f"{ref} - {banco}"
    return ref or banco


def _get_cuenta_for_user(
    db: Session,
    cuenta_id: str,
    current_user: models.User,
) -> models.CuentaBancaria:
    """
    Recupera una cuenta asegurando que pertenece al usuario autenticado.
    """
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
    """
    Convierte filas agregadas SQL [(fk_id, count), ...] a dict.
    """
    out: Dict[str, int] = {}
    for fk_id, qty in query_rows:
        key = str(fk_id or "").strip()
        if not key:
            continue
        out[key] = int(qty or 0)
    return out


def _merge_count_maps(*maps: Dict[str, int]) -> Dict[str, int]:
    """
    Suma múltiples mapas de contadores por la misma clave.
    """
    merged: Dict[str, int] = {}
    for mp in maps:
        for key, value in mp.items():
            merged[key] = merged.get(key, 0) + int(value or 0)
    return merged


def _get_cuenta_associated_count_map(
    db: Session,
    current_user: models.User,
) -> Dict[str, int]:
    """
    Calcula el número real de referencias asociadas por cuenta bancaria.

    Relaciones consideradas:
    - gastos
    - ingresos
    - gastos_cotidianos
    - movimientos_origen
    - movimientos_destino

    Se filtra por user_id cuando el modelo lo soporta para mantener
    consistencia multiusuario.
    """
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

    return _merge_count_maps(
        _build_count_map(gastos_rows),
        _build_count_map(ingresos_rows),
        _build_count_map(cotidianos_rows),
        _build_count_map(movimientos_origen_rows),
        _build_count_map(movimientos_destino_rows),
    )


def _serialize_cuenta(
    obj: models.CuentaBancaria,
    associated_count: int,
) -> dict:
    """
    Serializa una cuenta bancaria con contador asociado.
    """
    return {
        "id": obj.id,
        "banco_id": obj.banco_id,
        "referencia": obj.referencia,
        "anagrama": obj.anagrama,
        "liquidez": float(obj.liquidez or 0),
        "liquidez_inicial": float(obj.liquidez_inicial or 0),
        "user_id": int(obj.user_id),
        "activo": bool(obj.activo),
        "associated_count": int(associated_count or 0),
    }


# ============================================================
# Endpoints
# ============================================================

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
    """
    Devuelve las cuentas bancarias del usuario autenticado.

    Incluye `associated_count` con el número real de registros asociados.
    """
    q = (
        db.query(models.CuentaBancaria)
        .filter(models.CuentaBancaria.user_id == current_user.id)
    )

    if banco_id:
        q = q.filter(models.CuentaBancaria.banco_id == banco_id)

    if activo is not None:
        q = q.filter(models.CuentaBancaria.activo == activo)

    items = q.order_by(models.CuentaBancaria.id).all()
    count_map = _get_cuenta_associated_count_map(db, current_user)

    return [
        _serialize_cuenta(item, count_map.get(item.id, 0))
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
    """
    Recupera una cuenta bancaria por su ID, asegurando que pertenece al usuario actual.
    """
    obj = _get_cuenta_for_user(db, cuenta_id, current_user)
    count_map = _get_cuenta_associated_count_map(db, current_user)
    return _serialize_cuenta(obj, count_map.get(obj.id, 0))


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
    """
    Crea una nueva cuenta bancaria para el usuario autenticado.

    Reglas de negocio:
    - banco_id debe existir y ser rama 'Bancos y financieras'.
    - ID se genera con prefijo 'CTA-'.
    - ANAGRAMA = "REFERENCIA - NOMBRE DEL BANCO".
    - user_id siempre se asigna desde el token.
    """
    proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)

    new_id = generate_cuenta_bancaria_id(db)
    anagrama = _build_anagrama(proveedor.nombre, cuenta_in.referencia)

    obj = models.CuentaBancaria(
        id=new_id,
        banco_id=cuenta_in.banco_id,
        referencia=cuenta_in.referencia,
        anagrama=anagrama,
        user_id=current_user.id,
        activo=True if cuenta_in.activo is None else bool(cuenta_in.activo),
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _serialize_cuenta(obj, 0)


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
    """
    Actualiza una cuenta bancaria del usuario actual.

    Reglas:
    - Solo se puede actualizar si la cuenta pertenece al usuario actual.
    - Si cambian banco_id o referencia y no se envía anagrama -> recalcula anagrama.
    - Si se envía anagrama -> se respeta tal cual.
    - liquidez / liquidez_inicial / activo se aplican solo si vienen en el body.
    """
    obj = _get_cuenta_for_user(db, cuenta_id, current_user)

    recalc_anagrama = False
    proveedor = None

    if cuenta_in.banco_id is not None and cuenta_in.banco_id != obj.banco_id:
        proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)
        obj.banco_id = cuenta_in.banco_id
        recalc_anagrama = True

    if cuenta_in.referencia is not None and cuenta_in.referencia != obj.referencia:
        obj.referencia = cuenta_in.referencia
        recalc_anagrama = True

    if cuenta_in.anagrama is not None:
        obj.anagrama = cuenta_in.anagrama
        recalc_anagrama = False

    if getattr(cuenta_in, "liquidez", None) is not None:
        obj.liquidez = float(cuenta_in.liquidez)

    if getattr(cuenta_in, "liquidez_inicial", None) is not None:
        obj.liquidez_inicial = float(cuenta_in.liquidez_inicial)

    if getattr(cuenta_in, "activo", None) is not None:
        obj.activo = bool(cuenta_in.activo)

    if recalc_anagrama:
        if proveedor is None and obj.banco_id:
            proveedor = db.get(models.Proveedor, obj.banco_id)
        if proveedor:
            obj.anagrama = _build_anagrama(proveedor.nombre, obj.referencia or "")

    db.commit()
    db.refresh(obj)

    count_map = _get_cuenta_associated_count_map(db, current_user)
    return _serialize_cuenta(obj, count_map.get(obj.id, 0))


@router.delete(
    "/{cuenta_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar una cuenta bancaria",
)
def delete_cuenta_bancaria(
    cuenta_id: str,
    db: Session = Depends(get_db),
):
    """
    Elimina una cuenta bancaria por su ID.

    Se mantiene el comportamiento actual.
    """
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )

    db.delete(obj)
    db.commit()
    return None