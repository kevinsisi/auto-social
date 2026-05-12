## 1. Rename & Cleanup

- [x] 1.1 Replace `遇見好車海巡台` with `社群海巡工作站` in `packages/client/index.html` `<title>` and `packages/client/src/main.tsx` `<h1>`.
- [x] 1.2 Replace the hardcoded `普通酸、自嘲優先。人家認真問，我們就先不要耍嘴皮。` subtitle on the keyword card with a voice-profile-driven byline (initial fallback: `海巡隊已就位。等情報進來。`).
- [ ] 1.3 Delete or stub `packages/server/src/humor.ts`; its functionality is fully replaced by `ai/pipeline.ts` in section 5. (Batch 1 neutralized brand strings; full deletion lands in Batch 2.)
- [x] 1.4 Delete `遇見好車`-tinted strings from `packages/server/src/repository.ts` and `humor.ts` (browser-run `message` already neutral; humor.ts brand strings replaced with 海巡 phrasing).
- [ ] 1.5 Update `README.md` to describe the new product positioning and stack, keeping the existing local-dev / Docker sections accurate. (Done in prior rebrand commit; Batch 1 status note added now.)

## 2. Dependencies

- [x] 2.1 Add `@kevinsisi/ai-core` (latest, pinned via `git+https://github.com/kevinsisi/ai-core.git`) to `packages/server`. (Pinned to default branch HEAD; will pin to a tag once a stable Phase 0 tag is cut.)
- [~] 2.2 Add `playwright` + `playwright-extra` + `puppeteer-extra-plugin-stealth` to `packages/server`. (Phase 0 Batch 1 ships `playwright` only; `playwright-extra` + stealth deferred to Batch 4, will use manual stealth init-script if the ESM compat story is unclear.)
- [x] 2.3 Add `node-cron` (or `croner`) to `packages/server` for scan scheduling.
- [x] 2.4 Switch the runtime stage of `Dockerfile` to a Playwright-bundled base image; keep the build stage on `node:22-bookworm-slim`.
- [ ] 2.5 Ensure the local-network TLS bypass added during local testing remains gated behind the deps stage and labelled `LOCAL-TEST ONLY`; do not extend it to the runtime stage. (Batch 6 — already labelled in current Dockerfile.)

## 3. Database

- [x] 3.1 Add `voice_profile` table (single row id=1; JSON columns: `axes`, `no_go_zones`, `admired_accounts`, `self_descriptors`, `signature_phrases`, `updated_at`).
- [x] 3.2 Add `voice_feedback` table (`id`, `draft_id`, `variant_idx`, `decision`, `comment`, `created_at`).
- [x] 3.3 Add `trend_candidates` table (`id`, `source`, `external_id`, `fingerprint`, `card_id?`, `is_trending`, `url`, `author`, `title`, `text`, `published_at`, `engagement_json`, `fetched_at`, `pipeline_status`) + indexes.
- [x] 3.4 Add `drafts` table (`id`, `candidate_id`, `status`, `classify_json`, `score_json`, `variants_json`, `meme_json`, `chosen_variant_idx?`, `final_text?`, `published_url?`, `last_error_reason?`, `created_at`, `decided_at?`, `published_at?`) + index.
- [x] 3.5 Add `threads_session` table (`id`, `storage_state_ciphertext`, `salt`, `iv`, `auth_tag`, `bound_handle?`, `last_login_at`, `healthy`, `health_note?`).
- [x] 3.6 Add `daily_quotas` table (`op`, `date`, `count`); add `settings` table (`key`, `value_json`, `updated_at`) for kill switch + quota limits + scan cadence.
- [x] 3.7 Add `api_keys` table compatible with `ai-core` `SqliteAdapter` (id/key/is_active/cooldown_until/lease_until/lease_token/usage_count).
- [ ] 3.8 Preserve `patrol_cards`, `patrol_runs`, `candidates`, `analyses`, `reply_suggestions` from the prior MVP; do not drop them. The scheduler back-fills `candidates` from `trend_candidates` so the legacy detail view still works.

## 4. Key Pool & key-manager Integration

- [x] 4.1 Add `key-pool/key-pool.ts` that constructs `ai-core` `KeyPool` over `SqliteAdapter`. Inject default cooldowns and lease durations from env.
- [~] 4.2 Add `key-pool/key-manager-sync.ts` that polls `${KEY_MANAGER_URL}/api/keys/export?trusted_only=1` on startup and every hour, replacing local `api_keys`. Surface `unscoped_keys > 0` or `mixed_buckets > 0` as a warning, do not silently trust raw counts. (Manual sync endpoint exists; startup/hourly scheduling deferred to scheduler batch.)
- [x] 4.3 Add `key-pool/report.ts` `reportToManager(key, status)` and wire it after every Gemini call result (success / cooldown / auth failure).
- [x] 4.4 Add `/api/admin/keys/sync` POST endpoint for manual sync trigger.
- [x] 4.5 Add `/api/admin/keys/status` GET endpoint that returns the pool state (counts by health bucket) for the UI.

## 5. AI Pipeline

- [x] 5.1 Add `ai/gemini-client.ts` that wires `ai-core` `GeminiClient` to the `KeyPool`. Default model `gemini-2.5-flash`; allow override via env.
- [~] 5.2 Add `ai/prompt-builder.ts` that loads the active `voice_profile` and produces `systemInstruction` + per-step prompt sections. (Default profile injection exists; DB-backed voice loading lands with Voice Studio.)
- [x] 5.3 Add `ai/steps/classify.ts` (returns structured `{ topic, sensitivity, voiceFit, reason }`).
- [x] 5.4 Add `ai/steps/score.ts` (returns `{ engagementWorth, risk, timeliness, shouldDraft, reason }`; short-circuits when `shouldDraft=false`).
- [x] 5.5 Add `ai/steps/draft.ts` (returns 3 variants `{ angle, text, length }`).
- [x] 5.6 Add `ai/steps/meme.ts` (returns `{ memePrompt, sceneIdea }`).
- [x] 5.7 Add `ai/pipeline.ts` that composes the four steps via `ai-core` `StepRunner` with `planPreferredKeys`. Mark all steps `allowSharedFallback: true`; bubble `NoAvailableKeyError` as candidate status `pipeline_blocked`.
- [x] 5.8 Add unit tests for each step's JSON parsing and short-circuit behavior using Gemini response fixtures.

## 6. Voice Studio

- [ ] 6.1 Add `voice/repository.ts` with `getProfile()` / `saveProfile()` / `appendFeedback()`.
- [ ] 6.2 Add `/api/voice/profile` GET/PUT.
- [ ] 6.3 Add `/api/voice/feedback` POST.
- [ ] 6.4 Add `VoiceStudio` page in client with axis sliders, no-go-zone checklist + free-text, admired-accounts editor (3–5 rows), self-descriptors, signature phrases, language toggle (default `zh-TW`).
- [ ] 6.5 First-run guard: if `voice_profile` row is missing/empty, the Dashboard and Draft Inbox display a banner pointing to Voice Studio; the AI pipeline still runs with a sane default profile so the system is not blocked.
- [ ] 6.6 Add a "preview voice" panel in Voice Studio that feeds a fixed sample candidate through `draft` step and shows the 3 variants without persisting.

## 7. Trend Sources

- [ ] 7.1 Add `sources/source-adapter.ts` interface (`id`, `isEnabled`, `fetch`).
- [ ] 7.2 Add `sources/dcard.ts` with **two modes**: `fetchTrending()` calling the public Dcard popular-posts endpoint with no keyword filter, and `fetch({ keywords })` filtering trending results by keyword in title/excerpt/tags. Handle 429 with exponential backoff, fail soft. Dcard is an optional extra source only; it must not be used as a replacement for Threads patrol.
- [ ] 7.3 Add `sources/threads.ts` with **two modes**: `fetchTrending()` opening Threads explore / for-you feed via `threads-bot/explore.ts` and parsing top posts, and `fetch({ keywords })` calling `threads-bot/search.ts` per keyword. Both respect the search-quota gate.
- [ ] 7.4 Add `sources/registry.ts` listing built-in adapters; each adapter checks `settings.sources[id].enabled` before running.
- [ ] 7.5 Add `/api/sources` GET (list with health), POST `/api/sources/:id/enable`, POST `/api/sources/:id/disable`, PATCH `/api/sources/:id/config` for trending-limit etc.

## 8. Threads Automation (Playwright)

- [ ] 8.1 Add `threads-bot/session.ts` with `loginInteractive()`, `loadSession()`, `clearSession()`. Encrypt `storageState` with AES-256-GCM derived from `AUTO_SOCIAL_SESSION_KEY` env.
- [ ] 8.2 Add `threads-bot/browser.ts` that lazy-initializes a single `playwright-extra` chromium context with stealth plugin, real UA, 1280×800 viewport.
- [x] 8.3 Add `threads-bot/search.ts` `search(keyword, opts)` that opens `https://www.threads.net/search?q=<kw>`, scrolls once, returns up to N parsed candidates. On failure (login expired, layout changed, blocked) throw a typed error and do not invent results.
- [ ] 8.4 Add `threads-bot/explore.ts` `fetchTrending(opts)` that opens the Threads explore / for-you feed via Playwright, scrolls once, parses top posts. Same failure modes as search.
- [ ] 8.5 Stub `threads-bot/publish.ts` and `threads-bot/reply.ts` files with TODO + Phase 1 marker; corresponding HTTP endpoints respond `501 Not Implemented` in Phase 0.
- [~] 8.6 Add `threads-bot/throttle.ts` `gate(op)` enforcing kill switch, daily quota (op-aware), random jitter 5–30s. Phase 0 now has kill-switch read gate; quota + jitter remain for scheduler batch.
- [~] 8.7 Add `/api/threads/session/start` (returns interactive login channel info), `/api/threads/session/status`, `/api/threads/session/clear`. Status/clear/start-info endpoints exist; Settings can import encrypted Playwright `storageState` JSON; full interactive login channel + sub-account acknowledgement remain.
- [ ] 8.8 Add `/api/threads/kill-switch` GET/PUT and surface in UI with a big red button.
- [ ] 8.9 Add `/api/threads/quotas` GET (today's counts + limits + remaining) and PUT for limits.
- [ ] 8.10 Decide and document where the Playwright worker actually runs (in-container vs sidecar container). Default: in-container, single worker, mounted volume for `~/.cache/ms-playwright`.
- [ ] 8.11 Parse the bound Threads handle from `storageState` after login and store in `threads_session.bound_handle`; surface in Settings → Threads Session tab.

## 9. Scan Scheduler

- [ ] 9.1 Add `scheduler/scanner.ts` that, on each tick, calls every enabled `SourceAdapter.fetchTrending()` and `SourceAdapter.fetch({ keywords })` in parallel with a per-source-per-mode timeout (default 60s), dedupes by `fingerprint`, inserts new rows into `trend_candidates`; trending-mode results are marked `is_trending = true`.
- [ ] 9.2 Add `scheduler/pipeline-runner.ts` that for each new candidate runs `ai/pipeline.ts`, persists the draft, and marks `pipeline_status` final.
- [ ] 9.3 Add `scheduler/cron.ts` that wires `scanner` + `pipeline-runner` on a `*/15 * * * *` schedule (configurable via `settings.scan.cadence`).
- [ ] 9.4 Add `/api/admin/scan/run-now` POST to trigger a scan manually for testing.
- [x] 9.4a Interim radar scan: `POST /api/admin/scan/run-now` scans broad Threads observation queries, persists real candidates to `trend_candidates`, and `/api/radar/trends` reads recent persisted rows instead of live request-time fetches.
- [ ] 9.5 Add scheduler observability: each run produces a `scan_runs` row (started_at, ended_at, sources_summary_json, candidates_added, drafts_produced, errors_json).
- [ ] 9.6 Ensure the scheduler does not stack: if a previous run is still in progress when the next tick fires, the new tick is skipped and logged.

## 10. Draft Inbox

- [ ] 10.1 Add `/api/drafts` GET with filters (`status`, `since`, `sourceId`, `keyword`).
- [ ] 10.2 Add `/api/drafts/:id` GET for detail (includes candidate, variants, score, meme prompt).
- [ ] 10.3 Add `/api/drafts/:id/choose` PATCH `{ variantIdx, finalText? }`.
- [ ] 10.4 Phase 0: `/api/drafts/:id/publish` POST returns `501 Not Implemented` with explanatory body. Phase 1 will wire it through kill-switch + quota + `threads-bot/publish`.
- [ ] 10.5 Add `/api/drafts/:id/cancel` PATCH and `/api/drafts/:id/mark-posted` PATCH (the latter accepts a manual `published_url`).
- [ ] 10.6 Add `DraftInbox` page in client: card list sorted by score, expandable card with 3 variants, edit textarea, `定稿` button (per draft) that copies `final_text` to clipboard and opens `https://www.threads.net/` in a new tab, `已發` button that prompts for a Threads URL and marks `posted_manually`, `取消` button.
- [ ] 10.7 Add real-time-ish refresh (poll every 30s) so a new scan's drafts appear without manual reload.
- [ ] 10.8 Display kill-switch + today's quota usage prominently in the Draft Inbox header (publish/reply counters shown as `Phase 1 啟用` in Phase 0).

## 11. Dashboard & Keyword Management

- [~] 11.1 Rework Dashboard to show two tabs: `全網熱門` (candidates with `is_trending = true`) and `我的關鍵字` (candidates with `card_id` set); both sorted by score-by-engagement; both lead into the same per-draft view. Interim dashboard now has a hot keyword cloud plus keyword monitoring list; radar terms come from real Threads-targeted candidate text and must not use canned filler terms.
- [ ] 11.2 Dashboard header: today's draft count, per-source health, scan history button, pool status, kill-switch + (Phase 1) quota summary.
- [ ] 11.3 Move keyword-card list management into a `Sources & Keywords` sub-page; cards remain the source of keyword input for scans.
- [ ] 11.4 Preserve the existing manual link import path on a keyword card as a fallback when an interesting thread is found out-of-band.
- [ ] 11.5 Remove the old "patrol-detail" Threads-search browser-open button; replace with "run scan for this keyword now" that triggers `/api/admin/scan/run-now?keyword=...`.
- [x] 11.6 Add an interim `Threads 出勤海巡` button that performs Threads-targeted fallback discovery using `site:threads.net` search and stores only Threads links. This is explicitly not a Dcard substitute and remains a fallback until Playwright search lands.

## 11A. Settings Page

- [ ] 11A.1 Add `/settings` route in client with hash-routed tabs (`#quotas`, `#key-pool`, `#threads-session`, `#sources`, `#voice`, `#about`).
- [ ] 11A.2 `#quotas` tab: fields for `dailyPublishLimit`, `dailyReplyLimit`, `perScanSearchLimit`, `scanCadenceCron`, `jitterMinMs`, `jitterMaxMs`; save persists to `settings` table; scheduler re-registers cron on cadence change. Phase 0 disables publish/reply fields visually with `Phase 1 啟用` label.
- [ ] 11A.3 `#key-pool` tab:
  - [ ] 11A.3.1 Multi-line textarea for batch import; one key per non-empty non-`#` line; accepts the exact format key-manager's `複製可用金鑰` produces.
  - [ ] 11A.3.2 `匯入` button calls a new `POST /api/admin/keys/batch-import` endpoint; reports `新增 N 把、重複略過 M 把`.
  - [ ] 11A.3.3 `KEY_MANAGER_URL` input + `從 key-manager 同步` button that triggers `/api/admin/keys/sync`.
  - [ ] 11A.3.4 Per-key table by suffix showing health (`available` / `cooldown` / `leased` / `inactive`), `usage_count`, `cooldown_until`, delete button.
- [ ] 11A.4 `#threads-session` tab: red sub-account warning banner on first-bind; current session health badge; bound handle from `threads_session.bound_handle`; `登入 Threads` + `清除 Session` buttons.
- [ ] 11A.5 `#sources` tab: per-source toggle + trending limit input; last-success / last-failure timestamps.
- [ ] 11A.6 `#voice` tab: short copy + button linking to Voice Studio page.
- [ ] 11A.7 `#about` tab: version, `KEY_MANAGER_URL` host, `GEMINI_DEFAULT_MODEL`, `AUTO_SOCIAL_SESSION_KEY 已設定` boolean, link to risk-acknowledgement doc.

## 12. Verification

- [x] 12.1 `npm run typecheck` passes for both packages.
- [x] 12.2 `npm run build` passes for both packages.
- [~] 12.3 `npm run test` covers: ai pipeline parsing, voice prompt builder, source adapter fingerprinting, throttle gate (mocked time + mocked killswitch), session encryption round-trip. (Batch 2 covers key import + AI pipeline parsing/short-circuit; source/throttle/session tests remain for later batches.)
- [ ] 12.4 Local Docker `docker compose up -d --build` boots; `/api/health` reports OK; the Playwright base image is used; `~/.cache/ms-playwright` mount is intact.
- [ ] 12.5 End-to-end smoke (manual, Phase 0): set voice profile → batch-import 2+ keys via Settings → trigger scan-now → verify trending Dcard candidates appear in `全網熱門` tab → trigger keyword-card scan-now → verify keyword candidates appear in `我的關鍵字` tab → start interactive Threads login (副帳號 acknowledgement) → trigger scan-now again → verify Threads candidates appear → `定稿` a draft → confirm clipboard copy + Threads opens in new tab → paste a fake Threads URL into `已發` → confirm draft moves to `posted_manually`.
- [ ] 12.6 Confirm per-scan search quota enforcement by setting `perScanSearchLimit` to 1 and running a scan with 3+ keyword cards; only 1 Threads search per tick should fire, rest should record `quota` errors.
- [ ] 12.7 Confirm kill switch by engaging it and triggering a scan; Threads adapter must report `KillSwitchActiveError` and Dcard adapter must still run.
- [ ] 12.8 Confirm `POST /api/drafts/:id/publish` returns `501 Not Implemented` in Phase 0.

## 13. Documentation

- [ ] 13.1 Update `README.md` quick-start to reflect new modules, env vars (`KEY_MANAGER_URL`, `AUTO_SOCIAL_SESSION_KEY`, `GEMINI_DEFAULT_MODEL`), and the Phase 0 = read-only / manual-publish flow.
- [ ] 13.2 Add `docs/operations.md` covering: first-time Threads login (副帳號), recovering from expired session, tuning quotas, kill-switch usage, manual scan trigger, batch-importing keys.
- [ ] 13.3 Add `docs/risk-acknowledgement.md` stating the Meta ToS situation and the user's explicit acceptance.
- [x] 13.4 Add `.env.example` at repo root containing `AUTO_SOCIAL_SESSION_KEY=` placeholder with a comment `# generate with: openssl rand -hex 32`, and `KEY_MANAGER_URL=` placeholder; ensure `.env` is gitignored.
- [ ] 13.5 Update `docker-compose.yml` to `env_file: - .env` so the session key is injected at container start.

## 14. App Version

- [x] 14.1 Bump version to `1.0.0` (major rebrand from `0.1.0`) in: root `package.json`, `packages/server/package.json`, `packages/client/package.json`. `APP_VERSION` constant moved out of `types.ts` into dedicated `packages/server/src/version.ts` (reads its own `package.json` at runtime); `packages/client/src/version.ts` now imports `../package.json` via Vite's JSON resolution.
- [x] 14.2 Consolidated `APP_VERSION`: each package reads its own `package.json` at module init. No hardcoded version constants remain; bumping `package.json` is now the only place to change the version per package.
- [x] 14.3 Verified `/api/health` returns `{"ok":true,"version":"1.0.0"}` from a fresh `node packages/server/dist/index.js` run.
- [x] 14.4 `npm install` ran during dependency add; lockfile reflects new version and new deps.
- [ ] 14.5 Add a short note in `README.md` describing the version-bump rule and where the constant lives, so future contributors do not miss it. (Defer to Batch 6 docs sweep.)
