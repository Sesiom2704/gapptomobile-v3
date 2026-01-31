# backend/app/schemas/gastos_cotidianos.py

"""
Schemas Pydantic para GASTOS COTIDIANOS en GapptoMobile v3.

Se ha reconstruido a partir de tu schemas.py de v2 y de la lógica del router
gastosCotidianos.py, manteniendo:

- Misma estructura de campos:
  * fecha, tipo_id, proveedor_id, cuenta_id, importe, litros, km, precio_litro,
    pagado, evento, observaciones.
- Misma idea de:
  * fecha: str en create/update, date en lectura.
  * importe: Money (Decimal alias) en modelos, float en JSON.
  * evento: normalizado/validado contra ALLOWED_EVENTOS.

✅ Cambio V3 (sin romper V2):
- Se añaden campos nuevos opcionales:
  * tipo_pago (1..4)
  * importe_total (total real del ticket)
  * cantidad (personas para dividir)

Motivo:
- Antes el schema no los declaraba, por lo que Pydantic los descartaba y nunca
  llegaban al router/modelo. Eso provocaba que al consultar el gasto el frontend
  hiciera fallback a V2 (tipoPago=1, importe_total=importe, cantidad=1).
"""

from __future__ import annotations

from typing import Optional
from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from pydantic import ConfigDict

# Compatibilidad Pydantic v1/v2
try:
    from pydantic import field_serializer, field_validator
except Exception:  # pragma: no cover
    def field_serializer(*args, **kwargs):
        def _wrap(fn):
            return fn
        return _wrap

    def field_validator(*args, **kwargs):
        def _wrap(fn):
            return fn
        return _wrap

from backend.app.db.custom_types import Money

# ============================================================
# Constantes de negocio (como en v2)
# ============================================================

RESTAURANTES_TIPO_ID = "RES-TIPOGASTO-26ROES"
ALLOWED_EVENTOS = {"FAMILIA", "AMIGOS", "FAMILIA DE", "AMIGOS DE", "ROMANTICO"}


def _normalize_evento(val: Optional[str]) -> Optional[str]:
    """
    Normaliza 'evento':
    - Quita espacios extremos.
    - Pasa a mayúsculas.
    - Sustituye vocales acentuadas por no acentuadas.
    - Si queda vacío, devuelve None.
    """
    if not val:
        return None
    v = str(val).strip().upper()
    v = (
        v.replace("Á", "A")
        .replace("É", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ú", "U")
    )
    return v or None


# ============================================================
# Base (Create/Update)
# ============================================================

class GastoCotidianoBase(BaseModel):
    """
    Datos base de un gasto cotidiano.

    IMPORTANTE:
    - En create/update, fecha se maneja como str (la API móvil manda texto).
    - En lectura, se devolverá como date (ver GastoCotidianoRead).
    """

    # --------- Campos base (V2/V3) ----------
    fecha: str
    tipo_id: str
    proveedor_id: str
    pagado: bool = True
    importe: Money
    cuenta_id: Optional[str] = None

    # --------- Opcionales gasolina ----------
    litros: Optional[float] = None
    km: Optional[float] = None
    precio_litro: Optional[float] = None

    # --------- Contexto ----------
    evento: Optional[str] = None
    observaciones: Optional[str] = None

    # ============================================================
    # ✅ Campos V3 (opcionales para compatibilidad con registros V2)
    # ============================================================
    tipo_pago: Optional[int] = None        # 1..4
    importe_total: Optional[Money] = None  # total real del ticket
    cantidad: Optional[int] = None         # nº personas para dividir

    # --------------------------
    # Serialización Money -> float
    # --------------------------
    @field_serializer("importe", when_used="json")
    def _ser_money(cls, v: Decimal | None):
        """
        Convierte Money (Decimal) a float en JSON.
        """
        return float(v) if v is not None else None

    @field_serializer("importe_total", when_used="json")
    def _ser_money_total(cls, v: Decimal | None):
        """
        Convierte Money (Decimal) a float en JSON (para el total del ticket).
        """
        return float(v) if v is not None else None

    # --------------------------
    # Validación de evento (igual que en v2)
    # --------------------------
    @field_validator("evento", mode="before")
    def _val_evento(cls, v):
        """
        Normaliza y valida el campo 'evento':
        - None / "" ⇒ None.
        - Si tiene valor ⇒ debe estar en ALLOWED_EVENTOS.
        """
        vv = _normalize_evento(v)
        if vv is None:
            return None
        if vv not in ALLOWED_EVENTOS:
            opts = ", ".join(sorted(ALLOWED_EVENTOS))
            raise ValueError(f"Valor de 'evento' inválido. Opciones: {opts}")
        return vv


class GastoCotidianoCreate(GastoCotidianoBase):
    """
    Schema para CREAR un gasto cotidiano.

    - El id se genera en el backend (no se espera desde el cliente).
    """
    id: Optional[str] = None


class GastoCotidianoUpdate(BaseModel):
    """
    Schema para MODIFICAR un gasto cotidiano.

    Todos los campos son opcionales, se actualiza sólo lo que venga informado.
    """

    # --------- Campos base ----------
    fecha: Optional[str] = None
    tipo_id: Optional[str] = None
    proveedor_id: Optional[str] = None
    pagado: Optional[bool] = None
    importe: Optional[Money] = None
    cuenta_id: Optional[str] = None

    # --------- Opcionales gasolina ----------
    litros: Optional[float] = None
    km: Optional[float] = None
    precio_litro: Optional[float] = None

    # --------- Contexto ----------
    evento: Optional[str] = None
    observaciones: Optional[str] = None

    # ============================================================
    # ✅ Campos V3 (opcionales)
    # ============================================================
    tipo_pago: Optional[int] = None
    importe_total: Optional[Money] = None
    cantidad: Optional[int] = None

    @field_serializer("importe", when_used="json")
    def _ser_money_upd(cls, v: Decimal | None):
        return float(v) if v is not None else None

    @field_serializer("importe_total", when_used="json")
    def _ser_money_total_upd(cls, v: Decimal | None):
        return float(v) if v is not None else None

    @field_validator("evento", mode="before")
    def _val_evento_upd(cls, v):
        vv = _normalize_evento(v)
        if vv is None:
            return None
        if vv not in ALLOWED_EVENTOS:
            opts = ", ".join(sorted(ALLOWED_EVENTOS))
            raise ValueError(f"Valor de 'evento' inválido. Opciones: {opts}")
        return vv


class GastoCotidianoRead(BaseModel):
    """
    Vista de lectura de un gasto cotidiano:
    - fecha como date.
    - importe como float.
    - incluye todos los campos relevantes.
    """

    id: str
    fecha: Optional[date] = None
    tipo_id: Optional[str] = None
    proveedor_id: Optional[str] = None
    importe: Optional[float] = None
    cuenta_id: Optional[str] = None

    litros: Optional[float] = None
    km: Optional[float] = None
    precio_litro: Optional[float] = None
    pagado: Optional[bool] = None
    evento: Optional[str] = None
    observaciones: Optional[str] = None

    # ============================================================
    # ✅ Campos V3 devueltos al cliente
    # ============================================================
    tipo_pago: Optional[int] = None
    importe_total: Optional[float] = None
    cantidad: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# Aliases (igual que en v2)
GastoCotidianoSchema = GastoCotidianoRead
GastoCotidianoCreateSchema = GastoCotidianoCreate
GastoCotidianoUpdateSchema = GastoCotidianoUpdate
