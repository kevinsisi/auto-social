## Context

`auto-social` is still in plan-before-build. The previous feasibility report focused on official Meta Threads and Instagram APIs, but Kevin rejected the Meta App/App Review path for the first useful version. The confirmed MVP is a semi-automated Threads patrol console: Kevin enters a keyword, the system creates a patrol card, browser assistance opens or reads Threads Web where feasible, AI reports what it found, and Kevin manually decides whether to respond.

Constraints:
- Do not require Meta App, OAuth scopes, App Review, or official publishing APIs for this MVP.
- Do not store Threads passwords or automate final reply submission.
- Threads Web collection is best-effort because login walls, UI changes, and anti-automation controls can interrupt it.
- UI copy uses Traditional Chinese.
- AI calls should use `@kevinsisi/ai-core` unless a documented reason blocks adoption.
- Reply voice is calibrated for `遇見好車` official Threads: real human social editor, short and sharp, self-deprecating first, lightly sarcastic, never abusive.

## Goals / Non-Goals

**Goals:**
- Let a keyword become a persistent patrol card.
- Let each patrol card collect or accept Threads candidate links.
- Summarize each candidate and classify whether it is worth engaging.
- Generate `遇見好車` reply drafts that are funny, self-deprecating, Taiwanese, and sarcastic without attacking people.
- Suggest image replies and generate funny meme/card concepts when image generation is configured.
- Open target Threads pages for Kevin to manually reply.

**Non-Goals:**
- No Meta App setup, official Threads API publishing, or Instagram support in this change.
- No automatic reply submission.
- No account credential harvesting or password storage.
- No guarantee that Threads Web search can always be scraped reliably.
- No broad web crawler that patrols unrelated public content without a user-specified keyword.

## Decisions

1. Keyword cards are the primary unit of work.
   - Rationale: Kevin wants to type a keyword and get a card that can be revisited.
   - Alternative considered: one-off search form. Rejected because it does not preserve patrol history or follow-up state.

2. Threads Web browser assistance is best-effort and operator-driven.
   - Rationale: this avoids Meta App requirements while still reducing manual work.
   - Alternative considered: unofficial API/reverse engineering. Rejected due to account and maintenance risk.

3. The app opens Threads pages but does not submit responses.
   - Rationale: keeps the MVP useful without taking risky irreversible social actions.
   - Alternative considered: browser auto-fill and submit. Rejected for first version because it affects user habits and account safety.

4. AI output is structured per candidate link.
   - Rationale: each result needs a compact decision packet: summary, engagement score, angle, drafts, image idea, and action links.
   - Alternative considered: one long report per keyword. Rejected because it is hard to act on quickly.

5. Meme/card generation is provider-optional.
   - Rationale: text suggestions are useful immediately, while actual image generation depends on available provider credentials and cost.
   - Alternative considered: hard-require image generation. Rejected because it would block the first usable prototype.

6. Default voice follows the `遇見好車` humor calibration.
   - Rationale: Kevin wants a real social-editor voice close to PX Mart and Big City: quick, self-aware, a little acidic, and useful for inviting people back to the official Threads account.
   - Allowed patterns: self-deprecation, Taiwanese internet phrasing such as `蛤`, `不是欸`, `先不要`, `笑死`, `這很難評`, `我先尊重`, `你開心，我開心`, `只好讓我來幫幫你了`, `證據追不上結論啦`, and `事實追不上判斷了寶貝`.
   - Allowed light exclamations: `靠`, `靠杯`, and `哭啊`.
   - Preferred formats: short punchline, before/after comparison, fake customer-service reply, fake expert analysis, and car-dealer/used-car metaphors that gently guide users toward `遇見好車`.
   - Forbidden patterns: personal attacks, mocking logic or taste, mocking anonymous users, targeting `某些人`, profanity, slurs, `低能`, `白癡`, protected-class attacks, threats, doxxing, and dark humor that targets real people.
   - Situational rules: use empathy before humor for complaints, remove sarcasm for sincere questions, and avoid jokes when the user appears emotionally distressed.
   - Alternative considered: generic sarcastic bot voice. Rejected because it would not fit the brand target and could create avoidable conflict.

## Risks / Trade-offs

- Threads Web changes or blocks automation -> show a clear collection failure, preserve the keyword, and allow manual link paste/import.
- AI over-generates offensive replies -> enforce a style/safety pass that keeps replies self-deprecating, funny, and non-offensive, with risk levels for each suggestion.
- Generated image provider is unavailable -> keep image prompts/suggestions and mark generated assets as unavailable instead of failing the whole result.
- Search results are noisy -> keep user keywords unchanged, deduplicate links, and let Kevin mark results as useful/irrelevant.
- Browser assistance may require logged-in local browser state -> document that the app does not store Threads credentials and surfaces login-required state clearly.
- Over-automation may risk the account -> final posting remains manual in this MVP.

## Migration Plan

No data migration is required because the product has not been implemented yet. The implementation should introduce persistence and versioning as part of the initial app skeleton.

## Open Questions

- Which image generation provider should be used when the first real image generation integration is added?
- Should patrol runs auto-refresh on a schedule, or only run when Kevin clicks into a card?
- Should the browser assistance run in a visible local browser only, or also support headless collection when stable?
