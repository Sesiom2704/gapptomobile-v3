# backend/app/api/v1/cuentas_router.py

"""
API v1 - CUENTAS BANCARIAS

Responsabilidad:
- Gestionar las cuentas bancarias donde se almacena la liquidez.
- Validar que el banco asociado sea de la rama 'Bancos y financieras'.

Endpoints:
- GET    /api/cuentas          -> listar cuentas (con filtro opcional por banco)
- GET    /api/cuentas/{id}     -> obtener una cuenta por ID
- POST   /api/cuentas          -> crear una cuenta
- PUT    /api/cuentas/{id}     -> actualizar una cuenta
- DELETE /api/cuentas/{id}     -> eliminar una cuenta
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
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.cuentas import (
    CuentaBancariaCreate,
    CuentaBancariaUpdate,
    CuentaBancariaRead,
)
from backend.app.utils.id_utils import generate_cuenta_bancaria_id
from backend.app.utils.proveedor_utils import ensure_proveedor_es_banco


router = APIRouter(
    prefix="/cuentas",
    tags=["cuentas"],
)


# ============================================================
# Helpers internos
# ============================================================

def _build_anagrama(nombre_banco: str, referencia: str) -> str:
    """
    Construye un ANAGRAMA estándar a partir del nombre del banco
    y la referencia de la cuenta.

    Regla:
    - 4 primeras letras del nombre del banco (sin espacios, en mayúsculas)
    - "_"
    - 4 primeras letras de la referencia (sin espacios, en mayúsculas)

    Ejemplo:
    - nombre_banco = "Banco Santander"
      referencia   = "NÓMINA PRINCIPAL"
      -> "BANC_NÓMI"
    """
    nombre_clean = (nombre_banco or "").replace(" ", "").upper()
    ref_clean = (referencia or "").replace(" ", "").upper()
    return f"{nombre_clean[:4]}_{ref_clean[:4]}"


# ============================================================
# Endpoints
# ============================================================

@router.get(
    "/",
    response_model=List[CuentaBancariaRead],
    summary="Listar cuentas bancarias",
)
def list_cuentas_bancarias(
    banco_id: Optional[str] = Query(
        None,
        description="Si se indica, filtra solo las cuentas de este banco/proveedor.",
    ),
    db: Session = Depends(get_db),
):
    """
    Devuelve el listado de cuentas bancarias.

    - Sin parámetros -> todas las cuentas.
    - Con banco_id   -> solo las cuentas cuyo banco_id coincide.
    """
    q = db.query(models.CuentaBancaria)

    if banco_id:
        q = q.filter(models.CuentaBancaria.banco_id == banco_id)

    return q.order_by(models.CuentaBancaria.id).all()


@router.get(
    "/{cuenta_id}",
    response_model=CuentaBancariaRead,
    summary="Obtener una cuenta bancaria por ID",
)
def get_cuenta_bancaria(
    cuenta_id: str,
    db: Session = Depends(get_db),
):
    """
    Recupera una cuenta bancaria por su ID.

    Si no existe, devuelve 404.
    """
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )
    return obj


@router.post(
    "/",
    response_model=CuentaBancariaRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una cuenta bancaria",
)
def create_cuenta_bancaria(
    cuenta_in: CuentaBancariaCreate,
    db: Session = Depends(get_db),
):
    """
    Crea una nueva cuenta bancaria.

    Reglas de negocio:
    - El banco asociado (`banco_id`) debe:
        * existir en la tabla de proveedores.
        * pertenecer a la rama 'Bancos y financieras'.
    - El ID de la cuenta se genera automáticamente con prefijo 'CTA-'.
    - El ANAGRAMA se calcula a partir del nombre del banco y la referencia.
    - La liquidez inicial queda en 0.0 (por defecto de la BD).
    """
    # 1) Validar proveedor y que sea banco
    proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)

    # 2) Generar ID único
    new_id = generate_cuenta_bancaria_id(db)

    # 3) Construir anagrama
    anagrama = _build_anagrama(proveedor.nombre, cuenta_in.referencia)

    obj = models.CuentaBancaria(
        id=new_id,
        banco_id=cuenta_in.banco_id,
        referencia=cuenta_in.referencia,
        anagrama=anagrama,
        # liquidez se deja al default de BD (0.0)
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)

    return obj


@router.put(
    "/{cuenta_id}",
    response_model=CuentaBancariaRead,
    summary="Actualizar una cuenta bancaria",
)
def update_cuenta_bancaria(
    cuenta_id: str,
    cuenta_in: CuentaBancariaUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza una cuenta bancaria existente.

    Reglas de negocio:
    - Si se cambia `banco_id`, el nuevo proveedor debe ser de la rama
      'Bancos y financieras'.
    - Si cambian `banco_id` o `referencia` y NO se envía `anagrama`,
      el anagrama se recalcula automáticamente.
    - Si se envía `anagrama`, se respeta tal cual (no se recalcula).
    - La `liquidez` solo se modifica si se envía en el body.
    """
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )

    recalc_anagrama = False
    proveedor = None

    # 1) Posible cambio de banco
    if cuenta_in.banco_id is not None and cuenta_in.banco_id != obj.banco_id:
        proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)
        obj.banco_id = cuenta_in.banco_id
        recalc_anagrama = True

    # 2) Posible cambio de referencia
    if cuenta_in.referencia is not None and cuenta_in.referencia != obj.referencia:
        obj.referencia = cuenta_in.referencia
        recalc_anagrama = True

    # 3) Cambio explícito de anagrama
    if cuenta_in.anagrama is not None:
        obj.anagrama = cuenta_in.anagrama
        # Si el usuario lo fija manualmente, no lo recalculamos
        recalc_anagrama = False

    # 4) Cambio de liquidez (opcional)
    if cuenta_in.liquidez is not None:
        obj.liquidez = float(cuenta_in.liquidez)

    # 5) Recalcular anagrama si hace falta
    if recalc_anagrama:
        if proveedor is None and obj.banco_id:
            proveedor = db.get(models.Proveedor, obj.banco_id)
        if proveedor:
            obj.anagrama = _build_anagrama(
                proveedor.nombre,
                obj.referencia or "",
            )

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

    Nota:
    - Si existen gastos/ingresos/gastos cotidianos que referencian esta
      cuenta, la BD puede impedir el borrado (error de integridad).
      En ese caso, se devolverá un error 500 hasta que se añada una
      validación más específica.
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
