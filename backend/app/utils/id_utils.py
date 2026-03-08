# backend/app/utils/id_utils.py

"""
Utilidades para la generación de IDs en GapptoMobile v3.

Objetivo:
- Tener un único sitio donde se definan los patrones de IDs
  (prefijos, longitud, mayúsculas/minúsculas, etc.).
- Evitar duplicar lógica en cada router.

Incluye:
- random_code: genera un código aleatorio dado un alfabeto.
- generate_random_id: ID simple sin comprobar BD.
- generate_id_with_db: ID comprobando colisión en la tabla.
- Wrappers específicos para las distintas entidades.

Notas de diseño:
- Cuando el riesgo de colisión es muy bajo y el insert ya controla
  IntegrityError, puede bastar generate_random_id().
- Cuando queremos máxima robustez antes de insertar, usamos
  generate_id_with_db() contra la tabla real.
"""

from __future__ import annotations

import secrets
import string

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


# ============================================================
# Alfabetos reutilizables
# ============================================================

UPPER_ALNUM = string.ascii_uppercase + string.digits
LOWER_ALNUM = string.ascii_lowercase + string.digits


# ============================================================
# Helpers genéricos
# ============================================================

def random_code(length: int = 6, *, alphabet: str = UPPER_ALNUM) -> str:
    """
    Genera un código aleatorio de `length` caracteres usando el
    alfabeto indicado.

    Ejemplo:
        random_code(6, alphabet=UPPER_ALNUM) -> 'A3Z91B'
    """
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_random_id(
    prefix: str,
    *,
    length: int = 6,
    alphabet: str = UPPER_ALNUM,
) -> str:
    """
    Genera un ID del estilo:

        <prefix><codigo>

    sin comprobar nada en la BD.

    Útil cuando:
    - el espacio de IDs es suficientemente grande
    - la colisión es muy improbable
    - además se controla IntegrityError en el insert

    Ejemplo:
        generate_random_id("INGRESO-", length=6, alphabet=UPPER_ALNUM)
        -> 'INGRESO-A1B2C3'
    """
    return f"{prefix}{random_code(length=length, alphabet=alphabet)}"


def generate_id_with_db(
    db: Session,
    *,
    prefix: str,
    table: str,
    column: str = "id",
    length: int = 6,
    alphabet: str = UPPER_ALNUM,
    attempts: int = 10,
) -> str:
    """
    Genera un ID del estilo:

        <prefix><codigo>

    comprobando que no exista ya en la tabla indicada.

    Parámetros:
    - db: sesión SQLAlchemy
    - prefix: prefijo del ID (ej: 'GASTO_COTIDIANO-', 'gasto-')
    - table: nombre completo de la tabla, incluyendo schema si aplica
             (ej: 'public.gastos', 'public.tipo_ingreso')
    - column: columna donde se guarda el ID (por defecto 'id')
    - length: longitud del código aleatorio
    - alphabet: alfabeto a usar
    - attempts: máximo número de intentos

    Si no consigue un ID libre tras varios intentos, lanza HTTP 500.
    """
    for _ in range(attempts):
        candidate = f"{prefix}{random_code(length=length, alphabet=alphabet)}"
        row = db.execute(
            text(
                f"SELECT 1 FROM {table} "
                f"WHERE {column} = :id LIMIT 1"
            ),
            {"id": candidate},
        ).first()
        if not row:
            return candidate

    raise HTTPException(
        status_code=500,
        detail=(
            "No se pudo generar un ID único "
            f"para la tabla {table} tras varios intentos."
        ),
    )


def generate_entity_id(
    db: Session,
    prefix: str,
    table: str,
    column: str = "id",
    length: int = 6,
    alphabet: str = UPPER_ALNUM,
) -> str:
    """
    Generador genérico de IDs para cualquier entidad.

    Ejemplo:
        generate_entity_id(db, prefix="TIPO-", table="public.tipo_gasto")
    """
    return generate_id_with_db(
        db=db,
        prefix=prefix,
        table=table,
        column=column,
        length=length,
        alphabet=alphabet,
    )


# ============================================================
# Wrappers específicos para Gappto
# ============================================================

def generate_ingreso_id(db: Session) -> str:
    """
    IDs de INGRESOS, compatibles con la v2:

        INGRESO-<6 caracteres A-Z0-9>

    Comprueba colisión en public.ingresos.
    """
    return generate_id_with_db(
        db=db,
        prefix="INGRESO-",
        table="public.ingresos",
        column="id",
        length=6,
        alphabet=UPPER_ALNUM,
    )

def generate_gasto_cotidiano_id(db: Session) -> str:
    """
    IDs de GASTOS COTIDIANOS:

        GASTO_COTIDIANO-<6 caracteres A-Z0-9>

    Comprueba colisión en public.gastos_cotidianos.
    """
    return generate_id_with_db(
        db,
        prefix="GASTO_COTIDIANO-",
        table="public.gastos_cotidianos",
        column="id",
        length=6,
        alphabet=UPPER_ALNUM,
    )


def generate_gasto_id(db: Session) -> str:
    """
    IDs de GASTOS gestionables, compatibles con la v2:

        gasto-<6 caracteres a-z0-9>

    Comprueba colisión en public.gastos.
    """
    return generate_id_with_db(
        db,
        prefix="gasto-",
        table="public.gastos",
        column="id",
        length=6,
        alphabet=LOWER_ALNUM,
    )


def generate_cuenta_bancaria_id(db: Session) -> str:
    """
    IDs de CUENTAS BANCARIAS:

        CTA-<6 caracteres A-Z0-9>

    Comprueba colisión en public.cuentas_bancarias.
    """
    return generate_id_with_db(
        db,
        prefix="CTA-",
        table="public.cuentas_bancarias",
        column="id",
        length=6,
        alphabet=UPPER_ALNUM,
    )


def generate_proveedor_id(db: Session) -> str:
    """
    IDs de PROVEEDORES:

        PROV-<6 caracteres A-Z0-9>

    Comprueba colisión en public.proveedores.
    """
    return generate_entity_id(
        db=db,
        prefix="PROV-",
        table="public.proveedores",
    )


def generate_tipo_gasto_id(db: Session) -> str:
    """
    IDs de TipoGasto:

        TGAS-<6 caracteres A-Z0-9>

    Tabla: public.tipo_gasto
    """
    return generate_entity_id(
        db=db,
        prefix="TGAS-",
        table="public.tipo_gasto",
    )


def generate_tipo_ingreso_id(db: Session) -> str:
    """
    IDs de TipoIngreso:

        TING-<6 caracteres A-Z0-9>

    Tabla: public.tipo_ingreso
    """
    return generate_entity_id(
        db=db,
        prefix="TING-",
        table="public.tipo_ingreso",
    )


def generate_tipo_segmento_gasto_id(db: Session) -> str:
    """
    IDs de TipoSegmentoGasto:

        TSEG-<6 caracteres A-Z0-9>

    Tabla real: public.tipo_segmentos_gasto
    """
    return generate_entity_id(
        db=db,
        prefix="TSEG-",
        table="public.tipo_segmentos_gasto",
    )


def generate_tipo_rama_gasto_id(db: Session) -> str:
    """
    IDs de TipoRamasGasto:

        TRAG-<6 caracteres A-Z0-9>

    Tabla: public.tipo_ramas_gasto
    """
    return generate_entity_id(
        db=db,
        prefix="TRAG-",
        table="public.tipo_ramas_gasto",
    )


def generate_tipo_rama_proveedor_id(db: Session) -> str:
    """
    IDs de TipoRamasProveedores:

        TRPR-<6 caracteres A-Z0-9>

    Tabla: public.tipo_ramas_proveedores
    """
    return generate_entity_id(
        db=db,
        prefix="TRPR-",
        table="public.tipo_ramas_proveedores",
    )


def generate_tipo_rama_ingreso_id(db: Session) -> str:
    """
    IDs de TipoRamasIngreso:

        TRIN-<6 caracteres A-Z0-9>

    Tabla: public.tipo_ramas_ingreso

    Nota:
    - Los datos semilla históricos usan otro formato más descriptivo
      (ej. LAB-TIPORAMAINGRESO-...).
    - Para nuevas altas desde API usamos un formato técnico uniforme
      y fácil de mantener.
    """
    return generate_entity_id(
        db=db,
        prefix="TRIN-",
        table="public.tipo_ramas_ingreso",
    )


def generate_patrimonio_id(db: Session) -> str:
    """
    IDs de PATRIMONIO:

        VIVIENDA-<6 caracteres A-Z0-9>

    Tabla: public.patrimonio
    """
    return generate_entity_id(
        db=db,
        prefix="VIVIENDA-",
        table="public.patrimonio",
    )


def generate_prestamo_id(db: Session) -> str:
    """
    IDs de PRÉSTAMOS:

        prestamo-<6 caracteres A-Z0-9>

    Tabla: public.prestamo
    """
    return generate_entity_id(
        db=db,
        prefix="prestamo-",
        table="public.prestamo",
    )


def generate_prestamo_cuota_id(db: Session) -> str:
    """
    IDs de CUOTAS DE PRÉSTAMO:

        prestamo_cuota-<6 caracteres A-Z0-9>

    Tabla: public.prestamo_cuota
    """
    return generate_entity_id(
        db=db,
        prefix="prestamo_cuota-",
        table="public.prestamo_cuota",
    )