"""
Router de Endeudamiento (GapptoMobile v3).

Endpoint:
- GET /api/v1/analytics/endeudamiento/summary

Devuelve:
- total_deuda: suma del capital pendiente de préstamos activos del usuario autenticado.

Notas:
- No toca schemas.
- No depende del ORM de Prestamo (usamos SQL directo) para evitar problemas de nombres
  de modelos/tablas y para asegurar consistencia con tu SQL validado.
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
    Resumen de endeudamiento (por usuario autenticado).

    Cálculo:
      total_deuda = SUM(prestamo.capital_pendiente) where activo=true and user_id=current.id

    Respuesta:
      { "total_deuda": 116440.64 }
    """
    q = sa_text(
        """
        SELECT COALESCE(SUM(p.capital_pendiente), 0) AS total_deuda
        FROM prestamo p
        WHERE p.activo = true
          AND p.user_id = :user_id
        """
    )

    total = db.execute(q, {"user_id": int(current.id)}).scalar()
    # Aseguramos float JSON-serializable
    total_deuda = float(total or 0)

    return {"total_deuda": total_deuda}
