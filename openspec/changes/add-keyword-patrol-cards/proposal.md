## Why

The first useful `auto-social` MVP should avoid Meta App and App Review friction while still helping Kevin patrol Threads for opportunities. A semi-automated Threads Copilot can turn a keyword into a reusable patrol card, surface useful links, and prepare reply ideas without taking risky account actions.

## What Changes

- Add keyword-based patrol cards where each keyword becomes a saved task card.
- Add a patrol detail workflow that opens/uses Threads Web search through browser assistance and records candidate links.
- Add AI analysis for each discovered link, including summary, reply-worthiness, reply angles, and suggested responses.
- Add an operator-assisted action model: the app may open the Threads page, but the user remains responsible for final posting.
- Add image reply support through image suggestions and generated funny meme/card concepts.
- Set the default reply voice to a self-deprecating, Taiwanese, sarcastic-but-non-offensive Traditional Chinese brand-editor voice for `遇見好車`.
- Explicitly exclude Meta App OAuth, official Threads API publishing, automatic login, and automatic reply submission from this MVP.

## Capabilities

### New Capabilities

- `keyword-patrol-cards`: Keyword task cards, patrol runs, Threads Web candidate links, result status, and open-link workflow.
- `ai-reply-suggestions`: AI-generated summaries, reply recommendations, sarcastic-but-safe response drafts, image suggestions, and meme/card generation prompts.

### Modified Capabilities

- None.

## Impact

- Frontend: new dashboard for keyword cards, patrol results, and reply workspace.
- Backend: persistence for keywords, patrol runs, candidate links, AI suggestions, and generated image metadata.
- Browser integration: Playwright or equivalent browser-assist layer for opening Threads Web and collecting visible results where feasible.
- AI integration: `@kevinsisi/ai-core` should be preferred for Gemini calls, retry handling, and observable failures.
- Media generation: first version should support image/meme prompt generation and generated image assets only when a configured image provider is available; otherwise it must preserve the suggestion and surface the missing provider clearly.
- Safety: no automatic Threads submission, no stored Threads password, no unofficial credential harvesting, and no claim that Threads Web scraping is guaranteed stable.
