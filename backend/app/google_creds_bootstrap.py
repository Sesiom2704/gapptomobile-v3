# backend/app/google_creds_bootstrap.py
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


def ensure_gcp_creds_file() -> Optional[str]:
    """
    Garantiza que existe el fichero de credenciales de Google (service account) en disco.

    Fuentes soportadas:
      - GOOGLE_CREDENTIALS_JSON (recomendado en Render)
      - GOOGLE_SHEETS_CREDS_JSON (alias opcional)

    Destino:
      - Si GOOGLE_APPLICATION_CREDENTIALS está definido => se respeta.
      - Si NO está definido => se fija un path por defecto (compatible Render):
            /opt/render/project/src/backend/app/creds/sheets-credentials.json

    Comportamiento:
      - Si el fichero ya existe y parece válido => retorna su path.
      - Si no hay JSON en env => retorna None (NO bloquea).
      - Si hay JSON pero no se puede escribir/parsear => retorna None (NO bloquea).
    """
    raw = (os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_SHEETS_CREDS_JSON") or "").strip()

    # 1) Resolver path destino
    creds_path = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip().strip('"').strip("'")
    if not creds_path:
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
    if not raw:
        return None

    # 4) Normalizar si viene como string con comillas exteriores
    # (Render a veces guarda JSON como string ya serializado)
    raw = raw.strip()
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        raw = raw[1:-1].strip()

    # 5) Parsear y escribir a disco
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("type") != "service_account":
            raise ValueError("Credenciales inválidas: no es service_account")

        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        return str(p)
    except Exception as e:
        print(f"[startup] ensure_gcp_creds_file: no se pudo materializar credenciales: {e}")
        return None
