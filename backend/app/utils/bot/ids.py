"""
Archivo: backend/app/utils/bot/ids.py
Versión: 1.1.0

Descripción:
Utilidades para generación de identificadores técnicos y códigos visibles
del dominio BOT.

Funcionalidades incluidas:
- Generar id técnico de incidencias
- Generar id técnico de histórico de estados
- Generar id técnico de asignaciones de incidencia
- Generar id técnico de citas de incidencia
- Generar código visible de incidencia

Notas de diseño:
- El id técnico es independiente del código visible al usuario.
- El código visible debe ser legible para BOT_SERVICE y para soporte.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4


def generate_incidencia_id() -> str:
    return "INCID-" + uuid4().hex[:12].upper()


def generate_historial_estado_id() -> str:
    return "IHE-" + uuid4().hex[:12].upper()


def generate_asignacion_incidencia_id() -> str:
    return "ASI-" + uuid4().hex[:12].upper()


def generate_cita_incidencia_id() -> str:
    return "CIT-" + uuid4().hex[:12].upper()


def generate_incidencia_codigo() -> str:
    now = datetime.utcnow()
    return f"INC-{now.strftime('%Y%m%d')}-{uuid4().hex[:4].upper()}"

from uuid import uuid4


def generate_nota_incidencia_id() -> str:
    return "NOT-" + uuid4().hex[:12].upper()


def generate_presupuesto_incidencia_id() -> str:
    return "PRE-" + uuid4().hex[:12].upper()