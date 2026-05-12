## ADDED Requirements

### Requirement: Create keyword patrol cards
The system SHALL allow the user to create a persistent patrol card from a user-provided keyword without rewriting or replacing the keyword.

#### Scenario: Create a new patrol card
- **WHEN** the user submits a keyword
- **THEN** the system stores a patrol card using the original keyword text and shows it in the card list

#### Scenario: Reject empty keyword
- **WHEN** the user submits an empty or whitespace-only keyword
- **THEN** the system rejects the request with a clear Traditional Chinese validation message

### Requirement: View patrol card details
The system SHALL show each patrol card's patrol runs, discovered candidate links, result statuses, and available actions.

#### Scenario: Open a patrol card
- **WHEN** the user opens a patrol card
- **THEN** the system shows the keyword, latest patrol status, candidate links, and AI suggestion status for each result

### Requirement: Run browser-assisted Threads patrol
The system SHALL provide a browser-assisted patrol action that searches Threads Web for the card keyword and records candidate links when collection is feasible.

#### Scenario: Successful patrol collection
- **WHEN** the user starts a patrol and Threads Web results are accessible
- **THEN** the system records candidate Threads links with source metadata and marks the patrol run as completed

#### Scenario: Threads Web collection blocked
- **WHEN** Threads Web requires login, changes layout, blocks collection, or otherwise cannot be read
- **THEN** the system preserves the patrol card and reports a collection failure without inventing substitute results

### Requirement: Manual link import fallback
The system SHALL allow the user to manually add Threads links to a patrol card when browser-assisted collection is unavailable or incomplete.

#### Scenario: Add a manual result link
- **WHEN** the user pastes a valid Threads link into a patrol card
- **THEN** the system stores the link as a candidate result associated with that patrol card

### Requirement: Open Threads pages for manual response
The system SHALL provide an action to open each candidate Threads link in the browser without automatically submitting a reply.

#### Scenario: Open candidate link
- **WHEN** the user clicks the open action for a candidate result
- **THEN** the system opens the Threads page for that result and keeps final response submission under user control

### Requirement: Track patrol result decisions
The system SHALL allow the user to classify candidate results as useful, ignored, replied, or needs follow-up.

#### Scenario: Mark result as replied
- **WHEN** the user marks a candidate result as replied
- **THEN** the system updates the result status while preserving the original link and AI suggestions
