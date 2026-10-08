from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import AuthContext, get_current_context
from app.db.session import get_db
from app.repositories import storefront_repo, user_repo
from app.services import auth_service

router = APIRouter()
settings = get_settings()

_REFRESH_COOKIE_NAME = "refresh_token"
_REFRESH_COOKIE_PATH = "/api/v1/auth"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MeResponse(BaseModel):
    id: str
    org_id: str
    org_slug: str
    email: str
    full_name: str
    role: str


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.refresh_token_ttl_days * 24 * 3600,
        path=_REFRESH_COOKIE_PATH,
        httponly=True,
        samesite="strict",
        secure=settings.env != "local",
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await auth_service.login(db, email=payload.email, password=payload.password)
    _set_refresh_cookie(response, result.refresh_token)
    return TokenResponse(access_token=result.access_token, expires_in=result.expires_in)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await auth_service.signup(
        db, org_name=payload.org_name, email=payload.email, password=payload.password, full_name=payload.full_name,
    )
    _set_refresh_cookie(response, result.refresh_token)
    return TokenResponse(access_token=result.access_token, expires_in=result.expires_in)


@router.post("/demo-login", response_model=TokenResponse)
async def demo_login(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Public, unauthenticated, no form to fill in — creates (or, for a returning visitor whose
    refresh cookie still identifies a live demo session, resumes) one isolated demo workspace per
    visitor (NOVA 2.0 "no sign up or sign in" checkpoint). Never wipes another visitor's data —
    see auth_service.enter_demo's docstring. Passes along whatever refresh cookie is already on
    the request, exactly like /refresh does, so a returning visitor's own workspace can be
    resolved from it."""

    raw_token = request.cookies.get(_REFRESH_COOKIE_NAME)
    result = await auth_service.enter_demo(db, raw_token)
    _set_refresh_cookie(response, result.refresh_token)
    return TokenResponse(access_token=result.access_token, expires_in=result.expires_in)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    raw_token = request.cookies.get(_REFRESH_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="No refresh cookie")
    result = await auth_service.refresh(db, raw_refresh_token=raw_token)
    _set_refresh_cookie(response, result.refresh_token)
    return TokenResponse(access_token=result.access_token, expires_in=result.expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    raw_token = request.cookies.get(_REFRESH_COOKIE_NAME)
    await auth_service.logout(db, raw_refresh_token=raw_token)
    response.delete_cookie(key=_REFRESH_COOKIE_NAME, path=_REFRESH_COOKIE_PATH)


@router.get("/me", response_model=MeResponse)
async def me(ctx: AuthContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)) -> MeResponse:
    user = await user_repo.get_user_by_id(db, org_id=ctx.org_id, user_id=ctx.user_id)
    assert user is not None  # get_current_context already verified this user is active
    org = await storefront_repo.get_org_by_id(db, ctx.org_id)
    assert org is not None  # the user's own org_id always refers to a real, existing org
    return MeResponse(
        id=str(user.id), org_id=str(user.org_id), org_slug=org.slug,
        email=user.email, full_name=user.full_name, role=user.role.value,
    )
