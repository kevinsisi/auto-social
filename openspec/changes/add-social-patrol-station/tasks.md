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

- [~] 8.1 Add `threads-bot/session.ts` with `loginInteractive()`, `loadSession()`, `clearSession()`. Encrypted `storageState` import/load/clear/status is implemented with AES-256-GCM derived from `AUTO_SOCIAL_SESSION_KEY`; interactive login is available through noVNC fallback plus the preferred desktop helper, but the original `loginInteractive()` API shape remains deferred.
- [ ] 8.2 Add `threads-bot/browser.ts` that lazy-initializes a single `playwright-extra` chromium context with stealth plugin, real UA, 1280×800 viewport.
- [x] 8.3 Add `threads-bot/search.ts` `search(keyword, opts)` that opens Threads search, follows current `threads.com` redirects, scrolls once, returns parsed post candidates only, and on failure (login expired, layout changed, blocked) throws a typed error without inventing results.
- [ ] 8.4 Add `threads-bot/explore.ts` `fetchTrending(opts)` that opens the Threads explore / for-you feed via Playwright, scrolls once, parses top posts. Same failure modes as search.
- [ ] 8.5 Stub `threads-bot/publish.ts` and `threads-bot/reply.ts` files with TODO + Phase 1 marker; corresponding HTTP endpoints respond `501 Not Implemented` in Phase 0.
- [~] 8.6 Add `threads-bot/throttle.ts` `gate(op)` enforcing kill switch, daily quota (op-aware), random jitter 5–30s. Phase 0 now has kill-switch read gate; quota + jitter remain for scheduler batch.
- [~] 8.7 Add `/api/threads/session/start` (returns interactive login channel info), `/api/threads/session/status`, `/api/threads/session/clear`. Status/clear/start/import endpoints exist; Settings can upload/import encrypted Playwright `storageState` JSON; noVNC remains fallback, while desktop helper is the preferred path. Sub-account acknowledgement remains.
- [x] 8.7a Add desktop helper `npm run threads:login` that opens local Chromium, lets the user complete Instagram/Threads login on their computer, writes `data/threads-storage-state.json`, and Settings can upload that JSON for encrypted session import.
- [x] 8.8 Add `/api/threads/kill-switch` GET/PUT and surface in UI with a big red button. API + `throttle.gate()` enforcement landed in 15.A.2. UI (1.2.26): toggle in `#settings/threads` (red ON / paper OFF state), plus an always-on-top red banner across every dashboard page when kill-switch is ON, with a one-click 「立即解除」 button. App polls `/api/threads/kill-switch` every 10s.
- [~] 8.9 Add `/api/threads/quotas` GET (today's counts + limits + remaining) and PUT for limits. Current implementation exposes `GET /api/threads/throttle`, `PUT /api/admin/threads/daily-limits`, and `POST /api/admin/threads/quotas/search/reset-today` for the load-bearing search quota controls.
- [x] 8.10 Decide and document where the Playwright worker actually runs (in-container vs sidecar container). Current production uses in-container Playwright on a Playwright base image; desktop login helper is local-only for creating importable `storageState`.
- [x] 8.11 Parse the bound Threads handle from `storageState` after login and store in `threads_session.bound_handle`; surface in Settings → Threads Session tab. (1.2.27) Implementation: `threads-bot/handle-probe.ts` opens a Playwright context with the imported storageState, navigates to `https://www.threads.com/`, scans nav anchors for the user's own profile link via aria-label hint, and persists the matched `@handle`. Probe is fire-and-forget after both import paths and also exposed manually as `POST /api/threads/session/probe-handle` with a `抓綁定帳號` button in Settings → Threads.

## 9. Scan Scheduler

- [ ] 9.1 Add `scheduler/scanner.ts` that, on each tick, calls every enabled `SourceAdapter.fetchTrending()` and `SourceAdapter.fetch({ keywords })` in parallel with a per-source-per-mode timeout (default 60s), dedupes by `fingerprint`, inserts new rows into `trend_candidates`; trending-mode results are marked `is_trending = true`.
- [ ] 9.2 Add `scheduler/pipeline-runner.ts` that for each new candidate runs `ai/pipeline.ts`, persists the draft, and marks `pipeline_status` final.
- [ ] 9.3 Add `scheduler/cron.ts` that wires `scanner` + `pipeline-runner` on a `*/15 * * * *` schedule (configurable via `settings.scan.cadence`).
- [x] 9.4 Add `/api/admin/scan/run-now` POST to trigger a scan manually for testing.
- [x] 9.4a Interim radar scan: `POST /api/admin/scan/run-now` scans broad Threads observation queries, persists real candidates to `trend_candidates`, and `/api/radar/trends` reads recent persisted rows instead of live request-time fetches.
- [~] 9.5 Add scheduler observability: manual radar scan writes `scan_runs` rows with started/ended/status/sources/candidates/errors; recurring scheduler draft counters remain deferred.
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

- [~] 11.1 Rework Dashboard to show two tabs: `全網熱門` (candidates with `is_trending = true`) and `我的關鍵字` (candidates with `card_id` set); both sorted by score-by-engagement; both lead into the same per-draft view. Interim dashboard now has a hot keyword cloud plus keyword monitoring list; production v1.0.5 radar terms come from persisted real Threads Playwright candidates and filter internal/Threads UI labels instead of canned filler terms.
- [ ] 11.2 Dashboard header: today's draft count, per-source health, scan history button, pool status, kill-switch + (Phase 1) quota summary.
- [ ] 11.3 Move keyword-card list management into a `Sources & Keywords` sub-page; cards remain the source of keyword input for scans.
- [ ] 11.4 Preserve the existing manual link import path on a keyword card as a fallback when an interesting thread is found out-of-band.
- [x] 11.5 Remove the old "patrol-detail" Threads-search browser-open button; replace with "run scan for this keyword now" that triggers `/api/admin/scan/run-now?keyword=...`. (1.2.27) Legacy `POST /api/cards/:cardId/browser-run`, `api.startBrowserRun`, and `PatrolRepository.createBrowserRun` removed — replacement `scanThreads` SSE flow has been the user-facing path for several releases.
- [x] 11.6 Add an interim `Threads 出勤海巡` button that performs Threads-targeted fallback discovery using `site:threads.net OR site:threads.com` search and stores only Threads links. This is explicitly not a Dcard substitute and remains a fallback when Playwright search fails.
- [x] 11.7 Desktop keyword empty state now keeps the add-keyword form visible and tells the user to add a brand/topic/product term before the right observation panel can show Threads wind direction.

## 11A. Settings Page

- [ ] 11A.1 Add `/settings` route in client with hash-routed tabs (`#quotas`, `#key-pool`, `#threads-session`, `#sources`, `#voice`, `#about`).
- [x] 11A.1a Interim settings routes: `#settings/admin`, `#settings/keys`, `#settings/threads`, `#settings/pipeline` split the previous stacked page into explicit sections; in single-user deployment mode, admin operations are server-side guarded by configured `ADMIN_TOKEN` and the UI does not ask the user to paste token values.
- [ ] 11A.2 `#quotas` tab: fields for `dailyPublishLimit`, `dailyReplyLimit`, `perScanSearchLimit`, `scanCadenceCron`, `jitterMinMs`, `jitterMaxMs`; save persists to `settings` table; scheduler re-registers cron on cadence change. Phase 0 disables publish/reply fields visually with `Phase 1 啟用` label.
- [x] 11A.2a Interim Threads quota controls live under `#settings/threads`: show today's search usage, save the daily search limit, and clear today's search counter.
- [ ] 11A.3 `#key-pool` tab:
  - [ ] 11A.3.1 Multi-line textarea for batch import; one key per non-empty non-`#` line; accepts the exact format key-manager's `複製可用金鑰` produces.
  - [ ] 11A.3.2 `匯入` button calls a new `POST /api/admin/keys/batch-import` endpoint; reports `新增 N 把、重複略過 M 把`.
  - [ ] 11A.3.3 `KEY_MANAGER_URL` input + `從 key-manager 同步` button that triggers `/api/admin/keys/sync`.
  - [x] 11A.3.4 Per-key table by suffix showing health (`available` / `cooldown` / `leased` / `inactive`), `usage_count`, `cooldown_until`, delete button. (1.2.30) Each row in `#settings/keys` has a `✕ 砍` button; `DELETE /api/admin/keys/:id` route returns 404 when the id is unknown, 200 + `{deleted}` on success. Confirmed via 6-case `tests/key-pool.test.ts`.
- [~] 11A.4 `#threads-session` tab: red sub-account warning banner on first-bind; current session health badge; bound handle from `threads_session.bound_handle`; `登入 Threads` + `清除 Session` buttons. Current UI exposes session health, local-helper JSON upload/import, remote-browser fallback start, and clear; reliable bound-handle extraction remains deferred.
- [ ] 11A.5 `#sources` tab: per-source toggle + trending limit input; last-success / last-failure timestamps.
- [ ] 11A.6 `#voice` tab: short copy + button linking to Voice Studio page.
- [x] 11A.7 `#about` tab: version, `KEY_MANAGER_URL` host, `GEMINI_DEFAULT_MODEL`, `AUTO_SOCIAL_SESSION_KEY 已設定` boolean, link to risk-acknowledgement doc. (1.2.27) New `GET /api/about` returns `version`, `geminiDefaultModel`, `keyManagerHost`, `sessionKeyConfigured`, `adminTokenConfigured`, `insecureTlsEnabled`, `node`; the `#settings/about` tab renders them and surfaces the model-default-rule explainer to prevent the recurring 2.0 vs 2.5-flash confusion.
- [x] 11A.8 Settings page has an explicit `回儀表板` escape hatch, and the mobile header swaps the Settings button for a Dashboard button while on Settings.

## 12. Verification

- [x] 12.1 `npm run typecheck` passes for both packages.
- [x] 12.2 `npm run build` passes for both packages.
- [~] 12.3 `npm run test` covers: ai pipeline parsing, voice prompt builder, source adapter fingerprinting, throttle gate (mocked time + mocked killswitch), session encryption round-trip. (Batch 2 covers key import + AI pipeline parsing/short-circuit; source/throttle/session tests remain for later batches.)
- [ ] 12.4 Local Docker `docker compose up -d --build` boots; `/api/health` reports OK; the Playwright base image is used; `~/.cache/ms-playwright` mount is intact.
- [~] 12.5 End-to-end smoke (manual, Phase 0): set voice profile → batch-import 2+ keys via Settings → trigger scan-now → verify trending Dcard candidates appear in `全網熱門` tab → trigger keyword-card scan-now → verify keyword candidates appear in `我的關鍵字` tab → start interactive Threads login (副帳號 acknowledgement) → trigger scan-now again → verify Threads candidates appear → `定稿` a draft → confirm clipboard copy + Threads opens in new tab → paste a fake Threads URL into `已發` → confirm draft moves to `posted_manually`. Production v1.0.5 verified health/version, session `hasSession:true healthy:true`, and radar scan from Threads Playwright with persisted candidates; full Draft Inbox flow remains pending.
- [x] 12.6 Confirm per-scan search quota enforcement by setting `perScanSearchLimit` to 1 and running a scan with 3+ keyword cards; only 1 Threads search per tick should fire, rest should record `quota` errors. (1.2.27) Backend integration test `quota-killswitch-smoke.test.ts` covers daily-limit=1 with 3 cards: first scan returns `playwright_ok`, the next two see `DailyQuotaExceededError` thrown from the Playwright path and fall back into `fetchThreadsSearchOutcome` (mocked to `no_results`). The fallback being entered exactly N-1 times is asserted.
- [x] 12.7 Confirm kill switch by engaging it and triggering a scan; Threads adapter must report `KillSwitchActiveError` and Dcard adapter must still run. (1.2.27) Same test file: kill-switch ON → `scanKeywordCard` rethrows `KillSwitchActiveError` and the fallback path is never called (assertion: `fetchThreadsSearchOutcome` is not invoked); toggle OFF restores normal scans. Dcard is no longer in the patrol flow (rule: Threads only), so the original Dcard-still-runs requirement is moot.
- [ ] 12.8 Confirm `POST /api/drafts/:id/publish` returns `501 Not Implemented` in Phase 0.

## 13. Documentation

- [~] 13.1 Update `README.md` quick-start to reflect new modules, env vars (`KEY_MANAGER_URL`, `AUTO_SOCIAL_SESSION_KEY`, `GEMINI_DEFAULT_MODEL`), and the Phase 0 = read-only / manual-publish flow. README now reflects production v1.0.5, desktop helper, encrypted session import, Threads Playwright radar, and `threads.com` fallback; remaining docs for draft/publish flow deferred.
- [~] 13.2 Add `docs/operations.md` covering: first-time Threads login (副帳號), recovering from expired session, tuning quotas, kill-switch usage, manual scan trigger, batch-importing keys. Initial operations doc covers production health, desktop login/import, session recovery, manual scan, and version rule; quotas/kill-switch/key batch import details remain deferred.
- [ ] 13.3 Add `docs/risk-acknowledgement.md` stating the Meta ToS situation and the user's explicit acceptance.
- [x] 13.4 Add `.env.example` at repo root containing `AUTO_SOCIAL_SESSION_KEY=` placeholder with a comment `# generate with: openssl rand -hex 32`, and `KEY_MANAGER_URL=` placeholder; ensure `.env` is gitignored.
- [ ] 13.5 Update `docker-compose.yml` to `env_file: - .env` so the session key is injected at container start.

## 14. App Version

- [x] 14.1 Bump version to `1.0.0` (major rebrand from `0.1.0`) in: root `package.json`, `packages/server/package.json`, `packages/client/package.json`. `APP_VERSION` constant moved out of `types.ts` into dedicated `packages/server/src/version.ts` (reads its own `package.json` at runtime); `packages/client/src/version.ts` now imports `../package.json` via Vite's JSON resolution.
- [x] 14.2 Consolidated `APP_VERSION`: each package reads its own `package.json` at module init. No hardcoded version constants remain; bumping `package.json` is now the only place to change the version per package.
- [x] 14.3 Verified `/api/health` returns `{"ok":true,"version":"1.0.0"}` from a fresh `node packages/server/dist/index.js` run.
- [x] 14.4 `npm install` ran during dependency add; lockfile reflects new version and new deps.
- [ ] 14.5 Add a short note in `README.md` describing the version-bump rule and where the constant lives, so future contributors do not miss it. (Defer to Batch 6 docs sweep.)

## 15. Phase A1 — Observation MVP (active)

The A1 slice flips the product to observation-first. Drafts ride alongside observation for voice training; Voice Studio (Section 6) and Draft Inbox (Section 10) stay deferred. Each A1 sub-batch ships through `typecheck → build → test → local docker rebuild → push → production verify` before the next starts.

### 15.A Throttle first (blocking prerequisite)

- [x] 15.A.1 Make `threads-bot/throttle.ts` `gate(op)` load-bearing: read `settings.killSwitch` and throw `KillSwitchActiveError`; read `settings.threads.dailyLimits` and `daily_quotas` and throw `DailyQuotaExceededError`; apply random jitter from `settings.threads.jitterMs`; increment `daily_quotas` atomically via `INSERT … ON CONFLICT … WHERE count < limit`. `searchThreadsWithPlaywright` now gates before opening any Playwright context.
- [x] 15.A.2 Add `GET /api/threads/kill-switch`, `PUT /api/threads/kill-switch` (admin), `GET /api/threads/throttle` (snapshot of settings + today's counts). UI toggle lands in 15.E with the rest of the observation UI.
- [x] 15.A.3 Unit-test `gate(op)` with injected sleep + random + mocked kill switch + mocked quota table (8 cases in `tests/throttle.test.ts`).

### 15.B Threads search depth

- [x] 15.B.1 Extend `threads-bot/search.ts` `page.evaluate` to extract `author` (handle), `postedAt` (ISO via `time[datetime]`), `likes` and `replyCount` (parsed from aria-label/title hints with K/M/萬/千 unit support); fields are nullable when DOM doesn't surface them.
- [x] 15.B.2 No new columns needed — existing `trend_candidates.author`, `published_at`, `engagement_json` already cover the contract; engagement is stored as `{ likes, replies }` JSON.
- [x] 15.B.3 `radar-trends.ts` `insertTrendCandidate` now writes `author`, `published_at`, `engagement_json` when present.
- [x] 15.B.4 Fix Threads engagement extraction for visible text counters (`讚` / `留言` / `轉發` / `分享`) when the DOM does not expose aria/title labels, and clean those counters from displayed excerpts. Covered by `threads-search.test.ts`.
- [x] 15.B.5 Backfill engagement/text/images on duplicate Threads URLs during scan so existing rows get corrected after parser fixes instead of staying stale due to `INSERT OR IGNORE`. Covered by `radar-trends.test.ts`.

### 15.C AI sentiment + sponsored detection

- [x] 15.C.1 Extend `ai/steps/classify.ts` output schema: add `sentiment` (enum: `anger` / `complaint` / `help` / `sarcasm` / `neutral` / `positive` / `support`). Prompt now ships definitions + 1 example per class.
- [x] 15.C.2 Add `ai/steps/sponsored-detect.ts` returning `{ sponsoredSignal: 'none' | 'suspect' | 'likely', reasons: string[] }`. Prompt enumerates 5 signals (brand placement, PR-clean copy, hidden CTA, ad hashtags, brand-name repetition); `none` is normalised to empty reasons[]. Wired into `SocialPipeline` behind `options.runSponsored`; meme can be disabled via `options.runMeme = false`.
- [x] 15.C.3a Unit-test classify sentiment via `tests/classify.test.ts` (6 cases: 7-class roundtrip + missing/unknown sentiment rejection + markdown-fence stripping + prompt content).
- [x] 15.C.3b Unit-test sponsored-detect via `tests/sponsored-detect.test.ts` (10 cases: none/suspect/likely roundtrip + reason normalisation + length cap + markdown-fence + prompt content + sentiment-orthogonality note).

### 15.D Pipeline runner on every candidate

- [x] 15.D.1 Add `scheduler/pipeline-runner.ts` `runPipelineOnCandidate(db, id)` that runs `classify → sponsored-detect → score → draft (3 variants kept; UI shows first as the training draft)` with `runMeme: false`. Persists `classify_json`, `sponsored_json`, `score_json`, `draft_variants_json`, and `pipeline_status` ∈ {`drafted`, `short_circuited`, `pipeline_blocked`} directly on `trend_candidates`. Drafts table is deferred until A2 Draft Inbox.
- [x] 15.D.2 `radar-trends.ts` `scanRadarTrends` and the keyword-card scan-threads route both call `schedulePipelineForCandidates(db, ids)` which fire-and-forgets pipeline on every newly inserted candidate. The legacy `candidates` table is still populated for back-compat; new UI in 15.E reads from `trend_candidates`.
- [x] 15.D.3 `pipeline_blocked` is recorded on the candidate row with `pipeline_error`. Unit test `tests/pipeline-runner.test.ts` covers drafted / short-circuited / blocked / missing-id paths (4 cases).

### 15.E Observation API + UI

- [x] 15.E.1 `GET /api/keywords/:cardId/observe` returns `{ card, aggregate: { totalSamples, classifiedSamples, since, sentimentDistribution: { [class]: { count, pct } }, sponsoredRate, pipelineBlockedCount }, posts: [{ id, source, url, author, postedAt, likes, replyCount, excerpt, fetchedAt, pipelineStatus, pipelineError, topic, sentiment, voiceFit, sponsoredSignal, sponsoredReasons, shouldDraft, scoreReason, draft } ] }`. Window: 24h, max 50 posts, sorted newest first. Implementation in `src/observe.ts`.
- [x] 15.E.2 `POST /api/voice/feedback` `{ draftId, variantIdx, decision: 'like' | 'dislike' | 'rewrite', comment? }` writes to `voice_feedback`. `draftId` is the `trend_candidates.id` in Phase A1.
- [x] 15.E.3 Replaced `PatrolDetail` with `KeywordObservationPanel` (`packages/client/src/main.tsx`): top 風向卡 with 7-colour stacked bar + dominant-sentiment label + 葉配 rate + sample count, post list with author/time/likes/replies/excerpt/sentiment tag (colour-coded)/葉配 badge expanding to show `sponsored_reasons[]`/AI 建議留言 text + copy + `👍 像我` / `👎 不像` / `✏️ 改寫` buttons. Polls observe API every 30s. `pipeline_blocked` posts show a "AI 判讀失敗" badge and "草稿暫不可用" instead of fake content.
- [x] 15.E.4 Manual Threads link import preserved as `ManualLinkImport` block below the post list with a note that AI 風向 comes from the scheduled pipeline.

### 15.F Verification + ship

- [x] 15.F.1 `npm run typecheck` + `npm run build` + `npm run test` pass in both packages (55/55 server tests, client tsc + vite build clean).
- [~] 15.F.2 Local server smoke verified instead of full Docker rebuild: `node packages/server/dist/index.js` boots; `/api/health` returns `{"ok":true,"version":"1.1.0"}`; `/api/threads/throttle` returns expected snapshot; `/api/keywords/no-such-card/observe` 404s. Company-net Docker rebuild deferred — production deploys via GitHub Actions amd64 image, not local Docker.
- [x] 15.F.3 Version bumped `1.0.6` → `1.1.0` across root + server + client `package.json`; README status block rewritten for Phase A1 deliverables.
- [x] 15.F.4 Commit `e7ffee2` pushed to `main`; GitHub Actions `Deploy to amd64 Server via Tailscale` workflow ran 25777368557, status `success`. Production health verification from this workstation blocked because `social.sisihome.org` resolves to Tailscale CGNAT (100.126.x.x) and this company workstation has no Tailscale; user verifies on their own machine.

## 16. Phase A1.5 — Observation hardening (active, shipped)

User feedback after A1 deploy drove a tight iteration cycle. Every item below is implemented and pushed.

### 16.A Local-dev container ergonomics

- [x] 16.A.1 `docker-compose.yml` (root) defaults `ADMIN_TOKEN`, `AUTO_SOCIAL_SESSION_KEY`, `AUTO_SOCIAL_INSECURE_TLS`, `GEMINI_DEFAULT_MODEL=gemini-2.5-flash` so a single-user homelab container boots fully functional without users touching env vars. `deploy/docker-compose.yml` stays strict (real .env required). (2026-05-14: original spec said `gemini-2.0-flash` for its larger free tier, but 2.0-flash was deprecated by Google around the same time — calls return 404/429 with limit=0 — so commit `7f20fc5` 1.2.17 reverted to `gemini-2.5-flash` per `homelab-docs/skills/key-pool-standard/SKILL.md`. Real solution to the resulting 20 RPD ceiling is billing or multi-project keys, not model downgrade.)
- [x] 16.A.2 `AUTO_SOCIAL_INSECURE_TLS=1` propagated to in-container Playwright contexts (search + login) and to the desktop `npm run threads:login` script, so corporate-MITM TLS interception no longer blocks login pages.
- [x] 16.A.3 Embedded noVNC interactive-login UI removed; UI surfaces the two-step desktop flow (`npm run threads:login` then click "從 data/threads-storage-state.json 匯入"). New `POST /api/threads/session/import-from-file` reads the mounted JSON. Manual JSON paste stays as a `<details>` fallback. New `scripts/threads-dump-session.ts` re-reads the persistent profile and writes the file without re-running the polling loop, for cases where the auto-detect didn't trigger.
- [x] 16.A.4 Local docker `ADMIN_TOKEN` default removes the red `未設定 ADMIN_TOKEN` banner that fired because docker bridge IP is not 127.0.0.1; `isSingleUserMode()` now short-circuits `requireAdmin`.

### 16.B Threads search depth + locale + media

- [x] 16.B.1 Engagement parser extended from 2 fields to 4: 讚 / 留言 / 轉發 / 分享, via aria-label hints with a text-based fallback that handles "32讚", "讚32", and K/M/萬/千 unit suffixes. Engagement persisted as `{ likes, replies, reposts, shares }` JSON.
- [x] 16.B.2 Excerpt cleaner: leading `追蹤<username>` regex tightened from `\S+` (CJK-eating) to `[A-Za-z0-9_.]+`; trailing engagement-numeral chains (`1/2讚 N回覆 N轉發 N分享` + "讚 N", "N則讚" variants, split "分 享") aggressively stripped both at scrape time and at observe read time, so legacy rows show clean text without rescan.
- [x] 16.B.3 URL canonical: `/post/<id>/media`, `/post/<id>/likes`, `?...` all canonicalise to `/post/<id>`. Existing duplicates cleaned by ops query (9 rows dropped, 59 unique kept on dev container).
- [x] 16.B.4 Taiwan-first locale filter: drop posts dominated by English (asciiLetters > chineseChars × 2 and > 30), Japanese kana, or Korean hangul, regardless of query. 6 unit tests cover Chinese-dominant / English-dominant / Japanese / Korean / mixed cases.
- [x] 16.B.5 Image extraction: only `cdninstagram.com` / `fbcdn.net` sources, ≥ 120×120 rendered, alt not in 大頭貼 / profile picture / verified, not under a non-post `/@user` link. Up to 6 per post.
- [x] 16.B.6 Video extraction: `findVideos` walks `<video>` + nested `<source>` (or `currentSrc`), captures `poster`. Up to 4 per post. New `videos_json` column. UI renders a video thumbnail with `▶ 影片` overlay above the image grid; click opens original Threads.
- [x] 16.B.7 Keyword-card strict relevance filter: after locale filtering, Threads search results must still contain the requested keyword in title/excerpt (CJK substring or latin word-boundary match), preventing unrelated hot posts from entering observation cards like `Urus`.
- [x] 16.B.8 Observation read-time keyword filter: existing legacy rows that no longer satisfy the card keyword are hidden from the observation panel and aggregates, so old off-topic data does not linger after relevance-filter fixes.

### 16.C Independent scam dimension

- [x] 16.C.1 Add `ai/steps/scam-detect.ts` returning `{ scamSignal: 'none' | 'suspect' | 'likely', reasons: string[] }`. 6 detection signals: sexual-solicitation phrasing + price tags, DM-lure with LINE/WeChat/TG IDs, fake invest/dating (「報明牌」「保證獲利」「我月入 X 萬」), phishing short-links, scripted high-frequency reply patterns, urgency-plus-money (「最後機會」「先匯款」). Orthogonal to sentiment and to sponsored.
- [x] 16.C.2 `SocialPipeline.options.runScam` (default on for A1.5), `scam_json` column, observe surface, aggregate `scamRate`. UI: per-post pink/red `疑似詐騙 / 高機率詐騙` badge expanding to `scamReasons[]`; 風向卡 header shows 詐騙率.
- [x] 16.C.3 9-test `tests/scam-detect.test.ts` covers none / suspect / likely roundtrip, normalisation, length cap, markdown-fence, and the orthogonality prompt section.

### 16.D AI pipeline JSON robustness + voice cleanup

- [x] 16.D.1 Split system instruction: analysis steps (classify / sponsored / scam / score) get a `buildAnalysisSystemInstruction()` with strict "JSON only, no preamble, no markdown, no signature phrases" wording. Only `draft` + `meme` use the voice-flavoured instruction. This eliminated the bug where Gemini opened classify output with "先說結論，這則貼文..." (a voice signature phrase) and crashed JSON parsing.
- [x] 16.D.2 `parseJsonObject` fall-back: when the cleaned-fence parse fails, try extracting the last `{...}` block as a second attempt before raising.
- [x] 16.D.3 Draft prompt rewrite: zod `refine` rejects any variant containing emoji (broad emoji Unicode range), prompt bans 開頭話術 (「先說結論」「總而言之」「我覺得」「個人認為」「確實」「其實」「不得不說」「老實說」), bans hashtag / @-mention / link / AI 客氣話 ("希望對你有幫助" 等). Variants are 10–25 chars typically, capped at 35. The rigid 觀察家/自嘲/短梗 trio replaced by free-form angle ≤ 6 chars. Prompt seeds with Taiwan internet phrases (笑死 / 真假 / 蛤 / 蹲 / +1 / 推 / 等更 / 好慘 / 是說 / 啊就 / QQ / 我就問 / 不就 / 也太 / 無言 / 躺平 / 秒懂) for grounding.
- [x] 16.D.4 Local default `GEMINI_DEFAULT_MODEL` briefly switched to `gemini-2.0-flash` to dodge 2.5-flash's 20 RPD ceiling. Reverted by commit `7f20fc5` 1.2.17 because Google had already deprecated 2.0-flash (free tier limit=0, calls return 404/429). Per `homelab-docs/skills/key-pool-standard/SKILL.md` the project-wide default stays `gemini-2.5-flash`; the 20 RPD problem is solved by billing or multi-project keys, not by switching to a deprecated model.

### 16.E AI task queue + worker

- [x] 16.E.1 Add `ai_tasks` SQLite table (id / type / label / payload / status / priority / attempts / retry / result / error) + indexes.
- [x] 16.E.2 New `scheduler/task-queue.ts`: `enqueueTask` (with `dedupeKey` to suppress double-enqueue), `claimNextTask` (atomic transaction), `completeTask`, `failTask` (parses "retry in Ns" + 429 backoff to schedule `nextRetryAt`), `cancelTask`, `getQueueSnapshot`, `reclaimStaleTasks`.
- [x] 16.E.3 New `scheduler/worker.ts`: single-flight poll-and-execute loop (1.5s default), per-type handler registry, automatic retry with backoff, stale-task reclaim on boot. Single-flight avoids the prior "56 candidates × 4 calls" thundering-herd that previously exhausted free-tier RPD instantly.
- [x] 16.E.4 `schedulePipelineForCandidates` rewritten to enqueue `pipeline` tasks (one per candidate, dedupe key = `pipeline:<id>`). Worker drains the queue. Restart-safe because queue lives in SQLite.
- [x] 16.E.5 `GET /api/ai/status` returns countsByType + inflight + recent task rows.
- [x] 16.E.6 `AiQueuePanel` widget on Dashboard polls every 3s, shows排隊 / 跑 / 完成 / 失敗 per task type (`pipeline` 貼文判讀 / `compose_post` 發文發想 / `image_gen` 生圖), with a folded-up "最近 10 筆紀錄" details list.

### 16.F Observation UI polish

- [x] 16.F.1 4-tile engagement row (讚 / 留言 / 轉發 / 分享) replaces the old inline ♥/↩ badges; K/M abbreviations; em-dash placeholder for missing counts; colour tints (紅/藍/綠/黃).
- [x] 16.F.2 重點貼文 highlights split: top 3 by engagement (likes×1 + replies×3 + reposts×5 + shares×2) above the 50-point threshold, rendered in a separate signal-orange-bordered grid above the main feed. Main feed sorts newest-first by postedAt (falling back to fetchedAt).
- [x] 16.F.3 Delete keyword button (`✕`) on each watchlist card with confirm dialog; DELETE `/api/cards/:id` cascades into `trend_candidates`.
- [x] 16.F.4 Image + video media grid below excerpt; up to 6 images and 4 videos per post; videos overlay `▶ 影片` label.
- [x] 16.F.5 UI exclusivity: `pipeline_blocked` posts no longer show conflicting "情緒判讀中" + "AI 判讀失敗" badges simultaneously.
- [x] 16.F.6 Mobile overflow hardening: root/main clamp horizontal overflow, grid children set `min-w-0`, and hot-keyword cloud terms can break long words on small screens so iPhone Safari no longer gets horizontal run-off.

### 16.G Verification + ship

- [x] 16.G.1 74/74 server tests pass across 12 files including new scam-detect, taiwan-relevant filter, dedup, queue-related units.
- [x] 16.G.2 Versions bumped through 1.1.0 → 1.1.2 → 1.2.0 → 1.2.1 → 1.2.2 → 1.2.3 → 1.2.4 → 1.2.5 → 1.2.6 → 1.2.7 in lockstep across root + server + client `package.json`.
- [x] 16.G.3 Commits pushed to `main` (8 commits since A1 ship): scam + queue, scam UI badge, taiwan filter, video media, no-emoji drafts, canonical URL dedup, etc. Production auto-deploys via existing Tailscale workflow.
- [ ] 16.G.4 Live production observation pass with a billing-enabled Gemini key — pending user-side validation (free-tier keys exhausted; user has confirmed a billing key is on hand).

## 17. Phase A2a — Post Composer MVP (active)

### 17.A Queue-backed compose_post

- [x] 17.A.1 Add a queue-backed `compose_post` handler that reads recent real radar terms and trending candidate excerpts, asks Gemini for one original post draft + image prompt, and persists the result into `post_drafts`.
- [x] 17.A.2 Add `GET /api/post-drafts` and `POST /api/admin/post-drafts/run-now`; Dashboard can trigger one compose task and list recent generated drafts.
- [x] 17.A.3 Dashboard adds a `發文發想` panel with queue-aware status, copy button, and image prompt details. This slice remains human-gated and does not publish automatically.
- [x] 17.A.4 Add tests for compose prompt parsing and persistence path; ship through `typecheck → test → build → push → deploy`.

### 17.B Interim keyword auto scheduler

- [x] 17.B.1 Add a real server-started keyword auto scan scheduler with default cadence `*/15 * * * *` in `Asia/Taipei`, scanning all current keyword cards via existing Threads search flow.
- [x] 17.B.2 Add no-overlap guard and scheduler runtime status (`running`, `lastStartedAt`, `lastCompletedAt`, `lastInsertedCount`, `lastCardCount`, `lastStatus`, `lastError`) exposed via `GET /api/scheduler/status`.
- [x] 17.B.3 Dashboard adds a `關鍵字自動海巡` panel so the operator can see cadence and latest keyword-scan result without opening logs.

### 17.C Keyword observation freshness + suggestions

- [x] 17.C.1 Filter Threads search results and observation readback to hide known posts whose `published_at` is more than one year old, so stale high-engagement posts do not outrank current conversation.
- [x] 17.C.2 Add `suggestedKeywords` to the keyword observation response, extracted from current on-topic samples and excluding the active keyword / UI stop words.
- [x] 17.C.3 Dashboard renders suggested keyword chips as an operator-gated action: clicking a chip adds/selects that keyword card and triggers a scan; the system never auto-expands watchlist terms without a user click.
- [x] 17.C.4 Tighten mixed-language suggestion extraction so long CJK+Latin strings are not truncated into bad chips like half of a car model name.

### 17.D Scan feedback + quota fallback

- [x] 17.D.1 Treat direct Threads search quota exhaustion as recoverable for keyword-card scans and radar scans: fall back to Google `site:threads.net OR site:threads.com` discovery instead of returning only the quota error.
- [x] 17.D.2 Preserve kill-switch semantics: kill switch errors still stop all Threads-targeted discovery and must not fall back to Google.
- [x] 17.D.3 Add immediate Dashboard feedback for manual keyword scans: show an in-flight message, change the button to `海巡中...`, disable scan/suggestion/radar-term actions, and use a synchronous click lock to prevent mobile double-taps before React re-renders.

### 17.E Fallback search reliability

- [x] 17.E.1 Multi-provider fallback in `sources/threads-fallback-search.ts`: Google → Bing. Bing kicks in when Google returns no extractable Threads URLs, when the page is a `/sorry/` / `httpservice/retry/enablejs` retry-page, when status is 429/5xx, or when fetch throws. `scanKeywordCard` also gained the missing fallback wiring that was promised in 17.D.1 but not actually implemented (previously the keyword-scan test was failing).
- [x] 17.E.2 `KeywordScanRun.outcomeKind` ∈ {`playwright_ok`, `fallback_ok`, `no_matching_threads_results`, `search_provider_blocked`} surfaces through `/api/cards/:cardId/scan-threads` and the SSE `done` event. `providerUsed` and `blockedProviders[]` are included for diagnostics. Run message distinguishes "備援搜尋（Google、Bing）被阻擋" from "備援搜尋未找到 ...".
- [x] 17.E.3 `tests/threads-fallback-search.test.ts` (18 cases) covers Google `/sorry/` / `httpservice/retry/enablejs` / unusual-traffic detection, Bing CAPTCHA + ck/captcha URL detection, provider ordering (Google preferred, Bing fallback), 429/5xx + fetch-throw handling, limit honouring, dedup. `tests/keyword-scan.test.ts` extended (5 cases) for outcome-kind branching including kill-switch still blocking fallback.
