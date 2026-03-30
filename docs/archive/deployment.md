# Deployment

> Railway hosting with Docker, auto-deploy from GitHub.

## Railway Configuration

| Setting | Value |
|---------|-------|
| Service | aura |
| GitHub Repo | `sayedbaharun/aura` (auto-deploy on push to main) |
| Builder | Docker (via `Dockerfile`) |
| Runtime Port | 8080 |
| Database | Neon Serverless PostgreSQL (external) |
| Live URL | `https://sbaura.up.railway.app` |

## Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8080
ENV PORT=8080
CMD ["npm", "run", "start"]
```

Uses Docker instead of Railway's Railpack builder to avoid aggressive caching issues.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SESSION_SECRET` | Express session encryption key (`openssl rand -base64 32`) |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI inference |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `AUTHORIZED_TELEGRAM_CHAT_IDS` | Comma-separated authorized chat IDs |
| `PORT` | Server port (Railway sets to 8080) |
| `NODE_ENV` | `production` |

### Optional — AI & Memory

| Variable | Description |
|----------|-------------|
| `QDRANT_URL` | Qdrant Cloud endpoint |
| `QDRANT_API_KEY` | Qdrant authentication |
| `PINECONE_API_KEY` | Pinecone cloud backup |
| `PINECONE_INDEX` | Pinecone index name (default: `sbos-memory`) |
| `CEREBRAS_API_KEY` | Fast inference for compaction |
| `FALKORDB_URL` | FalkorDB graph (gracefully degrades) |
| `MEMORY_API_KEY` | Scoped API key for mobile memory endpoints |

### Optional — Integrations

| Variable | Description |
|----------|-------------|
| `TELEGRAM_WEBHOOK_URL` | Webhook URL for production (polling if not set) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook validation |
| `GOOGLE_CALENDAR_CLIENT_ID` | Google Calendar OAuth |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar OAuth |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Google Calendar OAuth |
| `GMAIL_CLIENT_ID` | Gmail OAuth |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth |
| `GMAIL_REFRESH_TOKEN` | Gmail OAuth |
| `TICKTICK_ACCESS_TOKEN` | TickTick integration |
| `BRAVE_SEARCH_API_KEY` | Web search for agents |
| `OPENAI_API_KEY` | Whisper STT + TTS for voice |

### Optional — Deploy Tools

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | For agent deploy tool — Vercel |
| `VERCEL_TEAM_ID` | Vercel team scope |
| `RAILWAY_TOKEN` | For agent deploy tool — Railway |

## Deployment Commands

```bash
# Deploy via git push (recommended — triggers auto-deploy)
git push origin main

# Check deployment status
railway status

# View logs
railway logs

# Redeploy current commit
railway redeploy -y
```

## Multi-Project Deploy Map

| Code Location | Railway Project | Auto-Deploys From |
|---|---|---|
| `SBOS/` (this repo) | SB-OS | `sayedbaharun/aura` push |
| `hikmadigital/` (root) | hikma-digital | `sayedbaharun/hikmadigital` push |
| `hikmadigital/hikmaclaw/` | hikmaclaw | `sayedbaharun/hikma-engine` push OR `railway up` |

## Database

- **Provider**: Neon Serverless PostgreSQL
- **Schema**: Drizzle ORM (`shared/schema.ts`)
- **Migration**: `npm run db:push` (Drizzle Kit push)
- No explicit migration files — Drizzle Kit compares schema to DB and applies changes

## Post-Deployment Verification

The server automatically on startup:

1. Runs `ensureSchema()` for DB initialization
2. Seeds default categories
3. Configures Telegram webhook (if `TELEGRAM_WEBHOOK_URL` set)
4. Initializes agent scheduler (loads all agent schedules from DB)
5. Starts channel adapters (Telegram)
6. Starts automations (daily day creation, reminders, RAG embeddings)
7. Syncs Knowledge Hub to Qdrant

Check logs for: `SB-OS automations initialized` and `Agent scheduler initialized: X jobs for Y agents`.

## Health Checks

- `GET /api/health` — basic server health (no auth required)
- System health monitor runs hourly (pipeline, embeddings, scheduler, nudge engine, Telegram)
- Issues reported via Telegram in morning check-in and evening review

## Known Issues

| Issue | Solution |
|-------|----------|
| Railpack cache reusing old images | Use Dockerfile instead of Railpack |
| `npm ci` lockfile sync errors | Regenerate `package-lock.json` with same Node/npm as Dockerfile |
| `ERR_ERL_KEY_GEN_IPV6` from rate limiter | Add `validate: { keyGeneratorIpFallback: false }` |
| `railway up` hanging on "Indexing..." | Use `git push` instead for large projects |
| Webhook route not receiving Telegram POSTs | Ensure webhook route is before SPA catch-all in `server/index.ts` |

## Rollback

```bash
# View recent deployments
railway deployments

# Rollback to previous commit
git revert HEAD
git push origin main

# Or redeploy a specific commit
railway redeploy --commit <sha>
```
