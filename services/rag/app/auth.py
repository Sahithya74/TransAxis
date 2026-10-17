"""Service tokens. The API signs a short-lived HS256 token for every call, carrying the caller's organisation,
permissions and readable document classifications. This service trusts nothing else about the caller: the
filters it applies to searches come from these claims, never from the question or a model's output."""

from __future__ import annotations

from dataclasses import dataclass

import jwt

AUDIENCE = "transaxis-rag"
ISSUER = "transaxis-api"
MAX_LIFETIME_S = 300


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class Principal:
    org_id: int
    user_id: int
    permissions: frozenset[str]
    classifications: tuple[str, ...]
    #: The organisation's local date (YYYY-MM-DD), so periods like "last month" match the app.
    today: str
    timezone: str
    #: The user's own API access token, used only to call permission-checked metric endpoints. Never logged.
    access_token: str | None

    def can(self, permission: str) -> bool:
        return permission in self.permissions


def verify_service_token(token: str, secret: str) -> Principal:
    if len(secret) < 32:
        raise AuthError("Service secret is not configured")
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            leeway=5,
            options={"require": ["exp", "iat", "sub", "org"]},
        )
    except jwt.PyJWTError as e:
        raise AuthError("Invalid service token") from e
    if int(claims["exp"]) - int(claims["iat"]) > MAX_LIFETIME_S:
        raise AuthError("Service token lifetime too long")
    try:
        return Principal(
            org_id=int(claims["org"]),
            user_id=int(claims["sub"]),
            permissions=frozenset(str(p) for p in claims.get("perms", [])),
            classifications=tuple(str(c) for c in claims.get("cls", [])),
            today=str(claims.get("today", "")),
            timezone=str(claims.get("tz", "Asia/Kolkata")),
            access_token=claims.get("tok") or None,
        )
    except (TypeError, ValueError) as e:
        raise AuthError("Malformed service token") from e
