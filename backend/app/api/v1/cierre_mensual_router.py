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

router = APIRouter(prefix="/cierre_mensual", tags=["Cierre mensual"])


# =============================================================================
# Helpers de recomputo
# =============================================================================
# Nota clave:
# - Tus SQL “fuente de verdad” definen desviaciones como: ESPERADO - REAL
#   (ej: desv_ingresos = ingresos_esperados - ingresos_reales).
# - Por coherencia, aquí recomputamos con esa misma convención.
# - Esto evita que, al editar con PATCH, se te inviertan signos y no cuadren importes.
# =============================================================================

def recompute_cierre_fields(c: models.CierreMensual) -> None:
    """
    Recalcula campos derivados de la cabecera.

    Convención (alineada con tus sentencias SQL):
      desviación = esperado - real

    Derivados recalculados:
      - gastos_esperados_total
      - gastos_reales_total
      - desv_ingresos
      - desv_gestionables
      - desv_cotidianos
      - desv_gastos_total
      - resultado_esperado
      - resultado_real
      - desv_resultado
    """
    ingresos_esp = float(c.ingresos_esperados or 0.0)
    ingresos_real = float(c.ingresos_reales or 0.0)

    gg_esp = float(c.gastos_gestionables_esperados or 0.0)
    gg_real = float(c.gastos_gestionables_reales or 0.0)

    gc_esp = float(c.gastos_cotidianos_esperados or 0.0)
    gc_real = float(c.gastos_cotidianos_reales or 0.0)

    # Totales
    c.gastos_esperados_total = gg_esp + gc_esp
    c.gastos_reales_total = gg_real + gc_real

    # Desviaciones: esperado - real
    c.desv_ingresos = ingresos_esp - ingresos_real
    c.desv_gestionables = gg_esp - gg_real
    c.desv_cotidianos = gc_esp - gc_real
    c.desv_gastos_total = (c.gastos_esperados_total or 0.0) - (c.gastos_reales_total or 0.0)

    # Resultados
    c.resultado_esperado = ingresos_esp - (c.gastos_esperados_total or 0.0)
    c.resultado_real = ingresos_real - (c.gastos_reales_total or 0.0)
    c.desv_resultado = (c.resultado_esperado or 0.0) - (c.resultado_real or 0.0)


def recompute_detalle_fields(d: models.CierreMensualDetalle) -> None:
    """
    Recalcula campos derivados del detalle.

    Convención:
      desviación = esperado - real

    - cumplimiento_pct: real/esperado (si esperado > 0)
    """
    esperado = float(d.esperado or 0.0)
    real = float(d.real or 0.0)

    d.desviacion = esperado - real

    if esperado != 0:
        d.cumplimiento_pct = real / esperado
    else:
        d.cumplimiento_pct = None


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/", response_model=List[CierreMensualOut])
def list_cierres(
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Lista cierres mensuales.

    Nota importante (tu caso actual):
    - Si en DB has eliminado columnas (p.ej. version, n_pendientes_al_cerrar),
      debes eliminarlas también del ORM y del schema CierreMensualOut.
    - Si el ORM todavía las tiene mapeadas, SQLAlchemy intentará seleccionarlas
      y fallará con UndefinedColumn o validaciones de respuesta.
    """
    q = db.query(models.CierreMensual)
    if user_id is not None:
        q = q.filter(models.CierreMensual.user_id == user_id)

    return q.order_by(desc(models.CierreMensual.anio), desc(models.CierreMensual.mes)).all()


@router.get("/{cierre_id}/detalles", response_model=List[CierreMensualDetalleOut])
def get_detalles(cierre_id: UUID, db: Session = Depends(get_db)):
    """
    Devuelve detalles del cierre, ordenados por tipo_detalle y segmento_id.

    Además, enriquece segmento_nombre de forma defensiva (sin depender de relationship).
    """
    dets = (
        db.query(models.CierreMensualDetalle)
        .filter(models.CierreMensualDetalle.cierre_id == cierre_id)
        .order_by(
            models.CierreMensualDetalle.tipo_detalle.asc(),
            models.CierreMensualDetalle.segmento_id.asc(),
        )
        .all()
    )

    seg_ids = [d.segmento_id for d in dets if d.segmento_id]
    if seg_ids:
        segs = (
            db.query(models.TipoSegmentoGasto)
            .filter(models.TipoSegmentoGasto.id.in_(seg_ids))
            .all()
        )
        seg_map = {s.id: getattr(s, "nombre", None) for s in segs}
        for d in dets:
            # Nota: segmento_nombre suele ser atributo “extra” no persistente;
            # si no existe en el modelo, lo asignamos dinámicamente igual.
            setattr(d, "segmento_nombre", seg_map.get(d.segmento_id))

    return dets


@router.patch("/{cierre_id}", response_model=CierreMensualOut)
def patch_cierre(cierre_id: UUID, payload: CierreMensualPatchIn, db: Session = Depends(get_db)):
    """
    Edita campos de cabecera y recomputa derivados.

    Pydantic v2:
    - model_dump(exclude_unset=True) sustituye a .dict(exclude_unset=True)
    """
    c = db.query(models.CierreMensual).filter(models.CierreMensual.id == cierre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(c, k, v)

    recompute_cierre_fields(c)

    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/detalle/{detalle_id}", response_model=CierreMensualDetalleOut)
def patch_detalle(detalle_id: UUID, payload: CierreMensualDetallePatchIn, db: Session = Depends(get_db)):
    """
    Edita un detalle y recomputa derivados.

    Pydantic v2:
    - model_dump(exclude_unset=True)
    """
    d = db.query(models.CierreMensualDetalle).filter(models.CierreMensualDetalle.id == detalle_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Detalle no encontrado")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(d, k, v)

    recompute_detalle_fields(d)

    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@router.delete("/{cierre_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cierre(cierre_id: UUID, db: Session = Depends(get_db)):
    """
    Elimina un cierre mensual (cabecera). Los detalles se eliminan por cascade.
    """
    c = db.query(models.CierreMensual).filter(models.CierreMensual.id == cierre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")

    db.delete(c)
    db.commit()
    return None


@router.get("/kpis", response_model=CierreMensualKpisResponse)
def kpis(limit: int = Query(12, ge=1, le=60), user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    KPIs agregados: devuelve cierres + detalles en una sola respuesta.

    - El frontend reordena asc si lo necesita; aquí devolvemos cierres en DESC por defecto.
    - Incluye enriquecimiento segmento_nombre si es necesario.
    """
    q = db.query(models.CierreMensual)
    if user_id is not None:
        q = q.filter(models.CierreMensual.user_id == user_id)

    cierres = q.order_by(desc(models.CierreMensual.anio), desc(models.CierreMensual.mes)).limit(limit).all()
    cierres_ids = [c.id for c in cierres]

    detalles = []
    if cierres_ids:
        detalles = (
            db.query(models.CierreMensualDetalle)
            .filter(models.CierreMensualDetalle.cierre_id.in_(cierres_ids))
            .all()
        )

        seg_ids = list({d.segmento_id for d in detalles if d.segmento_id})
        if seg_ids:
            segs = (
                db.query(models.TipoSegmentoGasto)
                .filter(models.TipoSegmentoGasto.id.in_(seg_ids))
                .all()
            )
            seg_map = {s.id: getattr(s, "nombre", None) for s in segs}
            for d in detalles:
                setattr(d, "segmento_nombre", seg_map.get(d.segmento_id))

    return CierreMensualKpisResponse(limit=limit, count=len(cierres), cierres=cierres, detalles=detalles)
