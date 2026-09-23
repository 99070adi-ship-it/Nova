import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.models import User, UserRole
from app.db.session import get_db

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    """The single, server-derived source of identity and tenant scope for a request.

    org_id here is NEVER taken from a request body, query/path parameter, or model/tool output —
    it is resolved once, from the verified JWT, against the live user row. Every tenant-scoped
    repository/service call takes org_id from this object and nothing else.
    """

    user_id: uuid.UUID
    org_id: uuid.UUID
    role: UserRole


async def get_current_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Access token expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from None

    user_id = uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User no longer active")

    # Re-derive org_id and role from the live row, not just the (possibly stale) token claims.
    return AuthContext(user_id=user.id, org_id=user.org_id, role=user.role)


def require_role(*roles: UserRole):
    async def _dep(ctx: AuthContext = Depends(get_current_context)) -> AuthContext:
        if ctx.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return ctx

    return _dep


require_owner = require_role(UserRole.owner)
require_any_role = require_role(UserRole.owner, UserRole.staff)
