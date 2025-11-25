"""
Router v3 para gestión de usuarios.

Endoints principales:
- GET  /api/v1/users        → listar usuarios (con filtros)
- POST /api/v1/users        → crear usuario
- GET  /api/v1/users/{id}   → obtener detalle
- PUT  /api/v1/users/{id}   → actualizar
- DELETE /api/v1/users/{id} → eliminar

Reglas de negocio:
- El email debe ser único (no se permiten duplicados).
- full_name se guarda SIEMPRE en MAYÚSCULAS.
- role se normaliza a minúsculas ("user", "admin") para encajar con el modelo.
- Por diseño, NO hacemos logging en BD (no se usa LOG_ACCIONES).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.schemas.users import UserCreate, UserUpdate, UserRead
from backend.app.utils.text_utils import normalize_upper

router = APIRouter(prefix="/users", tags=["users"])


# ================================
# Helpers internos
# ================================
def _email_exists(db: Session, email: str, exclude_id: Optional[int] = None) -> bool:
    """
    Comprueba si ya existe un usuario con ese email.

    - Si `exclude_id` se indica, se excluye ese usuario de la comprobación.
      Útil para updates (para no chocar con uno mismo).
    """
    q = db.query(models.User).filter(models.User.email == email)
    if exclude_id is not None:
        q = q.filter(models.User.id != exclude_id)
    return db.query(q.exists()).scalar()


def _normalize_role(role: Optional[str]) -> str:
    """
    Normaliza el rol a un valor aceptado por el modelo.

    - Si viene None → 'user'
    - Se fuerza a minúsculas para encajar con el enum/valores ('user', 'admin').
    """
    if not role:
        return "user"
    return role.strip().lower()


# ================================
# Endpoints CRUD
# ================================
@router.get("", response_model=List[UserRead])
def list_users(
    q: Optional[str] = Query(
        None,
        description="Filtro por email o nombre (búsqueda parcial).",
    ),
    only_active: Optional[bool] = Query(
        None,
        description="Si se indica, filtra por is_active = True/False.",
    ),
    db: Session = Depends(get_db),
):
    """
    Lista usuarios con filtros opcionales.

    Parámetros:
    - `q`: cadena de búsqueda que se aplica a email y full_name (ILIKE).
    - `only_active`: si se indica True/False, filtra por ese valor en is_active.

    Orden:
    - Por defecto, ordena por created_at descendente (más recientes primero).
    """
    query = db.query(models.User)

    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                models.User.email.ilike(like),
                models.User.full_name.ilike(like),
            )
        )

    if only_active is not None:
        query = query.filter(models.User.is_active == only_active)

    return query.order_by(models.User.created_at.desc()).all()


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """
    Crea un nuevo usuario.

    Reglas:
    - El email debe ser único.
    - full_name se guarda en MAYÚSCULAS.
    - is_active se inicializa a True.
    - role se normaliza a minúsculas ("user" / "admin").
    - La contraseña se guarda tal cual (sin hash, de momento).
    """
    if _email_exists(db, payload.email):
        raise HTTPException(
            status_code=409,
            detail="El email ya existe.",
        )

    full_name_norm = normalize_upper(payload.full_name)
    role_norm = _normalize_role(payload.role)

    row = models.User(
        email=payload.email,
        password=payload.password,  # <-- aquí iría el hash en el futuro
        full_name=full_name_norm or "",
        is_active=True,
        role=role_norm,
    )

    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """
    Devuelve el detalle de un usuario por su ID numérico.
    """
    row = db.get(models.User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return row


@router.put("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
):
    """
    Actualiza un usuario existente.

    Reglas:
    - Si se cambia el email, se vuelve a comprobar que no esté duplicado.
    - Si se cambia full_name, se normaliza a MAYÚSCULAS.
    - Si se cambia role, se normaliza a minúsculas.
    """
    row = db.get(models.User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Email duplicado
    if payload.email and _email_exists(db, payload.email, exclude_id=user_id):
        raise HTTPException(status_code=409, detail="El email ya existe.")

    # Asignaciones condicionales
    if payload.email is not None:
        row.email = payload.email

    if payload.password is not None:
        row.password = payload.password  # idem: aquí iría el hash si lo aplicas

    if payload.full_name is not None:
        row.full_name = normalize_upper(payload.full_name) or ""

    if payload.is_active is not None:
        row.is_active = payload.is_active

    if payload.role is not None:
        row.role = _normalize_role(payload.role)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """
    Elimina físicamente un usuario por ID.

    Nota:
    - Si en el futuro quieres "borrado lógico", en lugar de hacer delete()
      podríamos marcar is_active=False u otro flag.
    """
    row = db.get(models.User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    db.delete(row)
    db.commit()
    return None
