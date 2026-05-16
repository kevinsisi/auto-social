## 1. Spec and Data Model

- [x] 1.1 Add OpenSpec proposal, design, task list, and capability delta.
- [x] 1.2 Add `image_analysis_json` migration to `trend_candidates`.
- [x] 1.3 Add shared TypeScript types for persisted image analysis.

## 2. Backend Vision Pipeline

- [x] 2.1 Implement Gemini image recognition with bounded URL fetches, inline image data, JSON parsing, and model metadata.
- [x] 2.2 Run image recognition before candidate classification when images exist.
- [x] 2.3 Persist successful, partial, none, and failed image analysis states.
- [x] 2.4 Feed visual summary into classify, sponsored/scam detection, scoring, and draft prompts.

## 3. Observation UI

- [x] 3.1 Expose image analysis from keyword observation API.
- [x] 3.2 Add client types for image analysis.
- [x] 3.3 Render image recognition status and summary on observation post cards.

## 4. Verification & Release

- [x] 4.1 Add tests for persistence, graceful failure, observe API exposure, and prompt inclusion.
- [x] 4.2 Run `npm run typecheck`, `npm test`, `npm run build`, and `npx openspec validate add-observation-image-recognition --strict`.
- [x] 4.3 Update README and operations docs with the image recognition behavior.
