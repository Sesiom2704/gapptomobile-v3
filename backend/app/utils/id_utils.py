# backend/app/utils/id_utils.py

"""
Utilidades para la generación de IDs en GapptoMobile v3.

Objetivo:
- Tener un único sitio donde se definan los patrones de IDs
  (prefijos, longitud, mayúsculas/minúsculas, etc.).
- Evitar duplicar lógica en cada router.

Incluye:
- random_code: genera un código aleatorio dado un alfabeto.
- generate_random_id: ID simple sin comprobar BD (suficiente cuando
  la probabilidad de colisión es muy baja y además se controla con
  IntegrityError).
- generate_id_with_db: ID comprobando colisión en la tabla.
- Wrappers específicos:
    * generate_ingreso_id()
    * generate_gasto_cotidiano_id(db)
    * generate_gasto_id(db)
"""

from __future__ import annotations

from typing import Optional

import secrets
import string

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

# Alfabetos que reutilizaremos
UPPER_ALNUM = string.ascii_uppercase + string.digits
LOWER_ALNUM = string.ascii_lowercase + string.digits


def random_code(length: int = 6, *, alphabet: str = UPPER_ALNUM) -> str:
    """
    Genera un código aleatorio de `length` caracteres a partir del
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

    sin comprobar nada en la BD. Es útil cuando:

    - El espacio de IDs es muy grande (colisión muy improbable).
    - Además controlamos posibles colisiones con IntegrityError en el insert.

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
    - db: sesión SQLAlchemy.
    - prefix: prefijo del ID (ej: 'GASTO_COTIDIANO-', 'gasto-').
    - table: nombre completo de la tabla, incluyendo schema si aplica
             (ej: 'public.gastos', 'public.gastos_cotidianos').
    - column: columna donde se guarda el ID (por defecto 'id').
    - length: longitud del código aleatorio.
    - alphabet: alfabeto a usar (UPPER_ALNUM, LOWER_ALNUM, ...).
    - attempts: número máximo de reintentos en caso de colisión.

    Si no consigue un ID libre tras `attempts` intentos, lanza HTTP 500.
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


# ============================================================
# Wrappers específicos para Gappto (evitan “magia” en routers)
# ============================================================

def generate_ingreso_id() -> str:
    """
    IDs de INGRESOS, compatibles con la v2:

        INGRESO-<6 caracteres A-Z0-9>
    """
    return generate_random_id(
        prefix="INGRESO-",
        length=6,
        alphabet=UPPER_ALNUM,
    )


def generate_gasto_cotidiano_id(db: Session) -> str:
    """
    IDs de GASTOS COTIDIANOS, compatibles con la v2:

        GASTO_COTIDIANO-<6 caracteres A-Z0-9>

    Se comprueba que no exista ya en public.gastos_cotidianos.
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

    Se comprueba que no exista ya en public.gastos.
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

    Se comprueba que no exista ya en public.cuentas_bancarias antes de usarlo.
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
    Genera un ID único para PROVEEDORES con el formato:

        PROV-<6 caracteres A-Z0-9>

    Usa la tabla real de proveedores en la BD para asegurar que
    no se repite (consulta por public.proveedores.id).

    Requiere que exista la función generate_id_with_db, que ya
    utilizamos para otros IDs (gastos, ingresos, cuentas, etc.).
    """
    return generate_id_with_db(
        db=db,
        prefix="PROV-",
        table="public.proveedores",
        column="id",
        length=6,
        alphabet=UPPER_ALNUM,
    )


def generate_entity_id(
    db: Session,
    prefix: str,
    table: str,
    column: str = "id",
    length: int = 6,
) -> str:
    """
    Generador genérico de IDs para cualquier entidad.

    Ejemplo de uso:
    - generate_entity_id(db, prefix="TIPO-", table="public.tipo_gasto")

    Internamente delega en generate_id_with_db, que se encarga de
    comprobar en la BD que el ID no exista antes de devolverlo.
    """
    return generate_id_with_db(
        db=db,
        prefix=prefix,
        table=table,
        column=column,
        length=length,
        alphabet=UPPER_ALNUM,
    )

def generate_tipo_gasto_id(db: Session) -> str:
    """
    Genera un ID único para TipoGasto con formato:

        TGAS-<6 caracteres A-Z0-9>

    La tabla asumida es public.tipo_gasto.
    Ajusta 'table' si tu tabla real tiene otro nombre.
    """
    return generate_entity_id(
        db=db,
        prefix="TGAS-",
        table="public.tipo_gasto",
    )


def generate_tipo_ingreso_id(db: Session) -> str:
    """
    Genera un ID único para TipoIngreso:

        TING-<6 caracteres A-Z0-9>
    """
    return generate_entity_id(
        db=db,
        prefix="TING-",
        table="public.tipo_ingreso",
    )


def generate_tipo_segmento_gasto_id(db: Session) -> str:
    """
    Genera un ID único para TipoSegmentoGasto:

        TSEG-<6 caracteres A-Z0-9>
    """
    return generate_entity_id(
        db=db,
        prefix="TSEG-",
        table="public.tipo_segmento_gasto",
    )

def generate_tipo_segmento_gasto_id(db: Session) -> str:
    """
    Genera un ID único para TipoSegmentoGasto:

        TSEG-<6 caracteres A-Z0-9>
    """
    return generate_entity_id(
        db=db,
        prefix="TSEG-",
        table="public.tipo_segmentos_gasto",  # <- Ojo: tipo_segmentos_gasto (plural)
    )

def generate_tipo_rama_gasto_id(db: Session) -> str:
    """
    Genera un ID único para TipoRamasGasto con formato:

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
    Genera un ID único para TipoRamasProveedores con formato:

        TRPR-<6 caracteres A-Z0-9>

    Tabla: public.tipo_ramas_proveedores
    """
    return generate_entity_id(
        db=db,
        prefix="TRPR-",
        table="public.tipo_ramas_proveedores",
    )

def generate_patrimonio_id(db: Session) -> str:
    """
    Genera un ID único para PATRIMONIO (viviendas) con formato:

        VIVIENDA-<6 caracteres A-Z0-9>

    Usa la tabla real de patrimonio en BD para asegurar que no se repite.
    Ajusta el nombre de la tabla si en tu BD es distinto.
    """
    return generate_entity_id(
        db=db,
        prefix="VIVIENDA-",
        table="public.patrimonio",  # Si tu tabla es 'patrimonios', aquí lo cambiamos
    )

def generate_prestamo_id(db: Session) -> str:
    """
    Genera un ID único para la tabla prestamo, del estilo:
      'prestamo-xxxxxx'
    """
    from .id_utils import generate_entity_id  # si estás en el mismo archivo, quita este import interno
    return generate_entity_id(db, "prestamo-", "public.prestamo")

def generate_prestamo_cuota_id(db: Session) -> str:
    """
    Genera un ID único para la tabla prestamo_cuota, del estilo:
      'prestamo_cuota-xxxxxx'
    """
    from .id_utils import generate_entity_id  # igual que arriba, quítalo si ya estás en el mismo scope
    return generate_entity_id(db, "prestamo_cuota-", "public.prestamo_cuota")