# backend/app/utils/text_utils.py

"""
Utilidades de texto reutilizables en toda la app.

Por ahora:
- normalize_upper: pasar cadenas a MAYÚSCULAS + trim,
  devolviendo None si quedan vacías.
"""

from __future__ import annotations
import unicodedata
from typing import Optional  # si no estaba ya



def normalize_upper(value: Optional[str]) -> Optional[str]:
    """
    Normaliza una cadena a MAYÚSCULAS y elimina espacios al principio y final.

    Reglas:
    - Si value es None -> devuelve None.
    - Se hace strip() y upper().
    - Si tras strip() queda vacío -> devuelve None.

    Ejemplos:
    - "  hola  " -> "HOLA"
    - "   "      -> None
    - None       -> None
    """
    if value is None:
        return None
    s = value.strip().upper()
    return s or None

def normalize_upper_ascii(value: Optional[str]) -> Optional[str]:
    """
    Igual que normalize_upper, pero además elimina tildes/acentos.

    - None -> None
    - Convierte a str
    - Normaliza en NFD y elimina caracteres de tipo 'Mn' (marcas de acento)
    - strip() y upper()
    - Si queda vacío -> None

    Ejemplos:
    - "  ÁLAMO  " -> "ALAMO"
    - " C/ Núñez de Balboa " -> "C/ NUNEZ DE BALBOA"
    """
    if value is None:
        return None

    # Convertimos a str por seguridad
    s = str(value)

    # Normalización NFD y eliminación de tildes
    s = "".join(
        c
        for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )

    s = s.strip().upper()
    return s or None
