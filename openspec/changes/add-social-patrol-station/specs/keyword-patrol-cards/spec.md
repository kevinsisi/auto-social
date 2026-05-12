## MODIFIED Requirements

### Requirement: Run browser-assisted Threads patrol
The system SHALL drive keyword-card scans through the `scan-scheduler` capability, which uses the `trend-sources` adapter layer (Dcard plus Playwright-backed Threads search) instead of a single "open Threads Web in a new tab" action.

#### Scenario: Scheduled scan picks up a keyword card
- **WHEN** the scan scheduler tick fires (default every 15 minutes)
- **THEN** every active keyword card's keyword is dispatched to every enabled source adapter, and any new candidates flow into `trend_candidates` and into the legacy `candidates` table linked to that card

#### Scenario: Manual scan-now for a single keyword card
- **WHEN** the user triggers `run scan for this keyword now` on a card
- **THEN** the system enqueues a one-shot scan for that single keyword across all enabled sources without waiting for the next tick

#### Scenario: Source fails for a scan cycle
- **WHEN** a source adapter throws or times out during a scan
- **THEN** the system records the failure in `scan_runs.errors_json`, leaves other sources unaffected, and does not invent substitute results

### Requirement: View patrol card details
The system SHALL show, for each keyword card, recent scans, candidate results from any enabled source, and AI draft status, while preserving the legacy "manual link import" fallback.

#### Scenario: Open a card with mixed-source candidates
- **WHEN** the user opens a card whose keyword has produced results from both Dcard and Threads in the last 24 hours
- **THEN** the detail view lists each candidate with its source label, engagement summary, and current draft status

#### Scenario: Manual link import remains available
- **WHEN** the user pastes a Threads URL into the manual import field on a card
- **THEN** the system stores it as a candidate (source = `manual`) and runs the AI pipeline on it the same way as a scanned candidate

## REMOVED Requirements

### Requirement: Open Threads pages for manual response
**Reason**: replaced by `draft-inbox` `送出` button which uses `threads-automation` Playwright `publish` / `reply`; the prior browser-open helper is no longer the primary action path.
**Migration**: existing `patrol_runs` and `candidates` rows are preserved; the "Open candidate link" button is removed from the new UI but candidates can still be opened in a new tab from the keyword-card secondary view.
