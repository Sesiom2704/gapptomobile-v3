# backend/app/api/v1/cuentas_router.py

"""
API v1 - CUENTAS BANCARIAS

Responsabilidad:
- Gestionar las cuentas bancarias donde se almacena la liquidez.
- Validar que el banco asociado sea de la rama 'Bancos y financieras'.

Endpoints:
- GET    /api/cuentas          -> listar cuentas (con filtro opcional por banco y/o usuario)
- GET    /api/cuentas/{id}     -> obtener una cuenta por ID
- POST   /api/cuentas          -> crear una cuenta
- PUT    /api/cuentas/{id}     -> actualizar una cuenta
- DELETE /api/cuentas/{id}     -> eliminar una cuenta

NOTA IMPORTANTE (corrección clave):
- El ANAGRAMA debe ser consistente con la app: "REFERENCIA - NOMBRE DEL BANCO".
  Antes se estaba generando abreviado (ej. MEDI_CRÉD). Ahora se unifica.

SEGURIDAD / PROPIEDAD:
- Create asigna user_id desde el usuario autenticado (no lo manda el cliente).
- Update y Get validan que la cuenta pertenece al usuario autenticado.
- Delete se deja tal cual lo tenías (tú dices que ya funciona). Si quieres, luego lo blindamos igual.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
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
# Dependencia de usuario actual
# ============================================================
# Intentamos usar tu dependencia real (si existe). Si no existe,
# usamos un fallback con header X-User-Id para no bloquear desarrollo.
#
# Recomendado: tener get_current_user y eliminar el fallback.
try:
    # AJUSTA este import si tu proyecto lo tiene en otro sitio.
    from backend.app.api.deps import get_current_user as _get_current_user  # type: ignore
except Exception:  # pragma: no cover
    _get_current_user = None  # type: ignore


if _get_current_user is not None:
    # Caso normal: tu proyecto ya tiene auth y get_current_user funciona.
    def current_user_dep(user: models.User = Depends(_get_current_user)) -> models.User:
        return user
else:
    # Fallback: si NO existe get_current_user, exigimos X-User-Id (solo dev).
    def current_user_dep(
        request: Request,
        db: Session = Depends(get_db),
    ) -> models.User:
        user_id_raw = request.headers.get("X-User-Id")
        if not user_id_raw:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Falta autenticación. Configura get_current_user o envía X-User-Id (solo dev).",
            )
        try:
            user_id = int(user_id_raw)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="X-User-Id debe ser un entero.",
            )

        user = db.get(models.User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario no válido.",
            )
        return user


# ============================================================
# Helpers internos
# ============================================================

def _normalize_spaces(text: str) -> str:
    """
    Normaliza espacios:
    - strip() en extremos
    - colapsa espacios internos múltiples a uno
    """
    if not text:
        return ""
    return " ".join(text.strip().split())


def _build_anagrama(nombre_banco: str, referencia: str) -> str:
    """
    Construye un ANAGRAMA estándar unificado con el front.

    Regla (LA QUE TU UI DICE):
    - "REFERENCIA - NOMBRE DEL BANCO"

    Ejemplo:
    - nombre_banco = "MEDIOLANUM BANCO"
      referencia   = "CRÉDITO"
      -> "CRÉDITO - MEDIOLANUM BANCO"
    """
    ref = _normalize_spaces(referencia or "")
    banco = _normalize_spaces(nombre_banco or "")

    if ref and banco:
        return f"{ref} - {banco}"
    return ref or banco


def _assert_ownership(obj: models.CuentaBancaria, current_user: models.User) -> None:
    """
    Garantiza que la cuenta pertenece al usuario autenticado.
    """
    if obj.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos sobre esta cuenta.",
        )


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
    user_id: Optional[int] = Query(
        None,
        description="Si se indica, filtra solo las cuentas de este usuario. Si no se indica, usa el usuario autenticado.",
    ),
    activo: Optional[bool] = Query(
        None,
        description="Si se indica, filtra por estado activo/inactivo.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(current_user_dep),
):
    """
    Devuelve el listado de cuentas bancarias.

    Seguridad:
    - Por defecto lista SOLO las cuentas del usuario autenticado.
    - Si se pasa user_id y no coincide con el usuario autenticado -> 403.
    """
    q = db.query(models.CuentaBancaria)

    # Evita devolver registros legacy huérfanos (user_id NULL) que podrían romper respuestas
    q = q.filter(models.CuentaBancaria.user_id.isnot(None))

    # Si user_id no se indica, usamos el del usuario actual
    effective_user_id = current_user.id if user_id is None else user_id

    # Si intentan consultar otro user_id, bloqueamos (no hay roles/admin aquí)
    if effective_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No puedes listar cuentas de otro usuario.",
        )

    q = q.filter(models.CuentaBancaria.user_id == effective_user_id)

    if banco_id:
        q = q.filter(models.CuentaBancaria.banco_id == banco_id)

    if activo is not None:
        q = q.filter(models.CuentaBancaria.activo == activo)

    return q.order_by(models.CuentaBancaria.id).all()


@router.get(
    "/{cuenta_id}",
    response_model=CuentaBancariaRead,
    summary="Obtener una cuenta bancaria por ID",
)
def get_cuenta_bancaria(
    cuenta_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(current_user_dep),
):
    """
    Recupera una cuenta bancaria por su ID.

    Seguridad:
    - Solo permite leer cuentas del usuario autenticado.
    """
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )

    _assert_ownership(obj, current_user)
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
    current_user: models.User = Depends(current_user_dep),
):
    """
    Crea una nueva cuenta bancaria.

    Reglas de negocio:
    - banco_id debe existir y ser de la rama 'Bancos y financieras'.
    - ID se genera con prefijo 'CTA-'.
    - ANAGRAMA se calcula como "REFERENCIA - NOMBRE DEL BANCO".
    - user_id se asigna desde el usuario autenticado (NO desde el cliente).
    """
    # 1) Validar proveedor y que sea banco
    proveedor = ensure_proveedor_es_banco(db, cuenta_in.banco_id)

    # 2) Generar ID único
    new_id = generate_cuenta_bancaria_id(db)

    # 3) Construir anagrama unificado con el front
    anagrama = _build_anagrama(proveedor.nombre, cuenta_in.referencia)

    # 4) Crear objeto (user_id SIEMPRE desde current_user)
    obj = models.CuentaBancaria(
        id=new_id,
        banco_id=cuenta_in.banco_id,
        referencia=cuenta_in.referencia,
        anagrama=anagrama,
        user_id=current_user.id,
        activo=True if getattr(cuenta_in, "activo", None) is None else bool(getattr(cuenta_in, "activo")),
        # liquidez y liquidez_inicial se dejan a default de BD (0.0)
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
    current_user: models.User = Depends(current_user_dep),
):
    """
    Actualiza una cuenta bancaria existente.

    Seguridad:
    - Solo permite actualizar cuentas del usuario autenticado.

    Reglas de negocio:
    - Si se cambia banco_id -> debe ser banco/financiera.
    - Si cambian banco_id o referencia y NO se envía anagrama -> recalcula anagrama (regla unificada).
    - Si se envía anagrama -> se respeta tal cual (no se recalcula).
    - liquidez / liquidez_inicial / activo se actualizan solo si vienen en body.
    """
    obj = db.get(models.CuentaBancaria, cuenta_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta bancaria no encontrada.",
        )

    _assert_ownership(obj, current_user)

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

    # 3) Cambio explícito de anagrama (si el cliente lo manda, se respeta)
    if cuenta_in.anagrama is not None:
        obj.anagrama = cuenta_in.anagrama
        recalc_anagrama = False

    # 4) Cambio de liquidez (opcional)
    if getattr(cuenta_in, "liquidez", None) is not None:
        obj.liquidez = float(cuenta_in.liquidez)

    # 5) Cambio de liquidez_inicial (opcional)
    if getattr(cuenta_in, "liquidez_inicial", None) is not None:
        obj.liquidez_inicial = float(cuenta_in.liquidez_inicial)

    # 6) Cambio de activo (opcional)
    if getattr(cuenta_in, "activo", None) is not None:
        obj.activo = bool(cuenta_in.activo)

    # 7) Recalcular anagrama si hace falta (regla unificada)
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
