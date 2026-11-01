
## Two NVIDIA identities (processing vs. chat)
`NVIDIA_API_KEY` / `NVIDIA_MODEL` power processing: Store Manager, storefront generation, product content, change plans and click-to-edit. NOVA's conversation (text chat; spoken replies come from the same text) can use its own identity:

```
NVIDIA_CHAT_API_KEY=...        # unset -> uses NVIDIA_API_KEY
NVIDIA_CHAT_MODEL=...          # unset -> uses NVIDIA_MODEL
NVIDIA_CHAT_BASE_URL=...       # unset -> uses NVIDIA_BASE_URL
```
Keep each key on its own line (a duplicated `NVIDIA_API_KEY=` line silently overrides the first). `GET /api/v1/ai/status` shows `text_chat` and `processing` separately. Chat is session-aware: recent actions, unfinished work and the selected element are added to its context (`session_context_service`). Tests pin the fake provider and never read `.env`.
