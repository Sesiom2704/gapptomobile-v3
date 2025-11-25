# backend/app/utils/common.py

"""
Funciones auxiliares comunes entre GASTOS, INGRESOS y GASTOS COTIDIANOS.

Objetivo:
- Evitar duplicar la misma lógica en varios routers.
- Tener un único sitio donde tocar si cambian detalles de negocio
  como el cálculo de liquidez o la forma de localizar una cuenta.

Incluye:

- safe_float(v, default=0.0):
    Conversión robusta a float.

- adjust_liquidez(db, cuenta_id, delta, raise_if_missing=False):
    Suma/resta a la liquidez de una CuentaBancaria, dentro de una
    transacción SQLAlchemy.

- extract_cuenta_id(obj):
    Intenta sacar el id de cuenta bancaria desde:
      * campos directos (cuenta_id, cuenta_bancaria_id, etc.)
      * relación .cuenta / .cuenta_bancaria con atributo .id
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.db import models


# ============================================================
# Conversión numérica
# ============================================================

def safe_float(value: Any, default: float = 0.0) -> float:
    """
    Convierte un valor a float de forma segura.

    Reglas:
    - None, "" o valores no numéricos -> default (por defecto 0.0).
    - Números válidos (int, float, Decimal, str numérico) -> float(valor).

    Esto evita excepciones al hacer cuentas con campos que pueden venir
    como None o cadenas vacías desde la BD.
    """
    try:
        if value is None:
            return float(default)
        return float(value)
    except Exception:
        return float(default)


# ============================================================
# Liquidez de cuentas bancarias
# ============================================================

def adjust_liquidez(
    db: Session,
    cuenta_id: Optional[str],
    delta: float,
    *,
    raise_if_missing: bool = False,
) -> None:
    """
    Ajusta la liquidez de una cuenta bancaria.

    Reglas de negocio:

    - Si cuenta_id es None:
        * No se ajusta nada.
        * No se lanza error.
        * Interpretación: el movimiento no afecta a ninguna cuenta bancaria
          (ej.: gasto en efectivo sin cuenta 'EFECTIVO' creada en la tabla).

    - Si cuenta_id tiene valor:
        * Si la cuenta existe:
            liquidez_nueva = liquidez_actual + delta
        * Si la cuenta NO existe:
            - raise_if_missing = True  -> lanza HTTP 422
            - raise_if_missing = False -> NO hace nada y NO lanza error
              (modo tolerante, evitar usarlo salvo casos muy especiales).

    Recomendación:
    - Para INGRESOS, GASTOS y GASTOS_COTIDIANOS en la app normal, usar
      siempre raise_if_missing=True cuando se pasa un cuenta_id.
    """
    
    delta = float(delta or 0.0)
    if not cuenta_id or abs(delta) < 1e-12:
        # Nada que ajustar
        return

    cuenta = (
        db.query(models.CuentaBancaria)
        .filter(models.CuentaBancaria.id == cuenta_id)
        .with_for_update()
        .one_or_none()
    )

    if not cuenta:
        if raise_if_missing:
            # En algunos casos de negocio queremos que esto sea un error.
            raise HTTPException(
                status_code=422,
                detail="Cuenta asociada no existe.",
            )
        # En otros casos preferimos simplemente ignorar el ajuste.
        return

    cuenta.liquidez = safe_float(cuenta.liquidez) + delta

    # No hacemos commit aquí: se asume que el router está en una
    # transacción y hará db.commit() después de todos los cambios.
    db.flush()


# ============================================================
# Utilidad para extraer cuenta_id desde objetos variados
# ============================================================

def extract_cuenta_id(obj: Any) -> Optional[str]:
    """
    Intenta obtener un 'cuenta_id' desde un objeto que puede tener:

    - Campos directos:
        * cuenta_id
        * cuenta_bancaria_id
        * cuentabancaria_id
        * cuentaId
        * cuentaBancariaId

    - Relación a otro objeto:
        * cuenta.id
        * cuenta_bancaria.id

    Devuelve:
    - str(id) si encuentra alguno.
    - None si no encuentra nada.
    """
    if obj is None:
        return None

    # 1) Campos directos
    direct_names = [
        "cuenta_id",
        "cuenta_bancaria_id",
        "cuentabancaria_id",
        "cuentaId",
        "cuentaBancariaId",
    ]
    for name in direct_names:
        if hasattr(obj, name):
            val = getattr(obj, name)
            if val is not None:
                return str(val)

    # 2) Relaciones
    rel_names = ["cuenta", "cuenta_bancaria"]
    for rel in rel_names:
        if hasattr(obj, rel):
            rel_obj = getattr(obj, rel)
            if rel_obj is not None and hasattr(rel_obj, "id"):
                val = getattr(rel_obj, "id")
                if val is not None:
                    return str(val)

    return None
