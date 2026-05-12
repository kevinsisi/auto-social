## MODIFIED Requirements

### Requirement: Integrate `@kevinsisi/ai-core`
The system SHALL route every Gemini call through `@kevinsisi/ai-core` `GeminiClient` backed by `KeyPool` (with `SqliteAdapter`) and SHALL NOT issue any direct `@google/generative-ai` calls outside `ai-core`.

#### Scenario: AI call uses ai-core KeyPool
- **WHEN** any AI step in the pipeline executes
- **THEN** it allocates a key via `KeyPool`, runs `GeminiClient.generateContent`, releases the key (success or cooldown), and reports status back to key-manager

#### Scenario: Pool exhausted
- **WHEN** every key in the pool is in cooldown or leased
- **THEN** the step throws `NoAvailableKeyError`, the candidate is marked `pipeline_blocked`, and the scheduler retries on the next tick rather than busy-looping

### Requirement: Generate structured candidate analysis
The system SHALL produce, for every candidate eligible for drafting, a structured analysis with `topic`, `sensitivity`, `voiceFit`, `engagementWorth`, `risk`, `timeliness`, `shouldDraft`, and a one-line `reason`. Each field is produced by the `classify` and `score` micro-steps of the `ai-core` `StepRunner` pipeline.

#### Scenario: Sensitive topic short-circuits
- **WHEN** `classify` returns `sensitivity = high` and `topic` is in the voice profile's `noGoZones`
- **THEN** the pipeline marks the candidate `dropped` and does not run `draft` or `meme`

#### Scenario: Low engagement worth short-circuits
- **WHEN** `score` returns `shouldDraft = false`
- **THEN** the pipeline marks the candidate `dropped` with the score reason recorded; `draft` and `meme` are skipped

### Requirement: Generate voice-profile-driven draft variants
The system SHALL generate exactly three draft variants per non-dropped candidate, each labelled with an `angle` (default angles: `觀察家`, `自嘲`, `短梗`; configurable via voice profile) and shaped by the active voice profile's axes, no-go zones, admired-account anchors, self-descriptors, and signature phrases.

#### Scenario: Voice profile is empty
- **WHEN** no voice profile has been saved yet
- **THEN** the pipeline uses a sane default profile (mildly self-deprecating, observer stance, short jab, low emoji, no-go = politics + personal attack + religion) and surfaces a UI banner asking the user to complete Voice Studio

#### Scenario: Voice profile updated mid-day
- **WHEN** the user saves a new voice profile
- **THEN** subsequent `draft` calls use the new profile within the same scan cycle without restart

### Requirement: Apply safety filtering
The system SHALL refuse to produce draft text that personally attacks named individuals, mocks protected classes, doxxes anyone, or violates the voice profile's `noGoZones`. Drafts that fail safety are dropped, not partially rewritten without user awareness.

#### Scenario: Draft violates no-go zone
- **WHEN** a generated variant matches a no-go zone in the active voice profile (model self-check or post-generation classifier)
- **THEN** that variant is excluded from the returned set; if all three variants fail, the candidate is marked `pipeline_blocked` with a safety reason and surfaced for manual review

### Requirement: Apply micro-step key planning
The system SHALL run the four-step pipeline (`classify`, `score`, `draft`, `meme`) via `ai-core` `StepRunner` with `planPreferredKeys`, so different steps prefer different healthy keys when the pool can support it.

#### Scenario: Pool has at least four healthy keys
- **WHEN** the pipeline runs on a candidate
- **THEN** the four steps are assigned four distinct preferred keys; each step's metadata records `preferredKeyUsed = true`

#### Scenario: Pool has fewer healthy keys than steps
- **WHEN** the pool has fewer healthy keys than the pipeline has steps
- **THEN** later steps are explicitly marked `sharedFallbackRequired` and `allowSharedFallback = true` permits the run to proceed; the step result records `sharedFallbackUsed = true`

## REMOVED Requirements

### Requirement: Generate `普通` and `比較酸` sarcastic-but-non-offensive Traditional Chinese reply drafts per candidate
**Reason**: tied to the `遇見好車` brand voice; replaced by user-defined voice-profile angles in the new draft requirement.
**Migration**: legacy rows in `reply_suggestions` are kept for reference but no new rows are written by the rebuilt pipeline; `drafts` table is the source of truth going forward.

### Requirement: Apply the `遇見好車` humor calibration
**Reason**: brand specific to the prior product positioning; replaced by the voice-studio profile injection.
**Migration**: no data migration needed; the calibration only lived in `humor.ts` prompts, which are deleted.
