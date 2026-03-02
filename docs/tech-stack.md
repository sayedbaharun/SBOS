# Tech Stack

## Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.x | UI framework |
| Wouter | 3.x | Client-side routing |
| TanStack Query | 5.x | Server state management, caching |
| shadcn/ui | latest | Component library (Radix primitives) |
| Tailwind CSS | 3.4.19 | Utility-first styling |
| BlockNote | 0.46.x | Rich text editor (documents) |
| Recharts | 3.x | Data visualization |
| Framer Motion | 12.x | Animations |
| Lucide React | 0.574+ | Icons |
| React Hook Form | 7.x | Form handling |
| cmdk | 1.x | Command palette |
| react-resizable-panels | 4.x | Resizable layouts |
| Vaul | 1.x | Drawer component |

## Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20+ | Runtime |
| Express | 5.x | HTTP server |
| TypeScript | 5.9 | Type system |
| Drizzle ORM | 0.45+ | Database queries and schema |
| Zod | 4.x | Runtime validation |
| node-cron | 4.x | Scheduled jobs |
| Telegraf | 4.16.3 | Telegram bot framework |
| Passport | 0.7 | Authentication |
| express-session | 1.19 | Session management |
| Helmet | 8.x | Security headers |
| express-rate-limit | 8.x | Rate limiting |
| Pino | 10.x | Structured logging |
| Multer | 2.x | File uploads |

## Database & Storage

| Technology | Version | Purpose |
|-----------|---------|---------|
| Neon Serverless PostgreSQL | — | Primary database (64 tables) |
| @neondatabase/serverless | 1.x | Neon driver |
| Drizzle Kit | 0.31+ | Schema migrations (`npm run db:push`) |
| connect-pg-simple | 10.x | Session store |

## AI & Machine Learning

| Technology | Purpose | Model |
|-----------|---------|-------|
| OpenRouter | Multi-model LLM inference | Claude Opus/Sonnet/Haiku, GPT-4o-mini |
| Cerebras | Fast inference (compaction) | Llama 3.3 70b |
| OpenAI SDK | API client (OpenRouter-compatible) | — |
| text-embedding-3-small | Embeddings (via OpenRouter) | 1536 dimensions |

## Vector & Graph Databases

| Technology | Version | Purpose |
|-----------|---------|---------|
| Qdrant | 1.16+ (client) | Primary vector search |
| Pinecone | 7.x (client) | Cloud vector backup (512-dim) |
| FalkorDB | 6.x (client) | Knowledge graph (optional) |

## External Integrations

| Service | Library/Protocol | Purpose |
|---------|-----------------|---------|
| Telegram | Telegraf | Bot interface |
| Google Calendar | googleapis | Meeting sync |
| Google Drive | googleapis | File storage |
| Gmail | googleapis | Email features |
| TickTick | REST API | Mobile capture |
| Brave Search | REST API | Web search for agents |
| MCP | @modelcontextprotocol/sdk | Claude Code integration |
| Notion | @notionhq/client | Import (optional) |

## Build & Deploy

| Technology | Version | Purpose |
|-----------|---------|---------|
| Vite | 7.x | Frontend bundler + dev server |
| esbuild | 0.27+ | Server bundler |
| Docker | — | Container (node:20-slim) |
| Railway | — | Hosting + auto-deploy |
| tsx | 4.x | TypeScript execution (dev) |
| Vitest | 4.x | Testing framework |

## Key Version Notes

- **Tailwind CSS v3** (3.4.19) — NOT v4. Uses `@tailwind base/components/utilities` syntax with `tailwind.config.ts`
- **Zod v4** — `z.record()` requires 2 args: `z.record(z.string(), z.unknown())`
- **Express v5** — `req.params.x` returns `string | string[]`, needs `String()` cast
- **ESM modules** — `__dirname` not available; use `fileURLToPath(import.meta.url)` + `path.dirname()`
- **Node.js 20+** — Target doesn't support `s` (dotAll) regex flag; use `[\s\S]` instead
