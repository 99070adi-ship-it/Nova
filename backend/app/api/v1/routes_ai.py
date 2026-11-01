import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.speech import SpeechProvider, check_rate_limit, get_speech_provider
from app.config import get_settings
from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.repositories import ai_repo
from app.errors import SpeechUnavailableError, ValidationDomainError
from app.schemas.ai import ConversationOut, MessageOut, PostMessage, PostMessageResult, SpeechRequest, StartConversation
from app.services import agent_service

router = APIRouter()


@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def start_conversation(
    payload: StartConversation, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> ConversationOut:
    conversation = await agent_service.get_or_create_conversation(
        db, ctx.org_id, agent_key=payload.agent_key, raw_context=payload.context, user_id=ctx.user_id
    )
    return ConversationOut.model_validate(conversation)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID, ctx: AuthContext = Depends(require_any_role), db: AsyncSession = Depends(get_db)
) -> list[MessageOut]:
    await agent_service.get_conversation_or_404(db, ctx.org_id, conversation_id)
    messages = await ai_repo.list_messages(db, conversation_id)
    return [MessageOut.model_validate(m) for m in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=PostMessageResult)
async def post_message(
    conversation_id: uuid.UUID, payload: PostMessage, ctx: AuthContext = Depends(require_any_role),
    db: AsyncSession = Depends(get_db),
) -> PostMessageResult:
    result = await agent_service.post_message(db, ctx.org_id, conversation_id, user_text=payload.text, screen=payload.screen, focus=payload.focus)
    return PostMessageResult(**result)


@router.post("/speech")
async def speak(
    payload: SpeechRequest, ctx: AuthContext = Depends(require_any_role),
    provider: SpeechProvider = Depends(get_speech_provider),
) -> StreamingResponse:
    """Text-to-speech for the Guide / helping centre. Authenticated; scoped to nothing tenant-specific
    (it reads and writes no tenant data), but rate-limited per user. The audio is streamed through and
    never stored; the text is not logged. Errors are raised BEFORE any bytes are sent, by pulling the
    first chunk here, so the caller gets a proper status instead of a truncated 200."""
    text = payload.text.strip()
    max_chars = get_settings().tts_max_chars
    if not text:
        raise ValidationDomainError("Nothing to say.")
    if len(text) > max_chars:
        raise ValidationDomainError(f"Speech is limited to {max_chars} characters.")
    check_rate_limit(str(ctx.user_id))

    stream = provider.stream(text).__aiter__()
    try:
        first = await stream.__anext__()  # raises Speech*Error (mapped to 503/429) before the response starts
    except StopAsyncIteration:
        raise SpeechUnavailableError() from None

    async def body():
        yield first
        async for chunk in stream:
            yield chunk

    return StreamingResponse(body(), media_type=provider.media_type, headers={"Cache-Control": "no-store"})


@router.get("/speech/status")
async def speech_status(
    ctx: AuthContext = Depends(require_any_role), provider: SpeechProvider = Depends(get_speech_provider)
) -> dict:
    """Readiness of the voice engine, so the UI can tell "voice is unavailable" apart from a normal
    answer: state is not_loaded | loading | ready | failed. Reveals nothing sensitive."""
    return provider.status()


@router.post("/speech/warmup", status_code=202)
async def speech_warmup(
    ctx: AuthContext = Depends(require_any_role), provider: SpeechProvider = Depends(get_speech_provider)
) -> dict:
    """Starts loading the voice model in the background (idempotent) and returns immediately, so it is
    ready by the time the person has chosen voice. Never blocks, never fails the caller."""
    return await provider.warm_up()


@router.get("/status")
async def ai_status(ctx: AuthContext = Depends(require_any_role)) -> dict:
    """Which AI NOVA is using (a real language model or the rule-based demo double) and whether it is configured. No secrets."""
    from app.ai import status

    return status.describe()


@router.post("/status/probe")
async def ai_status_probe(ctx: AuthContext = Depends(require_any_role)) -> dict:
    """Makes one tiny real request to the configured provider to confirm credentials, model and endpoint work (cached 60 s)."""
    from app.ai import status

    return await status.probe()
