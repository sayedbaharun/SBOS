# Development Best Practices

## AI-Native Development Principles

> This is the most important section. Every other decision flows from this.

Every venture and every feature is built AI-first by default. Agents are the primary operators — humans approve, direct, and decide, but do not execute routine work.

- Before building any feature, ask: can an agent trigger this, execute this, or monitor this? If yes, make sure it can.
- API first, UI second — agents can't click buttons, they call endpoints. Build the API before the interface.
- Every significant operation must be triggerable without a human in the loop — manual-only operations are a design gap, not a feature
- Return structured JSON with consistent schemas everywhere — agents parse responses, not humans. Unstructured text has no place in internal APIs.
- Publish events to the message bus when state changes — agents should react to events, not poll for them
- New capabilities belong in `agent-tools.ts` if an agent might ever need to call them — tool registration is not optional
- Name functions and endpoints descriptively enough that an LLM can infer their purpose from the name alone — `createVentureOnboardingRun()` not `run()`
- When in doubt, over-expose rather than under-expose — it's easier to restrict access to a tool than to add one mid-execution
- The goal is zero-human-required operation — every feature should move the system closer to full autonomy

---

## How to Approach a New Feature

- Read the spec fully before writing a single line — understand the what and the why before the how
- Find existing patterns in the codebase before building something new — check adjacent modules first
- Build the smallest version that satisfies the spec — no future-proofing that isn't in the spec
- Complete one task fully before starting the next — no half-finished work left in the codebase

## Testing

- Use Vitest — test files co-located with the module (`venture-onboarding.test.ts` next to `venture-onboarding.ts`)
- Write tests for delegation logic, memory lifecycle, retrieval arms, and scheduler — these are the critical paths
- Test behaviour, not implementation — test what the function does, not how it does it
- Don't mock the database unless unavoidable — integration tests against a real DB catch what unit tests miss
- Pre-existing test failures unrelated to your change are not your problem to fix

## Deployment

- `git push origin main` only — never `railway up` for SB-OS
- Never say "deployed" without confirming the Railway build started and passed
- Vercel deploys auto-trigger on push — confirm the Vercel dashboard shows a successful build before calling it done
- New environment variables must be added to Railway (and Vercel if applicable) before the code that needs them is deployed — deploy order matters

## Environment Variables

- Never commit secrets or `.env` files
- Add new vars to Railway via dashboard, not CLI — so they're visible and auditable
- Document every new env var in the relevant `CLAUDE.md` env config section immediately — don't leave it undocumented
- Use descriptive names: `GOOGLE_SERVICE_ACCOUNT_JSON` not `GSA_KEY`

## Error Handling

- Handle errors at system boundaries only — user input, external APIs, file system
- Don't wrap internal function calls in try/catch unless they can genuinely fail in a recoverable way
- Log errors with enough context to debug without reproducing — include the operation, the input shape, and the error message
- Never swallow errors silently — if you catch, you must log or rethrow
- Never expose internal error messages to API responses — log internally, return a generic message externally

## Security

- Rate limiting is already implemented globally in SB-OS — don't add per-route rate limiting unless specifically needed
- Validate all external inputs at the route boundary with Zod — trust nothing from `req.body`, `req.params`, or `req.query`
- Auth check before any data access — no route returns data without confirming session

## Adding New Database Tables

- Define schema in `/shared/schema.ts` — never anywhere else
- Run `npm run db:push` to apply — never edit migration files manually
- Every new table needs a clear single responsibility — if you can't name it without "and", split it
- Add indexes on any column used in a frequent `WHERE` clause

## Adding New API Endpoints

- Route file goes in `server/routes/` — register it in `server/routes.ts`
- Follow the existing pattern: validate input → call storage/service → return consistent shape
- Document the endpoint in the relevant `CLAUDE.md` API reference section immediately after building it

## Adding New Agents

- Soul template goes in `server/agents/templates/` as a markdown file with YAML frontmatter
- Required frontmatter fields: `model_tier`, `memory_scope`, `schedule`, `delegates_to`, `permissions` — missing any causes silent fallback to defaults
- Add a CRITICAL section to the template if the agent must call tools — models sometimes write text instead of calling tools without it
- Seed via `POST /api/agents/admin/seed` after pushing

## Dependencies

- Check the existing stack before adding anything — the functionality may already exist
- Every new dependency must be justified in the spec's `technical-spec.md` under External Dependencies
- Prefer packages with >1M weekly downloads for anything in the critical path
- Don't add a package to solve a problem that's 10 lines of code

## Pre-Ship Checklist

- [ ] `npm run check` passes with no new errors introduced
- [ ] Relevant tests pass
- [ ] New env vars documented and added to Railway/Vercel
- [ ] New endpoints documented in `CLAUDE.md`
- [ ] New agent tools registered in `agent-tools.ts`
- [ ] `decisions.md` updated if an architectural choice was made
- [ ] Railway or Vercel build confirmed successful after push
