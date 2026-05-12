## ADDED Requirements

### Requirement: Settings page with tabbed layout
The system SHALL provide a `設定` page in the client UI organized into the following tabs, each addressable by URL hash so deep links work:

- `#quotas` — daily publish / reply / per-scan search caps, scan cadence
- `#key-pool` — Gemini API key pool: batch import, list, individual delete, key-manager URL, manual sync trigger, pool status summary
- `#threads-session` — current Threads session status, last login, login button, clear-session button, sub-account reminder banner
- `#sources` — per-source enable / disable, trending-limit per source
- `#voice` — link out to Voice Studio (keeps deep editing flows in their own page)
- `#about` — app version, env summary (non-secret), license / risk-acknowledgement summary

#### Scenario: Open settings on a specific tab
- **WHEN** the user opens `/settings#key-pool`
- **THEN** the page renders with the Key Pool tab selected and other tabs collapsed but reachable

### Requirement: Quotas tab edits live without redeploy
The `#quotas` tab SHALL allow editing `dailyPublishLimit`, `dailyReplyLimit`, `perScanSearchLimit`, `scanCadenceCron`, and `jitterMinMs` / `jitterMaxMs`. Saves SHALL be persisted to the `settings` table and take effect immediately on the next operation; the scheduler SHALL re-register its cron when the cadence changes.

#### Scenario: Lower the daily publish limit
- **WHEN** the operator changes `dailyPublishLimit` from 3 to 1 and saves
- **THEN** the next publish attempt that day succeeds only if today's count is 0; subsequent attempts return `DailyQuotaExceededError`

### Requirement: Key Pool tab supports batch import
The `#key-pool` tab SHALL accept a multi-line text area for batch-importing Gemini API keys, with one key per non-empty, non-comment line (`#` prefix denotes a comment line). The same format the user's `key-manager` "複製可用金鑰" feature emits SHALL be accepted verbatim.

#### Scenario: Batch import 5 keys
- **WHEN** the operator pastes 5 keys (some with `#` comment lines interleaved) and clicks `匯入`
- **THEN** the system inserts each new key into `api_keys` with `is_active = 1`, skips duplicates by exact key value, and reports a summary like `匯入完成：新增 4 把，重複略過 1 把`

#### Scenario: Sync from key-manager URL
- **WHEN** the operator fills `KEY_MANAGER_URL` in the same tab and clicks `從 key-manager 同步`
- **THEN** the system calls `GET ${KEY_MANAGER_URL}/api/keys/export?trusted_only=1`, replaces local active keys with the returned set, and reports the new pool size plus any `unscoped_keys` / `mixed_buckets` warnings

#### Scenario: Inspect key health
- **WHEN** the operator views the `#key-pool` tab
- **THEN** the page lists each key by suffix (last 4 chars) with health (`available` / `cooldown` / `leased` / `inactive`), `usage_count`, `cooldown_until`, and a per-row delete button

### Requirement: Threads Session tab guides safe setup
The `#threads-session` tab SHALL prominently warn the operator to bind a **副帳號** (test account) before doing anything else, show the current session status (`healthy` / `unhealthy` / `none`), display the bound Threads handle if detectable from `storageState`, and provide login + clear buttons.

#### Scenario: No session yet
- **WHEN** the operator opens `#threads-session` and no session has ever been stored
- **THEN** the page shows a red warning banner `首次登入前請務必使用副帳號 — 主帳號被 ban 不可逆`, a `登入 Threads` button to start the interactive Playwright login, and disables all scan / publish actions in the rest of the UI

#### Scenario: Existing session is unhealthy
- **WHEN** a previous session has been stored but the last health check failed
- **THEN** the page shows `session 過期 — 上次健康檢查失敗於 <time>`, the bound handle (if any) so the user can verify it is still the sub-account, and a `重新登入` button

### Requirement: Sources tab toggles adapters at runtime
The `#sources` tab SHALL list every registered adapter with its enabled state, last-success / last-failure timestamp, failure count in the last 24h, trending-limit, and a toggle. Saves take effect on the next scan tick.

#### Scenario: Disable Threads adapter temporarily
- **WHEN** the operator turns off Threads under `#sources` and clicks save
- **THEN** the next scan tick skips Threads entirely; Dcard still runs; the `scan_runs` row records `sources_summary_json.threads = 'disabled'`

### Requirement: About tab shows version + non-secret env
The `#about` tab SHALL show the running app version, the configured `KEY_MANAGER_URL` (host portion only), the AI model in use (`GEMINI_DEFAULT_MODEL`), whether `AUTO_SOCIAL_SESSION_KEY` is set (boolean only, never the value), and a one-line risk reminder linking to `docs/risk-acknowledgement.md`.

#### Scenario: Operator confirms environment
- **WHEN** the operator opens `#about`
- **THEN** the page shows `版本 1.0.0`, `模型 gemini-2.5-flash`, `Session Key 已設定 ✓`, `key-manager: key.sisihome.org`, and a link to the risk doc
