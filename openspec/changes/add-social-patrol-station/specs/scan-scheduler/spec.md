## ADDED Requirements

### Requirement: Scheduled scan tick
The system SHALL run a full scan on a configurable cron cadence with a default of every 15 minutes (`*/15 * * * *`). The cadence SHALL be editable via `settings.scan.cadence` without redeploy.

#### Scenario: Default cadence
- **WHEN** the server starts and no override is set
- **THEN** the scheduler is registered with `*/15 * * * *` in `Asia/Taipei`

#### Scenario: Interim keyword auto scan is enabled before full source registry lands
- **WHEN** the current A1/A2 transitional build starts
- **THEN** the server still schedules a default every-15-minute keyword Threads scan over all existing keyword cards, even though the future multi-source adapter layer is not fully implemented yet

#### Scenario: Override cadence
- **WHEN** the operator changes `settings.scan.cadence` to `*/30 * * * *` and reloads via the settings endpoint
- **THEN** the scheduler re-registers with the new expression and the next tick fires accordingly

### Requirement: Manual scan-now trigger
The system SHALL expose a manual trigger endpoint that runs a single scan immediately, optionally constrained to one keyword.

#### Scenario: Trigger an all-keywords scan now
- **WHEN** the operator calls `POST /api/admin/scan/run-now`
- **THEN** a scan runs for every active keyword card across every enabled source, exactly as a scheduled tick would

#### Scenario: Trigger a single-keyword scan now
- **WHEN** the operator calls `POST /api/admin/scan/run-now?keyword=...`
- **THEN** the scan only fetches that keyword from every enabled source

### Requirement: Non-overlapping scans
The system SHALL ensure no two scan ticks run concurrently. If a tick fires while a previous scan is still in progress, the new tick SHALL be skipped and recorded as `skipped`.

#### Scenario: Slow scan blocks next tick
- **WHEN** scan A is still running when the next 15-minute tick fires
- **THEN** scan B is not started; a `scan_runs` row records `status = 'skipped'` with `reason = 'previous run in progress'`

#### Scenario: Operator checks scheduler status
- **WHEN** the client calls `GET /api/scheduler/status`
- **THEN** the response reports cadence, running state, last started/completed times, last card count, last inserted count, and whether the previous tick was skipped because of overlap

### Requirement: Scan-level fan-out with per-source timeout
The system SHALL run every enabled source adapter in parallel within a scan, each with its own timeout (default 60s), so a slow or hung adapter does not block the scan from finishing.

#### Scenario: One adapter is slow
- **WHEN** Dcard responds in 2s and Threads search takes 75s
- **THEN** the Threads adapter is aborted at 60s, recorded as `errors[].source = 'threads'`, and the scan completes with Dcard's results

### Requirement: Pipeline runs per new candidate
After fetching and deduping, the scheduler SHALL run the `ai-reply-suggestions` four-step pipeline on each new candidate (not previously analyzed). Pipeline results SHALL be persisted into `drafts`.

#### Scenario: Five new candidates
- **WHEN** a scan produces 5 new candidates after dedupe
- **THEN** the pipeline runs 5 times, each producing either a `drafts` row with status `pending` or marking the candidate `dropped` / `pipeline_blocked`

#### Scenario: No new candidates
- **WHEN** every fetched candidate's fingerprint already exists in `trend_candidates`
- **THEN** the pipeline runs zero times and the `scan_runs` row records `candidates_added = 0`

### Requirement: Scan observability
The system SHALL persist a `scan_runs` row per tick with `started_at`, `ended_at`, `status` (`ok` / `skipped` / `error`), `sources_summary_json`, `candidates_added`, `drafts_produced`, `errors_json`.

#### Scenario: Inspect last scan
- **WHEN** the operator queries `/api/admin/scan/runs?limit=10`
- **THEN** the response lists the 10 most recent scans with their summary fields
