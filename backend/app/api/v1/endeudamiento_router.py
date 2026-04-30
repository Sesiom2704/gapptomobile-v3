"""
Router de Endeudamiento (GapptoMobile v3).

Endpoint:
- GET /api/v1/analytics/endeudamiento/summary

Devuelve:
- total_deuda: suma ponderada del capital pendiente de préstamos activos.

Regla de participación:
- Si el préstamo está asociado a una vivienda, se aplica:
      capital_pendiente * patrimonio.participacion_pct / 100
- Si no hay vivienda asociada o no se encuentra, se usa 100%.

Importante:
- Esto solo afecta a métricas.
- No modifica préstamos ni movimientos reales.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.api.v1.auth_router import require_user
from backend.app.db import models

router = APIRouter(prefix="/analytics/endeudamiento", tags=["analytics"])


@router.get("/summary")
def endeudamiento_summary(
    db: Session = Depends(get_db),
    current: models.User = Depends(require_user),
) -> dict:
    """
    Resumen de endeudamiento ponderado por participación de vivienda.

    Ejemplo:
    - Hipoteca pendiente: 200.000 €
    - Vivienda asociada al 50%
    - Deuda mostrada en Home: 100.000 €
    """
    q = sa_text(
        """
        SELECT COALESCE(
            SUM(
                COALESCE(p.capital_pendiente, 0)
                * COALESCE(pa.participacion_pct, 100) / 100.0
            ),
            0
        ) AS total_deuda
        FROM prestamo p
        LEFT JOIN patrimonio pa
          ON pa.id = p.referencia_vivienda_id
         AND pa.user_id = p.user_id
        WHERE p.activo = true
          AND p.user_id = :user_id
        """
    )

    total = db.execute(q, {"user_id": int(current.id)}).scalar()
    return {"total_deuda": float(total or 0)}