"""
Archivo: backend/app/schemas/bot_auth.py
Versión: 1.0.0

Descripción:
Schemas Pydantic específicos para la autenticación y contexto inicial del BOT
de alquileres, separados del backoffice de gestión.

Funcionalidades incluidas:
- Payload de entrada para login por DNI + teléfono
- Datos básicos de persona autenticada
- Datos de vivienda asociados al contrato
- Datos de contrato y rol del participante
- Respuesta agregada para selección posterior de contrato en el BOT

Notas de diseño:
- Este archivo no sustituye schemas existentes de gestión_alquiler.
- Se crea por separado para no mezclar endpoints de backoffice con endpoints
  conversacionales del BOT.
- La respuesta está pensada para que el BOT pueda:
  1) autenticar
  2) saber qué contratos activos tiene la persona
  3) conocer el rol por contrato
  4) pedir selección si hay varios contratos
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class BotAuthLoginIn(BaseModel):
    """
    Payload de entrada para autenticación del BOT.

    El usuario se autentica con:
    - DNI
    - teléfono

    Ambos valores se normalizarán en backend antes de comparar.
    """
    dni: str = Field(..., description="DNI/NIF/NIE introducido por el usuario.")
    telefono: str = Field(..., description="Teléfono introducido por el usuario.")


class BotAuthPersonaOut(BaseModel):
    """
    Datos mínimos de persona que el BOT necesita conocer tras autenticación.
    """
    id: str
    nombre_completo: str
    dni: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None


class BotAuthViviendaOut(BaseModel):
    """
    Datos básicos de la vivienda/patrimonio asociados al contrato.
    """
    patrimonio_id: str
    referencia: Optional[str] = None
    direccion_completa: Optional[str] = None
    localidad: Optional[str] = None


class BotAuthContratoOut(BaseModel):
    """
    Representa un contrato activo accesible por la persona autenticada,
    incluyendo su rol y la vivienda asociada.
    """
    contrato_id: str
    rol: str
    es_principal: bool = False

    estado: str
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None

    vivienda: BotAuthViviendaOut


class BotAuthLoginOut(BaseModel):
    """
    Respuesta completa del endpoint de autenticación del BOT.

    Contiene:
    - persona autenticada
    - lista de contratos activos válidos
    - indicador para saber si el BOT debe pedir selección de contrato
    """
    persona: BotAuthPersonaOut
    contratos: List[BotAuthContratoOut] = Field(default_factory=list)
    requiere_seleccion_contrato: bool = False