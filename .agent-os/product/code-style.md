# Code Style

## Engineering Philosophy

- Every file, function, and module must have an obvious reason to exist — if you can't explain it in one sentence, it shouldn't be there
- Write for the junior engineer reading it six months from now, not for the machine running it today
- No code for the sake of code — no over-engineering, no premature abstraction, no scaffolding that isn't immediately used
- Three similar lines is better than a wrong abstraction — only abstract when the pattern is proven and stable
- If a piece of code needs a comment to explain what it does, rename it instead
- No dead code — delete it, don't comment it out
- New modules follow existing patterns — check how adjacent files are structured before inventing something new

## Codebase Legibility

- Folder structure mirrors the mental model: `server/agents/` contains agents, `server/channels/` contains channel adapters, `server/memory/` contains memory — never cross-contaminate
- File names describe exactly what's inside — `venture-onboarding.ts` contains venture onboarding logic, nothing else
- Functions do one thing — if a function name has "and" in it, split it
- Keep files under 300 lines — if a file grows beyond that, it's doing too much
- New modules get a single-line header comment stating what the module does and why it exists — this is the one exception to the no-comments rule

## Decision Traceability

- Any non-obvious architectural choice must have a corresponding entry in `.agent-os/product/decisions.md`
- Future engineers should be able to read `decisions.md` and understand why the system is shaped the way it is
- "We tried X, it failed because Y, so we chose Z" is more valuable than any amount of inline comments

## TypeScript

- Always explicit types on function parameters and return values — no implicit `any`
- Use `type` not `interface` for object shapes unless extending
- `String(req.params.x)` always — Express v5 params return `string | string[]`
- `z.record(z.string(), z.unknown())` — Zod v4 requires 2 args
- Use `.issues` not `.errors` on Zod validation results
- Pre-existing TS errors in the codebase are not blockers — don't fix unrelated errors

## File & Folder Naming

- Server modules: `kebab-case.ts`
- React components: `PascalCase.tsx`
- Skills: `kebab-case/SKILL.md`
- Test files: `*.test.ts` co-located with the module they test

## Imports & Modules

- ESM only — no `require()` except Playwright (dynamic require to avoid TS module resolution errors)
- No `__dirname` — use `fileURLToPath(import.meta.url)` + `path.dirname()`
- No spread on iterables — use `Array.from(new Set(...))` or `Array.from(map.values())`
- No `s` (dotAll) regex flag — use `[\s\S]`

## React & Frontend

- shadcn/ui components first — never build a custom component if one already exists
- Tailwind v3.4.19 — not v4
- TanStack Query for all data fetching — no raw `fetch` in components
- `React.lazy` + `Suspense` on all new pages

## API Routes

- All routes in `server/routes/` — not inline in `routes.ts`
- Validate all inputs with Zod at the route boundary
- Consistent response shape: `{ data }` on success, `{ error, message }` on failure
- No business logic in route handlers — delegate to storage or service layer

## Database

- Schema changes in `/shared/schema.ts` only — never anywhere else
- Run `npm run db:push` to apply — never edit migration files manually
- Drizzle ORM for all queries — no raw SQL except in memory/search arms

## Comments

- No comments unless the WHY is non-obvious — a hidden constraint, a known bug workaround, a non-obvious invariant
- No docstrings, no multi-line comment blocks
- No "added for X", "used by Y", "handles case from issue Z" — those belong in the PR description or `decisions.md`

## Cron & Scheduling

- Always pass explicit IANA timezone — default `Asia/Dubai`
- node-cron v4 + cron-parser v5
