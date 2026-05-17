# Operations

## Production

- Domain: `https://social.sisihome.org`
- Health check: `https://social.sisihome.org/api/health`
- Current expected API version after the latest deployment: `1.2.62`

## Threads Login

Use the desktop helper instead of mobile noVNC for normal operation:

```bash
npm run threads:login
```

Complete Instagram / Threads login and any human verification in the opened Chromium window. The helper only saves after it reaches a non-login `threads.com` / `threads.net` page.

The helper writes:

```text
data/threads-storage-state.json
```

Import it from `https://social.sisihome.org/#settings/threads` and press `加密保存 Session`. Production stores the payload encrypted with `AUTO_SOCIAL_SESSION_KEY`.

## Session Recovery

If `GET /api/threads/session/status` reports `hasSession:false`, `healthy:false`, or a login-required `healthNote`, rerun `npm run threads:login` and import the new JSON.

Do not treat a raw Instagram cookie as enough. The saved session must have reached Threads after login / captcha verification.

## Manual Radar Scan

Trigger a production scan from Settings / admin UI, or call:

```bash
curl -X POST https://social.sisihome.org/api/admin/scan/run-now
```

Then inspect:

```bash
curl https://social.sisihome.org/api/radar/trends
```

Expected healthy shape: `source:"threads_search"`, `sampledCandidates > 0`, and no canned/filler terms. The Radar UI is intentionally labeled as a sample radar, not an official Threads trending chart. When monitored cards exist, scans use those keywords and trend reads ignore stale broad-query rows without a card association. Seed keywords and their CJK segmentation fragments are excluded from the cloud; term scores should represent engagement-weighted related terms discovered inside sampled posts.

## Keyword Auto Scan

Current production wakes keyword-card auto scan every 15 minutes in `Asia/Taipei` with cron `*/15 * * * *`. It is quota-aware: by default each tick scans at most 2 eligible keyword cards, and a card is eligible only if it has never been scanned or its last completed scan is at least 120 minutes old.

Runtime knobs:

- `AUTO_SOCIAL_KEYWORD_SCAN_MAX_PER_TICK` default `2`
- `AUTO_SOCIAL_KEYWORD_SCAN_MIN_INTERVAL_MINUTES` default `120`

Check runtime status:

```bash
curl https://social.sisihome.org/api/scheduler/status
```

Key fields:

- `running`
- `lastStartedAt`
- `lastCompletedAt`
- `lastCardCount`
- `lastEligibleCount`
- `lastInsertedCount`
- `lastQuotaRemaining`
- `lastScannedKeywords`
- `lastStatus`
- `lastError`

## Keyword Observation Freshness

Observation cards hide known Threads posts older than one year from `published_at`. The same filter is applied during Playwright search before new candidates are accepted. Suggested keywords are operator-gated: the UI only adds a suggested term to monitoring after the user clicks its chip.

## Per-Post AI Retry

Observation posts with `pipeline_status = pipeline_blocked` show a `重跑這則` button. It calls `POST /api/keywords/:cardId/candidates/:candidateId/repipeline`, resets only that candidate to `pending`, clears the pipeline error, and enqueues a single pipeline task.

## Observation Image Recognition

Pipeline runs analyze up to the first 3 image URLs from `trend_candidates.images_json` before text AI steps. Results are stored in `trend_candidates.image_analysis_json` with status `none`, `success`, `partial`, or `failed`.

Operational notes:

- Successful or partial summaries are added to downstream classify, sponsored/scam detection, score, and draft prompts as `visualSummary`.
- Image recognition failures are non-blocking; the text pipeline continues and the UI shows the image-analysis error separately from `pipeline_status`.
- Fetch guards reject non-image responses, images over 6 MB, and slow image downloads.
- `GEMINI_VISION_MODEL` can override the model; otherwise it follows the default Gemini model setting.

## Confirmed Threads Replies

Threads reply automation is disabled by default. Set `AUTO_SOCIAL_THREADS_REPLY_ENABLED=1` only when the account-risk tradeoff is acceptable, then import a Threads session and keep kill switch/quota controls conservative.

Observation posts with an AI draft show `用 Threads session 留言`. This is intentionally per-post only: the operator must review the target URL, author, bound Threads handle, and editable reply text, then click `確認送出留言` for each attempt.

Runtime behavior:

- `POST /api/keywords/:cardId/candidates/:candidateId/replies` requires `{ text, confirm: true }` and creates one `reply_attempts` row plus one `threads_reply` queue task.
- The API rejects missing/unhealthy session, missing bound handle, non-Threads URLs, duplicate successful replies, kill switch, and exhausted `reply` quota before enqueueing.
- The worker calls `gate('reply')` immediately before opening Playwright, so kill switch and reply quota are rechecked at write time.
- UI status maps to persisted attempt status: `pending`/`running` → `留言中`, `succeeded` → `留言成功`, `failed` → `留言失敗`, `uncertain` → `可能已送出但無法確認`.
- `留言成功` requires a verified reply URL or a DOM match containing the bound handle and exact reply text. If submit may have happened but verification fails, the attempt remains `uncertain` and should be manually reviewed on Threads.
- Failed/uncertain browser attempts try to save a diagnostic screenshot under `data/threads-reply-screenshots/`.

## Keyword Quality

The add-keyword form gives immediate quality hints for broad terms, UI-noise terms such as `轉發分享`, very short inputs, hashtag piles, and sentence-like inputs. The UI suggests replacement chips but does not block the operator; poor keywords change the submit label to `仍然加入`.

## Search Fallback

Keyword scans use Bing-first / Google-second `site:threads.net OR site:threads.com` discovery only. They do not use a logged-in Threads session and do not open Threads with Playwright.

## Transient 502s

The single-container homelab deployment can briefly return `502` while Docker recreates the service during CI/CD deploys. The frontend maps `502`/`503`/`504` API responses to a short retry message instead of showing a raw proxy or HTML error.

Known limitation: search providers can return challenge pages to server-side fetches. The fallback layer detects Google retry pages and Bing CAPTCHA / Cloudflare Turnstile challenges separately from true no-result pages, so empty scans should be read as either `search_provider_blocked` or `no_matching_threads_results` rather than a generic success.

## Threads Quota

Settings → Threads shows today's `search`, `publish`, and `reply` counts and daily limits. The default Playwright search limit is `2000` per day and reply limit is `10` per day. Use `儲存上限` to raise or lower limits, and `清除今天 search 用量` to delete only today's `search` counter.

## Version Rule

Every committed code/spec/docs change for this project must bump the root and workspace package versions in the same batch unless the user explicitly says not to.
