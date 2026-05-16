# Operations

## Production

- Domain: `https://social.sisihome.org`
- Health check: `https://social.sisihome.org/api/health`
- Current expected API version after the latest deployment: `1.2.37`

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

Expected healthy shape: `source:"threads_playwright"`, `sampledCandidates > 0`, and no canned/filler terms.

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

## Keyword Quality

The add-keyword form gives immediate quality hints for broad terms, UI-noise terms such as `轉發分享`, very short inputs, hashtag piles, and sentence-like inputs. The UI suggests replacement chips but does not block the operator; poor keywords change the submit label to `仍然加入`.

## Search Fallback

When direct Threads Playwright search exhausts the daily `search` quota, keyword scans fall back to Bing-first / Google-second `site:threads.net OR site:threads.com` discovery and clearly label the run message as fallback. The kill switch still stops all Threads-targeted discovery; it is not bypassed by fallback search.

Known limitation: search providers can return challenge pages to server-side fetches. The fallback layer detects Google retry pages and Bing CAPTCHA / Cloudflare Turnstile challenges separately from true no-result pages, so empty scans should be read as either `search_provider_blocked` or `no_matching_threads_results` rather than a generic success.

## Threads Quota

Settings → Threads shows today's `search` count and daily limit. The default Playwright search limit is `2000` per day. Use `儲存上限` to raise or lower it, and `清除今天 search 用量` to delete only today's `search` counter. The publish/reply counters remain Phase 1 safeguards.

## Version Rule

Every committed code/spec/docs change for this project must bump the root and workspace package versions in the same batch unless the user explicitly says not to.
