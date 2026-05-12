## 1. Project Foundation

- [x] 1.1 Create the initial npm workspace app structure with `packages/server` and `packages/client`.
- [x] 1.2 Add a version source and display the app version in the UI header.
- [x] 1.3 Add local development scripts for build, typecheck, test, and start.
- [x] 1.4 Add persistent storage for patrol cards, patrol runs, candidate links, AI suggestions, and generated image metadata.

## 2. Keyword Patrol Cards

- [x] 2.1 Implement keyword patrol card creation with empty-input validation and unchanged keyword preservation.
- [x] 2.2 Implement patrol card list and detail views in Traditional Chinese.
- [x] 2.3 Implement patrol run records with statuses for pending, running, completed, and failed.
- [x] 2.4 Implement manual Threads link import as the fallback input path.
- [x] 2.5 Implement candidate result statuses for useful, ignored, replied, and needs follow-up.

## 3. Browser-Assisted Threads Patrol

- [x] 3.1 Add a browser-assist service that opens Threads Web search for the card keyword.
- [ ] 3.2 Capture visible candidate links when Threads Web results can be read.
- [x] 3.3 Surface login-required, blocked, or layout-change failures without inventing results.
- [x] 3.4 Add an action that opens each candidate Threads link for manual response.

## 4. AI Reply Suggestions

- [ ] 4.1 Integrate `@kevinsisi/ai-core` for AI calls, retry handling, and clear failure reporting.
- [x] 4.2 Generate structured candidate analysis with summary, engagement recommendation, reply angle, and risk notes.
- [x] 4.3 Generate `普通` and `比較酸` sarcastic-but-non-offensive Traditional Chinese reply drafts per candidate.
- [x] 4.4 Apply the `遇見好車` humor calibration: self-deprecating, Taiwanese, short, useful, and never personally insulting.
- [x] 4.5 Add safety filtering or rewriting for offensive, threatening, protected-class, doxxing, personal-attack, group-mocking, or otherwise risky drafts.
- [x] 4.6 Add risk labels and `worth replying` recommendations for each candidate and suggestion.
- [x] 4.7 Add copy actions for reply drafts without automatic Threads submission.

## 5. Image And Meme Suggestions

- [x] 5.1 Generate image reply ideas for each candidate result.
- [x] 5.2 Generate funny meme/card prompts that match the candidate context.
- [x] 5.3 Support punchline, before/after, fake customer-service, fake expert-analysis, and used-car metaphor meme formats.
- [ ] 5.4 Add optional image generation provider wiring behind configuration.
- [x] 5.5 Preserve meme/card prompts and clearly report provider-unavailable states when image generation cannot run.
- [ ] 5.6 Show generated image metadata and download/open actions when an asset exists.

## 6. Verification And Completion

- [x] 6.1 Add tests for keyword validation, manual link import, status transitions, and AI failure handling.
- [ ] 6.2 Add prompt/style tests covering sincere questions, complaints, emotionally distressed posts, and forbidden personal attacks.
- [x] 6.3 Run the repo's concrete build and test commands.
- [ ] 6.4 Verify the browser-assisted flow in a real local browser session when feasible.
- [ ] 6.5 Update README and relevant OpenSpec/docs with the implemented MVP behavior.
- [ ] 6.6 Run review before commit and resolve findings.
- [ ] 6.7 Commit and push the completed coherent segment according to HomeProject rules.
