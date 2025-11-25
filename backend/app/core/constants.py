# backend/app/core/constants.py

"""
Constantes de negocio de GapptoMobile.

Aquí concentramos todos los "strings mágicos" que usamos en varios sitios:
- periodicidades
- IDs de segmentos clave
- etc.

Más adelante, cuando tengamos un configurador, este módulo será el
punto intermedio entre la configuración y el código.
"""

# ----------------------------
# Periodicidades (texto)
# ----------------------------
PERIODICIDAD_MENSUAL = "MENSUAL"
PERIODICIDAD_TRIMESTRAL = "TRIMESTRAL"
PERIODICIDAD_SEMESTRAL = "SEMESTRAL"
PERIODICIDAD_ANUAL = "ANUAL"
PERIODICIDAD_PAGO_UNICO = "PAGO UNICO"  # PAGO ÚNICO en la BD, en mayúsculas

ALL_PERIODICIDADES = {
    PERIODICIDAD_MENSUAL,
    PERIODICIDAD_TRIMESTRAL,
    PERIODICIDAD_SEMESTRAL,
    PERIODICIDAD_ANUAL,
    PERIODICIDAD_PAGO_UNICO,
}

# ----------------------------
# Segmentos
# ----------------------------
# Segmento para GASTOS COTIDIANOS (coincide con tu BD)
SEGMENTO_COTIDIANOS_ID = "COT-12345"

# ----------------------------
# Ramas de proveedores
# ----------------------------

# Rama para bancos y entidades financieras
# (debe coincidir con el ID real en la BD)
RAMA_BANCOS_FINANCIERAS_ID = "BAN-TIPORAMAPROVEEDOR-8D1302BD"

# ----------------------------
# Reglas especiales de PROVEEDORES
# ----------------------------

# Nombres de rama (TipoRamasProveedores.nombre, en MAYÚSCULAS)
# donde LOCALIDAD y PAÍS son obligatorios.
PROVEEDOR_RAMAS_UBICACION_OBLIGATORIA_NOMBRE = {
    "RESTAURANTES",
    "HOTELES",
}

# Nombres de rama donde, además, COMUNIDAD es obligatoria.
# IMPORTANTE: ahora aplica tanto a RESTAURANTES como a HOTELES.
PROVEEDOR_RAMAS_COMUNIDAD_OBLIGATORIA_NOMBRE = {
    "RESTAURANTES",
    "HOTELES",
}

# ============================
# PRÉSTAMOS / GASTO ASOCIADO
# ============================

# Tipo de gasto principal para cuotas de HIPOTECA / PRÉSTAMO PERSONAL
HIPOTECA_TIPO_GASTO_ID = "HIP-TIPOGASTO-1D7B7498"
PRESTAMO_TIPO_GASTO_ID = "PRE-TIPOGASTO-DF858F12"

# Segmentos
SEGMENTO_VIVIENDA_ID = "VIVI-12345"
SEGMENTO_FINANCIERO_ID = "FIN-12345"

# Ramas de gasto
RAMA_VIVIENDA_GASTO_ID = "VIV-TIPORAMAGASTO-6F29A938"
RAMA_FINANCIERO_GASTO_ID = "FIN-TIPORAMAGASTO-957ACF83"

# Tipo gasto específico para amortización de HIPOTECA (pago único)
TIPO_GASTO_HIPOTECA_AMORT_ID = "HIP-TIPOGASTO-1D7B749B"
