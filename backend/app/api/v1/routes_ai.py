import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import AuthContext, require_any_role
from app.db.session import get_db
from app.repositories import ai_repo
from app.schemas.ai import ConversationOut, MessageOut, PostMessage, PostMessageResult, StartConversation
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
    result = await agent_service.post_message(db, ctx.org_id, conversation_id, user_text=payload.text)
    return PostMessageResult(**result)
