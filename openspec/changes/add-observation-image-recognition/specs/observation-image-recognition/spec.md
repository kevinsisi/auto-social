## ADDED Requirements

### Requirement: Image recognition runs before observation AI analysis
The system SHALL analyze attached image URLs for observed candidates before running text classification and draft generation when images are present.

#### Scenario: Candidate has images
- **GIVEN** an observed Threads candidate has one or more image URLs
- **WHEN** the pipeline runs for that candidate
- **THEN** the system attempts image recognition before classify, sponsored detection, scam detection, scoring, and drafting
- **AND** downstream prompts receive the resulting visual summary when image recognition succeeds or partially succeeds

#### Scenario: Candidate has no images
- **GIVEN** an observed candidate has no image URLs
- **WHEN** the pipeline runs
- **THEN** the system records image analysis status `none` or omits visual context
- **AND** the existing text-only pipeline behavior continues

### Requirement: Image recognition is persisted and visible
The system SHALL persist image recognition output and expose it on observation post cards.

#### Scenario: Image recognition succeeds
- **WHEN** at least one attached image is analyzed successfully
- **THEN** the candidate stores a structured image analysis result with status, summary, per-image descriptions, model, and analyzed timestamp
- **AND** the observation UI shows the image recognition summary for that post

#### Scenario: Image recognition fails
- **WHEN** image download or vision analysis fails for all images
- **THEN** the candidate stores status `failed` with an error
- **AND** the observation UI shows that image recognition failed without hiding the post or blocking text analysis

### Requirement: Image recognition failures do not block text analysis
The system SHALL continue text-only analysis when image recognition cannot produce a usable summary.

#### Scenario: Image fetch times out
- **WHEN** an image URL times out, is too large, is not an image, or cannot be fetched
- **THEN** the pipeline records the image-analysis error
- **AND** classify/score/draft still run from text-only context if the text pipeline is otherwise available

### Requirement: Visual claims are bounded to analyzed images
The system SHALL not claim visual details unless the image recognition step actually analyzed an image.

#### Scenario: Only URLs are available
- **GIVEN** a candidate has image URLs but every image recognition attempt fails
- **WHEN** downstream AI prompts are built
- **THEN** the prompts do not include guessed image content from URLs, filenames, or surrounding text
