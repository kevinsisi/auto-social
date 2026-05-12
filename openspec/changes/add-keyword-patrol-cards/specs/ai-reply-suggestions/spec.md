## ADDED Requirements

### Requirement: Generate candidate analysis
The system SHALL generate structured AI analysis for each patrol candidate, including a summary, engagement recommendation, reply angle, and risk notes.

#### Scenario: Analyze a candidate link
- **WHEN** a patrol candidate has readable content or user-provided text
- **THEN** the system generates a Traditional Chinese analysis that helps the user decide whether to respond

#### Scenario: Candidate content is unavailable
- **WHEN** the system cannot read candidate content
- **THEN** the system reports that the content is unavailable and does not fabricate a summary

### Requirement: Generate calibrated brand-editor reply drafts
The system SHALL generate multiple Traditional Chinese reply drafts using the `遇見好車` brand-editor voice: real-person social editor, short and sharp, self-deprecating when possible, Taiwanese, funny, and sarcastic without attacking people.

#### Scenario: Generate reply drafts
- **WHEN** a candidate has enough context for response generation
- **THEN** the system provides at least two reply drafts labelled `普通` and `比較酸`

#### Scenario: Prevent unsafe reply tone
- **WHEN** an AI draft contains harassment, threats, protected-class attacks, doxxing, or other high-risk content
- **THEN** the system blocks or rewrites the draft into a safer sarcastic-but-non-offensive version

#### Scenario: Sincere question handling
- **WHEN** the candidate appears to be a sincere question
- **THEN** the system removes sarcasm and generates a helpful reply that can guide the user toward `遇見好車`

#### Scenario: Complaint handling
- **WHEN** the candidate is a complaint
- **THEN** the system generates a reply that acknowledges the complaint before adding light self-deprecating humor

#### Scenario: Emotional distress handling
- **WHEN** the candidate shows strong distress or vulnerability
- **THEN** the system avoids jokes and generates a supportive or non-engagement recommendation

### Requirement: Enforce forbidden humor boundaries
The system SHALL reject or rewrite reply drafts that mock a person's logic, taste, identity, or anonymous user group, or that contain profanity, slurs, personal attacks, `低能`, `白癡`, threats, doxxing, or dark humor targeting real people.

#### Scenario: Draft mocks a person
- **WHEN** a generated draft mocks the candidate author's logic, taste, or identity
- **THEN** the system rewrites the draft to target the situation, the brand's own awkwardness, or a harmless car-related metaphor instead

#### Scenario: Draft uses unacceptable wording
- **WHEN** a generated draft includes profanity, slurs, `低能`, `白癡`, threats, or doxxing
- **THEN** the system blocks the draft and reports the reason

### Requirement: Provide engagement risk labels
The system SHALL label each candidate and reply suggestion with an engagement risk level and explain whether the result is worth replying to.

#### Scenario: Risk label generated
- **WHEN** the system generates reply suggestions for a candidate
- **THEN** each suggestion includes a risk label and the candidate includes a `worth replying` recommendation

### Requirement: Provide image reply suggestions
The system SHALL suggest image reply ideas that match the candidate context and requested meme-oriented tone.

#### Scenario: Suggest image reply
- **WHEN** the system generates reply suggestions for a candidate
- **THEN** it also provides image or sticker-style reply ideas that the user can manually use on Threads

### Requirement: Generate meme or card concepts
The system SHALL generate funny meme/card concepts and prompts for candidate responses using short punchlines, before/after contrast, fake customer-service replies, fake expert analysis, and car-dealer or used-car metaphors.

#### Scenario: Image provider configured
- **WHEN** an image generation provider is configured and the user requests a meme/card asset
- **THEN** the system generates or queues the image asset and associates it with the candidate result

#### Scenario: Image provider unavailable
- **WHEN** no image generation provider is configured or the provider fails
- **THEN** the system preserves the meme/card prompt and clearly reports that image generation is unavailable

#### Scenario: Meme avoids dark humor
- **WHEN** the system creates a meme/card concept
- **THEN** it avoids dark humor that targets real people and uses self-deprecation or situational humor instead

### Requirement: Copy and open workflow
The system SHALL let the user copy generated text suggestions and open the target Threads page without automatically posting.

#### Scenario: Copy reply and open target
- **WHEN** the user chooses a reply draft
- **THEN** the system provides a copy action and an open-target action while leaving final posting to the user
