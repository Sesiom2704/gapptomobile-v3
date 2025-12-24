# routers/cierre_mensual.py
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from backend.app.db.session import get_db
from backend.app.db import models

from backend.app.schemas.cierre_mensual import (
    CierreMensualOut,
    CierreMensualDetalleOut,
    CierreMensualPatchIn,
    CierreMensualDetallePatchIn,
    CierreMensualKpisResponse,
)

router = APIRouter(prefix="/api/v1/cierre_mensual", tags=["Cierre mensual"])


def recompute_cierre_fields(c: models.CierreMensual) -> None:
    # Convención recomendada: Real - Esperado
    c.desv_ingresos = (c.ingresos_reales or 0) - (c.ingresos_esperados or 0)

    c.gastos_esperados_total = (c.gastos_gestionables_esperados or 0) + (c.gastos_cotidianos_esperados or 0)
    c.gastos_reales_total = (c.gastos_gestionables_reales or 0) + (c.gastos_cotidianos_reales or 0)

    c.desv_gestionables = (c.gastos_gestionables_reales or 0) - (c.gastos_gestionables_esperados or 0)
    c.desv_cotidianos = (c.gastos_cotidianos_reales or 0) - (c.gastos_cotidianos_esperados or 0)
    c.desv_gastos_total = (c.gastos_reales_total or 0) - (c.gastos_esperados_total or 0)

    c.resultado_esperado = (c.ingresos_esperados or 0) - (c.gastos_esperados_total or 0)
    c.resultado_real = (c.ingresos_reales or 0) - (c.gastos_reales_total or 0)
    c.desv_resultado = (c.resultado_real or 0) - (c.resultado_esperado or 0)


def recompute_detalle_fields(d: models.CierreMensualDetalle) -> None:
    # Convención: Real - Esperado
    d.desviacion = (d.real or 0) - (d.esperado or 0)
    if d.esperado and d.esperado != 0:
        d.cumplimiento_pct = (d.real or 0) / d.esperado
    else:
        d.cumplimiento_pct = None


@router.get("/", response_model=List[CierreMensualOut])
def list_cierres(
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.CierreMensual)
    if user_id is not None:
        q = q.filter(models.CierreMensual.user_id == user_id)
    return q.order_by(desc(models.CierreMensual.anio), desc(models.CierreMensual.mes)).all()


@router.get("/{cierre_id}/detalles", response_model=List[CierreMensualDetalleOut])
def get_detalles(cierre_id: UUID, db: Session = Depends(get_db)):
    dets = (
        db.query(models.CierreMensualDetalle)
        .filter(models.CierreMensualDetalle.cierre_id == cierre_id)
        .order_by(models.CierreMensualDetalle.tipo_detalle.asc(), models.CierreMensualDetalle.segmento_id.asc())
        .all()
    )

    # Enriquecemos nombre de segmento si existe relación
    # (si ya lo traes en tu modelo con relationship, puedes omitir)
    seg_ids = [d.segmento_id for d in dets if d.segmento_id]
    if seg_ids:
        segs = db.query(models.TipoSegmentoGasto).filter(models.TipoSegmentoGasto.id.in_(seg_ids)).all()
        seg_map = {s.id: getattr(s, "nombre", None) for s in segs}
        for d in dets:
            d.segmento_nombre = seg_map.get(d.segmento_id)

    return dets


@router.patch("/{cierre_id}", response_model=CierreMensualOut)
def patch_cierre(cierre_id: UUID, payload: CierreMensualPatchIn, db: Session = Depends(get_db)):
    c = db.query(models.CierreMensual).filter(models.CierreMensual.id == cierre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")

    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(c, k, v)

    recompute_cierre_fields(c)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/detalle/{detalle_id}", response_model=CierreMensualDetalleOut)
def patch_detalle(detalle_id: UUID, payload: CierreMensualDetallePatchIn, db: Session = Depends(get_db)):
    d = db.query(models.CierreMensualDetalle).filter(models.CierreMensualDetalle.id == detalle_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Detalle no encontrado")

    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(d, k, v)

    recompute_detalle_fields(d)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@router.delete("/{cierre_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cierre(cierre_id: UUID, db: Session = Depends(get_db)):
    c = db.query(models.CierreMensual).filter(models.CierreMensual.id == cierre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")
    db.delete(c)
    db.commit()
    return None


@router.get("/kpis", response_model=CierreMensualKpisResponse)
def kpis(limit: int = Query(12, ge=1, le=60), user_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.CierreMensual)
    if user_id is not None:
        q = q.filter(models.CierreMensual.user_id == user_id)

    cierres = q.order_by(desc(models.CierreMensual.anio), desc(models.CierreMensual.mes)).limit(limit).all()
    cierres_ids = [c.id for c in cierres]

    detalles = []
    if cierres_ids:
        detalles = db.query(models.CierreMensualDetalle).filter(models.CierreMensualDetalle.cierre_id.in_(cierres_ids)).all()

        # segmento_nombre (opcional)
        seg_ids = list({d.segmento_id for d in detalles if d.segmento_id})
        if seg_ids:
            segs = db.query(models.TipoSegmentoGasto).filter(models.TipoSegmentoGasto.id.in_(seg_ids)).all()
            seg_map = {s.id: getattr(s, "nombre", None) for s in segs}
            for d in detalles:
                d.segmento_nombre = seg_map.get(d.segmento_id)

    # Respuesta: el frontend reordena asc, aquí mantenemos desc por defecto
    return CierreMensualKpisResponse(limit=limit, count=len(cierres), cierres=cierres, detalles=detalles)
