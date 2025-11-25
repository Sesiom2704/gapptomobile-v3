# backend/app/core/config.py

"""
Módulo de configuración central de la aplicación.

Aquí definimos la clase Settings, que carga las variables de entorno
desde un archivo .env o desde el entorno del sistema. Así evitamos
tener las contraseñas, URLs de base de datos, etc. “a pelo” en el código.
"""

from pydantic_settings import BaseSettings  # <- viene del paquete pydantic-settings


class Settings(BaseSettings):
    """
    Clase Settings:

    - Hereda de BaseSettings, que es una utilidad de Pydantic dedicada a
      leer variables de entorno y validarlas.

    - Cada atributo de la clase representa una configuración de la app.
    """

    # Entorno (dev, prod, etc.). Si no se define, toma "development" por defecto.
    ENV: str = "development"

    # URL de conexión a la base de datos.
    # Ejemplo (PostgreSQL):
    # postgresql+psycopg2://usuario:password@host:puerto/nombre_bd
    DATABASE_URL: str

    # --- Seguridad / JWT ---
    SECRET_KEY: str = "CAMBIA-ESTO-POR-UNA-CADENA-LARGA-ALEATORIA"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    class Config:
        """
        Config interna de Pydantic Settings.

        - env_file: indica el nombre del archivo desde el que se leerán
          variables de entorno, además de las que existan en el sistema.

        - env_file_encoding: encoding del archivo .env.
        """
        env_file = ".env"
        env_file_encoding = "utf-8"


# Instancia global de settings que podremos importar desde cualquier parte:
# from backend.app.core.config import settings
settings = Settings()
