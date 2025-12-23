"""
Autenticación unificada para GapptoMobile v3.

Endpoints:
- POST /api/v1/auth/login  -> devuelve access_token (JWT)
- GET  /api/v1/auth/me     -> devuelve datos del usuario autenticado

Reglas de negocio principales:
- Login por email (o username, alias del mismo campo).
- Token tipo Bearer (Authorization: Bearer <token>).
- El token incluye el ID de usuario en el campo 'sub'.
- Se comprueba que el usuario exista y esté activo.

IMPORTANTE:
- No se guarda ningún log en BD (no usamos LOG_ACCIONES).
- La contraseña se verifica:
    * Si empieza por "$2" -> se interpreta como hash bcrypt.
    * Si no -> comparación en texto plano (compatibilidad con datos antiguos).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from jose.exceptions import ExpiredSignatureError
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.db.session import get_db
from backend.app.db import models
from backend.app.core.config import settings


# ---------- Config JWT ----------
SECRET_KEY = settings.SECRET_KEY or os.getenv("SECRET_KEY", "gapptomobile-secret")
ALGORITHM = settings.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES

# ---------- Router ----------
router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


# ---------- Schemas ----------
class LoginIn(BaseModel):
    """
    Datos de entrada para el login:

    - email: email del usuario (opcional, pero obligatorio si no se usa username).
    - username: alias del email (se usa igual que email).
    - password: contraseña en texto.
    """
    email: Optional[EmailStr] = None
    username: Optional[EmailStr] = None
    password: str


# ---------- Helpers internos ----------
def _norm(email: Optional[str]) -> Optional[str]:
    """
    Normaliza el email a minúsculas y sin espacios.

    Esto permite hacer la búsqueda case-insensitive.
    """
    return email.strip().lower() if email else None


def create_access_token(sub: str, minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    """
    Crea un JWT con:
    - sub: identificador del usuario (string)
    - iat: momento de emisión (timestamp)
    - exp: momento de expiración (iat + minutes)
    """
    now = datetime.now(tz=timezone.utc)
    exp = now + timedelta(minutes=minutes)
    payload = {"sub": sub, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_password(plain: str, stored: str) -> bool:
    """
    Verifica la contraseña de forma compatible:

    - Si la contraseña guardada empieza por '$2' (formato bcrypt),
      se verifica con passlib[bcrypt].
    - En cualquier otro caso, se compara como texto plano.

    Esto permite tener usuarios antiguos con password en texto
    y a la vez abrir la puerta a guardar hashes bcrypt en el futuro.
    """
    if not stored:
        return False

    try:
        if stored.startswith("$2"):  # bcrypt hash
            from passlib.hash import bcrypt  # import local para no fallar si no está
            return bcrypt.verify(plain, stored)
    except Exception:
        # Si algo falla con bcrypt, caemos a comparación simple.
        pass

    return plain == stored


# =========================================================
# Endpoints
# =========================================================
@router.post("/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    """
    Login del usuario.

    Flujo:
    1. Normaliza email/username a minúsculas.
    2. Busca el usuario en la tabla User (coincidencia por email).
    3. Verifica que la contraseña sea correcta.
    4. Devuelve:
        - access_token (JWT)
        - token_type ("Bearer")
        - expires_in (en segundos)
        - datos básicos del usuario (id, email, full_name, role)
    """
    email = _norm(data.email or data.username)
    if not email:
        raise HTTPException(status_code=422, detail="email/username requerido")

    user = (
        db.query(models.User)
        .filter(func.lower(models.User.email) == email)
        .first()
    )

    if not user or not verify_password(data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    # Opcional: si quisieras bloquear usuarios inactivos:
    # if not user.is_active:
    #     raise HTTPException(
    #         status_code=status.HTTP_403_FORBIDDEN,
    #         detail="Usuario inactivo",
    #     )

    token = create_access_token(str(user.id))
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": getattr(user, "role", "user"),
        },
    }


def require_user(
    creds: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Dependencia que obliga a estar autenticado.

    - Lee el token Bearer del header Authorization.
    - Decodifica el JWT.
    - Valida:
        * que no esté expirado,
        * que tenga 'sub',
        * que el usuario exista y esté activo.

    Si falla, lanza 401.
    """
    if not creds or creds.scheme.lower() != "Bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falta Bearer token",
        )

    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token sin 'sub'",
            )
    except ExpiredSignatureError:
        # Señal clara para el cliente para hacer logout
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token_expired",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )

    user = db.get(models.User, int(sub))
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado o inactivo",
        )
    return user


@router.get("/me")
def me(current: models.User = Depends(require_user)):
    """
    Devuelve los datos del usuario autenticado a partir del token Bearer.
    """
    return {
        "id": current.id,
        "email": current.email,
        "full_name": current.full_name,
        "is_active": current.is_active,
        "role": getattr(current, "role", "user"),
    }
