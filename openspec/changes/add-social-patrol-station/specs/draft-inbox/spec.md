## ADDED Requirements

### Requirement: List drafts sorted by score
The system SHALL list AI-prepared drafts with status `pending` or `approved`, sorted by descending `score.engagementWorth × score.timelinessWeight`, paginated, and filterable by source, keyword card, and date range.

#### Scenario: Default inbox view
- **WHEN** the user opens the Draft Inbox
- **THEN** the list shows pending and approved drafts from the last 24 hours, sorted hottest-first

#### Scenario: Filter by source
- **WHEN** the user selects `source = threads`
- **THEN** only drafts whose candidate source is `threads` appear in the list

### Requirement: Show three variants per draft
Each draft row SHALL display its three angle variants with the angle label, length category, and full text, plus the candidate's source, URL, original excerpt, and AI-produced `score` and `reason`.

#### Scenario: Inspect a draft
- **WHEN** the user expands a draft row
- **THEN** three variants are shown with their angle labels, plus links to the original candidate and a per-variant `這版最像我` / `跳過` button

### Requirement: Choose and edit (Phase 0: copy-and-mark-sent)
The system SHALL let the user pick one of the three variants, optionally edit the text inline, and mark the draft as approved. Phase 0 SHALL NOT execute automated publishing; instead the user copies the chosen text and posts to Threads themselves.

#### Scenario: Pick and edit a variant (Phase 0)
- **WHEN** the user picks variant 2, edits the text, and clicks `定稿`
- **THEN** `drafts.chosen_variant_idx = 2` and `drafts.final_text` are updated; the draft status becomes `approved`; a `複製文字` button copies `final_text` to the clipboard and opens `https://www.threads.net/` in a new tab

#### Scenario: Mark as posted manually (Phase 0)
- **WHEN** the user has copy-pasted the text into Threads and pasted the resulting post URL back into the draft
- **THEN** the draft status becomes `posted_manually`, `published_url` is recorded, and the draft leaves the active inbox

### Requirement: Send the chosen variant (Phase 1)
When Phase 1 enables `publish`, the system SHALL provide a `送出` button on approved drafts that invokes `threads-automation` publish through kill-switch and quota gates.

#### Scenario: Send via Playwright (Phase 1)
- **WHEN** the user clicks `送出` on an approved draft in Phase 1
- **THEN** the system calls `POST /api/drafts/:id/publish`, which goes through kill-switch + quota gates and invokes `threads-automation` publish; on success the draft moves to `published` and `published_url` is recorded

#### Scenario: Send attempt in Phase 0
- **WHEN** the user somehow triggers the publish endpoint in Phase 0
- **THEN** the server returns `501 Not Implemented` and the UI explains the manual copy-paste path

### Requirement: Cancel a draft
The system SHALL let the user cancel a draft so it does not appear in the active inbox again.

#### Scenario: Cancel
- **WHEN** the user clicks `跳過` for a whole draft (not just a single variant)
- **THEN** the draft status moves to `cancelled` and it leaves the default list view (still queryable for audit)

### Requirement: Publish errors are recoverable
The system SHALL handle publish failures by leaving the draft in `approved` status (not `failed`-and-stuck), recording the error reason, and allowing the user to retry `送出`.

#### Scenario: Publish fails due to expired session
- **WHEN** publish fails because the Threads session is expired
- **THEN** the draft remains `approved` with a `last_error_reason`, the dashboard shows the session-expired banner, and once the user re-logs the same draft can be sent

### Requirement: Show kill switch and quota usage prominently
The Draft Inbox header SHALL display the current kill-switch state and today's publish / reply / search usage versus limits.

#### Scenario: Kill switch engaged
- **WHEN** the kill switch is on
- **THEN** the header shows a red banner `自動發文已停用 — 按下方解除` and every `送出` button is disabled

#### Scenario: Approaching publish quota
- **WHEN** the user has used 2 of 3 daily publishes
- **THEN** the header displays `今日已發 2/3` and the next `送出` click warns that this will be the last allowed publish today

### Requirement: Soft real-time refresh
The Draft Inbox SHALL poll `/api/drafts` every 30 seconds (or use server-sent events if added later) so new drafts produced by a scan appear without manual reload.

#### Scenario: Scan produces new drafts mid-session
- **WHEN** the user is on the inbox page and a scan completes
- **THEN** within 30 seconds the new drafts appear at the top of the list (assuming they sort there by score)
