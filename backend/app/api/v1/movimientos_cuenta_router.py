# app/api/v1/movimientos_cuenta_router.py

import secrets
from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session, aliased
from sqlalchemy import and_, desc, or_

from backend.app.db.session import get_db
from backend.app.db.models import MovimientoCuenta, CuentaBancaria, User
from backend.app.schemas.movimiento_cuenta import (
    MovimientoCuentaCreate,
    MovimientoCuentaRead,
    MovimientoCuentaListItem,
    AjusteLiquidezPayload,
)
from backend.app.api.v1.auth_router import require_user

router = APIRouter(
    prefix="/movimientos-cuenta",
    tags=["movimientos_cuenta"],
)


def generar_id_movimiento() -> str:
    token = secrets.token_hex(4).upper()
    return f"MOV-{token}"

@router.post(
    "",
    response_model=MovimientoCuentaRead,
    status_code=status.HTTP_201_CREATED,
)

def crear_movimiento_cuenta(
    payload: MovimientoCuentaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """
    Crea un movimiento entre cuentas:
    - Descarga importe de cuenta_origen
    - Carga importe en cuenta_destino
    - Registra el movimiento en la tabla movimientos_cuenta
    """

    if payload.cuenta_origen_id == payload.cuenta_destino_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cuenta de origen y la de destino no pueden ser la misma.",
        )

    # Buscar cuentas
    cuenta_origen: Optional[CuentaBancaria] = (
        db.query(CuentaBancaria)
        .filter(CuentaBancaria.id == payload.cuenta_origen_id)
        .first()
    )
    cuenta_destino: Optional[CuentaBancaria] = (
        db.query(CuentaBancaria)
        .filter(CuentaBancaria.id == payload.cuenta_destino_id)
        .first()
    )

    if not cuenta_origen:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta de origen no encontrada.",
        )

    if not cuenta_destino:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta de destino no encontrada.",
        )

    # Importe positivo obligatorio
    if payload.importe is None or payload.importe <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El importe debe ser mayor que cero.",
        )

    # Normalizar importe a Decimal (por si llega como float)
    importe_dec = (
        payload.importe
        if isinstance(payload.importe, Decimal)
        else Decimal(str(payload.importe))
    )

    try:
        # Asegurarnos de que liquidez también es Decimal
        liquidez_origen = (
            cuenta_origen.liquidez
            if isinstance(cuenta_origen.liquidez, Decimal)
            else Decimal(str(cuenta_origen.liquidez or 0))
        )
        liquidez_destino = (
            cuenta_destino.liquidez
            if isinstance(cuenta_destino.liquidez, Decimal)
            else Decimal(str(cuenta_destino.liquidez or 0))
        )

        # 👉 Guardamos saldos "antes"
        saldo_origen_antes = liquidez_origen
        saldo_destino_antes = liquidez_destino

        # Aplicamos el movimiento
        cuenta_origen.liquidez = liquidez_origen - importe_dec
        cuenta_destino.liquidez = liquidez_destino + importe_dec

        # 👉 Guardamos saldos "después"
        saldo_origen_despues = cuenta_origen.liquidez
        saldo_destino_despues = cuenta_destino.liquidez

        # Crear registro de movimiento
        mov = MovimientoCuenta(
            id=generar_id_movimiento(),
            fecha=payload.fecha,
            cuenta_origen_id=payload.cuenta_origen_id,
            cuenta_destino_id=payload.cuenta_destino_id,
            importe=importe_dec,
            comentarios=payload.comentarios,
            user_id=current_user.id if current_user else None,
            saldo_origen_antes=saldo_origen_antes,
            saldo_origen_despues=saldo_origen_despues,
            saldo_destino_antes=saldo_destino_antes,
            saldo_destino_despues=saldo_destino_despues,
        )

        db.add(mov)
        db.commit()
        db.refresh(mov)

        # Campos derivados para el response_model
        mov.cuenta_origen_nombre = cuenta_origen.anagrama  # type: ignore[attr-defined]
        mov.cuenta_destino_nombre = cuenta_destino.anagrama  # type: ignore[attr-defined]

        return mov


    except Exception as exc:
        db.rollback()
        import traceback, sys

        print("\n\n===== ERROR crear_movimiento_cuenta =====", file=sys.stderr)
        print(repr(exc), file=sys.stderr)
        traceback.print_exc()
        print("===== FIN ERROR crear_movimiento_cuenta =====\n\n", file=sys.stderr)

        # De momento dejamos que FastAPI genere el 500 con el traceback "normal"
        raise

# ---------------------------------------------------------
# GET /api/v1/movimientos-cuenta
# Listar últimos movimientos (para BalanceScreen)
# ---------------------------------------------------------
@router.get(
    "",
    response_model=List[MovimientoCuentaListItem],
)
def listar_movimientos_cuenta(
    limit: int = Query(50, ge=1, le=500),          # 👈 subimos el máximo a 500
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    cuenta_id: Optional[str] = Query(None),        # 👈 opcional: permitir filtrar por cuenta
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """
    Listar movimientos de cuenta (compacto) para el usuario autenticado.

    - Filtra por usuario.
    - Opcionalmente filtra por año/mes.
    - Opcionalmente filtra por cuenta (origen o destino).
    - Devuelve un máximo de `limit` registros, ordenados del más reciente al más antiguo.
    """

    Origen = aliased(CuentaBancaria, name="origen")
    Destino = aliased(CuentaBancaria, name="destino")

    filtros = [MovimientoCuenta.user_id == current_user.id]

    if year is not None and month is not None:
        if month == 12:
            start_date = date(year, 12, 1)
            end_date = date(year + 1, 1, 1)
        else:
            start_date = date(year, month, 1)
            end_date = date(year, month + 1, 1)

        filtros.append(
            and_(
                MovimientoCuenta.fecha >= start_date,
                MovimientoCuenta.fecha < end_date,
            )
        )

    # 👇 si viene cuenta_id, filtramos por origen o destino
    if cuenta_id is not None:
        filtros.append(
            or_(
                MovimientoCuenta.cuenta_origen_id == cuenta_id,
                MovimientoCuenta.cuenta_destino_id == cuenta_id,
            )
        )

    query = (
        db.query(
            MovimientoCuenta.id,
            MovimientoCuenta.fecha,
            MovimientoCuenta.importe,
            MovimientoCuenta.comentarios,
            MovimientoCuenta.cuenta_origen_id,
            MovimientoCuenta.cuenta_destino_id,
            MovimientoCuenta.saldo_origen_antes,
            MovimientoCuenta.saldo_origen_despues,
            MovimientoCuenta.saldo_destino_antes,
            MovimientoCuenta.saldo_destino_despues,
            Origen.anagrama.label("origen_nombre"),
            Destino.anagrama.label("destino_nombre"),
        )
        .join(Origen, MovimientoCuenta.cuenta_origen_id == Origen.id)
        .join(Destino, MovimientoCuenta.cuenta_destino_id == Destino.id)
        .filter(*filtros)
        .order_by(desc(MovimientoCuenta.fecha), desc(MovimientoCuenta.id))
        .limit(limit)
    )


    rows = query.all()

    resultados: List[MovimientoCuentaListItem] = []
    for row in rows:
        resultados.append(
            MovimientoCuentaListItem(
                id=row.id,
                fecha=row.fecha,
                importe=row.importe,
                origen_nombre=row.origen_nombre,
                destino_nombre=row.destino_nombre,
                comentarios=row.comentarios,
                saldo_origen_antes=row.saldo_origen_antes,
                saldo_origen_despues=row.saldo_origen_despues,
                saldo_destino_antes=row.saldo_destino_antes,
                saldo_destino_despues=row.saldo_destino_despues,
            )
        )

    return resultados


# ---------------------------------------------------------
# GET /api/v1/{movimiento_id}
# Eliminar movimiento (para movimientosScreen)
# ---------------------------------------------------------

@router.delete(
    "/{movimiento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def eliminar_movimiento_cuenta(
    movimiento_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """
    Elimina un movimiento de cuentas y revierte su efecto en la liquidez:

    - Suma el importe a la cuenta de origen.
    - Resta el importe a la cuenta de destino.
    """

    # 1) Buscar el movimiento del usuario
    mov: Optional[MovimientoCuenta] = (
        db.query(MovimientoCuenta)
        .filter(
            MovimientoCuenta.id == movimiento_id,
            MovimientoCuenta.user_id == current_user.id,
        )
        .first()
    )

    if not mov:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movimiento no encontrado.",
        )

    # 2) Buscar cuentas origen y destino
    cuenta_origen: Optional[CuentaBancaria] = (
        db.query(CuentaBancaria)
        .filter(CuentaBancaria.id == mov.cuenta_origen_id)
        .first()
    )
    cuenta_destino: Optional[CuentaBancaria] = (
        db.query(CuentaBancaria)
        .filter(CuentaBancaria.id == mov.cuenta_destino_id)
        .first()
    )

    if not cuenta_origen or not cuenta_destino:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudieron recuperar las cuentas asociadas al movimiento.",
        )

    # 3) Normalizar importe a Decimal
    importe_dec = (
        mov.importe
        if isinstance(mov.importe, Decimal)
        else Decimal(str(mov.importe))
    )

    try:
        # 4) Normalizar liquidez
        liquidez_origen = (
            cuenta_origen.liquidez
            if isinstance(cuenta_origen.liquidez, Decimal)
            else Decimal(str(cuenta_origen.liquidez or 0))
        )
        liquidez_destino = (
            cuenta_destino.liquidez
            if isinstance(cuenta_destino.liquidez, Decimal)
            else Decimal(str(cuenta_destino.liquidez or 0))
        )

        # 5) Revertir el efecto del movimiento:
        #    Alta = origen - importe, destino + importe
        #    Baja = origen + importe, destino - importe
        cuenta_origen.liquidez = liquidez_origen + importe_dec
        cuenta_destino.liquidez = liquidez_destino - importe_dec

        # 6) Borrar el movimiento
        db.delete(mov)
        db.commit()

        return

    except Exception as exc:
        db.rollback()
        import traceback, sys

        print("\n\n===== ERROR eliminar_movimiento_cuenta =====", file=sys.stderr)
        print(repr(exc), file=sys.stderr)
        traceback.print_exc()
        print("===== FIN ERROR eliminar_movimiento_cuenta =====\n\n", file=sys.stderr)
        raise

# ---------------------------------------------------------
# POST /api/v1/movimientos-cuenta/ajuste-liquidez
# Ajustar liquidez de una cuenta con movimiento de traza
# ---------------------------------------------------------
@router.post(
    "/ajuste-liquidez",
    response_model=MovimientoCuentaRead,
    status_code=status.HTTP_201_CREATED,
)
def ajustar_liquidez_cuenta(
    payload: AjusteLiquidezPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """
    Ajusta la liquidez de una cuenta bancaria a un nuevo saldo:

    - Actualiza cuentas_bancarias.liquidez = nuevo_saldo
    - Registra un movimiento en movimientos_cuenta con:
        * cuenta_origen_id = cuenta_id
        * cuenta_destino_id = cuenta_id
        * importe = |nuevo_saldo - saldo_actual| (si hay cambio)
        * saldo_origen_antes / despues = saldos antes/despues del ajuste
    """

    # 1) Recuperar cuenta del usuario
    cuenta: Optional[CuentaBancaria] = (
        db.query(CuentaBancaria)
        .filter(
            CuentaBancaria.id == payload.cuenta_id,
            CuentaBancaria.user_id == current_user.id,
        )
        .first()
    )

    if not cuenta:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cuenta no encontrada o no pertenece al usuario.",
        )

    # Normalizamos a Decimal
    liquidez_actual = (
        cuenta.liquidez
        if isinstance(cuenta.liquidez, Decimal)
        else Decimal(str(cuenta.liquidez or 0))
    )
    nuevo_saldo_dec = (
        payload.nuevo_saldo
        if isinstance(payload.nuevo_saldo, Decimal)
        else Decimal(str(payload.nuevo_saldo))
    )

    if nuevo_saldo_dec < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nuevo saldo no puede ser negativo.",
        )

    # 2) Si no hay cambio, no tiene sentido registrar nada
    delta = nuevo_saldo_dec - liquidez_actual
    if delta == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nuevo saldo es igual al saldo actual. No hay nada que ajustar.",
        )

    # 3) Ajustamos la liquidez directamente al nuevo saldo
    saldo_antes = liquidez_actual
    saldo_despues = nuevo_saldo_dec
    cuenta.liquidez = nuevo_saldo_dec

    # 4) Movimiento de traza: importe SIEMPRE positivo (magnitud del ajuste)
    importe_mov = abs(delta)

    mov = MovimientoCuenta(
        id=generar_id_movimiento(),
        fecha=payload.fecha,
        cuenta_origen_id=payload.cuenta_id,
        cuenta_destino_id=payload.cuenta_id,
        importe=importe_mov,  # 👈 SIEMPRE > 0 para respetar el CHECK de la BD
        comentarios=payload.comentarios
        or "Ajuste manual de liquidez desde BalanceScreen",
        user_id=current_user.id if current_user else None,
        saldo_origen_antes=saldo_antes,
        saldo_origen_despues=saldo_despues,
        saldo_destino_antes=saldo_antes,
        saldo_destino_despues=saldo_despues,
    )

    db.add(mov)

    try:
        db.commit()
        db.refresh(mov)

        # Campos derivados (igual que en crear_movimiento_cuenta)
        mov.cuenta_origen_nombre = cuenta.anagrama  # type: ignore[attr-defined]
        mov.cuenta_destino_nombre = cuenta.anagrama  # type: ignore[attr-defined]

        return mov

    except Exception as exc:
        db.rollback()
        import traceback, sys

        print("\n\n===== ERROR ajustar_liquidez_cuenta =====", file=sys.stderr)
        print(repr(exc), file=sys.stderr)
        traceback.print_exc()
        print("===== FIN ERROR ajustar_liquidez_cuenta =====\n\n", file=sys.stderr)
        raise
