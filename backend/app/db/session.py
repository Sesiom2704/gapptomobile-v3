# backend/app/db/session.py

"""
Módulo responsable de la conexión a la base de datos y de la creación
de sesiones (Session) que usará el resto de la aplicación.

💡 Idea clave:
- "engine" = objeto global que representa la conexión (o pool de conexiones)
  hacia la base de datos (Neon, Supabase, etc.).
- "SessionLocal" = fábrica de sesiones. Cada petición de FastAPI abrirá
  una sesión, trabajará con ella y luego la cerrará.

Este módulo NO conoce credenciales directamente. La URL de conexión se
lee desde la configuración central (settings.DATABASE_URL), que a su vez
toma el valor de las variables de entorno definidas en el archivo .env.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings  # importamos la config central


# Creamos el "engine" de SQLAlchemy.
# ---------------------------------------------------------------------------
# - settings.DATABASE_URL viene de:
#   - backend/app/core/config.py -> Settings.DATABASE_URL
#   - que a su vez se carga desde el archivo .env o variables del sistema.
#
# - future=True activa el comportamiento más moderno de SQLAlchemy (2.0 style).
# - pool_pre_ping=True hace que SQLAlchemy compruebe las conexiones antes
#   de usarlas, evitando errores si la conexión se queda "colgada".
engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    pool_pre_ping=True,
)


# Creamos la factoría de sesiones.
# ---------------------------------------------------------------------------
# - autocommit=False: nosotros controlamos explícitamente cuándo hacer commit.
# - autoflush=False: evitamos que SQLAlchemy haga flush automático en momentos
#   inesperados; solemos llamar a commit() cuando queramos persistir cambios.
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db():
    """
    Dependencia de FastAPI para obtener una sesión de base de datos.

    Uso típico en un endpoint:
    --------------------------------------------------------
    from fastapi import Depends
    from sqlalchemy.orm import Session
    from backend.app.db.session import get_db

    @router.get("/gastos")
    def listar_gastos(db: Session = Depends(get_db)):
        return db.query(Gasto).all()
    --------------------------------------------------------

    FastAPI se encarga de:
    - Llamar a get_db(), obtener una Session.
    - Entregarla al endpoint.
    - Ejecutar el "finally" cuando termina la petición y cerrar la sesión.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
