## Why

The first MVP (`add-keyword-patrol-cards`) was a manual Threads patrol Copilot for the `遇見好車` brand: user pastes links, a rule-based humor engine drafts replies, user sends them by hand. The product direction has now changed:

- The owner is building a **personal-brand social-media-editor persona on Threads** (not a car-group brand).
- They want the system to **discover trending topics by itself** every 15–30 minutes across Taiwan-relevant sources.
- They want **AI drafts in their own voice**, learned from zero (no historical posts) via a voice studio and ongoing feedback.
- They want the system to **operate Threads using their own logged-in session via Playwright** — no Meta App, no App Review, and explicit acceptance of Threads ToS and account-suspension risk.
- They want the system to use **`@kevinsisi/ai-core`** for all Gemini calls so key rotation, retries, micro-step key planning, and key-manager integration are not re-implemented locally.
- Final publishing must remain **human-gated**: AI prepares drafts, the user clicks a button to send each one via Playwright.

The retained product identity is the existing "海巡" UI vocabulary (海巡卡、KEYWORD CARD, 「靠，海巡隊剛穿鞋」 etc.). Only the `遇見好車` brand strings are removed; the playful self-deprecating editor persona is replaced by the user's own voice profile.

The new product name is **社群海巡工作站** (Social Patrol Station).

## What Changes

### Renamed / rebranded

- App display name changes from `遇見好車海巡台` to `社群海巡工作站`.
- All `遇見好車`-specific copy is removed from UI and from server-generated draft text.
- The "海巡" / KEYWORD CARD / patrol-run / draft-status vocabulary is preserved.

### New behavior

- **Voice Studio**: a one-time questionnaire captures the user's voice axes (sarcastic ↔ wholesome, observer ↔ commentator, short-jab ↔ long-form, emoji density), no-go zones, 3–5 admired editor accounts as style anchors, signature phrases. All future AI prompts inject this profile. (Per-variant `這版最像我` / `都不像` feedback **schema is created in Phase 0 but write paths are Phase 1**, to keep Phase 0 scope tight.)
- **Trend Sources**: a pluggable adapter layer scans external sources every 15 minutes. Phase 0 ships **Dcard** (free public API) and **Threads** (via Playwright with the user's session). Each adapter runs in **two modes** per tick: `fetchTrending()` (keyword-less "what's hot right now") and `fetch({ keywords })` (filtered to the user's keyword cards). PTT, YouTube Trending, Google Trends, Google News are deferred to Phase 1.
- **Trending Topics**: the Dashboard has two tabs — `全網熱門` (results of `fetchTrending` across all enabled sources) and `我的關鍵字` (keyword-card filtered). Both flow into the same `trend_candidates` + AI pipeline; the user can see what's hot without first setting up keywords.
- **Scan Scheduler**: a node-cron job triggers a full scan every 15 minutes (configurable). One scan = trending fetch + keyword fetch from every enabled source → dedupe → enqueue new candidates → run the AI pipeline on each.
- **AI Pipeline (via ai-core)**: each candidate runs a 4-step `StepRunner` pipeline — `classify` (topic, sensitivity, voice fit) → `score` (engagement worth + risk + timeliness; short-circuit if not worth drafting) → `draft` (3 angle variants in the user's voice) → `meme` (image-card prompt). `planPreferredKeys` distributes the 4 steps across different keys; `allowSharedFallback` is set per step so behavior is predictable when the pool is small.
- **Key Pool Integration**: `ai-core`'s `SqliteAdapter` is the key store. Two ways to load keys: (a) Settings → Key Pool tab batch-import (paste multiple keys at once, `#` comment lines tolerated), or (b) auto-sync from key-manager via `GET /api/keys/export?trusted_only=1` (URL configurable in Settings). After every Gemini call the system reports key state back to key-manager.
- **Threads Automation (Phase 0 = read-only)**: a Playwright module manages a single persisted Threads session. In Phase 0 it exposes `search(keyword)` and `fetchTrending()` only; `publish` and `reply` endpoints exist but return `501 Not Implemented`. **All Threads writes are deferred to Phase 1.** A daily quota cap (search active; publish/reply inert until Phase 1) and a `kill-switch` button are present from Phase 0.
- **Sub-account first-bind policy**: the interactive login flow shows a blocking warning `首次登入前請務必使用副帳號 — 主帳號被 ban 不可逆` and requires explicit acknowledgement before storing `storageState`.
- **Draft Inbox (Phase 0 = manual copy-paste publish)**: a new UI surface lists AI-prepared drafts sorted by score. Each row shows 3 angle variants; user picks one, edits, clicks `定稿`, then uses `複製文字` to copy and post manually to Threads, and pastes the resulting URL back. Status updates: `pending` → `approved` → `posted_manually`. Phase 1 will add automated `送出`.
- **Settings page**: a new tabbed Settings page covers `配額`, `Key Pool` (with batch import), `Threads Session`, `Sources`, `Voice` (link out), `About` (version + non-secret env).

### Phase A1 — Observation-first refocus (2026-05-13)

After Phase 0 Batch 2 production landed, the product direction sharpened to **observation first, writing second**. The user wants to click a keyword and immediately see the social-listening picture for that keyword on Threads:

- **Per-keyword 風向卡** at the top of the keyword detail view: a 7-class sentiment distribution (`anger` / `complaint` / `help` / `sarcasm` / `neutral` / `positive` / `support`) over recent samples, plus a 葉配 (sponsored-content) rate.
- **Per-post sentiment tag + 葉配 badge**: every Threads candidate carries a single sentiment label and an independent sponsored-signal dimension (`none` / `suspect` / `likely`) with human-readable `sponsored_reasons[]` so the user can see *why* a post was judged as 葉配.
- **AI suggestion draft on every post, from day one**: training starts immediately. Each candidate gets one draft variant using the default voice profile; the UI exposes `👍 像我` / `👎 不像` / `✏️ 改寫` buttons that write `voice_feedback` rows. The full Voice Studio page is deferred to Phase A2+, but the feedback loop is collecting data from A1.
- **Comments come in A2**: per-post reply parsing via a new `threads-bot/post-detail.ts` Playwright step, with replies also classified for sentiment so they contribute to the per-keyword 風向 aggregate.

The 4-step pipeline (`classify` → `score` → `draft` → `meme`) becomes a 5-step pipeline by adding `sponsored-detect` as an independent dimension between `classify` and `score`. `meme` stays Phase B.

This refocus does **not** invalidate any existing Phase 0 task; it adds Section 15 to `tasks.md` covering the A1 observation slice and deprioritises Voice Studio (Section 6), Draft Inbox (Section 10), and full Dashboard tabs (Section 11.1 ff.) to A2+.

### Removed / deprecated from prior MVP

- Server-side `humor.ts` rule-based humor engine is replaced by `ai-core` + voice profile.
- The legacy `browser-run` action that only opens Threads search in a new tab is replaced by automated Threads search.
- The `遇見好車`-specific draft tones (`普通`, `比較酸`) are replaced by user-defined voice variants.

## Capabilities

### Modified Capabilities

- **`keyword-patrol-cards`**: cards now drive automated scans against multiple sources; the "browser-assisted Threads patrol" requirement is replaced by automated `trend-sources` scans. Manual link import remains as fallback.
- **`ai-reply-suggestions`**: rebuilt on `@kevinsisi/ai-core` `StepRunner`; the `遇見好車` voice calibration is replaced by the user's voice profile; the 4-step micro-pipeline becomes the spec.

### New Capabilities

- **`voice-studio`**: voice profile capture and edit. Feedback writes are Phase 1; schema only in Phase 0.
- **`trend-sources`**: pluggable source adapters with both trending (keyword-less) and keyword modes; Phase 0 implements Dcard and Threads.
- **`trending-topics`**: keyword-less "what's hot right now" Dashboard tab fed by every adapter's `fetchTrending` mode.
- **`threads-automation`**: Playwright-backed Threads session management. Phase 0 = read-only (search + trending). Phase 1 = publish + reply with full safety throttles.
- **`scan-scheduler`**: 15-minute scan orchestration, dedupe, and pipeline enqueue.
- **`draft-inbox`**: AI-prepared draft review surface. Phase 0 = copy-and-mark-sent manual flow. Phase 1 = automated `送出`.
- **`settings`**: tabbed settings page (`#quotas`, `#key-pool`, `#threads-session`, `#sources`, `#voice`, `#about`); Key Pool tab supports batch import of Gemini keys.
- **`app-version`**: UI shows the current app version on every page; every code- or behavior-changing modification bumps the version (`package.json` × 3 + `APP_VERSION` constants) consistently.

## Impact

- **Backend**:
  - Add `@kevinsisi/ai-core` and `playwright` dependencies.
  - Add `sources/`, `ai/` (pipeline + voice prompt builder), `threads-bot/` (Playwright), `scheduler/`, `voice/`, `key-pool/` modules.
  - Remove or deprecate `humor.ts`.
  - New tables: `voice_profile`, `voice_feedback`, `trend_candidates`, `drafts`, `threads_session`, `daily_quotas`. Existing tables (`patrol_cards`, `patrol_runs`, `candidates`, `analyses`, `reply_suggestions`) are kept; `candidates` is back-filled by the scheduler so the old per-card view still works.
  - Add `api_keys` table compatible with `ai-core` `SqliteAdapter`.
- **Frontend**:
  - Rename header and document title.
  - Remove all `遇見好車` strings.
  - Add 3 main views: Dashboard, Voice Studio, Draft Inbox. Existing patrol-card view becomes a secondary "keyword sources" management page within Dashboard.
  - Add prominent kill-switch button.
- **Risk acceptance**:
  - The user explicitly accepts that Playwright-based Threads automation violates Meta ToS and that account suspension is possible; the project takes mitigations (jitter, daily caps, half-auto publishing, kill switch) but cannot eliminate the risk.
  - No password is stored. Only `storageState` (cookies + IG session token) is persisted, encrypted at rest by a key from `AUTO_SOCIAL_SESSION_KEY` env.
- **Operations**:
  - Server image grows by ~400MB (chromium); base image switches to `mcr.microsoft.com/playwright:v1.50-jammy` or equivalent.
  - First-time login requires the user to attach to a Playwright headful window served via the local UI; this is a manual one-time step per session refresh.
- **AI key cost**:
  - Estimated per-scan cost: ~70 Gemini calls (50 classify + 10 score + 5 draft + 5 meme). 15-minute cadence = 4×/hour × 24 = 96 scans/day = ~6,720 calls/day. Within free-tier quota with a healthy 3+ key pool.

## Non-goals (Phase 0)

- **No Playwright publish or reply at all** — Phase 0 is fully read-only on Threads. The `送出` button is replaced by `定稿 + 複製文字 + 開 Threads` manual flow. Automated publish lands in Phase 1.
- No reply-monitoring on the user's own posts. That is Phase 1.
- No automatic voice-profile evolution from feedback writes; the feedback table exists but writes wait until Phase 1.
- No Meta App Review, no official Threads API, no Instagram Graph API integration.
- No image generation; only text prompts for memes/cards.
- No multi-user / multi-tenant support; this is a single-operator tool.
- No PTT / YouTube / Google Trends / Google News adapters; those land in Phase 1.
- No A/B testing of draft variants or post-publish engagement analytics; Phase 2 at earliest.
