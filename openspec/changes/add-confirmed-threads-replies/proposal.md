# Confirmed Threads Replies

## Why

The observation page already produces per-post AI reply drafts, but the operator still has to copy the text and manually reply in Threads. The next useful step is a human-gated reply action that uses the already imported Threads Playwright session while making success or failure explicit.

This must not become automatic engagement spam. The operator needs to clearly see the reply text, confirm the target post, confirm the bound Threads account, and then see whether the reply was actually verified on Threads.

## What Changes

### New behavior

- Add a per-post action on AI suggestion drafts: `用 Threads session 留言`.
- Require a confirmation dialog before any Threads write. The dialog shows the target post URL, author when known, bound Threads handle, and final reply text.
- Send exactly one reply attempt per confirmation using the stored encrypted Threads `storageState` through Playwright.
- Persist every attempt in a `reply_attempts` table with status, reply text, error, verification evidence, and timestamps.
- Show reply status on the observation post card: `留言中`, `留言成功`, `留言失敗`, or `無法確認是否成功`.
- Prevent duplicate successful replies to the same candidate by default.

### Verification-first success contract

A reply is `succeeded` only when the system verifies one of the following after submitting:

- Best: a reply permalink / URL for the just-created reply is found.
- Acceptable: the page DOM shows the bound handle and exact reply text in the reply area after submit or reload.

If Playwright clicks submit but cannot verify the result, the attempt is `uncertain`, not `succeeded`.

### Safety gates

- Threads kill switch blocks all reply attempts.
- Reply quota is enforced independently from search quota.
- A per-attempt confirmation is required; no batch reply and no background automatic reply.
- The UI must show the bound Threads account before confirmation. If the session has no bound handle, the operator must refresh/probe the session first.
- Expired or unhealthy Threads session errors surface as actionable UI errors.

## Non-Goals

- No automatic reply without explicit confirmation.
- No batch reply to multiple posts.
- No automatic retry loop after a failed/uncertain reply.
- No official Threads API integration.
- No reply performance analytics in this slice.

## Capabilities

### New Capabilities

- `threads-replies`: Human-confirmed Playwright-backed replies using the existing Threads session.

### Modified Capabilities

- `threads-automation`: Adds the first write operation, gated by kill switch, quota, explicit confirmation, and verification.
- `keyword-observation`: Observation post cards can show reply-attempt status and initiate one confirmed reply.

## Impact

- Backend:
  - Add `reply_attempts` table and repository helpers.
  - Add `threads-bot/reply.ts` Playwright flow.
  - Add reply task handling or a synchronous-with-timeout endpoint, depending on implementation findings.
  - Add APIs to create an attempt and poll status.
- Frontend:
  - Add confirmation modal on observed post cards.
  - Add reply status badges and success/error details.
- Operations:
  - Reply quota and kill switch must be visible enough to explain blocked attempts.
  - Playwright selector fragility is expected; failures must be captured as failed/uncertain with useful diagnostics.
