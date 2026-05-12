## ADDED Requirements

### Requirement: Keyword-less trending fetch
The system SHALL support fetching "what is hot right now" from every enabled trend source **without requiring the user to set up keyword cards**. Each source adapter SHALL expose a `fetchTrending({ limit, sinceIso })` mode that returns the source's current top posts irrespective of any keyword filter.

#### Scenario: Dcard trending mode
- **WHEN** the scan scheduler runs and Dcard is enabled
- **THEN** the Dcard adapter fetches the public popular-posts endpoint with no keyword filter and inserts the top N candidates into `trend_candidates` with `is_trending = true`

#### Scenario: Threads trending mode
- **WHEN** the scan scheduler runs and Threads is enabled and the session is healthy
- **THEN** the Threads adapter opens the explore / for-you feed via Playwright, scrolls once, parses up to N posts, and inserts them with `is_trending = true`

### Requirement: Trending coexists with keyword cards
Trending fetch and keyword-card scanning SHALL run side-by-side within the same scan tick. Candidates surfaced by both paths SHALL be deduped via the same `fingerprint = sha256(source + ':' + externalId)`; if a candidate matches both a trending result and a keyword card, the row records both `is_trending = true` and `card_id` of the matching card.

#### Scenario: Same post appears in both paths
- **WHEN** a Threads post is in the explore feed and also matches keyword card `iPhone`
- **THEN** only one `trend_candidates` row exists, with `is_trending = true` and `card_id` set to the iPhone card

### Requirement: Trending tab in Dashboard
The Dashboard SHALL provide two tabs side-by-side: `全網熱門` (trending across all enabled sources, sorted by per-source rank percentile then engagement) and `我的關鍵字` (filtered to candidates linked to a keyword card). Both tabs draw from the same `trend_candidates` + `drafts` join.

#### Scenario: Switch to trending tab
- **WHEN** the user clicks `全網熱門`
- **THEN** the list shows all candidates with `is_trending = true` from the configured time window (default last 24 hours), sorted hottest-first across sources

#### Scenario: Switch to keyword tab
- **WHEN** the user clicks `我的關鍵字`
- **THEN** the list shows only candidates whose `card_id` is non-null, optionally filterable by specific card

### Requirement: Trending defaults are tunable
The system SHALL store per-source trending `limit` and the trending time-window in `settings` so the operator can adjust how many posts to pull and how far back to consider "current".

#### Scenario: Operator changes Dcard trending limit
- **WHEN** the operator sets `settings.sources.dcard.trendingLimit = 50`
- **THEN** the next scan tick fetches up to 50 trending Dcard posts instead of the prior default

### Requirement: Trending candidates flow through the same AI pipeline
Trending candidates SHALL be processed by the same `classify → score → draft → meme` pipeline as keyword-card candidates, with no separate code path. The score's `voiceFit` field is the primary filter that prevents low-relevance trending posts from producing drafts.

#### Scenario: Trending post fails voice fit
- **WHEN** a Dcard trending post is classified as `voiceFit = 0.1` and `score.shouldDraft = false`
- **THEN** the candidate is recorded as `dropped`, no draft is generated, and the dashboard "discarded" filter can show it for audit
