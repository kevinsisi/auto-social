## 1. Backend Data Model

- [ ] 1.1 Add `reply_attempts` migration with status, candidate/card references, reply text, verification fields, error, screenshot path, and timestamps.
- [ ] 1.2 Add repository helpers to create attempts, transition status, fetch latest attempt per candidate, and reject duplicate succeeded attempts by default.
- [ ] 1.3 Include latest reply attempt status in keyword observation API rows so post cards can render reply state.

## 2. Threads Reply Automation

- [ ] 2.1 Implement `threads-bot/reply.ts` that opens the target Threads post with stored session state, fills the reply, submits it, and verifies success.
- [ ] 2.2 Enforce `gate('reply')`, kill switch, daily reply quota, and session health before any browser write.
- [ ] 2.3 Save failure/uncertain diagnostics, including a screenshot path when feasible.
- [ ] 2.4 Add tests for success, session expired, quota blocked, kill-switch blocked, selector failure, and verification failure paths with mocked Playwright boundaries.

## 3. APIs

- [ ] 3.1 Add `POST /api/keywords/:cardId/candidates/:candidateId/replies` requiring `{ text, confirm: true }`.
- [ ] 3.2 Add `GET /api/replies/:attemptId` for polling status.
- [ ] 3.3 Reject invalid ownership, non-Threads URLs, empty/too-long text, duplicate succeeded replies, unhealthy sessions, kill switch, and exhausted quota with clear errors.

## 4. Frontend

- [ ] 4.1 Add `用 Threads session 留言` button to post cards that have an AI draft.
- [ ] 4.2 Add confirmation modal showing target URL, author, bound handle, editable reply text, and final `確認送出留言` action.
- [ ] 4.3 Poll reply attempt status and render `留言中`, `留言成功`, `留言失敗`, or `可能已送出但無法確認` on the post card.
- [ ] 4.4 Show `查看留言` when `reply_url` is verified.
- [ ] 4.5 Disable duplicate submit while an attempt is pending/running and block additional attempts after success unless a future force flow is designed.

## 5. Verification & Release

- [ ] 5.1 Run `npm run typecheck`, `npm test`, `npm run build`, and `npx openspec validate add-confirmed-threads-replies --strict`.
- [ ] 5.2 Production smoke: verify session status, create one attempt on a safe test Threads post, confirm UI reaches `留言成功` or a truthful `uncertain/failed` terminal state.
- [ ] 5.3 Update `README.md` and `docs/operations.md` with the human-confirmed reply workflow and risk controls.
