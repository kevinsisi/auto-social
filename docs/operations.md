# Operations

## Production

- Domain: `https://social.sisihome.org`
- Health check: `https://social.sisihome.org/api/health`
- Current expected API version after the latest deployment: `1.0.6`

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

## Version Rule

Every committed code/spec/docs change for this project must bump the root and workspace package versions in the same batch unless the user explicitly says not to.
