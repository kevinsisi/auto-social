# Design: Confirmed Threads Replies

## Flow

1. Operator opens a keyword observation card.
2. A post with an AI draft shows `用 Threads session 留言`.
3. Clicking it opens a confirmation modal.
4. Modal displays:
   - target post URL
   - author when known
   - bound Threads handle from session status
   - editable reply text initialized from the AI draft
   - quota/kill-switch warning if blocked
5. Operator clicks `確認送出留言`.
6. Server creates `reply_attempts` row and runs one Playwright reply attempt.
7. UI polls attempt status until terminal: `succeeded`, `failed`, or `uncertain`.
8. Observation post card shows terminal status and details.

## Backend Shape

### Data Model

`reply_attempts`

- `id TEXT PRIMARY KEY`
- `card_id TEXT NOT NULL REFERENCES patrol_cards(id) ON DELETE CASCADE`
- `candidate_id TEXT NOT NULL REFERENCES trend_candidates(id) ON DELETE CASCADE`
- `reply_text TEXT NOT NULL`
- `status TEXT NOT NULL` — `pending | running | succeeded | failed | uncertain`
- `bound_handle TEXT`
- `reply_url TEXT`
- `verification_method TEXT` — `reply_url | dom_match | screenshot_only | none`
- `error TEXT`
- `screenshot_path TEXT`
- `created_at TEXT NOT NULL`
- `started_at TEXT`
- `completed_at TEXT`

Indexes:

- `(candidate_id, created_at DESC)` for observation card status.
- Unique partial index for one `succeeded` attempt per candidate if SQLite version supports it; otherwise enforce in code before creating attempts.

### APIs

`POST /api/keywords/:cardId/candidates/:candidateId/replies`

Request:

```json
{ "text": "reply text", "confirm": true }
```

Response:

```json
{ "replyAttempt": { "id": "...", "status": "pending" } }
```

Rules:

- `confirm` must be `true`.
- Candidate must belong to card.
- Candidate must have a Threads URL.
- Text must be non-empty and length-limited.
- Reject if kill switch is on.
- Reject if reply quota exhausted.
- Reject if an existing succeeded attempt exists for the candidate unless a future explicit `force` flag is designed.

`GET /api/replies/:attemptId`

Returns current attempt state including terminal result details.

### Execution Model

Preferred implementation: add `threads_reply` to the existing `ai_tasks`-style queue or a dedicated queue table worker so HTTP requests are short and UI can poll.

Minimum acceptable implementation: endpoint creates attempt and runs Playwright with a strict timeout, returning `202` early if the process is still running. Avoid holding a browser operation under a long request without progress state.

## Playwright Reply Strategy

`threads-bot/reply.ts` should:

1. Call `gate('reply')` before opening Threads.
2. Load existing encrypted session storage state.
3. Open candidate URL.
4. Detect login wall/session expiry before interacting.
5. Find the reply/comment control.
6. Fill exact reply text.
7. Submit.
8. Verify by reply permalink or DOM match.
9. Save screenshot on failure or uncertain status.

Selector strategy should prefer accessible labels/roles and fall back to bounded text heuristics. It must fail loudly when the Threads layout changes instead of claiming success.

## UI States

Post card states:

- No attempt: show `用 Threads session 留言` when an AI draft exists.
- `pending/running`: show `留言中` and disable duplicate submit.
- `succeeded`: show `留言成功`, timestamp, and `查看留言` if `reply_url` exists.
- `failed`: show `留言失敗` plus error and allow a new confirmed attempt.
- `uncertain`: show `可能已送出但無法確認`, show screenshot/evidence if available, and require manual review before another attempt.

## Risk Controls

- Human confirmation is required for every single reply.
- No automatic/batch reply action in this change.
- Reply quota defaults should be conservative.
- Kill switch blocks replies.
- The bound handle is shown before submit.
- Failed/uncertain attempts must not be hidden.
