## ADDED Requirements

### Requirement: Provide a pluggable source-adapter interface
The system SHALL define a `SourceAdapter` interface with `id`, `isEnabled()`, and `fetch({ keywords, sinceIso })`, and the scan scheduler SHALL only call adapters through this interface so adapters can be added or removed without changing scheduler code.

#### Scenario: Add a new adapter
- **WHEN** a developer adds a new file implementing `SourceAdapter` and registers it in `sources/registry.ts`
- **THEN** the scheduler picks it up on the next tick, calls `isEnabled()`, and includes it in the fan-out fetch if enabled

### Requirement: Dedupe candidates by source-aware fingerprint
The system SHALL dedupe candidates using `fingerprint = sha256(source + ':' + externalId)` so the same post returned by the same source across scans is not duplicated, while the same URL surfaced by a different source still produces a distinct row.

#### Scenario: Same post returned twice by same source
- **WHEN** a Dcard post appears in two consecutive scans
- **THEN** only the first scan inserts a `trend_candidates` row; the second scan's result is dropped during dedupe

#### Scenario: Same URL from different sources
- **WHEN** the same Threads URL is surfaced by both `manual` import and `threads` adapter
- **THEN** two `trend_candidates` rows exist, one per source, so source attribution is preserved

### Requirement: Dcard adapter ships in Phase 0
The system SHALL ship a `dcard` source adapter that uses the public Dcard popular-posts endpoint, filters by keyword in title / excerpt / tags, and never requires a Dcard account.

#### Scenario: Dcard returns relevant posts
- **WHEN** the adapter runs with keyword `iPhone`
- **THEN** it returns Dcard posts whose title, excerpt, or tags contain `iPhone` (case-insensitive), with `engagement.likes` and `engagement.replies` populated from the Dcard payload

#### Scenario: Dcard rate-limits the adapter
- **WHEN** Dcard returns HTTP 429
- **THEN** the adapter backs off exponentially within the scan window, and if it cannot succeed before the per-source timeout it returns an empty result with `errors[].source = 'dcard'`

### Requirement: Threads adapter ships in Phase 0
The system SHALL ship a `threads` source adapter that delegates to `threads-automation` `search(keyword)` (which uses the user's logged-in Playwright session) and respects the daily-search quota.

#### Scenario: Threads search succeeds
- **WHEN** the adapter runs with keyword `中古車` and the Threads session is healthy
- **THEN** it returns up to N parsed candidates with `source = 'threads'`, `author`, `url`, `text`, and any visible engagement counts

#### Scenario: Threads search blocked / login expired / quota exceeded
- **WHEN** Playwright reports the session is logged out, Threads layout changed, or daily search quota is exceeded
- **THEN** the adapter returns an empty result and records the reason in `scan_runs.errors_json[].source = 'threads'`; it does not invent candidates

### Requirement: Adapter health is observable
The system SHALL track per-adapter recent success / failure counts and expose them at `/api/sources` so the dashboard can show which adapters are healthy.

#### Scenario: Source health surfaced in UI
- **WHEN** the dashboard polls `/api/sources`
- **THEN** the response lists each adapter with `enabled`, `lastSuccessAt`, `lastFailureAt`, `failureCountLast24h`, and an optional `note`
