# backend/app/db/custom_types.py

"""
Tipos personalizados relacionados con la base de datos y los schemas.

De momento definimos:

- Money: alias tipado de Decimal, para representar importes monetarios.

¿Por qué así?
-------------
- Pydantic trabaja muy bien con Decimal para dinero.
- Los límites de dígitos y decimales (2 decimales, etc.) los podemos
  controlar en la base de datos (NUMERIC(14, 2)) y/o con validadores
  adicionales en los schemas si hace falta.
- Al declarar Money como TypeAlias, Pylance deja de mostrar el aviso
  "Variable no permitida en la expresión de tipo" cuando hacemos:
      importe: Money
      total: Money
"""

from decimal import Decimal
from typing import TypeAlias

# Alias de tipo: para Pylance y para el editor, Money es "un Decimal"
Money: TypeAlias = Decimal
