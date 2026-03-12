# ============================================================
# GapptoMobile - Modelos SQLAlchemy (unificados V1 + V2 + V3)
# ------------------------------------------------------------
# - Mantiene relaciones y campos de V1
# - Añade extend_existing=True para convivencia con Neon
# - Conserva constraints y claves foráneas
#
# Ajustes previos:
#   * Proveedor: nuevas columnas localidad, pais
#   * GastoCotidiano: se eliminan CHECKS restrictivos de tipo/observaciones
#   * Índices útiles para filtros (fecha/tipo/proveedor; localidad/pais)
#
# Ajustes NUEVOS (ramas de ingreso):
#   * Nueva tabla: tipo_ramas_ingreso
#   * tipo_ingreso añade rama_id
#   * ingresos añade rama_id
#   * Relaciones ORM completas para poder navegar:
#       - rama -> tipos de ingreso
#       - rama -> ingresos
#       - tipo de ingreso -> rama
#       - ingreso -> rama
#
# Ajustes NUEVOS (incidencias 4.3A):
#   * Nueva clase ORM: AsignacionIncidencia
#   * Nueva clase ORM: CitaIncidencia
#   * Incidencia añade relaciones hacia asignaciones y citas
#   * Proveedor añade relaciones hacia asignaciones y citas de incidencias
#   * Persona añade relaciones auxiliares para auditoría operativa de incidencias
#
# Nota funcional:
#   La validación de coherencia entre:
#       ingreso.rama_id <-> ingreso.tipo_id <-> tipo_ingreso.rama_id
#   debe hacerse en schemas / services / router,
#   no sólo en el modelo ORM.
# ============================================================

from datetime import datetime
from uuid import uuid4
import enum

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Enum as SAEnum,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum as PyEnum

from backend.app.db.base import Base


# =============================================
# 1. TABLAS AUXILIARES
# =============================================

class TipoRamasIngreso(Base):
    """
    Catálogo de ramas de ingreso.
    Ejemplos:
    - LABORAL
    - FINANCIACION
    - VIVIENDAS
    - OTROS
    - SUMINISTRO
    - IMPUESTOS Y TASAS
    """
    __tablename__ = "tipo_ramas_ingreso"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

    # Relación con tipos de ingreso
    tipos_ingreso = relationship("TipoIngreso", back_populates="rama_rel")

    # Relación directa con ingresos
    ingresos = relationship("Ingreso", back_populates="rama_rel")


class TipoIngreso(Base):
    """
    Catálogo de tipos de ingreso.
    Ahora cada tipo de ingreso pertenece a una rama.
    """
    __tablename__ = "tipo_ingreso"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

    # NUEVO: rama a la que pertenece el tipo de ingreso
    rama_id = Column(String, ForeignKey("tipo_ramas_ingreso.id"), nullable=False, index=True)

    rama_rel = relationship("TipoRamasIngreso", back_populates="tipos_ingreso")
    ingresos = relationship("Ingreso", back_populates="tipo_rel")


class TipoRamasGasto(Base):
    __tablename__ = "tipo_ramas_gasto"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

    tipos_gasto = relationship("TipoGasto", back_populates="rama_rel")


class TipoSegmentoGasto(Base):
    __tablename__ = "tipo_segmentos_gasto"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

    tipos_gasto = relationship("TipoGasto", back_populates="segmento_rel")
    gastos = relationship("Gasto", back_populates="segmento")


class TipoRamasProveedores(Base):
    __tablename__ = "tipo_ramas_proveedores"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)

    proveedores = relationship("Proveedor", back_populates="rama_rel")


class TipoGasto(Base):
    __tablename__ = "tipo_gasto"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    rama_id = Column(String, ForeignKey("tipo_ramas_gasto.id"))
    segmento_id = Column(String, ForeignKey("tipo_segmentos_gasto.id"), nullable=True)

    rama_rel = relationship("TipoRamasGasto", back_populates="tipos_gasto")
    segmento_rel = relationship("TipoSegmentoGasto", back_populates="tipos_gasto")
    gastos = relationship("Gasto", back_populates="tipo_rel")
    gastos_cotidianos = relationship("GastoCotidiano", back_populates="tipo_rel")
    inversiones = relationship("Inversion", back_populates="tipo_gasto")


# =============================================
# 2. TABLAS PRINCIPALES
# =============================================

class TipoInmueble(str, PyEnum):
    VIVIENDA = "VIVIENDA"
    LOCAL = "LOCAL"
    GARAJE = "GARAJE"
    TRASTERO = "TRASTERO"


class Patrimonio(Base):
    __tablename__ = "patrimonio"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    calle = Column(String)
    numero = Column(String)
    escalera = Column(String)
    piso = Column(String)
    puerta = Column(String)
    localidad = Column(String)
    referencia = Column(String, index=True)
    direccion_completa = Column(String)

    # Propietario del activo
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    tipo_inmueble = Column(
        PGEnum(TipoInmueble, name="tipo_inmueble", create_type=False),
        nullable=False,
        server_default=text("'VIVIENDA'::tipo_inmueble"),
    )
    fecha_adquisicion = Column(Date, nullable=True)
    activo = Column(Boolean, nullable=False, server_default=text("true"), index=True)
    disponible = Column(Boolean, nullable=False, server_default=text("true"), index=True)

    superficie_m2 = Column(Float, nullable=True)

    participacion_pct = Column(Float, nullable=False, server_default=text("100.0"))
    superficie_construida = Column(Numeric(10, 2), nullable=True)

    habitaciones = Column(Integer, nullable=True)
    banos = Column(Integer, nullable=True)
    garaje = Column(Boolean, nullable=False, server_default=text("false"))
    trastero = Column(Boolean, nullable=False, server_default=text("false"))

    ingresos = relationship("Ingreso", back_populates="vivienda_rel")
    gastos = relationship("Gasto", back_populates="vivienda_rel")
    rendimientos = relationship("RendimientoPatrimonio", back_populates="patrimonio", cascade="all, delete-orphan")
    contratos = relationship("Contrato", back_populates="patrimonio_rel", cascade="all, delete-orphan")
    incidencias = relationship("Incidencia", back_populates="patrimonio")
    user = relationship("User", back_populates="patrimonios")


class PatrimonioCompra(Base):
    __tablename__ = "patrimonio_compra"
    __table_args__ = {"extend_existing": True}

    patrimonio_id = Column(String, ForeignKey("patrimonio.id", ondelete="CASCADE"), primary_key=True)

    valor_compra = Column(Float, nullable=False)
    valor_referencia = Column(Float, nullable=True)
    impuestos_pct = Column(Float, nullable=True)
    impuestos_eur = Column(Float, nullable=True)
    notaria = Column(Float, nullable=True)
    agencia = Column(Float, nullable=True)
    reforma_adecuamiento = Column(Float, nullable=True)
    total_inversion = Column(Float, nullable=True)
    valor_mercado = Column(Float, nullable=True)
    valor_mercado_fecha = Column(Date, nullable=True, server_default=func.current_date())

    notas = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    patrimonio_rel = relationship("Patrimonio", backref="compra", uselist=False)


def gen_rendpat_id() -> str:
    return "rendpat-" + uuid4().hex[:8]


def gen_persona_id() -> str:
    return "PER-" + uuid4().hex[:10].upper()


def gen_contrato_id() -> str:
    return "CON-" + uuid4().hex[:10].upper()


def gen_contrato_participante_id() -> str:
    return "CPR-" + uuid4().hex[:10].upper()


class RendimientoPatrimonio(Base):
    __tablename__ = "rendimiento_patrimonio"
    __table_args__ = (
        UniqueConstraint("patrimonio_id", "year", name="uq_rendpat_patrimonio_year"),
        {"extend_existing": True},
    )

    id = Column(String, primary_key=True, default=gen_rendpat_id, index=True)
    patrimonio_id = Column(String, ForeignKey("patrimonio.id", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)

    ingresos_alquiler = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    meses_alquiler = Column(Integer, nullable=False, server_default=text("0"))
    ingresos_adicionales = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    gastos_mejoras = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    gastos_mantenimiento = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    otros_gastos = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    ocupacion_pct = Column(Numeric(5, 2), nullable=False, server_default=text("0"))
    ingreso_bruto = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    gasto_total = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    ingreso_neto = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    yield_bruto_pct = Column(Numeric(7, 3), nullable=False, server_default=text("0"))
    yield_neto_pct = Column(Numeric(7, 3), nullable=False, server_default=text("0"))

    participacion_pct = Column(Numeric(5, 2), nullable=False, server_default=text("100"))

    createon = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    modifiedon = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patrimonio = relationship("Patrimonio", back_populates="rendimientos")


# =============================================
# 2.1 GESTIÓN DE ALQUILERES
# =============================================

class Persona(Base):
    """
    Tabla maestra de personas vinculables a contratos:
    - inquilinos
    - avalistas
    - gestores
    """

    __tablename__ = "personas"
    __table_args__ = (
        Index("ix_personas_user_dni", "user_id", "dni"),
        Index("ix_personas_user_telefono", "user_id", "telefono"),
        {"extend_existing": True},
    )

    id = Column(String, primary_key=True, index=True, default=gen_persona_id)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    nombre_completo = Column(String, nullable=False, index=True)
    dni = Column(String, nullable=True, index=True)
    telefono = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True, index=True)
    fecha_nacimiento = Column(Date, nullable=True)
    observaciones = Column(Text, nullable=True)

    createon = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    modifiedon = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    inactivatedon = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="personas")

    contratos_participaciones = relationship(
        "ContratoParticipante",
        back_populates="persona",
        cascade="all, delete-orphan",
    )

    incidencias_reportadas = relationship(
        "Incidencia",
        foreign_keys="Incidencia.persona_reporta_id",
        back_populates="persona_reporta",
    )

    incidencias_como_gestor = relationship(
        "Incidencia",
        foreign_keys="Incidencia.gestor_actual_id",
        back_populates="gestor_actual",
    )

    incidencias_como_supervisor = relationship(
        "Incidencia",
        foreign_keys="Incidencia.supervisor_actual_id",
        back_populates="supervisor_actual",
    )

    historial_cambios_incidencia = relationship(
        "HistorialEstadoIncidencia",
        foreign_keys="HistorialEstadoIncidencia.persona_cambia_id",
        back_populates="persona_cambia",
    )

    asignaciones_incidencia_como_gestor = relationship(
        "AsignacionIncidencia",
        foreign_keys="AsignacionIncidencia.gestor_id",
        back_populates="gestor",
    )

    asignaciones_incidencia_como_supervisor = relationship(
        "AsignacionIncidencia",
        foreign_keys="AsignacionIncidencia.supervisor_id",
        back_populates="supervisor",
    )

    asignaciones_incidencia_como_asignador = relationship(
        "AsignacionIncidencia",
        foreign_keys="AsignacionIncidencia.asignado_por_persona_id",
        back_populates="asignado_por",
    )

    citas_incidencia_propuestas = relationship(
        "CitaIncidencia",
        foreign_keys="CitaIncidencia.propuesta_por_persona_id",
        back_populates="propuesta_por",
    )

    citas_incidencia_confirmadas = relationship(
        "CitaIncidencia",
        foreign_keys="CitaIncidencia.confirmada_por_persona_id",
        back_populates="confirmada_por",
    )

class Contrato(Base):
    """
    Contrato asociado a una vivienda/patrimonio.
    """

    __tablename__ = "contratos"
    __table_args__ = (
        CheckConstraint(
            "estado IN ('activo', 'pendiente', 'finalizado', 'cancelado')",
            name="ck_contratos_estado"
        ),
        Index("ix_contratos_user_estado", "user_id", "estado"),
        Index("ix_contratos_patrimonio_estado", "patrimonio_id", "estado"),
        {"extend_existing": True},
    )

    id = Column(String, primary_key=True, index=True, default=gen_contrato_id)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    patrimonio_id = Column(String, ForeignKey("patrimonio.id", ondelete="CASCADE"), nullable=False, index=True)

    fecha_inicio = Column(Date, nullable=False)
    fecha_fin = Column(Date, nullable=True)

    renta_mensual = Column(Numeric(12, 2), nullable=True)
    fianza = Column(Numeric(12, 2), nullable=True)

    estado = Column(String, nullable=False, server_default=text("'activo'"), index=True)

    incluye_luz = Column(Boolean, nullable=False, server_default=text("false"))
    incluye_agua = Column(Boolean, nullable=False, server_default=text("false"))
    incluye_internet = Column(Boolean, nullable=False, server_default=text("false"))
    incremento_ipc = Column(Boolean, nullable=False, server_default=text("false"))

    observaciones = Column(Text, nullable=True)

    createon = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    modifiedon = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    inactivatedon = Column(DateTime(timezone=True), nullable=True)
    objeto_alquiler = Column(String, nullable=False, server_default="completa")

    user = relationship("User", back_populates="contratos")
    patrimonio_rel = relationship("Patrimonio", back_populates="contratos")

    participantes = relationship(
        "ContratoParticipante",
        back_populates="contrato",
        cascade="all, delete-orphan",
    )

    incidencias = relationship(
        "Incidencia",
        back_populates="contrato",
        cascade="all, delete-orphan",
    )


class ContratoParticipante(Base):
    """
    Relación entre contrato y persona con rol.
    """

    __tablename__ = "contratos_participantes"
    __table_args__ = (
        CheckConstraint(
            "rol IN ('inquilino', 'avalista', 'gestor', 'propietario')",
            name="ck_contratos_participantes_rol"
        ),
        Index("ix_contrato_participante_contrato_rol", "contrato_id", "rol"),
        Index("ix_contrato_participante_persona", "persona_id"),
        {"extend_existing": True},
    )

    id = Column(String, primary_key=True, index=True, default=gen_contrato_participante_id)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    contrato_id = Column(String, ForeignKey("contratos.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False, index=True)

    rol = Column(String, nullable=False, index=True)
    es_principal = Column(Boolean, nullable=False, server_default=text("false"))
    observaciones = Column(Text, nullable=True)

    createon = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    modifiedon = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    inactivatedon = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="contratos_participantes")
    contrato = relationship("Contrato", back_populates="participantes")
    persona = relationship("Persona", back_populates="contratos_participaciones")


class Pais(Base):
    __tablename__ = "paises"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    codigo_iso = Column(String, nullable=True)

    regiones = relationship("Region", back_populates="pais")


class Region(Base):
    __tablename__ = "regiones"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    pais_id = Column(Integer, ForeignKey("paises.id"), nullable=False)

    pais = relationship("Pais", back_populates="regiones")
    localidades = relationship("Localidad", back_populates="region")

    __table_args__ = (
        UniqueConstraint("nombre", "pais_id"),
    )


class Localidad(Base):
    __tablename__ = "localidades"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regiones.id"), nullable=False)

    region = relationship("Region", back_populates="localidades")
    proveedores = relationship("Proveedor", back_populates="localidad_rel")

    __table_args__ = (
        UniqueConstraint("nombre", "region_id"),
    )


class Proveedor(Base):
    __tablename__ = "proveedores"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    rama_id = Column(String, ForeignKey("tipo_ramas_proveedores.id"), nullable=True)

    localidad = Column(Text, nullable=True, index=True)
    pais = Column(Text, nullable=True, index=True)
    comunidad = Column(String, nullable=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    localidad_id = Column(Integer, ForeignKey("localidades.id"), nullable=True, index=True)

    cif = Column(String, nullable=True)
    telefono = Column(String, nullable=True)
    email = Column(String, nullable=True)
    subsegmento = Column(String, nullable=True)
    direccion = Column(Text, nullable=True)
    codigo_postal = Column(String, nullable=True)
    persona_contacto = Column(String, nullable=True)

    activo = Column(Boolean, nullable=False, server_default=text("true"))
    observaciones = Column(Text, nullable=True)
    acepta_urgencias = Column(Boolean, nullable=False, server_default=text("false"))
    ambito_servicio = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    subsegmento_id = Column(String, nullable=True)

    rama_rel = relationship("TipoRamasProveedores", back_populates="proveedores")
    gastos = relationship("Gasto", back_populates="proveedor_rel")
    gastos_cotidianos = relationship("GastoCotidiano", back_populates="proveedor_rel")
    cuentas_bancarias = relationship("CuentaBancaria", back_populates="banco_rel")
    user = relationship("User", back_populates="proveedores")

    localidad_rel = relationship("Localidad", back_populates="proveedores")
    inversiones_como_proveedor = relationship(
        "Inversion",
        foreign_keys="Inversion.proveedor_id",
        back_populates="proveedor",
    )
    inversiones_como_dealer = relationship(
        "Inversion",
        foreign_keys="Inversion.dealer_id",
        back_populates="dealer",
    )

    incidencias_actuales = relationship(
        "Incidencia",
        foreign_keys="Incidencia.proveedor_actual_id",
        back_populates="proveedor_actual",
    )

    asignaciones_incidencia = relationship(
        "AsignacionIncidencia",
        foreign_keys="AsignacionIncidencia.proveedor_id",
        back_populates="proveedor",
    )

    citas_incidencia = relationship(
        "CitaIncidencia",
        foreign_keys="CitaIncidencia.proveedor_id",
        back_populates="proveedor",
    )

class CuentaBancaria(Base):
    __tablename__ = "cuentas_bancarias"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    banco_id = Column(String, ForeignKey("proveedores.id"))
    referencia = Column(String)
    anagrama = Column(String)

    liquidez = Column(Float, nullable=False, server_default=text("0"))
    liquidez_inicial = Column(Float, nullable=False, server_default=text("0"))

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    activo = Column(Boolean, default=True)

    banco_rel = relationship("Proveedor", back_populates="cuentas_bancarias")
    gastos = relationship("Gasto", back_populates="cuenta_rel")
    ingresos = relationship("Ingreso", back_populates="cuenta")
    gastos_cotidianos = relationship(
        "GastoCotidiano",
        back_populates="cuenta",
        cascade="all, delete-orphan"
    )

    user = relationship("User", back_populates="cuentas_bancarias")

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

    id = Column(String, primary_key=True, index=True)

    rango_cobro = Column(String, nullable=True)
    periodicidad = Column(String)

    # Tipo de ingreso seleccionado
    tipo_id = Column(String, ForeignKey("tipo_ingreso.id"), index=True)

    # NUEVO: rama del ingreso
    # Se persiste también en ingresos para acelerar filtros y evitar recalcular siempre
    rama_id = Column(String, ForeignKey("tipo_ramas_ingreso.id"), nullable=True, index=True)

    referencia_vivienda_id = Column(String, ForeignKey("patrimonio.id"))

    # Ajuste de consistencia:
    # contratos.id es String, por tanto aquí también debe ser String
    contrato_alquiler = Column(
        String,
        ForeignKey("contratos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    concepto = Column(String)
    importe = Column(Float)
    activo = Column(Boolean, server_default=text("true"))
    cobrado = Column(Boolean, server_default=text("false"))
    createon = Column(DateTime, server_default=func.now())
    modifiedon = Column(DateTime, onupdate=func.now())
    fecha_inicio = Column(Date, nullable=True)

    cuenta_id = Column(
        String,
        ForeignKey("cuentas_bancarias.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    kpi = Column(Boolean, nullable=False, server_default=sa.text("true"))
    ingresos_cobrados = Column(Integer, nullable=False, server_default=sa.text("0"))
    inactivatedon = Column(DateTime, nullable=True)
    ultimo_ingreso_on = Column(DateTime, nullable=True)

    omitido_este_mes = Column(Boolean, nullable=False, server_default=sa.text("false"), index=True)
    ultimo_omitido_on = Column(DateTime(timezone=True), nullable=True)
    omitido_count = Column(Integer, nullable=False, server_default=sa.text("0"))

    # Relaciones
    tipo_rel = relationship("TipoIngreso", back_populates="ingresos")
    rama_rel = relationship("TipoRamasIngreso", back_populates="ingresos")
    cuenta = relationship("CuentaBancaria", back_populates="ingresos", lazy="joined")
    vivienda_rel = relationship("Patrimonio", back_populates="ingresos")
    contrato_rel = relationship("Contrato", foreign_keys=[contrato_alquiler])
    user = relationship("User", back_populates="ingresos")


class Gasto(Base):
    __tablename__ = "gastos"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True)
    fecha = Column(Date, index=True)
    periodicidad = Column(String, index=True)
    nombre = Column(String)
    tienda = Column(String)
    proveedor_id = Column(String, ForeignKey("proveedores.id"), index=True)
    tipo_id = Column(String, ForeignKey("tipo_gasto.id"), index=True)
    segmento_id = Column(String, ForeignKey("tipo_segmentos_gasto.id"), nullable=True, index=True)
    rama = Column(String)
    referencia_vivienda_id = Column(String, ForeignKey("patrimonio.id"), index=True)
    cuenta_id = Column(String, ForeignKey("cuentas_bancarias.id"), index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    importe = Column(Float)
    importe_cuota = Column(Float)
    cuotas = Column(Integer)
    total = Column(Float)
    cuotas_pagadas = Column(Integer)
    cuotas_restantes = Column(Integer)
    importe_pendiente = Column(Float)
    rango_pago = Column(String)
    activo = Column(Boolean, server_default=text("true"), index=True)
    pagado = Column(Boolean, server_default=text("false"), index=True)
    kpi = Column(Boolean, server_default=text("false"), index=True)
    createon = Column(DateTime, server_default=func.now())
    modifiedon = Column(DateTime, onupdate=func.now())
    referencia_gasto = Column(String, ForeignKey("gastos.id"))
    prestamo_id = sa.Column(sa.String)

    inactivatedon = Column(DateTime, nullable=True)
    ultimo_pago_on = Column(DateTime, nullable=True)
    comentarios = Column(Text, nullable=True)

    omitido_este_mes = Column(Boolean, nullable=False, server_default=text("false"), index=True)
    ultimo_omitido_on = Column(DateTime(timezone=True), nullable=True)
    omitido_count = Column(Integer, nullable=False, server_default=text("0"))

    proveedor_rel = relationship("Proveedor", back_populates="gastos")
    tipo_rel = relationship("TipoGasto", back_populates="gastos")
    vivienda_rel = relationship("Patrimonio", back_populates="gastos")
    cuenta_rel = relationship("CuentaBancaria", back_populates="gastos")
    subgastos = relationship("Gasto", backref="parent", remote_side=[id])
    segmento = relationship("TipoSegmentoGasto", back_populates="gastos")
    user = relationship("User", back_populates="gastos")

    @property
    def user_nombre(self) -> str | None:
        return self.user.full_name if self.user else None

    @property
    def proveedor_nombre(self) -> str | None:
        return self.proveedor_rel.nombre if self.proveedor_rel else None

    @property
    def tipo_nombre(self) -> str | None:
        return self.tipo_rel.nombre if self.tipo_rel else None

    @property
    def segmento_nombre(self) -> str | None:
        return self.segmento.nombre if self.segmento else None

    @property
    def cuenta_anagrama(self) -> str | None:
        if not self.cuenta_rel:
            return None
        return getattr(self.cuenta_rel, "anagrama", None) or getattr(self.cuenta_rel, "nombre", None)


class GastoCotidiano(Base):
    __tablename__ = "gastos_cotidianos"
    __table_args__ = {
        "extend_existing": True,
        "schema": "public",
    }

    id = Column(String, primary_key=True, index=True)
    fecha = Column(Date, index=True)
    tipo_id = Column(String, ForeignKey("tipo_gasto.id"), index=True)
    proveedor_id = Column(String, ForeignKey("proveedores.id"), index=True)
    cuenta_id = Column(String, ForeignKey("cuentas_bancarias.id"), index=True, nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    importe = Column(Float)
    litros = Column(Float)
    km = Column(Float)
    precio_litro = Column(Float)
    pagado = Column(Boolean, server_default=text("true"), index=True)

    tipo_pago = Column(Integer, nullable=True, index=True)
    importe_total = Column(Numeric(12, 2), nullable=True)
    cantidad = Column(Integer, nullable=True)

    evento = Column(String(120), nullable=True)
    observaciones = Column(sa.Text, nullable=True)

    tipo_rel = relationship("TipoGasto", back_populates="gastos_cotidianos")
    proveedor_rel = relationship("Proveedor", back_populates="gastos_cotidianos")
    cuenta = relationship("CuentaBancaria", back_populates="gastos_cotidianos", lazy="joined")
    user = relationship("User", back_populates="gastos_cotidianos")

# =============================================
# 3.1 INCIDENCIAS BOT / ALQUILERES
# =============================================

def gen_incidencia_id() -> str:
    return "INCID-" + uuid4().hex[:12].upper()


def gen_historial_estado_incidencia_id() -> str:
    return "IHE-" + uuid4().hex[:12].upper()


def gen_asignacion_incidencia_id() -> str:
    return "ASI-" + uuid4().hex[:12].upper()


def gen_cita_incidencia_id() -> str:
    return "CIT-" + uuid4().hex[:12].upper()


class Incidencia(Base):
    """
    Incidencia reportada sobre un contrato de alquiler.

    Tabla principal para la gestión operativa de incidencias desde BOT
    y backoffice.
    """

    __tablename__ = "incidencias"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True, default=gen_incidencia_id)
    codigo = Column(String, nullable=False, index=True)

    contrato_id = Column(String, ForeignKey("contratos.id"), nullable=False, index=True)
    patrimonio_id = Column(String, ForeignKey("patrimonio.id"), nullable=True, index=True)

    persona_reporta_id = Column(String, ForeignKey("personas.id"), nullable=False, index=True)
    rol_reporta = Column(String, nullable=False, index=True)

    categoria = Column(String, nullable=False, index=True)
    titulo = Column(String, nullable=True)
    descripcion = Column(Text, nullable=False)

    prioridad = Column(String, nullable=False, index=True)
    estado = Column(String, nullable=False, index=True)

    gestor_actual_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    supervisor_actual_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    proveedor_actual_id = Column(String, ForeignKey("proveedores.id"), nullable=True, index=True)

    telefono_inquilino_snapshot = Column(String, nullable=True)
    notas_acceso = Column(Text, nullable=True)

    fecha_creacion = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    fecha_actualizacion = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    fecha_cierre = Column(DateTime(timezone=True), nullable=True)

    contrato = relationship("Contrato", back_populates="incidencias")
    patrimonio = relationship("Patrimonio", back_populates="incidencias")

    persona_reporta = relationship(
        "Persona",
        foreign_keys=[persona_reporta_id],
        back_populates="incidencias_reportadas",
    )

    gestor_actual = relationship(
        "Persona",
        foreign_keys=[gestor_actual_id],
        back_populates="incidencias_como_gestor",
    )

    supervisor_actual = relationship(
        "Persona",
        foreign_keys=[supervisor_actual_id],
        back_populates="incidencias_como_supervisor",
    )

    proveedor_actual = relationship(
        "Proveedor",
        foreign_keys=[proveedor_actual_id],
        back_populates="incidencias_actuales",
    )

    historial_estados = relationship(
        "HistorialEstadoIncidencia",
        back_populates="incidencia",
        cascade="all, delete-orphan",
    )

    asignaciones = relationship(
        "AsignacionIncidencia",
        back_populates="incidencia",
        cascade="all, delete-orphan",
    )

    citas = relationship(
        "CitaIncidencia",
        back_populates="incidencia",
        cascade="all, delete-orphan",
    )

class HistorialEstadoIncidencia(Base):
    """
    Historial de cambios de estado de una incidencia.
    """

    __tablename__ = "historial_estados_incidencias"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True, default=gen_historial_estado_incidencia_id)

    incidencia_id = Column(String, ForeignKey("incidencias.id"), nullable=False, index=True)

    estado_anterior = Column(String, nullable=True)
    estado_nuevo = Column(String, nullable=False, index=True)

    persona_cambia_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    rol_cambia = Column(String, nullable=True)
    nota = Column(Text, nullable=True)

    fecha_creacion = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    incidencia = relationship("Incidencia", back_populates="historial_estados")
    persona_cambia = relationship(
        "Persona",
        foreign_keys=[persona_cambia_id],
        back_populates="historial_cambios_incidencia",
    )

def gen_asignacion_incidencia_id() -> str:
    return "ASI-" + uuid4().hex[:12].upper()


class AsignacionIncidencia(Base):
    """
    Registro histórico y operativo de asignaciones sobre una incidencia.

    Permite trazar:
    - toma en gestión por gestor
    - asignación de supervisor
    - asignación de proveedor
    - cierre o sustitución de asignaciones previas
    """

    __tablename__ = "asignaciones_incidencias"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True, default=gen_asignacion_incidencia_id)

    incidencia_id = Column(String, ForeignKey("incidencias.id"), nullable=False, index=True)

    gestor_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    supervisor_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    proveedor_id = Column(String, ForeignKey("proveedores.id"), nullable=True, index=True)

    tipo_asignacion = Column(String, nullable=False, index=True)
    estado = Column(String, nullable=False, index=True)

    asignado_por_persona_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)

    fecha_asignacion = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    fecha_desasignacion = Column(DateTime(timezone=True), nullable=True)

    nota = Column(Text, nullable=True)

    incidencia = relationship("Incidencia", back_populates="asignaciones")

    gestor = relationship(
        "Persona",
        foreign_keys=[gestor_id],
        back_populates="asignaciones_incidencia_como_gestor",
    )

    supervisor = relationship(
        "Persona",
        foreign_keys=[supervisor_id],
        back_populates="asignaciones_incidencia_como_supervisor",
    )

    proveedor = relationship(
        "Proveedor",
        foreign_keys=[proveedor_id],
        back_populates="asignaciones_incidencia",
    )

    asignado_por = relationship(
        "Persona",
        foreign_keys=[asignado_por_persona_id],
        back_populates="asignaciones_incidencia_como_asignador",
    )

class CitaIncidencia(Base):
    """
    Cita programada para una incidencia.

    En la Fase 4.3A la cita se utilizará para:
    - registrar fecha y hora programadas
    - vincular el proveedor que realizará la visita
    - dejar trazabilidad de propuesta y posibles reprogramaciones

    La confirmación explícita del inquilino queda fuera de 4.3A
    y se abordará en 4.3B.
    """

    __tablename__ = "citas_incidencias"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True, default=gen_cita_incidencia_id)

    incidencia_id = Column(String, ForeignKey("incidencias.id"), nullable=False, index=True)
    proveedor_id = Column(String, ForeignKey("proveedores.id"), nullable=True, index=True)

    fecha_inicio_programada = Column(DateTime(timezone=True), nullable=False)
    fecha_fin_programada = Column(DateTime(timezone=True), nullable=True)

    estado_inquilino = Column(String, nullable=False, index=True)
    estado_cita = Column(String, nullable=False, index=True)

    propuesta_por_persona_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)
    confirmada_por_persona_id = Column(String, ForeignKey("personas.id"), nullable=True, index=True)

    fecha_confirmacion = Column(DateTime(timezone=True), nullable=True)
    motivo_reprogramacion = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    incidencia = relationship("Incidencia", back_populates="citas")

    proveedor = relationship(
        "Proveedor",
        foreign_keys=[proveedor_id],
        back_populates="citas_incidencia",
    )

    propuesta_por = relationship(
        "Persona",
        foreign_keys=[propuesta_por_persona_id],
        back_populates="citas_incidencia_propuestas",
    )

    confirmada_por = relationship(
        "Persona",
        foreign_keys=[confirmada_por_persona_id],
        back_populates="citas_incidencia_confirmadas",
    )

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

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    is_active = Column(Boolean, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    role = Column(
        SAEnum(RoleEnum, name="role_enum"),
        nullable=False,
        server_default="user",
    )

    gastos = relationship("Gasto", back_populates="user")
    ingresos = relationship("Ingreso", back_populates="user")
    gastos_cotidianos = relationship("GastoCotidiano", back_populates="user")
    cuentas_bancarias = relationship("CuentaBancaria", back_populates="user")
    patrimonios = relationship("Patrimonio", back_populates="user")
    prestamos = relationship("Prestamo", back_populates="user")
    proveedores = relationship("Proveedor", back_populates="user")
    movimientos_cuenta = relationship("MovimientoCuenta", back_populates="user")

    personas = relationship("Persona", back_populates="user")
    contratos = relationship("Contrato", back_populates="user")
    contratos_participantes = relationship("ContratoParticipante", back_populates="user")

    inversiones = relationship(
        "Inversion",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


# =============================================
# 5. CIERRES MENSUALES
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
        sa.dialects.postgresql.UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )

    anio = sa.Column(sa.SmallInteger, nullable=False)
    mes = sa.Column(sa.SmallInteger, nullable=False)

    fecha_cierre = sa.Column(sa.DateTime, server_default=func.now())

    user_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
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

    liquidez_total = sa.Column(sa.Float, nullable=False, server_default=sa.text("0"))

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
        sa.dialects.postgresql.UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )
    cierre_id = sa.Column(
        sa.dialects.postgresql.UUID(as_uuid=True),
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

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    nombre = Column(String, nullable=False)

    proveedor_id = Column(String, nullable=False, index=True)
    referencia_vivienda_id = Column(String, nullable=True, index=True)
    cuenta_id = Column(String, nullable=False, index=True)

    fecha_inicio = Column(Date, nullable=False)
    periodicidad = Column(String, nullable=True)
    plazo_meses = Column(Integer, nullable=False, default=0)

    importe_principal = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    tipo_interes = Column(String, nullable=True)
    tin_pct = Column(Numeric, nullable=True)
    tae_pct = Column(Numeric, nullable=True)

    indice = Column(String, nullable=True)
    diferencial_pct = Column(Numeric, nullable=True)

    comision_apertura = Column(Numeric, nullable=True)
    otros_gastos_iniciales = Column(Numeric, nullable=True)

    estado = Column(String, nullable=True, index=True)
    cuotas_totales = Column(Integer, nullable=True, default=0)
    cuotas_pagadas = Column(Integer, nullable=True, default=0)

    fecha_vencimiento = Column(Date, nullable=True)
    rango_pago = Column(String, nullable=True)

    activo = Column(Boolean, nullable=False, default=True)

    createon = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    modifiedon = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    inactivatedon = Column(DateTime, nullable=True)

    referencia_gasto = Column(String, nullable=True)

    capital_pendiente = Column(Numeric, nullable=True)
    intereses_pendientes = Column(Numeric, nullable=True)

    cuotas = relationship("PrestamoCuota", back_populates="prestamo", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_prestamo_user_createon", "user_id", "createon"),
        Index("ix_prestamo_user_estado", "user_id", "estado"),
    )

    user = sa.orm.relationship("User", back_populates="prestamos")


# ============================
# Detalle de cuotas (plan)
# ============================
class PrestamoCuota(Base):
    __tablename__ = "prestamo_cuota"

    id = Column(String, primary_key=True, index=True)

    prestamo_id = Column(String, ForeignKey("prestamo.id"), nullable=False, index=True)
    num_cuota = Column(Integer, nullable=False)

    fecha_vencimiento = Column(Date, nullable=False)

    importe_cuota = Column(Numeric, nullable=False)
    capital = Column(Numeric, nullable=False)
    interes = Column(Numeric, nullable=False)
    seguros = Column(Numeric, nullable=True)
    comisiones = Column(Numeric, nullable=True)
    saldo_posterior = Column(Numeric, nullable=True)

    pagada = Column(Boolean, nullable=False, default=False)
    fecha_pago = Column(Date, nullable=True)
    gasto_id = Column(String, nullable=True)

    createon = Column(DateTime, nullable=False, default=datetime.utcnow)
    modifiedon = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    prestamo = relationship("Prestamo", back_populates="cuotas")

    __table_args__ = (
        Index("ix_prestamo_cuota_prestamo_num", "prestamo_id", "num_cuota"),
    )


# =============================================
# 6. INVERSIONES
# =============================================

def gen_inversion_id() -> str:
    return "INV-" + uuid4().hex[:10].upper()


class Inversion(Base):
    __tablename__ = "inversion"
    __table_args__ = {"extend_existing": True}

    id = Column(String, primary_key=True, index=True, default=gen_inversion_id)

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    tipo_gasto_id = Column(String, ForeignKey("tipo_gasto.id", ondelete="RESTRICT"), nullable=False, index=True)

    proveedor_id = Column(String, ForeignKey("proveedores.id", ondelete="SET NULL"), nullable=True, index=True)
    dealer_id = Column(String, ForeignKey("proveedores.id", ondelete="SET NULL"), nullable=True, index=True)

    nombre = Column(String, nullable=False)
    descripcion = Column(sa.Text, nullable=True)

    estado = Column(String, nullable=False, server_default=text("'ACTIVA'"))
    fase = Column(String, nullable=True)

    fecha_creacion = Column(Date, nullable=False, server_default=func.current_date())
    fecha_inicio = Column(Date, nullable=True)
    fecha_objetivo_salida = Column(Date, nullable=True)
    fecha_cierre_real = Column(Date, nullable=True)

    moneda = Column(String, nullable=False, server_default=text("'EUR'"))

    aporte_estimado = Column(Numeric(14, 2), nullable=True)
    aporte_final = Column(Numeric(14, 2), nullable=True)
    retorno_esperado_total = Column(Numeric(14, 2), nullable=True)
    retorno_final_total = Column(Numeric(14, 2), nullable=True)

    roi_esperado_pct = Column(Numeric(6, 2), nullable=True)
    moic_esperado = Column(Numeric(10, 4), nullable=True)
    irr_esperada_pct = Column(Numeric(6, 2), nullable=True)
    plazo_esperado_meses = Column(Integer, nullable=True)

    roi_final_pct = Column(Numeric(6, 2), nullable=True)
    moic_final = Column(Numeric(10, 4), nullable=True)
    irr_final_pct = Column(Numeric(6, 2), nullable=True)
    plazo_final_meses = Column(Integer, nullable=True)

    notas = Column(sa.Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="inversiones")

    tipo_gasto = relationship("TipoGasto", back_populates="inversiones")

    proveedor = relationship(
        "Proveedor",
        foreign_keys=[proveedor_id],
        back_populates="inversiones_como_proveedor",
    )
    dealer = relationship(
        "Proveedor",
        foreign_keys=[dealer_id],
        back_populates="inversiones_como_dealer",
    )

    metricas = relationship(
        "InversionMetrica",
        back_populates="inversion",
        cascade="all, delete-orphan",
    )


class InversionMetrica(Base):
    __tablename__ = "inversion_metrica"
    __table_args__ = {"extend_existing": True}

    id = Column(sa.BigInteger, primary_key=True, autoincrement=True)

    inversion_id = Column(
        String,
        ForeignKey("inversion.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    escenario = Column(String, nullable=True)
    clave = Column(String, nullable=False)

    valor_num = Column(Numeric(18, 6), nullable=True)
    valor_Texto = Column(sa.Text, nullable=True)
    unidad = Column(String, nullable=True)
    origen = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    inversion = relationship("Inversion", back_populates="metricas")