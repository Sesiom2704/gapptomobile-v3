# backend/app/google_creds_bootstrap.py
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


def _clean_env(v: str | None) -> str:
    """Quita comillas típicas de env vars en Render/Windows."""
    if not v:
        return ""
    return v.strip().strip('"').strip("'")


def ensure_gcp_creds_file() -> Optional[str]:
    """
    Garantiza que existe un fichero de credenciales de Google en disco.

    Fuentes soportadas:
      - GOOGLE_CREDENTIALS_JSON (recomendado en Render)
      - GOOGLE_SHEETS_CREDS_JSON (alias opcional)

    Destino:
      - GOOGLE_APPLICATION_CREDENTIALS si viene definido
      - Si NO viene definido, usamos un path por defecto (Render-friendly)

    Comportamiento:
      - Si ya existe el fichero y parece válido -> devuelve path
      - Si no hay JSON en env -> devuelve None (no bloqueante)
      - Si hay JSON -> lo escribe y devuelve path
    """
    creds_json = _clean_env(os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_SHEETS_CREDS_JSON"))

    # 1) Resolver path destino
    creds_path = _clean_env(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
    if not creds_path:
        # Path estable recomendado en Render (dentro del repo desplegado)
        creds_path = "/opt/render/project/src/backend/app/creds/sheets-credentials.json"
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path

    p = Path(creds_path)

    # 2) Si ya existe y parece válido, listo
    try:
        if p.is_file() and p.stat().st_size > 50:
            return str(p)
    except Exception:
        pass

    # 3) Si no hay JSON en env, no bloqueamos
    if not creds_json:
        return None

    # 4) Escribir JSON a disco
    try:
        data = json.loads(creds_json)
        if not isinstance(data, dict) or data.get("type") != "service_account":
            raise ValueError("Credenciales inválidas: no es service_account")

        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(p)
    except Exception as e:
        print(f"[startup] ensure_gcp_creds_file: no se pudo materializar credenciales: {e}")
        return None
