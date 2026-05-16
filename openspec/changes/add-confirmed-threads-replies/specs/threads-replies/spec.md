## ADDED Requirements

### Requirement: Human-confirmed Threads replies
The system SHALL allow the operator to send a reply to one observed Threads post using the stored Threads Playwright session only after explicit per-attempt confirmation.

#### Scenario: Operator confirms one reply
- **GIVEN** a keyword observation post has an AI draft
- **AND** the Threads session is healthy and has a bound handle
- **WHEN** the operator clicks `用 Threads session 留言`, reviews the target post, bound handle, and reply text, and clicks `確認送出留言`
- **THEN** the system creates one reply attempt for that candidate and starts a single Threads reply operation

#### Scenario: Confirmation is missing
- **WHEN** a reply request is sent without `confirm: true`
- **THEN** the server rejects it and does not open Threads or create a browser write operation

#### Scenario: Batch reply is not supported
- **WHEN** the operator is viewing multiple posts
- **THEN** the UI only exposes per-post reply actions and does not provide a batch reply action

### Requirement: Reply attempts are persisted and visible
The system SHALL persist every reply attempt and expose terminal state to the operator.

#### Scenario: Reply attempt is created
- **WHEN** the operator confirms a reply
- **THEN** the system stores a `reply_attempts` row with candidate, card, text, status, timestamps, and later verification details or errors

#### Scenario: Post card renders reply state
- **WHEN** a post has a reply attempt
- **THEN** the observation post card shows one of `留言中`, `留言成功`, `留言失敗`, or `可能已送出但無法確認`

#### Scenario: Successful reply has a URL
- **WHEN** the system verifies a reply permalink
- **THEN** the post card shows `留言成功` and a `查看留言` link

### Requirement: Success requires verification
The system SHALL mark a reply attempt as `succeeded` only after verifying the reply on Threads.

#### Scenario: Reply permalink found
- **WHEN** Playwright submits the reply and finds a permalink for the new reply
- **THEN** the attempt is marked `succeeded` with `verification_method = reply_url` and the `reply_url` is stored

#### Scenario: DOM match found
- **WHEN** no permalink is available but the page shows the bound handle and exact reply text after submit or reload
- **THEN** the attempt is marked `succeeded` with `verification_method = dom_match`

#### Scenario: Submit happened but verification fails
- **WHEN** Playwright submits or may have submitted the reply but cannot verify it
- **THEN** the attempt is marked `uncertain`, not `succeeded`, and the UI tells the operator manual review is required

### Requirement: Safety gates protect the Threads account
The system SHALL enforce account-safety gates before any Threads reply write.

#### Scenario: Kill switch is enabled
- **WHEN** the Threads kill switch is enabled
- **THEN** confirmed reply attempts are rejected before opening a browser write operation

#### Scenario: Reply quota is exhausted
- **WHEN** today's reply quota is exhausted
- **THEN** confirmed reply attempts are rejected before opening a browser write operation

#### Scenario: Session is unhealthy
- **WHEN** the stored Threads session is missing, expired, or has no bound handle
- **THEN** confirmed reply attempts are rejected with an actionable session error

#### Scenario: Candidate was already replied successfully
- **GIVEN** a candidate already has a `succeeded` reply attempt
- **WHEN** the operator tries to reply to the same candidate again
- **THEN** the system rejects the attempt by default to prevent accidental duplicate replies
