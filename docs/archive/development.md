# Development Guide

> Local setup, code patterns, and contributing.

## Local Setup

```bash
# Clone
git clone https://github.com/sayedbaharun/aura.git sbos
cd sbos

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# At minimum, set: DATABASE_URL, OPENROUTER_API_KEY, SESSION_SECRET

# Push database schema
npm run db:push

# Start dev server (frontend + backend)
npm run dev
```

The dev server runs at `http://localhost:5000` with Vite HMR for the frontend.

### First Run

After the server is running, seed the agent templates:

```bash
curl -X POST http://localhost:5000/api/agents/admin/seed \
  -H "Content-Type: application/json"
```

Then visit `http://localhost:5000` to set up your password.

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (tsx + Vite HMR) |
| `npm run build` | Build for production (Vite + esbuild) |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push schema changes to database |
| `npm run mcp` | Start MCP server |

## Code Patterns

### API Routes

Routes live in `server/routes/*.ts`. Each file exports a Router:

```typescript
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { insertThingSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// GET with filters
router.get("/", async (req: Request, res: Response) => {
  const things = await storage.getThings(req.query);
  res.json(things);
});

// POST with Zod validation
router.post("/", async (req: Request, res: Response) => {
  const data = insertThingSchema.parse(req.body);
  const thing = await storage.createThing(data);
  res.status(201).json(thing);
});

export default router;
```

Register in `server/routes/index.ts`.

### Database Queries (Drizzle ORM)

All DB operations go through `server/storage.ts`:

```typescript
// Query
const tasks = await db.select().from(tasks)
  .where(eq(tasks.ventureId, ventureId))
  .orderBy(desc(tasks.createdAt));

// Insert
const [task] = await db.insert(tasks)
  .values(data)
  .returning();

// Update
const [updated] = await db.update(tasks)
  .set({ status: "completed" })
  .where(eq(tasks.id, id))
  .returning();
```

### Frontend Data Fetching (TanStack Query)

```typescript
// Query hook
const { data: tasks } = useQuery({
  queryKey: ["/api/tasks", { venture_id: ventureId }],
  queryFn: () => fetch(`/api/tasks?venture_id=${ventureId}`).then(r => r.json()),
});

// Mutation
const mutation = useMutation({
  mutationFn: (data) => fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
});
```

### Zod Validation

All inputs validated with Zod v4. Schema defined in `shared/schema.ts`:

```typescript
export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
```

## Database Changes

1. Edit `shared/schema.ts` — add/modify table definitions
2. Run `npm run db:push` — Drizzle Kit compares and applies changes
3. If adding a new table, add storage methods to `server/storage.ts`
4. Create route file if needed in `server/routes/`

No migration files — Drizzle Kit handles diffing automatically.

## Adding UI Components (shadcn/ui)

```bash
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add form
```

Components install to `client/src/components/ui/`.

## Adding Pages

1. Create page in `client/src/pages/my-page.tsx`
2. Add route in `client/src/App.tsx`:
   ```tsx
   <Route path="/my-page" component={MyPage} />
   ```
3. Add nav item in `client/src/components/sidebar/sidebar.tsx`

## Agent Templates

Soul templates live in `server/agents/templates/*.md`. Format:

```markdown
---
name: Agent Name
slug: agent-slug
role: specialist
parent: parent-slug
model_tier: fast
temperature: 0.6
available_tools:
  - web_search
  - create_task
can_delegate_to: []
max_delegation_depth: 0
---

# Agent Name

## Identity
You are the Agent Name for SB-OS...

## Responsibilities
- ...

## Rules
- ...
```

After modifying templates, re-seed: `POST /api/agents/admin/seed`.

## TypeScript

```bash
npm run check
```

Note: There are pre-existing client-side TS errors in the codebase. These are not blockers for development. Server-side errors are more critical:

```bash
npx tsc -p tsconfig.server.json --noEmit
```

## Key Gotchas

- **Zod v4**: `z.record()` requires 2 args: `z.record(z.string(), z.unknown())`
- **Express v5**: `req.params.x` returns `string | string[]`, cast with `String()`
- **ESM**: No `__dirname` — use `fileURLToPath(import.meta.url)` + `path.dirname()`
- **Tailwind v3**: Uses `@tailwind base/components/utilities` syntax, NOT v4
- **Regex**: Target doesn't support `s` flag — use `[\s\S]` instead
- **Set spread**: `--downlevelIteration` not enabled — use `Array.from(new Set(...))` not `[...new Set(...)]`

## Testing

```bash
# Run tests
npx vitest

# Run with UI
npx vitest --ui

# Run with coverage
npx vitest --coverage
```

Test framework: Vitest with happy-dom for browser environment simulation.

## Project Structure

```
client/src/
├── components/
│   ├── ui/          # shadcn/ui primitives
│   └── sidebar/     # Navigation
├── pages/           # Route pages
├── hooks/           # TanStack Query hooks
└── lib/             # Utilities

server/
├── routes/          # 40+ API route modules
├── agents/          # Agent system
│   ├── templates/   # 13 soul templates
│   └── tools/       # Agent tools
├── channels/        # Communication adapters
├── infra/           # Resilience layer
├── memory/          # Memory pipeline
├── telegram/        # Telegram bot
├── storage.ts       # All DB operations
└── index.ts         # Entry point

shared/
└── schema.ts        # Drizzle schema (64 tables)
```
