# backend/app/api/v1/prestamos_router.py

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from math import log, ceil
from typing import Optional, Literal, List

from fastapi import APIRouter, HTTPException, Depends, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.prestamos import (
    PrestamoOut,
    PrestamoCreate,
    PrestamoUpdate,
    PrestamoCuotaOut,
    AmortizacionIn,
)
from backend.app.utils.id_utils import (
    generate_prestamo_id,
    generate_prestamo_cuota_id,
    generate_gasto_id,
)
from backend.app.utils.text_utils import normalize_upper
from backend.app.utils.prestamo_utils import (
    generar_plan_frances,
    map_ids_por_clasificacion,
    recompute_pendientes_prestamo,
    recalcular_plan_reduciendo_plazo,
)
from backend.app.core.constants import (
    HIPOTECA_TIPO_GASTO_ID,
    PRESTAMO_TIPO_GASTO_ID,
    SEGMENTO_VIVIENDA_ID,
    SEGMENTO_FINANCIERO_ID,
    RAMA_VIVIENDA_GASTO_ID,
    RAMA_FINANCIERO_GASTO_ID,
    TIPO_GASTO_HIPOTECA_AMORT_ID,
)
from backend.app.utils.common import adjust_liquidez, safe_float
from backend.app.api.v1.auth_router import require_user


router = APIRouter(prefix="/prestamos", tags=["prestamos"])

# =======================================================
# Endpoints principales de préstamo
# =======================================================
import logging
logger = logging.getLogger(__name__)

@router.get("", response_model=list[PrestamoOut])
def listar_prestamos(
    q: Optional[str] = Query(None, description="Filtro por nombre (contiene)"),
    estado: Optional[Literal["ACTIVO", "CANCELADO", "INACTIVO"]] = Query(None),
    vencen: Optional[str] = Query(
        None, description='Si es "MES", filtra préstamos que vencen este mes.'
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista préstamos del usuario autenticado, con filtros opcionales:
      - q: nombre contiene (case-insensitive)
      - estado: ACTIVO / CANCELADO / INACTIVO
      - vencen=MES: vencen el mes actual
    """
    try:
        stmt = select(models.Prestamo).filter(models.Prestamo.user_id == current_user.id)

        if q:
            like = f"%{q.upper()}%"
            stmt = stmt.filter(func.upper(models.Prestamo.nombre).like(like))

        if estado:
            stmt = stmt.filter(models.Prestamo.estado == estado)

        if (vencen or "").upper() == "MES":
            today = date.today()
            y, m = today.year, today.month
            stmt = stmt.filter(
                func.extract("year", models.Prestamo.fecha_vencimiento) == y,
                func.extract("month", models.Prestamo.fecha_vencimiento) == m,
            )

        stmt = stmt.order_by(models.Prestamo.createon.desc())
        rows = db.execute(stmt).scalars().all()

        # Log útil (sin datos sensibles)
        logger.info("[prestamos] listar user_id=%s count=%s", current_user.id, len(rows))

        return rows

    except Exception as e:
        logger.exception("[prestamos] listar FAILED user_id=%s q=%s estado=%s vencen=%s", current_user.id, q, estado, vencen)
        raise HTTPException(status_code=500, detail="Error interno listando préstamos")

@router.get("/{prestamo_id}", response_model=PrestamoOut)
def obtener_prestamo(
    prestamo_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Recupera un préstamo por ID (solo si pertenece al usuario).
    """
    row = db.get(models.Prestamo, prestamo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")
    return row


@router.get("/{prestamo_id}/cuotas", response_model=list[PrestamoCuotaOut])
def listar_cuotas(
    prestamo_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista las cuotas (plan) de un préstamo, ordenadas por num_cuota.
    Solo accesible si el préstamo pertenece al usuario.
    """
    p = db.get(models.Prestamo, prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    rows = (
        db.query(models.PrestamoCuota)
        .filter(models.PrestamoCuota.prestamo_id == prestamo_id)
        .order_by(models.PrestamoCuota.num_cuota.asc())
        .all()
    )
    return rows


@router.post("", response_model=PrestamoOut, status_code=status.HTTP_201_CREATED)
def crear_prestamo(
    payload: PrestamoCreate,
    clasificacion: Optional[str] = Query(None, description="PERSONAL o HIPOTECA"),
    gasto_tipo_id: Optional[str] = Query(
        None,
        description="Opcional: forzar un tipo_gasto concreto. Si no se envía, se usa la clasificación.",
    ),
    gasto_segmento_id: Optional[str] = Query(
        None,
        description="Opcional: forzar un segmento concreto. Si no se envía, se usa la clasificación.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un préstamo y su gasto asociado (personal o hipoteca) para el usuario actual.

    Reglas clave:
    - Si clasificacion está vacío:
        * Si hay referencia_vivienda_id -> HIPOTECA
        * Si no -> PERSONAL
    - Para HIPOTECA la referencia de vivienda es obligatoria.
    - Todo texto se guarda en MAYÚSCULAS (por regla global de la app).
    """
    now = datetime.utcnow()

    # Determinar clasificación efectiva
    clasif = (clasificacion or "").upper().strip()
    if not clasif:
        clasif = "HIPOTECA" if payload.referencia_vivienda_id else "PERSONAL"

    # IDs de tipo y segmento (por clasificación) si no vienen forzados
    tipo_id_cfg, seg_id_cfg = map_ids_por_clasificacion(clasif)
    gasto_tipo_id = gasto_tipo_id or tipo_id_cfg
    gasto_segmento_id = gasto_segmento_id or seg_id_cfg

    # Validación: HIPOTECA -> requiere vivienda
    if clasif == "HIPOTECA" and not payload.referencia_vivienda_id:
        raise HTTPException(
            status_code=400,
            detail="Para HIPOTECA es obligatoria la referencia de vivienda.",
        )

    # Si no es hipoteca, se fuerza a None la vivienda
    ref_viv = payload.referencia_vivienda_id if clasif == "HIPOTECA" else None

    try:
        # ---------- Crear PRESTAMO ----------
        p = models.Prestamo(
            id=generate_prestamo_id(db),
            user_id=current_user.id,
            nombre=normalize_upper(payload.nombre) or "",
            proveedor_id=payload.proveedor_id,
            referencia_vivienda_id=ref_viv,
            cuenta_id=payload.cuenta_id,
            fecha_inicio=payload.fecha_inicio,
            periodicidad=(payload.periodicidad or "").upper().strip() if payload.periodicidad else None,
            plazo_meses=payload.plazo_meses,
            importe_principal=payload.importe_principal,
            tipo_interes=normalize_upper(payload.tipo_interes) if payload.tipo_interes else None,
            tin_pct=payload.tin_pct,
            tae_pct=payload.tae_pct,
            indice=normalize_upper(payload.indice) if payload.indice else None,
            diferencial_pct=payload.diferencial_pct,
            comision_apertura=payload.comision_apertura or Decimal("0"),
            otros_gastos_iniciales=payload.otros_gastos_iniciales or Decimal("0"),
            estado="ACTIVO",
            cuotas_totales=0,
            cuotas_pagadas=0,
            capital_pendiente=payload.importe_principal,
            intereses_pendientes=Decimal("0.00"),
            fecha_vencimiento=payload.fecha_inicio,
            rango_pago=normalize_upper(payload.rango_pago) if payload.rango_pago else None,
            activo=payload.activo if payload.activo is not None else True,
            createon=now,
            modifiedon=now,
        )
        db.add(p)
        db.flush()  # asegura p.id

        # ---------- Plan francés de cuotas ----------
        plan = generar_plan_frances(
            fecha_inicio=payload.fecha_inicio,
            plazo_meses=payload.plazo_meses,
            periodicidad=p.periodicidad,
            principal=payload.importe_principal,
            tin_pct=payload.tin_pct,
        )

        cuotas = []
        last_vto = payload.fecha_inicio
        for c in plan:
            cuotas.append(
                models.PrestamoCuota(
                    id=generate_prestamo_cuota_id(db),
                    prestamo_id=p.id,
                    num_cuota=c["num_cuota"],
                    fecha_vencimiento=c["fecha_vencimiento"],
                    importe_cuota=c["importe_cuota"],
                    capital=c["capital"],
                    interes=c["interes"],
                    seguros=c["seguros"],
                    comisiones=c["comisiones"],
                    saldo_posterior=c["saldo_posterior"],
                    pagada=False,
                    createon=now,
                    modifiedon=now,
                )
            )
            last_vto = c["fecha_vencimiento"]

        if cuotas:
            db.add_all(cuotas)
            p.cuotas_totales = len(cuotas)
            p.fecha_vencimiento = last_vto
            p.capital_pendiente = sum(c.capital for c in cuotas)
            p.intereses_pendientes = sum(c.interes for c in cuotas)

        # ---------- Crear GASTO asociado ----------
        importe_primera = plan[0]["importe_cuota"] if plan else Decimal("0.00")
        total_teorico = importe_primera * Decimal(p.cuotas_totales or 0)

        rama_gasto = RAMA_VIVIENDA_GASTO_ID if clasif == "HIPOTECA" else RAMA_FINANCIERO_GASTO_ID

        g = models.Gasto(
            id=generate_gasto_id(db),
            user_id=current_user.id,
            fecha=p.fecha_inicio,
            periodicidad=p.periodicidad,
            nombre=normalize_upper(p.nombre) or "",
            proveedor_id=p.proveedor_id,
            segmento_id=gasto_segmento_id,
            tipo_id=gasto_tipo_id,
            rama=rama_gasto,
            referencia_vivienda_id=ref_viv,
            cuenta_id=p.cuenta_id,
            importe=importe_primera,
            importe_cuota=importe_primera,
            cuotas=p.cuotas_totales,
            total=total_teorico,
            cuotas_pagadas=0,
            cuotas_restantes=p.cuotas_totales,
            importe_pendiente=total_teorico,
            rango_pago=p.rango_pago,
            activo=True,
            pagado=False,
            kpi=True,
            createon=now,
            modifiedon=now,
            referencia_gasto=None,
            prestamo_id=p.id,
        )
        db.add(g)
        db.flush()

        p.referencia_gasto = g.id

        db.commit()
        db.refresh(p)
        return p

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Conflicto de integridad al crear el préstamo."
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Error al crear el préstamo: {e}"
        )


@router.put("/{prestamo_id}", response_model=PrestamoOut)
def actualizar_prestamo(
    prestamo_id: str,
    payload: PrestamoUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza campos de un préstamo del usuario. Solo se tocan los campos
    que vengan con valor distinto de None en el payload.
    """
    p = db.get(models.Prestamo, prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    for field in [
        "nombre",
        "proveedor_id",
        "referencia_vivienda_id",
        "cuenta_id",
        "fecha_inicio",
        "periodicidad",
        "plazo_meses",
        "importe_principal",
        "tipo_interes",
        "tin_pct",
        "tae_pct",
        "indice",
        "diferencial_pct",
        "comision_apertura",
        "otros_gastos_iniciales",
        "rango_pago",
        "activo",
        "estado",
    ]:
        val = getattr(payload, field, None)
        if val is not None:
            # Regla global: textos en mayúsculas (excepto campos de observaciones)
            if isinstance(val, str) and field in {"nombre", "tipo_interes", "indice", "rango_pago", "periodicidad", "estado"}:
                val = normalize_upper(val)
            setattr(p, field, val)

    p.modifiedon = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return p


# =======================================================
# Endpoints de cuotas
# =======================================================

@router.post("/cuotas/{cuota_id}/pagar")
def pagar_cuota(
    cuota_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Marca una cuota como pagada y actualiza los agregados del préstamo
    (cuotas_pagadas, capital_pendiente, intereses_pendientes).
    Solo si el préstamo pertenece al usuario.
    """
    c = db.get(models.PrestamoCuota, cuota_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")

    p = db.get(models.Prestamo, c.prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    if c.pagada:
        return {"ok": True}

    now = datetime.utcnow()
    c.pagada = True
    c.fecha_pago = date.today()
    c.modifiedon = now

    p.cuotas_pagadas = (p.cuotas_pagadas or 0) + 1
    p.capital_pendiente = max(
        Decimal("0.00"),
        (p.capital_pendiente or Decimal("0.00")) - (c.capital or Decimal("0.00")),
    )
    p.intereses_pendientes = max(
        Decimal("0.00"),
        (p.intereses_pendientes or Decimal("0.00"))
        - (c.interes or Decimal("0.00")),
    )
    p.modifiedon = now

    db.commit()
    return {"ok": True}


@router.post("/cuotas/{cuota_id}/desmarcar")
def desmarcar_cuota(
    cuota_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Desmarca una cuota como pagada, revierte fecha_pago y vuelve a sumar
    capital/intereses pendientes en el agregado del préstamo.
    Solo si el préstamo pertenece al usuario.
    """
    c = db.get(models.PrestamoCuota, cuota_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")

    p = db.get(models.Prestamo, c.prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    if not c.pagada:
        return {"ok": True}

    now = datetime.utcnow()
    c.pagada = False
    c.fecha_pago = None
    c.modifiedon = now

    p.cuotas_pagadas = max(0, (p.cuotas_pagadas or 0) - 1)
    p.capital_pendiente = (p.capital_pendiente or Decimal("0.00")) + (
        c.capital or Decimal("0.00")
    )
    p.intereses_pendientes = (p.intereses_pendientes or Decimal("0.00")) + (
        c.interes or Decimal("0.00")
    )
    p.modifiedon = now

    db.commit()
    return {"ok": True}


@router.post("/cuotas/{cuota_id}/vincular_gasto")
def vincular_gasto(
    cuota_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Vincula una cuota con un gasto concreto (gasto_id) y recalcula
    los pendientes del préstamo.
    Solo si el préstamo pertenece al usuario.
    """
    gasto_id = (body or {}).get("gasto_id")
    if not gasto_id:
        raise HTTPException(status_code=400, detail="gasto_id requerido")

    c = db.get(models.PrestamoCuota, cuota_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")

    p = db.get(models.Prestamo, c.prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    c.gasto_id = gasto_id
    c.modifiedon = datetime.utcnow()
    db.flush()

    recompute_pendientes_prestamo(db, c.prestamo_id)
    db.commit()

    return {"ok": True}


# =======================================================
# Amortización de capital (reduce plazo)
# =======================================================


def _calc_num_periodos_desde_PV_P(PV: Decimal, P: Decimal, r: Decimal) -> int:
    """
    Calcula el número de periodos N manteniendo una cuota P para un capital PV
    con tipo periódico r, usando la fórmula de la anualidad:
      N = - ln(1 - r*PV/P) / ln(1+r)

    Se redondea hacia arriba (ceil) y se asegura N >= 1.
    """
    PV = Decimal(PV)
    P = Decimal(P)
    r = Decimal(r)

    if PV <= 0:
        return 0
    if r <= 0:
        # Sin interés: N ≈ PV / P
        return int(max(1, ceil((PV / P).quantize(Decimal("0.01"))))) if P > 0 else 0

    x = 1.0 - float((r * PV) / P)
    if x <= 0.0:
        return 1

    N = -log(x) / log(1.0 + float(r))
    return int(max(1, ceil(N)))


@router.post("/{prestamo_id}/amortizar")
def amortizar_prestamo(
    prestamo_id: str,
    body: AmortizacionIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Amortiza capital de un préstamo, reduciendo el plazo (manteniendo cuota
    aproximadamente constante) y generando un GASTO de pago único que refleja:
      - capital amortizado
      - comisión de cancelación (si la hay)
    Además, ajusta la liquidez de la cuenta.
    Solo si el préstamo pertenece al usuario.
    """
    p = db.get(models.Prestamo, prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    if p.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre este préstamo")

    # Validaciones de cantidad / comisión
    try:
        cant = Decimal(str(body.cantidad)).quantize(Decimal("0.01"))
    except Exception:
        raise HTTPException(status_code=422, detail="Cantidad inválida.")
    if cant <= 0:
        raise HTTPException(status_code=422, detail="Cantidad inválida.")

    pct = Decimal(str(body.cancelacion_pct or 0)).quantize(Decimal("0.01"))
    if pct < 0:
        pct = Decimal("0.00")

    fee = (cant * pct / Decimal("100")).quantize(Decimal("0.01"))
    total = (cant + fee).quantize(Decimal("0.01"))

    now = datetime.utcnow()
    cuenta_id = body.cuenta_id or p.cuenta_id

    # ---------- Crear gasto de pago único (PU) ----------
    if (p.tipo_interes or "").upper().startswith("HIP"):
        gasto_rama = RAMA_VIVIENDA_GASTO_ID
        gasto_tipo_id = TIPO_GASTO_HIPOTECA_AMORT_ID
        gasto_segmento_id = SEGMENTO_VIVIENDA_ID
    else:
        gasto_rama = RAMA_FINANCIERO_GASTO_ID
        gasto_tipo_id = PRESTAMO_TIPO_GASTO_ID
        gasto_segmento_id = SEGMENTO_FINANCIERO_ID

    g = models.Gasto(
        id=generate_gasto_id(db),
        user_id=current_user.id,
        fecha=date.today(),
        periodicidad="PAGO UNICO",
        nombre=normalize_upper(f"AMORTIZACION CAPITAL {p.nombre}") or "",
        proveedor_id=p.proveedor_id,
        tipo_id=gasto_tipo_id,
        segmento_id=gasto_segmento_id,
        rama=gasto_rama,
        referencia_vivienda_id=p.referencia_vivienda_id,
        cuenta_id=cuenta_id,
        importe=total,
        importe_cuota=total,
        cuotas=1,
        total=total,
        cuotas_pagadas=1,
        cuotas_restantes=0,
        importe_pendiente=Decimal("0.00"),
        activo=False,
        pagado=True,
        kpi=False,
        createon=now,
        modifiedon=now,
        referencia_gasto=None,
        prestamo_id=prestamo_id,
    )
    db.add(g)
    db.flush()

    # ---------- Recalcular plan reduciendo plazo ----------
    recalcular_plan_reduciendo_plazo(db, p, cant)
    recompute_pendientes_prestamo(db, prestamo_id)

    # ---------- Ajustar liquidez (PAGO ÚNICO ya pagado) ----------
    if g.cuenta_id and g.importe:
        adjust_liquidez(db, g.cuenta_id, -safe_float(g.importe))

    db.commit()
    db.refresh(p)

    return {
        "ok": True,
        "gasto_id": g.id,
        "prestamo": {
            "id": p.id,
            "cuotas_pagadas": int(p.cuotas_pagadas or 0),
            "capital_pendiente": float(getattr(p, "capital_pendiente", 0) or 0),
            "intereses_pendientes": float(
                getattr(p, "intereses_pendientes", 0) or 0
            ),
        },
    }
