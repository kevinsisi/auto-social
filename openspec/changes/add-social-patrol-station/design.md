## Architecture Overview

```
┌─────────────────── packages/server ────────────────────┐
│                                                         │
│  scheduler/  ──→  for each enabled source:              │
│  (node-cron)        sources/{dcard,threads,...}.ts      │
│  every 15min       ↓                                    │
│                   trend_candidates (dedupe by sha)      │
│                    ↓                                    │
│                   ai/pipeline.ts (StepRunner)           │
│                   ├─ classify (ai-core GeminiClient)    │
│                   ├─ score  ──→ drop if not worth       │
│                   ├─ draft  (3 angle variants)          │
│                   └─ meme   (image-card prompt)         │
│                    ↓                                    │
│                   drafts (pending)                      │
│                                                         │
│  API: /api/* (Express)                                  │
│  ├─ voice/        profile CRUD + feedback               │
│  ├─ drafts/       list, edit, approve, publish, cancel  │
│  ├─ threads/      session login, kill-switch, quotas    │
│  ├─ sources/      enable/disable, keywords              │
│  └─ admin/        key-manager sync, scan triggers       │
│                                                         │
│  threads-bot/  Playwright worker                        │
│  ├─ session.ts        storageState mgmt (encrypted)     │
│  ├─ search.ts         keyword search read               │
│  ├─ publish.ts        compose + send                    │
│  ├─ reply.ts          reply to post                     │
│  └─ throttle.ts       jitter + daily quota gate         │
│                                                         │
│  key-pool/  ai-core SqliteAdapter + key-manager sync    │
│                                                         │
└──────────────────────── SQLite ────────────────────────┘

┌─────────────────── packages/client ────────────────────┐
│                                                         │
│  Dashboard          熱度排序 / 篩選 / 跳轉到 Draft       │
│  Voice Studio       軸 + 禁區 + 欣賞帳號 + feedback     │
│  Draft Inbox        審稿、編輯、送出（人手點）          │
│  Sources & Cards    管理關鍵字卡與 source on/off        │
│  Killswitch         全停 Playwright                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### D1. Playwright session, not API

**Decision**: Use Playwright with the user's logged-in Threads session (`storageState`) for both read (search) and write (publish, reply).

**Why**: User has explicitly declined Meta App Review. Without an official API, the only viable read+write path is browser automation with the user's own session. The user explicitly accepted ToS and account-suspension risk.

**Alternatives rejected**:
- Meta `keyword_search` API: rejected — user won't go through App Review.
- Apify / Bright Data: rejected — recurring cost, still violates ToS, requires external account.
- Web scraping without login: rejected — Threads requires login for meaningful search depth.

**Risk mitigations**:
- All writes are human-gated (UI button per draft); no schedule-triggered publish.
- Per-action jitter (5–30s random delay before each Playwright action).
- Daily quota caps (defaults: 3 publish, 10 reply, 20 keyword searches × 4 scans/hour); over cap → operation rejected.
- `playwright-extra` + stealth plugin to reduce fingerprint anomalies.
- Single global kill switch in UI; pressing it drains the Playwright worker and refuses all further writes until cleared.

### D2. ai-core micro-step pipeline

**Decision**: Run AI per candidate as a 4-step `StepRunner` (`classify` → `score` → `draft` → `meme`), with `planPreferredKeys` distributing steps across different keys when pool is healthy.

**Why**:
- ai-core already provides `KeyPool`, `GeminiClient`, `StepRunner`, `withRetry`, and key-manager sync — re-implementing locally would duplicate well-tested infrastructure.
- Micro-steps mean each call is small, cheap, observable, and individually retriable.

**⚠️ Gemini 免費配額限制（2026-05 實測確認）**:
- `gemini-2.5-flash` free tier = **20 RPD per Google Cloud project**（非 per-key）
- `gemini-2.0-flash` 已被 Google 棄用（free tier limit=0，呼叫返 404/429）
- 若 16 把 keys 來自同一 GCP project → 共享 20 RPD，掃一輪就會耗盡
- **真正解法**：啟用 billing（移除 RPD 限制）或使用不同 GCP project 的 keys
- 配額重置時間：UTC 00:00（台灣 08:00）
- 診斷：inflight task error 含 `quota exceeded, limit: 20` → 當日配額耗盡；`pipeline_blocked: no available Gemini key` → 所有 key 在 cooldown 因 429
- `planPreferredKeys` avoids hammering one key when 4 calls fire in quick succession per candidate.
- `score` step can short-circuit: candidates that fail the worth-replying bar do not consume `draft` or `meme` calls.

**Step contract** (all `allowSharedFallback: true` so the system degrades gracefully when only one key is healthy; `score`-and-onward also tolerate shared key reuse):
- `classify`: input candidate text → output `{ topic, sensitivity (low/med/high), voiceFit (0..1), reason }`. Skipped if `sensitivity=high` AND topic ∈ voice no-go list.
- `score`: input candidate + classify → output `{ engagementWorth (0..1), risk (low/med/high), timeliness (cold/warm/hot), shouldDraft: boolean, reason }`. If `shouldDraft=false`, candidate is stored with status `dropped` and remaining steps are skipped.
- `draft`: input candidate + classify + score + voice profile → output `{ variants: [{ angle, text, length }, ×3] }`. Three angles: 觀察家、自嘲、短梗 (configurable per voice profile).
- `meme`: input candidate + draft → output `{ memePrompt: string, sceneIdea: string }`. Text-only; no image generation in Phase 0.

**Failure semantics**: any step throwing `NoAvailableKeyError` marks the candidate `pipeline_blocked`. The scheduler retries blocked candidates on the next scan cycle, not in-loop, to avoid burning the pool further when it is exhausted.

### D3. Voice profile injection

**Decision**: Voice profile is a structured JSON record stored in `voice_profile`. The AI prompt builder reads the active profile on every call and injects it as `systemInstruction` (Gemini) plus a `## Voice Anchors` block in the prompt.

**Structure**:
```json
{
  "axes": {
    "sarcasm": 0.6,         // 0=暖、1=機掰
    "stance": 0.4,          // 0=觀察家、1=評論家
    "length": 0.3,          // 0=短梗、1=長文
    "emojiDensity": 0.2     // 0=無、1=很多
  },
  "noGoZones": ["politics", "religion", "personal-attack"],
  "admiredAccounts": [
    { "handle": "@xxx", "description": "冷不防一句的觀察家", "samplePost": "..." }
  ],
  "selfDescriptors": ["冷靜不冷漠", "直接不刻薄"],
  "signaturePhrases": ["先說結論", "我覺得齁"],
  "language": "zh-TW",
  "lastUpdatedAt": "..."
}
```

**Feedback loop**: every draft variant a user accepts/rejects writes a `voice_feedback` row with `{ draftId, variantIdx, decision, comment? }`. A nightly job (Phase 1) aggregates recent feedback into an "evolution hint" appended to the voice prompt; in Phase 0 the feedback is stored but not yet used to evolve the profile (manual review only).

### D4. Sources are a pluggable adapter interface

**Decision**: All sources implement:

```ts
interface SourceAdapter {
  id: string                                // 'dcard' | 'threads' | ...
  isEnabled(): Promise<boolean>
  fetch(input: { keywords: string[]; sinceIso: string }):
      Promise<SourceCandidate[]>
}

interface SourceCandidate {
  source: string
  externalId: string                 // dedupe key inside source
  url: string
  author?: string
  title?: string
  text: string
  publishedAt: string
  engagement?: { likes?: number; replies?: number; shares?: number }
  raw?: unknown                      // source-specific payload for debugging
}
```

`trend_candidates.fingerprint = sha256(source + ':' + externalId)` enforces global dedupe.

**Phase 0 adapters**:
- `dcard`: `GET https://www.dcard.tw/service/api/v2/forums/all/posts?popular=true&limit=30` (no auth, public). Filtered by keyword match in `title`/`excerpt`/`tags`. Tolerates 429 with exponential backoff.
- `threads`: delegates to `threads-bot/search.ts`. Subject to daily search quota cap. On Playwright failure (login expired, layout changed, blocked) → marks source unhealthy for current scan, does not invent results.

### D5. Threads session storage

**Decision**: Store `storageState` JSON encrypted at rest using AES-256-GCM with a key derived from `AUTO_SOCIAL_SESSION_KEY` env var (PBKDF2, 100k iterations, salt stored alongside ciphertext). If env var is missing on startup, the server logs a warning and refuses to load any previous session.

**Why**: SQLite is mounted on a Docker volume; user does not want plaintext IG cookies sitting on disk. Symmetric encryption with an env-supplied key is sufficient because the threat model is "host disk leaked", not "process compromised".

**Login flow**:
1. User clicks `設定 Threads Session` in Voice Studio / Settings.
2. Server starts Playwright headful in a worker, returns a streaming URL (websocket) the UI iframes / opens in a popup.
3. User logs in normally (incl. IG OAuth + 2FA).
4. Server detects post-login redirect, calls `context.storageState()`, encrypts, stores.
5. Records `threads_session.last_login_at` and `threads_session.healthy = true`.

**Health checks**: every Playwright operation captures whether the session still appears logged in (looks for header avatar element). If not, sets `healthy = false` and surfaces a banner in UI saying "Threads session 過期，請重新登入". No automated re-login.

### D6. Throttle and kill switch

**Decision**: All Playwright operations go through `threads-bot/throttle.ts`:

```ts
async function gate(op: 'search' | 'publish' | 'reply'): Promise<void>
```

`gate` does, in order:
1. Check `killSwitch.isEnabled()` → throw `KillSwitchActiveError` if engaged.
2. Check daily quota for `op`; throw `DailyQuotaExceededError` if over.
3. Sleep `random(5_000..30_000)` ms (configurable jitter window).
4. Increment quota counter atomically (SQLite transaction).

Daily quotas reset at local midnight (Asia/Taipei). Quota window and limits live in `settings` table so they can be tuned without redeploy.

**Kill switch state** is a single row in `settings`; flipping it sets a process-level flag plus persists. The Playwright worker checks the flag before every action and aborts mid-queue.

### D7. Why retain old tables

**Decision**: Keep `patrol_cards`, `patrol_runs`, `candidates`, `analyses`, `reply_suggestions` from the prior MVP. New scan pipeline writes into `trend_candidates` (new) and `drafts` (new) tables; on import, candidates are also reflected into the legacy `candidates` table linked to a card so the prior detail view still works.

**Why**: Avoids a destructive migration during a rebrand. Legacy data is not large. Phase 1 can deprecate the old tables once the new UI is the daily driver. The `keyword-patrol-cards` capability remains the entry point for managing which keywords drive scans.

### D8. Docker base image change

**Decision**: Switch from `node:22-bookworm-slim` to `mcr.microsoft.com/playwright:v1.50.0-jammy` (or current LTS Playwright tag) in the runtime stage.

**Why**: `playwright` package pulls chromium at install; doing this at runtime adds startup latency and requires writable filesystem. Microsoft's image already has chromium + deps. Build stage still uses `node:22-bookworm-slim` for `npm install` and TS build; only the runtime stage changes.

### D9. Naming inside the codebase

- The product display name **`社群海巡工作站`** is the only user-facing brand string.
- Internal module names use English (`threads-bot`, `voice-studio`, `trend-sources`) to keep `tsc` paths readable.
- The legacy `遇見好車` strings are deleted, not renamed. No comment trail.

### D10. Phase 0 is read-only on Threads

**Decision**: Phase 0 ships Playwright `search(keyword)` and `fetchTrending()` only. `publish` and `reply` endpoints exist and return `501 Not Implemented`. Draft Inbox uses a manual `定稿 + 複製文字 + 開 Threads + 貼回 URL 標記已發` flow.

**Why**:
- Cuts the highest-risk surface (account ban via automated writes) out of the first release.
- Keeps Phase 0 task count manageable (estimate drops from ~70 to ~55 tasks).
- Lets the user validate trending discovery + voice quality before committing to write automation.
- The hard work (session login, throttle, kill-switch, quota schema) is still done in Phase 0 so Phase 1 just turns on the write endpoints.

**Implication**: Phase 0 `daily_quotas` already records `publish` / `reply` counters and limits but they only become active in Phase 1. The kill switch is wired and visible from Phase 0 so the UX is consistent.

### D11. Trending fetch is a separate adapter mode

**Decision**: Each `SourceAdapter` exposes two methods: `fetchTrending({ limit, sinceIso })` for keyword-less hot posts, and `fetch({ keywords, sinceIso })` for keyword-filtered results. Both write to the same `trend_candidates` table; `is_trending` boolean column marks trending-path candidates.

**Why**:
- Answers the explicit product need: "我要知道現在的熱門話題是啥" — without forcing the user to pre-define keywords.
- Reuses the same AI pipeline, dedupe, and UI surfaces.
- Adapters that have no real "trending" concept (e.g. a future Google News RSS) can return `[]` from `fetchTrending` without breaking the contract.

### D12. Session key origin and lifecycle

**Decision**: `AUTO_SOCIAL_SESSION_KEY` is a 64-char hex string generated once per installation via `openssl rand -hex 32`, stored in a local `.env` file alongside `docker-compose.yml`, and injected into the container via compose `env_file:` directive. The key is **not** sourced from key-manager (different concern: key-manager handles AI API keys with rotation; the session key is a single long-lived secret for symmetric encryption of `storageState`).

**Rotation rule**: rotating `AUTO_SOCIAL_SESSION_KEY` invalidates the stored session and requires re-login. The decryption-failure path in D5 covers this without data loss (the corrupted row is kept for audit; the operator simply logs in again).

**Compose snippet**:

```yaml
services:
  auto-social:
    env_file:
      - .env             # contains AUTO_SOCIAL_SESSION_KEY
    environment:
      KEY_MANAGER_URL: https://key.sisihome.org
      GEMINI_DEFAULT_MODEL: gemini-2.5-flash
```

`.env.example` (committed) contains a placeholder and a `# generate with: openssl rand -hex 32` comment; `.env` (gitignored) holds the real value.

### D13. Sub-account first-bind UX

**Decision**: The very first interactive login flow is blocked by a checkbox acknowledgement `我確認登入的是副帳號，主帳號 ban 風險自負`. Subsequent re-logins (when a session already existed) show the warning as a non-blocking reminder plus the bound handle parsed from `storageState` so the user can verify they have not slipped into the main account.

**Why**: a single typo in the IG login screen could bind the wrong account; once `storageState` is captured we cannot easily verify "is this the test account or the main account" without a network call. Surfacing the handle on re-login is the cheap retrospective check.

### D14. Settings page tab layout

**Decision**: Settings is a single page at `/settings` with hash-routed tabs. Phase 0 ships these tabs:

| Tab | Hash | Purpose |
|-----|------|---------|
| 配額 / 排程 | `#quotas` | daily publish/reply caps (inert in Phase 0), per-scan search cap, scan cadence cron, jitter window |
| Key Pool | `#key-pool` | batch-import Gemini keys (textarea, `#` comment lines tolerated), key-manager URL + sync button, per-key health table |
| Threads Session | `#threads-session` | 副帳號 warning, current session health, bound handle, login / clear buttons |
| Sources | `#sources` | per-source enable + trending limit |
| Voice | `#voice` | link out to Voice Studio (Voice Studio stays a dedicated page) |
| About | `#about` | app version, configured `KEY_MANAGER_URL` host, model, `AUTO_SOCIAL_SESSION_KEY` presence boolean, link to risk doc |

**Why a single page with hash tabs** (vs separate routes): a settings rarely-visited area benefits from deep links (`/settings#key-pool`) without proliferating routes; hash-based tabs are zero-state and refresh-safe.

## Open Questions (to revisit if Phase 0 review finds issues)

1. **Threads search depth**: how many posts to read per keyword per scan? Defaulting to "first viewport + 1 scroll" (~20 posts) to keep operation time under ~30s. May need to be tuned based on early scan results.
2. **Voice variant count**: 3 angles per draft is a reasonable starting point; user may want more or fewer once they see the inbox in practice.
3. **Feedback signal strength**: Phase 0 stores `voice_feedback` but does not feed it back into the prompt automatically. We will need to design that feedback aggregator in Phase 1; the data is captured now so we don't lose history.
4. **Engagement scoring across sources**: Dcard's `likeCount` and Threads' visible engagement use different scales. Phase 0 normalizes via per-source rank percentile rather than absolute numbers; if this turns out to bias toward one source, we may need explicit weights.
