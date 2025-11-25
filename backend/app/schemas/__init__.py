# backend/app/schemas/__init__.py
"""
Paquete de schemas Pydantic de GapptoMobile v3.

De momento solo exponemos los schemas de GASTOS.
Más adelante podremos añadir:
- ingresos.py
- patrimonio.py
- proveedores.py
- etc.
"""

from .gastos import GastoSchema, GastoCreateSchema, GastoUpdateSchema

__all__ = ["GastoSchema", "GastoCreateSchema", "GastoUpdateSchema"]
