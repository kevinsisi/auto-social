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
The system SHALL ship a `threads` source adapter that returns only Threads post URLs. Keyword-card discovery SHALL use Threads-targeted search providers without loading a logged-in Threads session; if `BRAVE_SEARCH_API_KEY` is configured, Brave Search API SHALL be attempted before unauthenticated browser/raw search fallbacks.

#### Scenario: Threads search succeeds
- **WHEN** the adapter runs with keyword `中古車` and a search provider returns matching Threads post URLs
- **THEN** it returns up to N parsed candidates with `source = 'threads_search'`, `url`, `title`, `excerpt`, and the provider used for diagnostics

#### Scenario: Threads search provider blocked / API key missing
- **WHEN** Brave Search API is unconfigured or a browser/raw provider is blocked by CAPTCHA / protection pages
- **THEN** the adapter skips or cools down that provider, continues to the next configured provider, and returns `search_provider_blocked` only when every attempted provider is unusable; it does not invent candidates

### Requirement: Adapter health is observable
The system SHALL track per-adapter recent success / failure counts and expose them at `/api/sources` so the dashboard can show which adapters are healthy.

#### Scenario: Source health surfaced in UI
- **WHEN** the dashboard polls `/api/sources`
- **THEN** the response lists each adapter with `enabled`, `lastSuccessAt`, `lastFailureAt`, `failureCountLast24h`, and an optional `note`
