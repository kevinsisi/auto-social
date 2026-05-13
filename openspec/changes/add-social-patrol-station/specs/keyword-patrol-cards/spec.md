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

## ADDED Requirements

### Requirement: Show per-keyword observation panel (Phase A1)
Clicking a keyword card SHALL open an observation panel showing both the aggregate sentiment 風向 for that keyword and a list of recent Threads candidates with per-post sentiment, sponsored-content signal, and a single AI training draft per post. The panel is the primary daily-use surface for the product; manual link import remains as a secondary affordance.

#### Scenario: Open a keyword with recent Threads candidates
- **WHEN** the user clicks a keyword card whose last-24h scan has 10+ candidates
- **THEN** the observation panel shows: a 7-class sentiment bar (anger / complaint / help / sarcasm / neutral / positive / support with counts and percentages), a 葉配 rate (% of `sponsored_signal != 'none'`), a sample count, and a since-time label; below that, a list of posts sorted newest first, each with author handle, posted time, likes, replies, excerpt, sentiment tag, sponsored badge (expandable to reveal `sponsored_reasons[]`), AI draft text, copy button, and feedback buttons (`👍 像我` / `👎 不像` / `✏️ 改寫`)

#### Scenario: Open a keyword with no recent candidates
- **WHEN** the keyword has no candidates in the last 24h
- **THEN** the panel shows an empty 風向卡 with sample count 0 and a "尚無樣本，請按出勤海巡或等下次排程" message; the manual link import field is still visible

#### Scenario: AI pipeline blocked for a candidate
- **WHEN** a candidate exists but `pipeline_status = 'pipeline_blocked'` (key pool exhausted, JSON parse fail, etc.)
- **THEN** the post still appears in the list with raw author/time/excerpt; the sentiment tag shows `分類失敗`, the 葉配 badge shows `偵測失敗`, and the AI draft area shows `草稿暫不可用` instead of fake content

#### Scenario: Feedback button writes voice_feedback
- **WHEN** the user clicks any feedback button on a draft
- **THEN** the client calls `POST /api/voice/feedback` and the button reflects the new state (one feedback per draft per session; subsequent clicks update the existing row)

## REMOVED Requirements

### Requirement: Open Threads pages for manual response
**Reason**: replaced by `draft-inbox` `送出` button which uses `threads-automation` Playwright `publish` / `reply`; the prior browser-open helper is no longer the primary action path.
**Migration**: existing `patrol_runs` and `candidates` rows are preserved; the "Open candidate link" button is removed from the new UI but candidates can still be opened in a new tab from the keyword-card secondary view.
