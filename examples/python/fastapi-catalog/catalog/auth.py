"""Toy bearer-token auth: real apps would verify a JWT. Sets the StackLens user for the trace."""

from typing import Optional

from fastapi import Header, HTTPException

import stacklens

TOKENS = {
    "tok_ada": {"id": 1, "email": "ada@shop.test", "role": "customer"},
    "tok_grace": {"id": 2, "email": "grace@shop.test", "role": "customer"},
    "tok_ghost": {"id": 42, "email": "ghost@shop.test", "role": "customer"},
    "tok_admin": {"id": 900, "email": "ops@shop.test", "role": "admin"},
}


class AuthError(HTTPException):
    pass


def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError(401, "missing bearer token")
    user = TOKENS.get(authorization.split(" ", 1)[1].strip())
    if user is None:
        raise AuthError(401, "invalid or expired token")
    stacklens.set_user(user["id"])
    return user


def admin_user(authorization: Optional[str] = Header(default=None)) -> dict:
    user = current_user(authorization)
    if user["role"] != "admin":
        raise AuthError(403, "admin role required")
    return user
