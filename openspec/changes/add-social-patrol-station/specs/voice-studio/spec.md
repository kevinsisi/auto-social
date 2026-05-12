## ADDED Requirements

### Requirement: Capture a voice profile
The system SHALL capture and persist a single active voice profile per installation with the following structured fields: `axes` (sarcasm, stance, length, emojiDensity, each 0..1), `noGoZones` (array of tag plus free-text), `admiredAccounts` (3–5 entries, each with handle + description + optional sample post), `selfDescriptors` (free-text adjectives), `signaturePhrases` (free-text phrases), and `language` (default `zh-TW`).

#### Scenario: Create initial voice profile
- **WHEN** the user fills the Voice Studio form for the first time and saves
- **THEN** a single `voice_profile` row is written with all submitted fields and `updated_at = now`

#### Scenario: Edit voice profile
- **WHEN** the user changes any field and saves
- **THEN** the existing row is updated, `updated_at = now`, and subsequent AI pipeline calls within the same process see the new values without restart

### Requirement: Inject voice profile into AI prompts
The system SHALL render the active voice profile into a structured `systemInstruction` plus a `## Voice Anchors` block in the user prompt for every `draft` step call.

#### Scenario: Voice profile drives draft
- **WHEN** the `draft` step runs
- **THEN** the prompt sent to Gemini contains the axes, no-go zones, admired accounts, self-descriptors, and signature phrases in a deterministic structured layout

#### Scenario: Voice profile missing
- **WHEN** no voice profile row exists
- **THEN** the prompt builder substitutes a documented default profile and the UI surfaces a banner pointing the user to Voice Studio

### Requirement: Capture per-draft feedback (Phase 1)
When Phase 1 enables voice feedback, the system SHALL allow the user to record per-variant feedback for any produced draft, with values `accept`, `reject`, or `none`, plus an optional comment. The `voice_feedback` table SHALL exist in Phase 0 (schema only) so prior chosen-variant data can be backfilled when feedback writes turn on.

#### Scenario: Mark a variant as accepted (Phase 1)
- **WHEN** the user clicks `這版最像我` on a variant in Phase 1
- **THEN** a `voice_feedback` row is written with `decision = accept`, the draft id, and the variant index

#### Scenario: Reject all variants (Phase 1)
- **WHEN** the user clicks `都不像` for the whole draft in Phase 1
- **THEN** three `voice_feedback` rows are written (one per variant) with `decision = reject` and a shared optional comment

#### Scenario: Feedback UI in Phase 0
- **WHEN** the user views the draft inbox in Phase 0
- **THEN** the per-variant `這版最像我` / `都不像` buttons are absent or disabled with a tooltip `Phase 1 開放`; choosing a variant via `定稿` is still recorded in `drafts.chosen_variant_idx`

### Requirement: Voice profile preview
The system SHALL provide an in-place preview that runs the `draft` step against a fixed sample candidate, using the current draft of the voice profile (not yet saved), and returns the variants without persisting them.

#### Scenario: Preview before save
- **WHEN** the user clicks `預覽` in Voice Studio with unsaved edits
- **THEN** the system runs `draft` once against a built-in sample candidate using the current form state and displays the three variants in a preview panel

### Requirement: Voice profile is not yet auto-evolved in Phase 0
The system SHALL persist `voice_feedback` rows but SHALL NOT automatically modify the saved voice profile from those rows in Phase 0; auto-evolution is reserved for Phase 1.

#### Scenario: Feedback accumulates
- **WHEN** the user has recorded feedback over several days
- **THEN** the data is available via `/api/voice/feedback?since=...` for inspection, but the saved voice profile only changes when the user explicitly edits it
