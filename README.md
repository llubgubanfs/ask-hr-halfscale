# Ask HR

Responsive web app: employees ask handbook questions (phone-first) and get a cited answer **or** a handoff to HR; HR works an inbox at `/hr`.
Dependency-free Node (>=18): one small server + static front end.

## Run
```
cd app && npm start        # http://localhost:3000   (mock mode, no key needed)
npm test                   # spec fixtures (api-and-data §5) against mock mode
```
HR inbox: `/hr`, PIN `hr-demo` (env `HR_PIN`) — a demo stand-in for SSO. "Reset demo data" in the HR header restores the 4 seed items (no tickets of yours).

## Modes
| | |
|---|---|
| default | `AI_MODE=mock` (also the default when unset): fixed lookup, canned cited answers for the 5 FAQ seeds, everything else escalates. No network. |
| `?ai=real` | per-session switch (tab session): one server route calls `AI_BASE_URL/chat/completions` with `AI_MODEL`, using `AI_API_KEY` from the **server environment only**. Whole handbook in the system prompt (`prompts/system.md`), temp 0, max 400 tokens, 20 q/session/hour, identical-question cache. |
| `?ai=fail` | forces a failed AI call (502 `ai_unavailable`, UI shows Retry, no handoff created). `?ai=mock` returns to default. |
Sensitive/personal-data keyword pre-check runs **before** mock or real; a match always escalates (`lib/assistant.js`). Model output is validated server-side: unknown/missing citation IDs or unparseable JSON become a `not_covered` handoff.

## Env
`AI_MODE` `AI_API_KEY` `AI_BASE_URL` `AI_MODEL` `HR_PIN` (see `.env.example`; `.env` is git-ignored and auto-loaded locally). Optional `STATE_FILE`, `BLOB_READ_WRITE_TOKEN` (Vercel Blob persistence).

## Data & persistence
Handbook and FAQ chips are read from `data/handbook.json` / `data/faq-seed.json` at startup (nothing hard-coded; replace the files to swap the handbook). Tickets persist in `data/state.json` (JSON file). On Vercel's serverless runtime the disk is ephemeral (`/tmp`), so persistence there is best-effort unless a Blob store token is configured.

Bisaya/Tagalog: not built; the model path could translate answers later while citations stay the same.
