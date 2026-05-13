## ADDED Requirements

### Requirement: Generate original post ideas from live radar context
The system SHALL support a queue-backed `compose_post` flow that turns recent real Threads radar context into an original post draft for the operator's own account. This is not a reply draft; it is a fresh top-level post idea.

#### Scenario: Operator requests a post idea
- **WHEN** the operator clicks `生一篇發文靈感`
- **THEN** the server enqueues a `compose_post` AI task using the latest radar terms plus recent trending candidate excerpts as seed context, and the Dashboard shows the queued/running/completed state in the AI 工作站 widget

#### Scenario: Compose task succeeds
- **WHEN** the worker finishes a `compose_post` task successfully
- **THEN** the system stores one `post_drafts` row containing `seed_keyword`, `seed_topic`, `angle`, `text`, `image_prompt`, `status`, and timestamps, and the Dashboard shows it in a 發文發想 panel with a copy button

#### Scenario: No recent radar context exists
- **WHEN** the operator requests a post idea but there are no recent trending candidates in the last 24 hours
- **THEN** the server rejects the request with a clear error instead of inventing context or fabricating a draft

### Requirement: Compose drafts stay human-gated
The system SHALL present generated post drafts as ideas for manual use only. Queue-backed compose does not publish automatically.

#### Scenario: Draft appears in Dashboard
- **WHEN** a post idea is listed in the Dashboard
- **THEN** the operator can copy the generated text and inspect the image prompt, but there is no automatic publish action in this slice
