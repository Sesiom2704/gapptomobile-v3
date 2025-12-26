# backend/app/google_creds_bootstrap.py
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def ensure_gcp_creds_file() -> Optional[str]:
    """
    Normaliza GOOGLE_APPLICATION_CREDENTIALS para que sea un path absoluto válido.

    Uso típico:
      - En backend/.env pones: GOOGLE_APPLICATION_CREDENTIALS=backend/creds/sheets-credentials.json
      - En Windows, dependiendo del CWD, puede no resolverse bien.
      - Aquí lo resolvemos respecto al root del repo.

    Devuelve:
      - Ruta absoluta si existe y queda configurada.
      - None si no está configurado o no existe el fichero.

    Importante:
      - No lanza excepciones por defecto (salvo casos muy raros).
      - No debe bloquear el arranque del backend.
    """
    raw = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not raw:
        return None

    p = Path(raw)

    # Si ya es absoluto y existe, OK
    if p.is_absolute() and p.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(p)
        return str(p)

    # Resolver relativo al root del repo:
    # .../backend/app/google_creds_bootstrap.py -> parents[2] = repo root
    repo_root = Path(__file__).resolve().parents[2]
    candidate = (repo_root / raw).resolve()

    if candidate.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate)
        return str(candidate)

    # Alternativa: relativo al backend/
    backend_root = Path(__file__).resolve().parents[1]  # .../backend/app -> .../backend
    candidate2 = (backend_root / raw).resolve()
    if candidate2.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate2)
        return str(candidate2)

    return None
