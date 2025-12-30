from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.inversiones import (
    InversionCreate,
    InversionUpdate,
    InversionOut,
    InversionMetricaIn,
    InversionMetricaOut,
    InversionKpisOut,
    KpiBlock,
)
from backend.app.utils.text_utils import normalize_upper_ascii
from backend.app.api.v1.auth_router import require_user


router = APIRouter(prefix="/inversiones", tags=["inversiones"])


# ----------------------------
# Helpers
# ----------------------------

def gen_inversion_id() -> str:
    return "INV-" + uuid4().hex[:10].upper()


def _require_owned_inversion(db: Session, inversion_id: str, user_id: int) -> models.Inversion:
    row = db.get(models.Inversion, inversion_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Inversión no encontrada")
    return row


def _require_owned_proveedor(db: Session, proveedor_id: str, user_id: int) -> models.Proveedor:
    p = db.get(models.Proveedor, proveedor_id)
    if not p or p.user_id != user_id:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return p


def _require_tipo_inversion(db: Session, tipo_gasto_id: str) -> models.TipoGasto:
    t = db.get(models.TipoGasto, tipo_gasto_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tipo de inversión (tipo_gasto) no encontrado")

    # Validación: el tipo debe pertenecer a segmento "INVERSIÓN"
    # (si todavía no lo has cargado en BD, este check te lo bloqueará)
    seg = getattr(t, "segmento_rel", None)
    if seg is None or normalize_upper_ascii(getattr(seg, "nombre", "")) != "INVERSION":
        raise HTTPException(
            status_code=400,
            detail="El tipo indicado no pertenece al segmento INVERSIÓN",
        )
    return t


def _to_float(x) -> Optional[float]:
    if x is None:
        return None
    try:
        return float(x)
    except Exception:
        return None


def _kpi_block(aporte, retorno, meses) -> KpiBlock:
    """
    KPIs aproximados con 1 flujo de entrada (inicio) y 1 salida (final).
    """
    aporte_f = _to_float(aporte)
    retorno_f = _to_float(retorno)
    meses_i = int(meses) if meses is not None else None

    out = KpiBlock(aporte=aporte_f, retorno_total=retorno_f, plazo_meses=meses_i)

    if aporte_f and aporte_f > 0 and retorno_f is not None:
        # MOIC
        moic = retorno_f / aporte_f
        out.moic = round(moic, 4)
        out.puede_calcular_moic = True

        # ROI%
        out.roi_pct = round(((retorno_f - aporte_f) / aporte_f) * 100.0, 2)
        out.puede_calcular_roi = True

        # IRR aproximada (solo si meses > 0)
        if meses_i and meses_i > 0:
            try:
                irr = (moic ** (12.0 / float(meses_i))) - 1.0
                out.irr_pct_aprox = round(irr * 100.0, 2)
                out.puede_calcular_irr = True
            except Exception:
                pass

    return out


def _coerce_inversion_out(row: models.Inversion) -> dict:
    """
    Dict compatible con InversionOut, incluyendo mini-objetos para UI.
    """
    tipo = row.tipo_gasto
    prov = row.proveedor
    deal = row.dealer

    return {
        "id": row.id,
        "user_id": row.user_id,
        "tipo_gasto_id": row.tipo_gasto_id,
        "proveedor_id": row.proveedor_id,
        "dealer_id": row.dealer_id,
        "nombre": row.nombre,
        "descripcion": row.descripcion,
        "estado": row.estado,
        "fase": row.fase,
        "fecha_creacion": row.fecha_creacion,
        "fecha_inicio": row.fecha_inicio,
        "fecha_objetivo_salida": row.fecha_objetivo_salida,
        "fecha_cierre_real": row.fecha_cierre_real,
        "moneda": row.moneda,
        "aporte_estimado": _to_float(row.aporte_estimado),
        "aporte_final": _to_float(row.aporte_final),
        "retorno_esperado_total": _to_float(row.retorno_esperado_total),
        "retorno_final_total": _to_float(row.retorno_final_total),
        "roi_esperado_pct": _to_float(row.roi_esperado_pct),
        "moic_esperado": _to_float(row.moic_esperado),
        "irr_esperada_pct": _to_float(row.irr_esperada_pct),
        "plazo_esperado_meses": row.plazo_esperado_meses,
        "roi_final_pct": _to_float(row.roi_final_pct),
        "moic_final": _to_float(row.moic_final),
        "irr_final_pct": _to_float(row.irr_final_pct),
        "plazo_final_meses": row.plazo_final_meses,
        "notas": row.notas,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "tipo_gasto": (
            {
                "id": tipo.id,
                "nombre": tipo.nombre,
                "rama_id": getattr(tipo, "rama_id", None),
                "segmento_id": getattr(tipo, "segmento_id", None),
            }
            if tipo else None
        ),
        "proveedor": (
            {"id": prov.id, "nombre": prov.nombre}
            if prov else None
        ),
        "dealer": (
            {"id": deal.id, "nombre": deal.nombre}
            if deal else None
        ),
    }


# ----------------------------
# CRUD
# ----------------------------

@router.get(
    "",
    response_model=List[InversionOut],
    summary="Listar inversiones",
)
def listar_inversiones(
    estado: Optional[str] = Query(None, description="ACTIVA | CERRADA | DESCARTADA"),
    tipo_gasto_id: Optional[str] = Query(None, description="Filtrar por tipo inversión (tipo_gasto.id)"),
    proveedor_id: Optional[str] = Query(None),
    dealer_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    q = db.query(models.Inversion).filter(models.Inversion.user_id == current_user.id)

    if estado:
        q = q.filter(models.Inversion.estado == estado)
    if tipo_gasto_id:
        q = q.filter(models.Inversion.tipo_gasto_id == tipo_gasto_id)
    if proveedor_id:
        q = q.filter(models.Inversion.proveedor_id == proveedor_id)
    if dealer_id:
        q = q.filter(models.Inversion.dealer_id == dealer_id)

    q = q.order_by(models.Inversion.fecha_creacion.desc(), models.Inversion.nombre.asc())
    rows = q.all()
    return [_coerce_inversion_out(r) for r in rows]


@router.get(
    "/{inversion_id}",
    response_model=InversionOut,
    summary="Detalle de inversión",
)
def get_inversion(
    inversion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _require_owned_inversion(db, inversion_id, current_user.id)
    return _coerce_inversion_out(row)


@router.post(
    "",
    response_model=InversionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Crear inversión",
)
def crear_inversion(
    payload: InversionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    # Validar tipo inversión (segmento INVERSIÓN)
    _require_tipo_inversion(db, payload.tipo_gasto_id)

    # Validar proveedor/dealer si vienen informados (y que sean del usuario)
    if payload.proveedor_id:
        _require_owned_proveedor(db, payload.proveedor_id, current_user.id)
    if payload.dealer_id:
        _require_owned_proveedor(db, payload.dealer_id, current_user.id)

    inv_id = gen_inversion_id()

    row = models.Inversion(
        id=inv_id,
        user_id=current_user.id,
        tipo_gasto_id=payload.tipo_gasto_id,
        proveedor_id=payload.proveedor_id,
        dealer_id=payload.dealer_id,
        nombre=normalize_upper_ascii(payload.nombre),
        descripcion=payload.descripcion,
        estado=payload.estado or "ACTIVA",
        fase=payload.fase,
        fecha_creacion=payload.fecha_creacion,  # si None, aplica default BD
        fecha_inicio=payload.fecha_inicio,
        fecha_objetivo_salida=payload.fecha_objetivo_salida,
        fecha_cierre_real=payload.fecha_cierre_real,
        moneda=payload.moneda or "EUR",
        aporte_estimado=payload.aporte_estimado,
        aporte_final=payload.aporte_final,
        retorno_esperado_total=payload.retorno_esperado_total,
        retorno_final_total=payload.retorno_final_total,
        roi_esperado_pct=payload.roi_esperado_pct,
        moic_esperado=payload.moic_esperado,
        irr_esperada_pct=payload.irr_esperada_pct,
        plazo_esperado_meses=payload.plazo_esperado_meses,
        roi_final_pct=payload.roi_final_pct,
        moic_final=payload.moic_final,
        irr_final_pct=payload.irr_final_pct,
        plazo_final_meses=payload.plazo_final_meses,
        notas=payload.notas,
    )

    db.add(row)
    db.commit()
    db.refresh(row)
    return _coerce_inversion_out(row)


@router.put(
    "/{inversion_id}",
    response_model=InversionOut,
    summary="Actualizar inversión",
)
def actualizar_inversion(
    inversion_id: str,
    payload: InversionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _require_owned_inversion(db, inversion_id, current_user.id)

    # Si cambia tipo, validarlo
    if payload.tipo_gasto_id is not None:
        _require_tipo_inversion(db, payload.tipo_gasto_id)
        row.tipo_gasto_id = payload.tipo_gasto_id

    # Proveedor/dealer (validar ownership si se establecen)
    if payload.proveedor_id is not None:
        if payload.proveedor_id:
            _require_owned_proveedor(db, payload.proveedor_id, current_user.id)
        row.proveedor_id = payload.proveedor_id

    if payload.dealer_id is not None:
        if payload.dealer_id:
            _require_owned_proveedor(db, payload.dealer_id, current_user.id)
        row.dealer_id = payload.dealer_id

    # Textos
    if payload.nombre is not None:
        row.nombre = normalize_upper_ascii(payload.nombre)
    if payload.descripcion is not None:
        row.descripcion = payload.descripcion
    if payload.notas is not None:
        row.notas = payload.notas

    # Estado/fase
    if payload.estado is not None:
        row.estado = payload.estado
    if payload.fase is not None:
        row.fase = payload.fase

    # Fechas
    for f in ["fecha_creacion", "fecha_inicio", "fecha_objetivo_salida", "fecha_cierre_real"]:
        v = getattr(payload, f, None)
        if getattr(payload, f, None) is not None:
            setattr(row, f, v)

    # Moneda e importes
    for f in [
        "moneda",
        "aporte_estimado",
        "aporte_final",
        "retorno_esperado_total",
        "retorno_final_total",
        "roi_esperado_pct",
        "moic_esperado",
        "irr_esperada_pct",
        "plazo_esperado_meses",
        "roi_final_pct",
        "moic_final",
        "irr_final_pct",
        "plazo_final_meses",
    ]:
        if hasattr(payload, f) and getattr(payload, f) is not None:
            setattr(row, f, getattr(payload, f))

    db.commit()
    db.refresh(row)
    return _coerce_inversion_out(row)


@router.delete(
    "/{inversion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar inversión",
)
def eliminar_inversion(
    inversion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    row = _require_owned_inversion(db, inversion_id, current_user.id)
    db.delete(row)
    db.commit()
    return None


# ----------------------------
# Métricas
# ----------------------------

@router.get(
    "/{inversion_id}/metricas",
    response_model=List[InversionMetricaOut],
    summary="Listar métricas de una inversión",
)
def listar_metricas(
    inversion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _require_owned_inversion(db, inversion_id, current_user.id)
    q = (
        db.query(models.InversionMetrica)
        .filter(models.InversionMetrica.inversion_id == inversion_id)
        .order_by(models.InversionMetrica.created_at.desc(), models.InversionMetrica.id.desc())
    )
    return q.all()


@router.post(
    "/{inversion_id}/metricas",
    response_model=InversionMetricaOut,
    status_code=status.HTTP_201_CREATED,
    summary="Añadir métrica a una inversión",
)
def crear_metrica(
    inversion_id: str,
    payload: InversionMetricaIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _require_owned_inversion(db, inversion_id, current_user.id)

    if payload.valor_num is None and (payload.valor_texto is None or payload.valor_texto.strip() == ""):
        raise HTTPException(status_code=400, detail="Debe informar valor_num o valor_texto")

    row = models.InversionMetrica(
        inversion_id=inversion_id,
        escenario=payload.escenario,
        clave=payload.clave,
        valor_num=payload.valor_num,
        valor_texto=payload.valor_texto,
        unidad=payload.unidad,
        origen=payload.origen,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete(
    "/{inversion_id}/metricas/{metrica_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar métrica",
)
def eliminar_metrica(
    inversion_id: str,
    metrica_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    _require_owned_inversion(db, inversion_id, current_user.id)

    row = db.get(models.InversionMetrica, metrica_id)
    if not row or row.inversion_id != inversion_id:
        raise HTTPException(status_code=404, detail="Métrica no encontrada")

    db.delete(row)
    db.commit()
    return None


# ----------------------------
# KPIs (calculados)
# ----------------------------

@router.get(
    "/{inversion_id}/kpis",
    response_model=InversionKpisOut,
    summary="KPIs calculados (aprox) de la inversión",
)
def kpis_inversion(
    inversion_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    inv = _require_owned_inversion(db, inversion_id, current_user.id)

    esperado = _kpi_block(inv.aporte_estimado, inv.retorno_esperado_total, inv.plazo_esperado_meses)
    final = _kpi_block(inv.aporte_final, inv.retorno_final_total, inv.plazo_final_meses)

    return InversionKpisOut(
        inversion_id=inversion_id,
        esperado=esperado,
        final=final,
    )
