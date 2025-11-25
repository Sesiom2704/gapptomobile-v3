# backend/app/db/base.py

"""
Definición de la clase Base de SQLAlchemy para todas las tablas del ORM.
"""

from sqlalchemy.orm import declarative_base

# Clase base sobre la que se definen todos los modelos (tablas)
Base = declarative_base()
