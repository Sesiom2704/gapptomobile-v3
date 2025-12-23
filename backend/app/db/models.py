# ============================================================
# GapptoMobile - Modelos SQLAlchemy (unificados V1 + V2)
# - Mantiene relaciones y campos de V1
# - Añade extend_existing=True (de V2) para convivencia con Neon
# - Conserva constraints y claves foráneas
# - Ajustes 2025-10-07:
#   * Proveedor: nuevas columnas localidad, pais
#   * GastoCotidiano: se eliminan CHECKS restrictivos de tipo/observaciones.
#     (La validación de "segmento = COTIDIANOS" se hará a nivel de API/servicio)
#   * Índices útiles para filtros (fecha/tipo/proveedor; localidad/pais)
# ============================================================

from sqlalchemy import (
    Column, String, Integer, Float, Boolean,
    Date, DateTime, ForeignKey, CheckConstraint, ForeignKeyConstraint,
    Enum as SAEnum, text, UniqueConstraint, Numeric, Index
)
import enum
from sqlalchemy.sql import func
from backend.app.db.base import Base
import sqlalchemy as sa
from sqlalchemy.orm import relationship
from enum import Enum as PyEnum
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from uuid import uuid4
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# =============================================
# 1. TABLAS AUXILIARES
# =============================================

class TipoIngreso(Base):
    __tablename__ = "tipo_ingreso"
    __table_args__ = {"extend_existing": True}

    id      = Column(String, primary_key=True, index=True)
    nombre  = Column(String, nullable=False)

    ingresos = relationship("Ingreso", back_populates="tipo_rel")


class TipoRamasGasto(Base):
    __tablename__ = "tipo_ramas_gasto"
    __table_args__ = {"extend_existing": True}

    id      = Column(String, primary_key=True, index=True)
    nombre  = Column(String, nullable=False)

    tipos_gasto = relationship("TipoGasto", back_populates="rama_rel")


class TipoSegmentoGasto(Base):
    __tablename__ = "tipo_segmentos_gasto"
    __table_args__ = {"extend_existing": True}

    id      = Column(String, primary_key=True, index=True)
    nombre  = Column(String, nullable=False)

    tipos_gasto = relationship("TipoGasto", back_populates="segmento_rel")
    gastos = relationship("Gasto", back_populates="segmento")


class TipoRamasProveedores(Base):
    __tablename__ = "tipo_ramas_proveedores"
    __table_args__ = {"extend_existing": True}

    id      = Column(String, primary_key=True, index=True)
    nombre  = Column(String, nullable=False)

    proveedores = relationship("Proveedor", back_populates="rama_rel")

class TipoGasto(Base):
    __tablename__ = "tipo_gasto"
    __table_args__ = {"extend_existing": True}

    id          = Column(String, primary_key=True, index=True)
    nombre      = Column(String, nullable=False)
    rama_id     = Column(String, ForeignKey("tipo_ramas_gasto.id"))
    segmento_id = Column(String, ForeignKey("tipo_segmentos_gasto.id"), nullable=True)

    rama_rel            = relationship("TipoRamasGasto", back_populates="tipos_gasto")
    segmento_rel        = relationship("TipoSegmentoGasto", back_populates="tipos_gasto")
    gastos              = relationship("Gasto", back_populates="tipo_rel")
    gastos_cotidianos   = relationship("GastoCotidiano", back_populates="tipo_rel")


# =============================================
# 2. TABLAS PRINCIPALES
# =============================================

class TipoInmueble(str, PyEnum):
    VIVIENDA = "VIVIENDA"
    LOCAL    = "LOCAL"
    GARAJE   = "GARAJE"
    TRASTERO = "TRASTERO"

class Patrimonio(Base):
    __tablename__ = "patrimonio"
    __table_args__ = {"extend_existing": True}

    id                 = Column(String, primary_key=True, index=True)
    calle              = Column(String)
    numero             = Column(String)
    escalera           = Column(String)
    piso               = Column(String)
    puerta             = Column(String)
    localidad          = Column(String)
    referencia         = Column(String, index=True)
    direccion_completa = Column(String)
    # 👇 Nuevo campo: propietario de la vivienda / activo
    user_id            = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Enum persiste en BD (create_type=False evita recrearlo)
    tipo_inmueble     = Column(
        PGEnum(TipoInmueble, name="tipo_inmueble", create_type=False),
        nullable=False,
        server_default=text("'VIVIENDA'::tipo_inmueble"),
    )
    fecha_adquisicion = Column(Date, nullable=True)
    activo            = Column(Boolean, nullable=False, server_default=text("true"), index=True)
    disponible        = Column(Boolean, nullable=False, server_default=text("true"), index=True)

    # Superficie original
    superficie_m2     = Column(Float, nullable=True)

    # Nuevos
    participacion_pct     = Column(Float, nullable=False, server_default=text("100.0"))
    superficie_construida = Column(Numeric(10, 2), nullable=True)

    habitaciones      = Column(Integer, nullable=True)
    banos             = Column(Integer, nullable=True)
    garaje            = Column(Boolean, nullable=False, server_default=text("false"))
    trastero          = Column(Boolean, nullable=False, server_default=text("false"))

    ingresos      = relationship("Ingreso", back_populates="vivienda_rel")
    gastos        = relationship("Gasto", back_populates="vivienda_rel")
    rendimientos  = relationship("RendimientoPatrimonio", back_populates="patrimonio", cascade="all, delete-orphan")
    # 👇 Relación inversa hacia el usuario dueño
    user          = relationship("User", back_populates="patrimonios")

class PatrimonioCompra(Base):
    __tablename__ = "patrimonio_compra"
    __table_args__ = {"extend_existing": True}

    patrimonio_id       = Column(String, ForeignKey("patrimonio.id", ondelete="CASCADE"), primary_key=True)

    valor_compra        = Column(Float, nullable=False)
    valor_referencia    = Column(Float, nullable=True)
    impuestos_pct       = Column(Float, nullable=True)
    impuestos_eur       = Column(Float, nullable=True)
    notaria             = Column(Float, nullable=True)
    agencia             = Column(Float, nullable=True)
    reforma_adecuamiento= Column(Float, nullable=True)
    total_inversion     = Column(Float, nullable=True)
    valor_mercado       = Column(Float, nullable=True)
    valor_mercado_fecha = Column(Date, nullable=True, server_default=func.current_date())

    notas               = Column(String)

    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    patrimonio_rel = relationship("Patrimonio", backref="compra", uselist=False)


def gen_rendpat_id() -> str:
    return "rendpat-" + uuid4().hex[:8]


class RendimientoPatrimonio(Base):
    __tablename__ = "rendimiento_patrimonio"
    __table_args__ = (
        UniqueConstraint("patrimonio_id", "year", name="uq_rendpat_patrimonio_year"),
        {"extend_existing": True},
    )

    id = Column(String, primary_key=True, default=gen_rendpat_id, index=True)
    patrimonio_id = Column(String, ForeignKey("patrimonio.id", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)

    # Entradas
    ingresos_alquiler    = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    meses_alquiler       = Column(Integer, nullable=False, server_default=text("0"))  # 0..12
    ingresos_adicionales = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    # Gastos
    gastos_mejoras       = Column(Numeric(12, 2), nullable=False, server_default=text("0"))  # CAPEX
    gastos_mantenimiento = Column(Numeric(12, 2), nullable=False, server_default=text("0"))  # OPEX
    otros_gastos         = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    # Derivados
    ocupacion_pct        = Column(Numeric(5, 2), nullable=False, server_default=text("0"))   # 0..100
    ingreso_bruto        = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    gasto_total          = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    ingreso_neto         = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    yield_bruto_pct      = Column(Numeric(7, 3), nullable=False, server_default=text("0"))
    yield_neto_pct       = Column(Numeric(7, 3), nullable=False, server_default=text("0"))

    # Snapshot de participación para ese año
    participacion_pct    = Column(Numeric(5, 2), nullable=False, server_default=text("100"))

    createon            = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    modifiedon          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patrimonio = relationship("Patrimonio", back_populates="rendimientos")

class Pais(Base):
    __tablename__ = "paises"

    id         = Column(Integer, primary_key=True, index=True)
    nombre     = Column(String, nullable=False, unique=True)
    codigo_iso = Column(String, nullable=True)

    # Lista de regiones asociadas a este país
    regiones = relationship("Region", back_populates="pais")


class Region(Base):
    __tablename__ = "regiones"

    id      = Column(Integer, primary_key=True, index=True)
    nombre  = Column(String, nullable=False)
    pais_id = Column(Integer, ForeignKey("paises.id"), nullable=False)

    # Relación inversa con Pais.regiones
    pais = relationship("Pais", back_populates="regiones")

    # Lista de localidades dentro de esta región
    localidades = relationship("Localidad", back_populates="region")

    __table_args__ = (
        UniqueConstraint("nombre", "pais_id"),
    )


class Localidad(Base):
    __tablename__ = "localidades"

    id        = Column(Integer, primary_key=True, index=True)
    nombre    = Column(String, nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regiones.id"), nullable=False)

    # Relación inversa con Region.localidades
    region = relationship("Region", back_populates="localidades")

    # Proveedores asociados a esta localidad
    proveedores = relationship("Proveedor", back_populates="localidad_rel")

    __table_args__ = (
        UniqueConstraint("nombre", "region_id"),
    )


class Proveedor(Base):
    __tablename__ = "proveedores"
    __table_args__ = {"extend_existing": True}

    id       = Column(String, primary_key=True, index=True)
    nombre   = Column(String, nullable=False)
    rama_id  = Column(String, ForeignKey("tipo_ramas_proveedores.id"))

    # Campos texto para mantener compatibilidad con v2.0
    localidad_id = Column(Integer, ForeignKey("localidades.id"), nullable=True, index=True)
    localidad   = Column(String, nullable=True, index=True)
    pais      = Column(String, nullable=True, index=True)
    comunidad = Column(String, nullable=True, index=True)

    # Multiusuario
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)


    rama_rel          = relationship("TipoRamasProveedores", back_populates="proveedores")
    gastos            = relationship("Gasto", back_populates="proveedor_rel")
    gastos_cotidianos = relationship("GastoCotidiano", back_populates="proveedor_rel")
    cuentas_bancarias = relationship("CuentaBancaria", back_populates="banco_rel")
    user              = relationship("User", back_populates="proveedores")

    # Relación con Localidad (normalizada)
    localidad_rel = relationship("Localidad", back_populates="proveedores")

class CuentaBancaria(Base):
    __tablename__ = "cuentas_bancarias"
    __table_args__ = {"extend_existing": True}

    id         = Column(String, primary_key=True, index=True)
    banco_id   = Column(String, ForeignKey("proveedores.id"))
    referencia = Column(String)
    anagrama   = Column(String)
    liquidez   = Column(Float, nullable=False, server_default=text("0"))
    liquidez_inicial   = Column(Float, nullable=False, server_default=text("0"))
    # 👇 Nueva columna: propietario de la cuenta
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    Activo =    Column("activo", Boolean, default=True)

    banco_rel = relationship("Proveedor", back_populates="cuentas_bancarias")
    gastos    = relationship("Gasto", back_populates="cuenta_rel")
    ingresos  = relationship("Ingreso", back_populates="cuenta")
    gastos_cotidianos = relationship("GastoCotidiano",back_populates="cuenta", cascade="all, delete-orphan")

    # 👇 Relación inversa hacia el usuario
    user      = relationship("User", back_populates="cuentas_bancarias")
    movimientos_origen = relationship(
        "MovimientoCuenta",
        foreign_keys="MovimientoCuenta.cuenta_origen_id",
        back_populates="cuenta_origen",
        cascade="all, delete-orphan",
    )
    movimientos_destino = relationship(
        "MovimientoCuenta",
        foreign_keys="MovimientoCuenta.cuenta_destino_id",
        back_populates="cuenta_destino",
        cascade="all, delete-orphan",
    )
    

class MovimientoCuenta(Base):
    __tablename__ = "movimientos_cuenta"

    id = Column(String, primary_key=True, index=True)
    fecha = Column(Date, nullable=False)

    cuenta_origen_id = Column(
        String,
        ForeignKey("cuentas_bancarias.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )
    cuenta_destino_id = Column(
        String,
        ForeignKey("cuentas_bancarias.id", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
    )

    importe = Column(Numeric(12, 2), nullable=False)
    comentarios = Column(String, nullable=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
    )

    createdon = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    modifiedon = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    saldo_origen_antes = Column(Numeric(12, 2), nullable=True)
    saldo_origen_despues = Column(Numeric(12, 2), nullable=True)
    saldo_destino_antes = Column(Numeric(12, 2), nullable=True)
    saldo_destino_despues = Column(Numeric(12, 2), nullable=True)

    # Relaciones
    cuenta_origen = relationship(
        "CuentaBancaria",
        foreign_keys=[cuenta_origen_id],
        back_populates="movimientos_origen",
    )
    cuenta_destino = relationship(
        "CuentaBancaria",
        foreign_keys=[cuenta_destino_id],
        back_populates="movimientos_destino",
    )
    user = relationship("User", back_populates="movimientos_cuenta")

class Ingreso(Base):
    __tablename__ = "ingresos"
    __table_args__ = {"extend_existing": True}

    id                     = Column(String, primary_key=True, index=True)
    rango_cobro            = Column(String, nullable=True)   # (pendiente migrar a Date si procede)
    periodicidad           = Column(String)
    tipo_id                = Column(String, ForeignKey("tipo_ingreso.id"))
    referencia_vivienda_id = Column(String, ForeignKey("patrimonio.id"))
    concepto               = Column(String)
    importe                = Column(Float)
    activo                 = Column(Boolean, server_default=text("true"))
    cobrado                = Column(Boolean, server_default=text("false"))
    createon               = Column(DateTime, server_default=func.now())
    modifiedon             = Column(DateTime, onupdate=func.now())
    fecha_inicio           = Column(Date, nullable=True)
    cuenta_id              = Column(
        String,
        ForeignKey("cuentas_bancarias.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    user_id                = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    kpi               = Column(Boolean, nullable=False, server_default=sa.text("true"))
    ingresos_cobrados = Column(Integer, nullable=False, server_default=sa.text("0"))
    inactivatedon     = Column(DateTime, nullable=True)
    ultimo_ingreso_on = Column(DateTime, nullable=True)

    tipo_rel     = relationship("TipoIngreso", back_populates="ingresos")
    cuenta       = relationship("CuentaBancaria", back_populates="ingresos", lazy="joined")
    vivienda_rel = relationship("Patrimonio", back_populates="ingresos")
    # 👇 Relación inversa al usuario
    user         = relationship("User", back_populates="ingresos")

class Gasto(Base):
    __tablename__ = "gastos"
    __table_args__ = {"extend_existing": True}

    id                     = Column(String, primary_key=True, index=True)
    fecha                  = Column(Date, index=True)
    periodicidad           = Column(String, index=True)
    nombre                 = Column(String)
    tienda                 = Column(String)
    proveedor_id           = Column(String, ForeignKey("proveedores.id"), index=True)
    tipo_id                = Column(String, ForeignKey("tipo_gasto.id"), index=True)
    segmento_id            = Column(String, ForeignKey("tipo_segmentos_gasto.id"), nullable=True, index=True)
    rama                   = Column(String) 
    referencia_vivienda_id = Column(String, ForeignKey("patrimonio.id"), index=True)
    cuenta_id              = Column(String, ForeignKey("cuentas_bancarias.id"), index=True)

    user_id                = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    importe                = Column(Float)
    importe_cuota          = Column(Float)
    cuotas                 = Column(Integer)
    total                  = Column(Float)
    cuotas_pagadas         = Column(Integer)
    cuotas_restantes       = Column(Integer)
    importe_pendiente      = Column(Float)
    rango_pago             = Column(String)
    activo                 = Column(Boolean, server_default=text("true"), index=True)
    pagado                 = Column(Boolean, server_default=text("false"), index=True)
    kpi                    = Column(Boolean, server_default=text("false"), index=True)
    createon               = Column(DateTime, server_default=func.now())
    modifiedon             = Column(DateTime, onupdate=func.now())
    referencia_gasto       = Column(String, ForeignKey("gastos.id"))
    prestamo_id            = sa.Column(sa.String)

    # NUEVO
    inactivatedon          = Column(DateTime, nullable=True)
    ultimo_pago_on         = Column(DateTime, nullable=True)

    proveedor_rel  = relationship("Proveedor", back_populates="gastos")
    tipo_rel       = relationship("TipoGasto", back_populates="gastos")
    vivienda_rel   = relationship("Patrimonio", back_populates="gastos")
    cuenta_rel     = relationship("CuentaBancaria", back_populates="gastos")
    subgastos      = relationship("Gasto", backref="parent", remote_side=[id])
    segmento       = relationship("TipoSegmentoGasto", back_populates="gastos")
    user           = relationship("User", back_populates="gastos")

    @property
    def user_nombre(self) -> str | None:
        # Ajusta "nombre" al campo real de tu modelo User
        return self.user.full_name if self.user else None

class GastoCotidiano(Base):
    __tablename__ = "gastos_cotidianos"
    __table_args__ = {
        "extend_existing": True,
        "schema": "public",
        # Nota: se eliminan CHECKS restrictivos previos. Validación por API:
        # - sólo tipos cuyo segmento sea COTIDIANOS
        # - reglas de evento/observaciones si aplican
    }

    id           = Column(String, primary_key=True, index=True)
    fecha        = Column(Date, index=True)
    tipo_id      = Column(String, ForeignKey("tipo_gasto.id"), index=True)
    proveedor_id = Column(String, ForeignKey("proveedores.id"), index=True)
    cuenta_id    = Column(String, ForeignKey("cuentas_bancarias.id"), index=True, nullable=True)
    # 👇 Nuevo: dueño del gasto cotidiano
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    importe      = Column(Float)
    litros       = Column(Float)
    km           = Column(Float)
    precio_litro = Column(Float)
    pagado       = Column(Boolean, server_default=text("true"), index=True)

    # Campos de contexto
    evento        = Column(String(120), nullable=True)
    observaciones = Column(sa.Text, nullable=True)

    tipo_rel      = relationship("TipoGasto", back_populates="gastos_cotidianos")
    proveedor_rel = relationship("Proveedor", back_populates="gastos_cotidianos")
    cuenta        = relationship("CuentaBancaria", back_populates="gastos_cotidianos", lazy="joined")
    # 👇 Relación inversa al usuario
    user          = relationship("User", back_populates="gastos_cotidianos")


# =============================================
# 4.1 ROLES
# =============================================
class RoleEnum(str, enum.Enum):
    admin = "admin"
    user = "user"


# =============================================
# 4.1 ROLES
# =============================================
class RoleEnum(str, enum.Enum):
    admin = "admin"
    user = "user"


# =============================================
# 4. USUARIOS
# =============================================
class User(Base):
    __tablename__ = "users"
    __table_args__ = {"extend_existing": True}

    id         = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email      = Column(String, unique=True, index=True, nullable=False)
    password   = Column(String, nullable=False)
    full_name  = Column(String, nullable=False)
    is_active  = Column(Boolean, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    role       = Column(
        SAEnum(RoleEnum, name="role_enum"),
        nullable=False,
        server_default="user",
    )

    # Relaciones con las entidades que "pertenecen" a un usuario
    gastos            = relationship("Gasto", back_populates="user")
    ingresos          = relationship("Ingreso", back_populates="user")
    gastos_cotidianos = relationship("GastoCotidiano", back_populates="user")
    cuentas_bancarias = relationship("CuentaBancaria", back_populates="user")
    patrimonios       = relationship("Patrimonio", back_populates="user")
    prestamos         = relationship("Prestamo", back_populates="user")
    proveedores       = relationship("Proveedor", back_populates="user")
    movimientos_cuenta = relationship("MovimientoCuenta", back_populates="user")

# =============================================
# 5. CIERRES MENSUALES (cabecera + detalle)
# =============================================

class CierreMensual(Base):
    __tablename__ = "cierre_mensual"
    __table_args__ = (
        sa.UniqueConstraint("anio", "mes", name="uq_cierre_anio_mes"),
        sa.CheckConstraint("mes BETWEEN 1 AND 12", name="ck_cierre_mes_1_12"),
        sa.CheckConstraint("criterio IN ('CAJA')", name="ck_cierre_criterio"),
        {"extend_existing": True},
    )

    id = sa.Column(
        PGUUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )

    anio = sa.Column(sa.SmallInteger, nullable=False)
    mes = sa.Column(sa.SmallInteger, nullable=False)

    fecha_cierre = sa.Column(sa.DateTime, server_default=func.now())
    user_id = sa.Column(
        sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    criterio = sa.Column(sa.String, nullable=False, server_default="CAJA")

    ingresos_esperados = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    ingresos_reales = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    desv_ingresos = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))

    gastos_gestionables_esperados = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    gastos_gestionables_reales = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    gastos_cotidianos_esperados = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    gastos_cotidianos_reales = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    gastos_esperados_total = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    gastos_reales_total = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))

    desv_gestionables = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    desv_cotidianos = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    desv_gastos_total = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))

    resultado_esperado = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    resultado_real = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    desv_resultado = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))

    n_recurrentes_ing = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    n_recurrentes_gas = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    n_unicos_ing = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    n_unicos_gas = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    n_cotidianos = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    n_pendientes_al_cerrar = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))

    version = sa.Column(sa.Integer, nullable=False, server_default=sa.text("1"))

    detalles = relationship(
        "CierreMensualDetalle",
        back_populates="cabecera",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    user_rel = relationship("User")


class CierreMensualDetalle(Base):
    __tablename__ = "cierre_mensual_detalle"
    __table_args__ = (
        sa.CheckConstraint("mes BETWEEN 1 AND 12", name="ck_detalle_mes_1_12"),
        sa.CheckConstraint("tipo_detalle IN ('GESTIONABLES','COTIDIANOS')", name="ck_detalle_tipo"),
        {"extend_existing": True},
    )

    id = sa.Column(
        PGUUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )
    cierre_id = sa.Column(
        PGUUID(as_uuid=True),
        sa.ForeignKey("cierre_mensual.id", ondelete="CASCADE"),
        nullable=False,
    )

    anio = sa.Column(sa.SmallInteger, nullable=False)
    mes = sa.Column(sa.SmallInteger, nullable=False)
    segmento_id = sa.Column(
        sa.String,
        sa.ForeignKey("tipo_segmentos_gasto.id", ondelete="RESTRICT"),
        nullable=False,
    )
    tipo_detalle = sa.Column(sa.String, nullable=False)

    esperado = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    real = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    desviacion = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))
    cumplimiento_pct = sa.Column(sa.Float, nullable=True)
    n_items = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    incluye_kpi = sa.Column(sa.Boolean, nullable=False, server_default=sa.text("true"))

    fecha_cierre = sa.Column(sa.DateTime, server_default=func.now())
    user_id = sa.Column(sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    cabecera = relationship("CierreMensual", back_populates="detalles")
    segmento_rel = relationship("TipoSegmentoGasto")


# ============================
# Préstamo (cabecera)
# ============================
class Prestamo(Base):
    __tablename__ = "prestamo"

    id = sa.Column(sa.String, primary_key=True)
    nombre = sa.Column(sa.String, nullable=False)

    proveedor_id = sa.Column(sa.String, sa.ForeignKey("proveedores.id"), nullable=False)
    referencia_vivienda_id = sa.Column(sa.String, sa.ForeignKey("patrimonio.id"))
    cuenta_id = sa.Column(sa.String, sa.ForeignKey("cuentas_bancarias.id"), nullable=False)
    # 👇 Nuevo: dueño del préstamo
    user_id = sa.Column(sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True)

    fecha_inicio = sa.Column(sa.Date, nullable=False)
    periodicidad = sa.Column(sa.String, nullable=False)  # ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')
    plazo_meses = sa.Column(sa.Integer, nullable=False)

    importe_principal = sa.Column(sa.Numeric(14, 2), nullable=False)
    tipo_interes = sa.Column(sa.String, nullable=False)  # ('FIJO','VARIABLE','MIXTO')
    tin_pct = sa.Column(sa.Numeric(6, 3), nullable=False)
    tae_pct = sa.Column(sa.Numeric(6, 3))
    indice = sa.Column(sa.String)
    diferencial_pct = sa.Column(sa.Numeric(6, 3))

    comision_apertura = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))
    otros_gastos_iniciales = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))

    rango_pago = sa.Column(sa.String)
    activo = sa.Column(sa.Boolean, nullable=False, server_default=sa.text("true"))

    cuotas_totales = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))
    cuotas_pendientes = sa.Column(sa.Integer, nullable=False, server_default=sa.text("0"))

    capital_pendiente    = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))
    intereses_pendientes = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))

    cuotas = sa.orm.relationship(
        "PrestamoCuota",
        back_populates="prestamo",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PrestamoCuota.num_cuota",
    )

    # 👇 Relación inversa al usuario
    user = sa.orm.relationship("User", back_populates="prestamos")

# ============================
# Detalle de cuotas (plan)
# ============================
class PrestamoCuota(Base):
    __tablename__ = "prestamo_cuota"

    id = sa.Column(sa.String, primary_key=True)
    prestamo_id = sa.Column(sa.String, sa.ForeignKey("prestamo.id", ondelete="CASCADE"), nullable=False)
    num_cuota = sa.Column(sa.Integer, nullable=False)
    fecha_vencimiento = sa.Column(sa.Date, nullable=False)

    importe_cuota = sa.Column(sa.Numeric(14, 2), nullable=False)
    capital = sa.Column(sa.Numeric(14, 2), nullable=False)
    interes = sa.Column(sa.Numeric(14, 2), nullable=False)
    seguros = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))
    comisiones = sa.Column(sa.Numeric(14, 2), nullable=False, server_default=sa.text("0"))

    saldo_posterior = sa.Column(sa.Numeric(14, 2), nullable=False)

    pagada = sa.Column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    fecha_pago = sa.Column(sa.Date)
    gasto_id = sa.Column(sa.String, sa.ForeignKey("gastos.id"))

    createon = sa.Column(sa.DateTime, server_default=sa.text("now()"), nullable=False)
    modifiedon = sa.Column(sa.DateTime, server_default=sa.text("now()"), onupdate=sa.text("now()"), nullable=False)

    __table_args__ = (
        sa.UniqueConstraint("prestamo_id", "num_cuota", name="uq_prestamo_cuota"),
    )

    __table_args__ = (
        sa.UniqueConstraint("prestamo_id", "num_cuota", name="uq_prestamo_cuota"),
        sa.Index("ix_prestamo_cuota_prestamo_id_num", "prestamo_id", "num_cuota"),
    )

    prestamo = sa.orm.relationship("Prestamo", back_populates="cuotas")

