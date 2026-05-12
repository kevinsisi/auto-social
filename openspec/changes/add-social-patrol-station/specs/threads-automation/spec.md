## ADDED Requirements

### Requirement: Persist the Threads session encrypted at rest
The system SHALL persist the Threads / Instagram login session as `storageState` JSON encrypted with AES-256-GCM, using a key derived from the `AUTO_SOCIAL_SESSION_KEY` environment variable via PBKDF2 (≥ 100,000 iterations) with a random per-record salt. The system SHALL NOT store any Threads or Instagram password in any form. `AUTO_SOCIAL_SESSION_KEY` SHALL be a 64-char hex string (32 bytes of entropy) generated once via `openssl rand -hex 32` and stored in the local `.env` file (gitignored), then injected into the container via `docker-compose.yml` `env_file` or `environment`.

#### Scenario: Session is encrypted on save
- **WHEN** the system stores a freshly captured `storageState`
- **THEN** the row in `threads_session` contains only the ciphertext, salt, and metadata; reading the row without `AUTO_SOCIAL_SESSION_KEY` cannot recover the plaintext

#### Scenario: Session key missing on startup
- **WHEN** the server starts without `AUTO_SOCIAL_SESSION_KEY` set
- **THEN** the system logs a clear warning, refuses to load any previous session, and disables all Threads automation operations until the env var is provided

#### Scenario: Session key changed across restarts
- **WHEN** the operator restarts the container with a different `AUTO_SOCIAL_SESSION_KEY` than the one used when the session was encrypted
- **THEN** decryption fails on next session load, the system marks the existing session row corrupted, surfaces a UI banner asking the operator to log in again, and does NOT silently delete the row (kept for audit)

### Requirement: Sub-account first-bind policy
The system SHALL warn the operator on every login flow that the bound account should be a Threads **副帳號** (test account), not the primary brand account. The login flow's confirmation step SHALL require an explicit "I understand this should be a test account" acknowledgement before storing the `storageState` for the first time.

#### Scenario: First-time login
- **WHEN** the operator triggers the first interactive login (no prior session row exists)
- **THEN** the UI shows a blocking acknowledgement step: `我確認登入的是副帳號，主帳號 ban 風險自負`; only after the operator checks this and clicks confirm does the system persist the captured `storageState`

#### Scenario: Re-login after session expiry
- **WHEN** the operator re-logs in (a prior session row exists)
- **THEN** the warning is shown as a non-blocking reminder; the bound Threads handle (parsed from `storageState`) is displayed before the operator confirms, so they can verify they have not accidentally logged in with the wrong account

### Requirement: Interactive one-time login
The system SHALL expose an interactive login flow where Playwright opens Threads in a headful window and the user logs in normally (including Instagram OAuth and 2FA). After the post-login redirect is detected, the system SHALL capture `storageState`, encrypt it, and store it.

#### Scenario: User completes interactive login
- **WHEN** the user clicks `設定 Threads Session` and completes the IG login flow in the popup
- **THEN** the server captures `storageState`, encrypts and persists it, and marks `threads_session.healthy = true`

#### Scenario: User abandons interactive login
- **WHEN** the user closes the popup before reaching the post-login redirect
- **THEN** no session is stored, the prior session (if any) is preserved, and the UI reports `login cancelled`

### Requirement: Read-side operations are throttled and quota-gated
The system SHALL route every Playwright operation through a `throttle.gate(op)` function that enforces, in order: kill-switch check, daily quota check (op-specific), and a randomized 5–30s jitter delay before the action runs. Quotas reset at local midnight (`Asia/Taipei`).

#### Scenario: Search within quota
- **WHEN** the daily `search` count is below the configured limit and the kill switch is off
- **THEN** the gate sleeps a random 5–30s, increments the `search` counter, and lets the operation proceed

#### Scenario: Search over quota
- **WHEN** the daily `search` count already equals or exceeds the configured limit
- **THEN** `throttle.gate('search')` throws `DailyQuotaExceededError` before any network activity

### Requirement: Phase 0 ships read-only Threads automation
For Phase 0, the system SHALL implement only **read** Playwright operations against Threads: `search(keyword)` and `fetchTrending()`. Write operations (`publish`, `reply`) are explicitly out of scope for Phase 0; their schemas may be stubbed but the corresponding API endpoints SHALL respond `501 Not Implemented` until Phase 1.

#### Scenario: Publish endpoint in Phase 0
- **WHEN** any client calls `POST /api/drafts/:id/publish` in Phase 0
- **THEN** the server responds `501 Not Implemented` with body `{ error: 'Phase 0 不支援自動發文，請複製草稿手動發送', phase: 0 }`

#### Scenario: Reply endpoint in Phase 0
- **WHEN** any client calls reply endpoints in Phase 0
- **THEN** the server responds `501 Not Implemented` with a clear message

### Requirement: Write operations are human-gated (Phase 1)
When Phase 1 enables `publish` and `reply`, the system SHALL only execute them as a direct result of an explicit user click on the corresponding UI button for a specific draft. The system SHALL NOT trigger `publish` or `reply` from a schedule, a webhook, or any background job.

#### Scenario: Publish requires a UI button (Phase 1)
- **WHEN** a draft has been generated and the user clicks `送出`
- **THEN** `threads-bot/publish.ts` only runs after the user calls `POST /api/drafts/:id/publish`; no background job or scheduler may call it

#### Scenario: Publish blocked by kill switch (Phase 1)
- **WHEN** the kill switch is engaged
- **THEN** any `publish` or `reply` request is rejected with `KillSwitchActiveError` and the operation does not reach Playwright

### Requirement: Daily quotas have safe defaults and are configurable
The system SHALL ship with default daily limits of 3 publishes, 10 replies, and 20 keyword searches per 15-minute scan tick (the publish/reply caps are daily; the search cap is per-tick to throttle per-scan fan-out). In Phase 0 the publish/reply quotas are inert because those operations are not yet implemented; the search quota is active. Limits SHALL be editable via `settings` without redeploy.

#### Scenario: Settings change quota at runtime
- **WHEN** the operator changes the publish limit in settings from 3 to 5
- **THEN** the change takes effect for subsequent publish requests within the same day, capped by the new value

### Requirement: Session health is observable
The system SHALL detect "session no longer logged in" on every Playwright operation by checking a stable post-auth DOM marker (e.g. header avatar element) and SHALL flip `threads_session.healthy = false` on failure, surfacing a UI banner.

#### Scenario: Session expired mid-operation
- **WHEN** Playwright opens a Threads page and the post-auth marker is missing
- **THEN** the system records `health_note = 'logged out'`, sets `healthy = false`, throws a typed error to the caller, and the dashboard shows a banner asking the user to re-login

### Requirement: Single shared browser context
The system SHALL maintain at most one shared Playwright chromium context for Threads operations and SHALL serialise read and write operations through this context, so two operations never race over the same DOM.

#### Scenario: Concurrent publish requests
- **WHEN** two `publish` requests arrive at the same time
- **THEN** the threads-bot worker serialises them through a queue; the second waits for the first to finish before its jitter delay starts

### Requirement: Stealth and realistic fingerprint
The system SHALL launch chromium via `playwright-extra` with the stealth plugin enabled, use a realistic user-agent string matching the bundled chromium version, set the viewport to 1280×800, and not surface obvious automation flags (e.g. `navigator.webdriver`).

#### Scenario: Browser fingerprint check
- **WHEN** a test page that inspects `navigator.webdriver` and standard automation tells is loaded
- **THEN** the fingerprint does not flag the session as automated by these basic checks
