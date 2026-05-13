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

## ADDED Requirements

### Requirement: Classify candidate sentiment (7 classes)
The `classify` step SHALL return a `sentiment` label for every candidate, chosen from a fixed 7-class enum: `anger`, `complaint`, `help`, `sarcasm`, `neutral`, `positive`, `support`. The label SHALL describe the *post author's* emotional posture, not the topic or any third party. Every candidate gets exactly one label.

#### Scenario: Complaint post
- **WHEN** a Threads post says `又斷線了，這家網路真的爛`
- **THEN** `classify.sentiment = 'complaint'`

#### Scenario: Help-seeking post
- **WHEN** a Threads post says `有沒有人推薦台北的牙醫，洗牙不會痛的那種`
- **THEN** `classify.sentiment = 'help'`

#### Scenario: Sarcasm post
- **WHEN** a Threads post uses obvious irony or backhanded praise (`真不愧是台灣之光，連手搖飲都漲三次`)
- **THEN** `classify.sentiment = 'sarcasm'`

#### Scenario: Neutral statement
- **WHEN** a Threads post is factual or descriptive without emotional cue (`今天台北 28 度多雲`)
- **THEN** `classify.sentiment = 'neutral'`

### Requirement: Detect sponsored content as an independent dimension
The pipeline SHALL include a `sponsored-detect` step run after `classify` that returns `{ sponsoredSignal: 'none' | 'suspect' | 'likely', reasons: string[] }`. The dimension is independent of `sentiment` (any sentiment can be sponsored or organic) and independent of `risk`. `reasons[]` SHALL be short human-readable Traditional-Chinese strings explaining *which* signals triggered the classification.

#### Scenario: Clear ad with disclosure
- **WHEN** a Threads post says `感謝 @某品牌 邀請！折扣碼 ABC123，#廣告 #合作`
- **THEN** `sponsoredSignal = 'likely'` and `reasons` includes `明示廣告 hashtag` and `出現優惠碼`

#### Scenario: Suspicious organic post
- **WHEN** a Threads post is overly positive about a single brand with polished copy, no negatives, and an implicit CTA (`私訊我拿連結`) but no disclosure
- **THEN** `sponsoredSignal = 'suspect'` and `reasons` includes at least two of: `過度正向品牌植入`, `用語過度乾淨`, `隱性 CTA`

#### Scenario: Clearly organic post
- **WHEN** a Threads post is a first-person opinion or observation with no brand promotion, no CTA, no ad markers
- **THEN** `sponsoredSignal = 'none'` and `reasons` is empty

#### Scenario: Sponsored signal is orthogonal to sentiment
- **WHEN** the same post is classified as `sentiment = 'complaint'` (complaining about a competitor while praising the sponsor)
- **THEN** `sponsoredSignal` can still be `'likely'`; the two fields are reported independently

### Requirement: Generate one training draft on every observed candidate
For every candidate not dropped by `classify` short-circuit (sensitivity-high in no-go zones) or `score.shouldDraft = false`, the system SHALL generate one draft variant using the active voice profile (or a sane default if none is saved). The draft is stored on the candidate's `drafts` row regardless of whether the user ever reviews it; this provides a continuous voice-training corpus.

#### Scenario: Draft generated for every observable candidate
- **WHEN** the pipeline runs on a candidate with `score.shouldDraft = true`
- **THEN** a `drafts` row is created with one entry in `variants_json` and `status = 'pending'`

#### Scenario: Draft generation failure does not block observation
- **WHEN** the `draft` step throws or returns invalid JSON
- **THEN** the candidate is still saved with `classify_json`, `sponsored_json`, and `score_json` populated; `drafts` row is created with `last_error_reason` set and surfaced in the UI as "AI 草稿暫不可用"

### Requirement: Collect per-draft voice training feedback
The system SHALL accept `POST /api/voice/feedback` with `{ draftId, variantIdx, decision: 'like' | 'dislike' | 'rewrite', comment? }` and write a `voice_feedback` row. Feedback is collected starting in Phase A1; voice-profile evolution from accumulated feedback is deferred to Phase A2+.

#### Scenario: User likes a draft
- **WHEN** the user clicks `👍 像我` on a draft
- **THEN** a `voice_feedback` row is inserted with `decision = 'like'` and is immediately visible if the same draft is fetched again

#### Scenario: User rewrites a draft
- **WHEN** the user clicks `✏️ 改寫` and submits a comment with their corrected wording
- **THEN** a `voice_feedback` row is inserted with `decision = 'rewrite'` and the corrected text stored in `comment`

## REMOVED Requirements

### Requirement: Generate `普通` and `比較酸` sarcastic-but-non-offensive Traditional Chinese reply drafts per candidate
**Reason**: tied to the `遇見好車` brand voice; replaced by user-defined voice-profile angles in the new draft requirement.
**Migration**: legacy rows in `reply_suggestions` are kept for reference but no new rows are written by the rebuilt pipeline; `drafts` table is the source of truth going forward.

### Requirement: Apply the `遇見好車` humor calibration
**Reason**: brand specific to the prior product positioning; replaced by the voice-studio profile injection.
**Migration**: no data migration needed; the calibration only lived in `humor.ts` prompts, which are deleted.
