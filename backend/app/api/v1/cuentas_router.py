# backend/app/api/v1/cuentas_router.py

"""
API v1 - CUENTAS BANCARIAS

Responsabilidad:
- Gestionar las cuentas bancarias donde se almacena la liquidez.
- Validar que el banco asociado sea de la rama 'Bancos y financieras'.

Endpoints:
- GET    /api/cuentas          -> listar cuentas (filtrado por usuario autenticado)
- GET    /api/cuentas/{id}     -> obtener una cuenta por ID (del usuario autenticado)
- POST   /api/cuentas          -> crear una cuenta (user_id = usuario autenticado)
- PUT    /api/cuentas/{id}     -> actualizar una cuenta (solo si es del usuario autenticado)
- DELETE /api/cuentas/{id}     -> eliminar una cuenta (solo si es del usuario autenticado)

NOTA IMPORTANTE (corrección clave):
- El ANAGRAMA debe ser consistente con la app: "REFERENCIA - NOMBRE DEL BANCO".
  Antes se estaba generando abreviado (ej. MEDI_CRÉD). Ahora se unifica.

AUTH:
- Se usa la misma dependencia que en ingresos_router: require_user
  (backend.app.api.v1.auth_router).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

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
    - Evita 422 si tu schema CuentaBancariaCreate todavía exige user_id.
    - El backend SIEMPRE asigna user_id desde el usuario autenticado.

    Nota:
    - Aceptamos user_id opcional por compatibilidad, pero se ignora.
    """
    banco_id: str = Field(..., description="ID del proveedor (banco/financiera).")
    referencia: str = Field(..., description="Etiqueta de la cuenta (ej. NÓMINA, GASTOS, CRÉDITO).")
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
    (Mismo patrón que _get_ingreso_for_user en ingresos_router)
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

    Importante:
    - Esto evita devolver cuentas con user_id NULL (legacy) y evita el
      ResponseValidationError (user_id None) en el response_model.
    """
    q = (
        db.query(models.CuentaBancaria)
        .filter(models.CuentaBancaria.user_id == current_user.id)
    )

    if banco_id:
        q = q.filter(models.CuentaBancaria.banco_id == banco_id)

    if activo is not None:
        q = q.filter(models.CuentaBancaria.activo == activo)

    return q.order_by(models.CuentaBancaria.id).all()


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
    return _get_cuenta_for_user(db, cuenta_id, current_user)


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
    - user_id SIEMPRE se asigna desde el token (current_user.id).
    """
    # 1) Validar proveedor y que sea banco
    proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)

    # 2) Generar ID único
    new_id = generate_cuenta_bancaria_id(db)

    # 3) Construir anagrama unificado con el front
    anagrama = _build_anagrama(proveedor.nombre, cuenta_in.referencia)

    # 4) Crear objeto
    obj = models.CuentaBancaria(
        id=new_id,
        banco_id=cuenta_in.banco_id,
        referencia=cuenta_in.referencia,
        anagrama=anagrama,
        user_id=current_user.id,  # ✅ clave: nunca viene del cliente
        activo=True if cuenta_in.activo is None else bool(cuenta_in.activo),
        # liquidez y liquidez_inicial se dejan a default de BD (0.0)
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


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
    - Si cambian banco_id o referencia y NO se envía anagrama -> recalcula anagrama (regla unificada).
    - Si se envía anagrama -> se respeta tal cual (no se recalcula).
    - liquidez / liquidez_inicial / activo se aplican solo si vienen en el body.
    """
    obj = _get_cuenta_for_user(db, cuenta_id, current_user)

    recalc_anagrama = False
    proveedor = None

    # 1) Cambio de banco (si procede)
    if cuenta_in.banco_id is not None and cuenta_in.banco_id != obj.banco_id:
        proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)
        obj.banco_id = cuenta_in.banco_id
        recalc_anagrama = True

    # 2) Cambio de referencia (si procede)
    if cuenta_in.referencia is not None and cuenta_in.referencia != obj.referencia:
        obj.referencia = cuenta_in.referencia
        recalc_anagrama = True

    # 3) Anagrama manual (si viene, manda sobre el cálculo)
    if cuenta_in.anagrama is not None:
        obj.anagrama = cuenta_in.anagrama
        recalc_anagrama = False

    # 4) Liquidez (opcional)
    if getattr(cuenta_in, "liquidez", None) is not None:
        obj.liquidez = float(cuenta_in.liquidez)

    # 5) Liquidez inicial (opcional)
    if getattr(cuenta_in, "liquidez_inicial", None) is not None:
        obj.liquidez_inicial = float(cuenta_in.liquidez_inicial)

    # 6) Activo (opcional)
    if getattr(cuenta_in, "activo", None) is not None:
        obj.activo = bool(cuenta_in.activo)

    # 7) Recalcular anagrama si hace falta
    if recalc_anagrama:
        if proveedor is None and obj.banco_id:
            proveedor = db.get(models.Proveedor, obj.banco_id)
        if proveedor:
            obj.anagrama = _build_anagrama(proveedor.nombre, obj.referencia or "")

    db.commit()
    db.refresh(obj)
    return obj


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

    (Lo dejo como lo tenías porque dices que ya funciona.)
    Si quieres blindarlo igual que el resto, dímelo y lo adapto con require_user.
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
