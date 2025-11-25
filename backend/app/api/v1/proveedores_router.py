# backend/app/api/v1/proveedores_router.py

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db import models
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


@router.post(
    "/",
    response_model=ProveedorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear proveedor",
)
def create_proveedor(
    prov_in: ProveedorCreate,
    db: Session = Depends(get_db),
):
    """
    Crea un nuevo proveedor.

    Reglas:
    - Convierte NOMBRE/LOCALIDAD/PAÍS/COMUNIDAD a MAYÚSCULAS.
    - Valida que no exista ya un proveedor con el mismo NOMBRE.
    - Valida obligatoriedad condicional:
      * LOCALIDAD y PAÍS para ramas RESTAURANTES/HOTELES.
      * COMUNIDAD para RESTAURANTES/HOTELES.
    - Genera el ID en el backend con formato PROV-XXXXXX.
    """
    # Normalización a MAYÚSCULAS
    nombre_up = normalize_upper(prov_in.nombre) or ""
    localidad_up = normalize_upper(prov_in.localidad)
    pais_up = normalize_upper(prov_in.pais)
    comunidad_up = normalize_upper(prov_in.comunidad)

    # Unicidad por nombre
    exists = (
        db.query(models.Proveedor)
        .filter(models.Proveedor.nombre == nombre_up)
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un proveedor con este nombre.",
        )

    # Validación condicional por rama
    validate_proveedor_ubicacion_condicional(
        db,
        prov_in.rama_id,
        localidad_up,
        pais_up,
        comunidad_up,
    )

    # 🔹 NUEVO: generamos el ID en servidor
    new_id = generate_proveedor_id(db)

    obj = models.Proveedor(
        id=new_id,
        nombre=nombre_up,
        rama_id=prov_in.rama_id,
        localidad=localidad_up,
        pais=pais_up,
        comunidad=comunidad_up,
    )

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.put(
    "/{prov_id}",
    response_model=ProveedorRead,
    summary="Actualizar proveedor",
)
def update_proveedor(
    prov_id: str,
    prov_in: ProveedorUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza los datos de un proveedor existente.
    """
    obj = db.get(models.Proveedor, prov_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Proveedor no encontrado",
        )

    data = prov_in.model_dump(exclude_unset=True)

    # Normalización a MAYÚSCULAS
    if "nombre" in data and data["nombre"] is not None:
        data["nombre"] = normalize_upper(data["nombre"])
    if "localidad" in data:
        data["localidad"] = normalize_upper(data["localidad"])
    if "pais" in data:
        data["pais"] = normalize_upper(data["pais"])
    if "comunidad" in data:
        data["comunidad"] = normalize_upper(data["comunidad"])

    # Valores finales con los que se quedaría el proveedor
    rama_objetivo = data.get("rama_id", obj.rama_id)
    loc_objetivo = data.get("localidad", obj.localidad)
    pais_objetivo = data.get("pais", obj.pais)
    com_objetivo = data.get("comunidad", obj.comunidad)

    # Validación condicional por rama
    validate_proveedor_ubicacion_condicional(
        db,
        rama_objetivo,
        loc_objetivo,
        pais_objetivo,
        com_objetivo,
    )

    for k, v in data.items():
        setattr(obj, k, v)

    db.commit()
    db.refresh(obj)
    return obj
