# Project Rules

This repository is a GitHub template. When a new project is generated from it, these rules activate immediately so any AI coding assistant follows the same workflow conventions from the first commit.

Edit this file freely to add stack-, domain-, or team-specific rules for your project. Keep the Skill Activation section so the bundled `skills/` and `.github/skills/` stay wired in.

## Local Docker Build — Company Network (READ FIRST)

If you are about to run `docker compose build` / `docker compose up --build` on a development workstation **inside the company network** (Evertrust / HousePrice / 永慶 office Wi-Fi, wired, VPN, or `ohousefun`), the default build path **will fail** because of corporate TLS inspection. Use this exact sequence:

```bash
# 1. Make sure the node base image is already pulled (host CA trusts the company root cert, container doesn't).
docker pull node:22-bookworm-slim     # do this on company net before step 2; once cached, step 2 won't refetch

# 2. Use the LEGACY builder (NOT BuildKit). BuildKit re-resolves the manifest over HTTPS and fails on cert verification.
DOCKER_BUILDKIT=0 docker compose build

# 3. Start
docker compose up -d

# 4. Verify
curl -s http://localhost:4323/api/health
# expected: {"ok":true,"version":"1.0.0"}
```

Why each step exists:

- **`docker pull` first**: on company net Docker Hub manifest fetch via BuildKit hits `tls: failed to verify certificate: x509: certificate signed by unknown authority`. A successful host-side `docker pull` lands the image into local cache where the legacy builder can pick it up without re-resolving the manifest.
- **`DOCKER_BUILDKIT=0`**: forces Docker's legacy builder. BuildKit always re-validates registry TLS even when the image is local; the legacy builder is happy with the local cache.
- **In-Dockerfile TLS bypass**: the `deps` stage of `Dockerfile` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` + `npm config set strict-ssl false` so `npm install` inside the build container survives the same TLS inspection. These lines are clearly marked **LOCAL-TEST ONLY** and must not propagate to a production runtime image.

Common symptoms and what they mean:

| Error | Means |
|-------|-------|
| `Head "https://registry-1.docker.io/...": tls: failed to verify certificate` | You ran with BuildKit. Re-run with `DOCKER_BUILDKIT=0`. |
| `npm error Exit handler never called` inside `RUN npm install` | `npm install` failed silently on TLS. The `Dockerfile` already adds the bypass; if you removed it, restore. |
| Container restart loop with `invalid ELF header` on `better_sqlite3.node` | A previous compose accidentally bind-mounted host `node_modules` into the Linux container. `docker-compose.yml` here only mounts `./data:/app/data`; do not add `./:/app`. |

Off-company-net (home, hotspot, RPi, etc.) the bypass is not needed but does no harm. **Do not** rebuild the image on a production host with these settings still active; switch to a Dockerfile variant that injects the corporate root CA via `update-ca-certificates` if you ever need to build from inside corporate net for a non-test deploy.

For full reasoning see `D:\Projects\_HomeProject\company-doc\skills\local-docker-corporate-network\SKILL.md`.

## Global Working Rules

- Read the current code, files, and runtime context before deciding on a change.
- Prefer the smallest correct fix over broad refactors.
- Fix root causes, not only visible symptoms or display-layer effects.
- When the best next step is already clear, execute it instead of asking redundant confirmation.
- Do not send the user through intermediate debugging steps you can perform directly.
- Do not use regex to parse structured formats when explicit parsing or a proper parser is more reliable.
- For new projects, major features, rewrites, or redesigns with unresolved decisions, present a reviewable plan before writing product code.
- Parallelize independent work when it meaningfully reduces turnaround; keep the main thread focused on coordination and synthesis.
- Frame each task clearly with the actual problem, constraints, and expected end state.
- Do not replace user intent with hardcoded fallback values after a failure.
- Retry transient external or AI failures with backoff; when retries are exhausted, surface the real failure.
- Add per-item timeouts to batched external calls so one slow request does not block the whole batch.
- Keep user keywords and search intent unchanged unless the user explicitly asked for transformation.
- Verify behavior in a real runnable environment whenever feasible.
- Do not claim CI, CD, deployment, or runtime success from guesswork; use trustworthy evidence.
- When a code change is complete, treat follow-through as part of the work, not an optional extra.
- Every code change must update memory, update spec, commit, and push unless the user explicitly says not to.
- Prefer commit-first, push-later batching for larger work groups when repeated pushes would only retrigger CI/CD without adding review value.
- If a requirement should govern future implementation, write it into the formal rule sources instead of leaving it only in chat context.
- Avoid magic numbers in implementation; prefer existing enums, or introduce named constants when no enum exists.
- Before commit, confirm AI-generated methods, classes, and files are actually used; remove unused junk instead of committing it.
- Build checks before commit must use the repo's concrete command(s), not vague "validation" language.
- For any non-trivial feature request or requirement, first confirm requirements with the user and define OpenSpec before implementation.
- For major changes, use a brainstorming step before proposal or implementation.

## Skill Activation Rules

Treat the following skill files as active workflow rules for this workspace, even if the host AI environment does not expose them through a built-in skill registry. Apply them automatically by task type:

- Treat `skills/execution-style/SKILL.md` as the default execution behavior for normal implementation work
- Treat `skills/plan-before-build/SKILL.md` as mandatory for new projects, major features, and large redesigns before implementation begins
- Treat `skills/project-stack-standard/SKILL.md` as mandatory when choosing or reviewing app/service stack, backend setup, database choice, or monorepo structure
- Treat `skills/root-cause-debugging/SKILL.md` as mandatory for bug investigation and regressions
- Treat `skills/integration-robustness/SKILL.md` as mandatory for AI calls, external APIs, retries, and batched integrations
- Treat `skills/verification-and-evidence/SKILL.md` as mandatory when reporting runtime, CI, CD, or deployment status
- Treat `skills/agent-design/SKILL.md` as mandatory for multi-agent or tool-enabled agent architecture work
- Treat `skills/completion-checklist/SKILL.md` as mandatory for any code change before reporting completion
- Treat `skills/deployment/SKILL.md` as mandatory for deployment, Docker, reverse-proxy, CI/CD, and release work
- Treat `skills/frontend-design/SKILL.md` as mandatory for frontend creation or redesign work
- Treat `skills/key-pool-standard/SKILL.md` as mandatory for any AI key-pool, quota, or multi-key retry implementation
- Treat `skills/skill-creator/SKILL.md` as the active workflow when creating, improving, or evaluating a skill
- Treat `.github/skills/openspec-explore/SKILL.md` as the active workflow when the user wants exploration without implementation
- Treat `.github/skills/openspec-propose/SKILL.md` as the active workflow when creating a new OpenSpec change
- Treat `.github/skills/openspec-apply-change/SKILL.md` as the active workflow when implementing an OpenSpec change
- Treat `.github/skills/openspec-archive-change/SKILL.md` as the active workflow when archiving a completed OpenSpec change

Mirror locations (`.claude/skills/`, `.gemini/skills/`, `.opencode/skills/`, `.github/skills/`) hold the same OpenSpec workflow skills so Claude Code, Gemini CLI, opencode, and GitHub Copilot all see them. The canonical source for general workflow skills lives in `skills/`.

## Persistent Standards

- Every code change must update memory (if applicable), update OpenSpec (if applicable), commit, and push; larger work batches may commit in checkpoints and push once the batch is ready. Rule home: `skills/completion-checklist/SKILL.md`.
- Complex tasks must carry workflow checkpoints in the task list, and major task boundaries must trigger a fresh rule check. Rule home: `skills/execution-style/SKILL.md` and `skills/completion-checklist/SKILL.md`.
- Any requirement that should govern future implementation must be written into the formal rule sources (this file or a skill), not left only in chat context. Rule home: `skills/execution-style/SKILL.md`.
- Any non-trivial feature request should first go through an exploration/confirmation step and be captured in OpenSpec before implementation.

## When To Remove Or Replace Skills

- Remove `skills/frontend-design/` if the project has no frontend.
- Remove `skills/key-pool-standard/` if the project does not use AI API keys.
- Remove `skills/agent-design/` if the project is not building AI agents.
- Keep `skills/execution-style/`, `skills/completion-checklist/`, `skills/plan-before-build/`, `skills/root-cause-debugging/`, `skills/verification-and-evidence/`, and `skills/integration-robustness/` for any project.
- If you delete a skill, also delete its line in the Skill Activation Rules above.
