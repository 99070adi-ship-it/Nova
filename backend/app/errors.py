from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Base class for business-rule violations raised from the service layer.

    Routes never construct ad hoc error responses — they raise a DomainError subclass and the
    handlers below map it to the shared error envelope.
    """

    status_code: int = status.HTTP_422_UNPROCESSABLE_ENTITY
    code: str = "domain_error"

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class ValidationDomainError(DomainError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"


class ForbiddenError(DomainError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class StaleProposalError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    code = "stale_proposal"


class AIProviderError(DomainError):
    """Raised whenever an `LLMProvider` implementation (Fake/NVIDIA/OpenAI) fails — network error,
    rate limit, timeout, malformed response, anything. Deliberately carries no detail from the
    underlying exception: providers are untrusted, unreliable external dependencies, and nothing
    about their failure mode (API keys, stack traces, vendor error text) should ever reach the
    frontend. Distinct from ValidationDomainError (bad input), ConflictError/StaleProposalError
    (state machine violations), and ForbiddenError (auth) — this is specifically "the AI service
    itself didn't respond," which the caller could plausibly retry later."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "ai_provider_unavailable"

    def __init__(self, details: dict | None = None):
        super().__init__(
            "NOVA couldn't complete this step because the AI service is temporarily unavailable. "
            "Your store data and existing changes are safe.",
            details=details,
        )


def _envelope(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_envelope(exc.code, exc.message, exc.details))

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_envelope("http_error", str(exc.detail)))

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope("validation_error", "Request validation failed", {"errors": exc.errors()}),
        )
