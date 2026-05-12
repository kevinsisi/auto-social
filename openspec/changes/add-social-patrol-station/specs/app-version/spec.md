## ADDED Requirements

### Requirement: UI displays the current app version
The system SHALL display the current app version in a visible location of the main UI on every page, so the user can quote a version number when reporting bugs or requesting changes.

#### Scenario: Version visible in header
- **WHEN** the user loads any page of the client
- **THEN** the app header displays a version badge such as `v1.0.0` reading from the canonical `APP_VERSION` constant

#### Scenario: Server reports the same version
- **WHEN** `/api/health` is called
- **THEN** the response includes the same `version` value as the UI badge

### Requirement: Code-changing or behavior-changing modifications bump the version
The system SHALL treat the version number as part of every release-worthy change. Any modification that affects product code, runtime behavior, dependencies, build output, behavior-changing config, or user-facing copy SHALL bump the version following semver, and SHALL bump `package.json` (root + every workspace package) plus the `APP_VERSION` constant(s) consistently.

#### Scenario: Behavior change without version bump
- **WHEN** a pull request changes runtime behavior, UI copy, dependencies, or build output without bumping `package.json` and `APP_VERSION`
- **THEN** the change is considered incomplete and is not eligible to merge / deploy until the version is bumped

#### Scenario: Docs-only change
- **WHEN** a change only updates docs (`README`, `openspec/`, internal comments) without touching product code or build output
- **THEN** the version bump is not required, but the rationale for skipping must be visible in the commit body or PR description

#### Scenario: Version values stay aligned
- **WHEN** any package or constant changes its version
- **THEN** the root `package.json`, every workspace `package.json`, every `APP_VERSION` constant in code, and the version reported by `/api/health` all agree on the same string
