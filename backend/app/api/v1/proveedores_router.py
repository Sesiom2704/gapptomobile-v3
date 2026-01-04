# backend/app/api/v1/proveedores_router.py
"""
Router: Proveedores

Mejoras incluidas (sin perder funcionalidades existentes):
1) DELETE /proveedores/{prov_id}
   - Antes devolvía 405 (Method Not Allowed) porque no existía el endpoint.
   - Implementado con protección: si el proveedor está referenciado por gastos/inversiones,
     se devuelve 409 Conflict (para no romper histórico ni constraints de FK).

2) Soporte correcto de localidad_id en CREATE/UPDATE
   - Tu modelo y schemas ya contemplan localidad_id y localidad_rel.
   - Antes el POST ignoraba localidad_id (se perdía), y el PUT no derivaba textos.
   - Ahora:
     - Si viene localidad_id: el backend deriva localidad/comunidad/pais desde la BBDD,
       y además guarda los textos (compatibilidad v2) + la FK (v3 normalizado).
     - Si no viene localidad_id: mantiene el comportamiento legacy (textos).

3) Unicidad de nombre en UPDATE (multiusuario)
   - Antes podías renombrar un proveedor al nombre de otro y quedarte duplicados.
   - Ahora se valida igual que en CREATE, pero excluyendo el propio id.

4) Comentarios y comportamiento conservador:
   - No se elimina ninguna validación existente (validate_proveedor_ubicacion_condicional).
   - Se mantiene normalización a MAYÚSCULAS en campos de texto.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.api.v1.auth_router import require_user
from backend.app.db.session import get_db
from backend.app.db import models

# Nota: mantengo los imports tal como los tienes para no romper tu proyecto.
# Si en tu repo real están en schemas/proveedor.py, entonces este import debe apuntar allí.
from backend.app.schemas.proveedores import (
    ProveedorCreate,
    ProveedorUpdate,
    ProveedorRead,
)

from backend.app.utils.text_utils import normalize_upper
from backend.app.utils.proveedor_utils import validate_proveedor_ubicacion_condicional
from backend.app.utils.id_utils import generate_proveedor_id


router = APIRouter(
    prefix="/proveedores",
    tags=["proveedores"],
)


# =============================================================================
# Helpers internos
# =============================================================================
def _resolve_ubicacion_from_localidad_id(db: Session, localidad_id: int) -> dict:
    """
    Dado un localidad_id, carga Localidad y deriva:
      - localidad (nombre localidad)
      - comunidad (nombre región)
      - pais (nombre país)
    Devuelve un dict con:
      { localidad_id, localidad, comunidad, pais }

    Importante:
    - Usamos accesos "robustos" a relaciones por si tu modelo usa nombres distintos
      (region vs region_rel, pais vs pais_rel).
    """
    loc = db.get(models.Localidad, localidad_id)
    if not loc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="localidad_id inválido (no existe).",
        )

    # Intentamos obtener región y país de forma tolerante
    region = getattr(loc, "region", None) or getattr(loc, "region_rel", None)
    pais_obj = None
    if region is not None:
        pais_obj = getattr(region, "pais", None) or getattr(region, "pais_rel", None)

    localidad_txt = normalize_upper(getattr(loc, "nombre", None))
    comunidad_txt = normalize_upper(getattr(region, "nombre", None) if region else None)
    pais_txt = normalize_upper(getattr(pais_obj, "nombre", None) if pais_obj else None)

    return {
        "localidad_id": loc.id,
        "localidad": localidad_txt,
        "comunidad": comunidad_txt,
        "pais": pais_txt,
    }


# =============================================================================
# GET /proveedores
# =============================================================================
@router.get(
    "",
    response_model=List[ProveedorRead],
    summary="Listar proveedores",
)
def list_proveedores(
    rama_id: Optional[str] = Query(None, description="Filtrar por rama_id"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Lista proveedores del usuario autenticado.

    - Multiusuario: solo devuelve proveedores con user_id == current_user.id
    - Filtro opcional por rama_id
    - Orden estable por nombre e id
    """
    qry = db.query(models.Proveedor).filter(models.Proveedor.user_id == current_user.id)

    if rama_id:
        qry = qry.filter(models.Proveedor.rama_id == rama_id)

    qry = qry.order_by(models.Proveedor.nombre.asc(), models.Proveedor.id.asc())
    return qry.all()


# =============================================================================
# POST /proveedores
# =============================================================================
@router.post(
    "",
    response_model=ProveedorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear proveedor",
)
def create_proveedor(
    prov_in: ProveedorCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Crea un nuevo proveedor.

    Reglas (se mantienen):
    - Convierte NOMBRE/LOCALIDAD/PAÍS/COMUNIDAD a MAYÚSCULAS (normalización).
    - Valida unicidad por nombre, PERO dentro del usuario (multiusuario).
    - Valida obligatoriedad condicional según rama (validate_proveedor_ubicacion_condicional).
    - Genera el ID en el backend con formato PROV-XXXXXX.

    Mejora:
    - Si llega localidad_id, el backend deriva localidad/comunidad/pais desde BBDD
      y guarda:
        - localidad_id (FK normalizada)
        - localidad/comunidad/pais (texto legacy, útil para filtros v2/v3)
    """
    # -------------------------
    # Normalización a MAYÚSCULAS
    # -------------------------
    nombre_up = normalize_upper(prov_in.nombre) or ""

    # Si viene localidad_id, damos prioridad a BBDD (normalizado)
    if prov_in.localidad_id:
        ub = _resolve_ubicacion_from_localidad_id(db, prov_in.localidad_id)
        localidad_up = ub["localidad"]
        comunidad_up = ub["comunidad"]
        pais_up = ub["pais"]
        localidad_id_final = ub["localidad_id"]
    else:
        localidad_up = normalize_upper(prov_in.localidad)
        pais_up = normalize_upper(prov_in.pais)
        comunidad_up = normalize_upper(prov_in.comunidad)
        localidad_id_final = None

    # -------------------------
    # Unicidad por nombre (multiusuario)
    # -------------------------
    exists = (
        db.query(models.Proveedor)
        .filter(
            models.Proveedor.user_id == current_user.id,
            models.Proveedor.nombre == nombre_up,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un proveedor con este nombre.",
        )

    # -------------------------
    # Validación condicional por rama
    # (se mantiene; trabaja sobre los textos finales)
    # -------------------------
    validate_proveedor_ubicacion_condicional(
        db,
        prov_in.rama_id,
        localidad_up,
        pais_up,
        comunidad_up,
    )

    # -------------------------
    # ID generado en servidor
    # -------------------------
    new_id = generate_proveedor_id(db)

    obj = models.Proveedor(
        id=new_id,
        user_id=current_user.id,
        nombre=nombre_up,
        rama_id=prov_in.rama_id,

        # Normalizado v3
        localidad_id=localidad_id_final,

        # Legacy v2/v3 (texto)
        localidad=localidad_up,
        pais=pais_up,
        comunidad=comunidad_up,
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


# =============================================================================
# PUT /proveedores/{prov_id}
# =============================================================================
@router.put(
    "/{prov_id}",
    response_model=ProveedorRead,
    summary="Actualizar proveedor",
)
def update_proveedor(
    prov_id: str,
    prov_in: ProveedorUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Actualiza los datos de un proveedor existente.

    Funcionalidad existente (se mantiene):
    - 404 si no existe o no pertenece al usuario.
    - Normalización a MAYÚSCULAS en textos.
    - validate_proveedor_ubicacion_condicional antes de guardar.

    Mejoras:
    - Si se actualiza nombre: valida unicidad dentro del usuario (excluyendo el propio proveedor).
    - Si llega localidad_id:
        - se deriva localidad/comunidad/pais desde BBDD y se actualizan también los textos.
        - esto mantiene consistencia entre FK y textos legacy.
    """
    obj = db.get(models.Proveedor, prov_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )

    data = prov_in.model_dump(exclude_unset=True)

    # -------------------------
    # Normalización + unicidad nombre (si cambia)
    # -------------------------
    if "nombre" in data and data["nombre"] is not None:
        nombre_up = normalize_upper(data["nombre"]) or ""
        # Unicidad dentro del usuario, excluyendo el propio id
        exists = (
            db.query(models.Proveedor)
            .filter(
                models.Proveedor.user_id == current_user.id,
                models.Proveedor.nombre == nombre_up,
                models.Proveedor.id != prov_id,
            )
            .first()
        )
        if exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un proveedor con este nombre.",
            )
        data["nombre"] = nombre_up

    # -------------------------
    # Si llega localidad_id, derivamos textos desde BBDD (consistencia)
    # -------------------------
    if "localidad_id" in data and data["localidad_id"]:
        ub = _resolve_ubicacion_from_localidad_id(db, data["localidad_id"])
        # Sobrescribimos textos con los derivados (fuente de verdad BBDD)
        data["localidad"] = ub["localidad"]
        data["comunidad"] = ub["comunidad"]
        data["pais"] = ub["pais"]

    # Normalización de textos si vienen explícitamente (modo legacy)
    if "localidad" in data:
        data["localidad"] = normalize_upper(data["localidad"])
    if "pais" in data:
        data["pais"] = normalize_upper(data["pais"])
    if "comunidad" in data:
        data["comunidad"] = normalize_upper(data["comunidad"])

    # -------------------------
    # Validación condicional por rama con el estado final
    # -------------------------
    rama_objetivo = data.get("rama_id", obj.rama_id)
    loc_objetivo = data.get("localidad", obj.localidad)
    pais_objetivo = data.get("pais", obj.pais)
    com_objetivo = data.get("comunidad", obj.comunidad)

    validate_proveedor_ubicacion_condicional(
        db,
        rama_objetivo,
        loc_objetivo,
        pais_objetivo,
        com_objetivo,
    )

    # -------------------------
    # Persistencia
    # -------------------------
    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj


# =============================================================================
# DELETE /proveedores/{prov_id}
# =============================================================================
@router.delete(
    "/{prov_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Eliminar proveedor",
)
def delete_proveedor(
    prov_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """
    Elimina un proveedor.

    Motivo de la implementación:
    - Tu app móvil ya llama a DELETE, pero antes devolvía 405 porque no existía endpoint.

    Protección (importante):
    - Si el proveedor está referenciado por gastos / gastos_cotidianos / inversiones,
      NO eliminamos y devolvemos 409 Conflict, evitando:
        - violaciones de FK
        - pérdida de histórico
        - inconsistencias

    Si en el futuro quieres "borrado lógico", lo ideal es:
    - añadir campo is_active / inactivatedon en modelos.Proveedor
    - filtrar en listados
    - mantener histórico sin conflictos
    """
    obj = db.get(models.Proveedor, prov_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado")

    # Referencias (evitar romper integridad)
    has_gastos = (
        db.query(models.Gasto.id)
        .filter(models.Gasto.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_cotidianos = (
        db.query(models.GastoCotidiano.id)
        .filter(models.GastoCotidiano.proveedor_id == prov_id)
        .first()
        is not None
    )

    has_inversiones = (
        db.query(models.Inversion.id)
        .filter(
            or_(
                models.Inversion.proveedor_id == prov_id,
                models.Inversion.dealer_id == prov_id,
            )
        )
        .first()
        is not None
    )

    if has_gastos or has_cotidianos or has_inversiones:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: el proveedor está referenciado por movimientos.",
        )

    db.delete(obj)
    db.commit()
    return
