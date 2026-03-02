# Telegram Bot

> @SBNexusBot — 9 commands, 8 NLP intents, voice/image processing, nudge engine.

## Setup

### Bot Configuration

- **Bot**: @SBNexusBot (Nexus)
- **Library**: Telegraf v4.16.3
- **Production**: Webhook mode via `TELEGRAM_WEBHOOK_URL`
- **Development**: Polling mode (auto-restart with backoff)

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `AUTHORIZED_TELEGRAM_CHAT_IDS` | Yes (prod) | Comma-separated authorized chat IDs |
| `TELEGRAM_WEBHOOK_URL` | No | Webhook URL (polling if not set) |
| `TELEGRAM_WEBHOOK_SECRET` | No | Webhook validation secret |

### Getting Your Chat ID

1. Send any message to @SBNexusBot
2. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Find your `chat.id` in the response
4. Add to `AUTHORIZED_TELEGRAM_CHAT_IDS`

## Commands (9)

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with usage guide |
| `/agents` | List all available AI agents with slugs and roles |
| `/briefing` | Generate daily briefing via Chief of Staff |
| `/capture <text>` | Create capture item directly to inbox |
| `/today` | Show top 3 outcomes + urgent tasks + inbox count |
| `/tasks` | List active in_progress and next tasks (numbered, max 10) |
| `/done <number>` | Mark task as done by number from `/tasks` list |
| `/shop <item> [#category]` | Add to shopping list (#groceries, #household, #personal, #business) |
| `/clip <url>` | Clip web article to Knowledge Hub with auto-embedding for RAG |

## Agent Routing

- `@cmo <message>` → routes to CMO agent
- `@cto <message>` → routes to CTO agent
- `@<any-slug> <message>` → routes to that agent
- Plain text → routes to Chief of Staff (default)

## NLP Intents (8)

Natural language messages are processed by `server/channels/telegram-nlp-handler.ts`. Keyword gates prevent unnecessary LLM calls — GPT-4o-mini structured extraction only runs if keywords match.

### 1. morning_ritual

Track morning habits: press-ups, squats, water, supplements.

- **Keywords**: "press ups", "pushups", "squats", "supplements", "water", "morning ritual"
- **Shortcut**: "morning done" auto-completes all with defaults (50 reps/supplements/water)
- **Example**: `Did 60 press ups 50 squats water supplements` → logs all four

### 2. health_log

Track sleep, energy, mood, stress, weight, steps, fasting.

- **Keywords**: "slept", "sleep", "energy", "mood", "stress", "weight", "kg", "lbs", "body fat", "steps", "fasting"
- **Example**: `Slept 7h good, energy 4, weight 82kg` → creates health entry

### 3. workout

Log exercise sessions.

- **Keywords**: "workout", "gym", "trained", "ran", "cardio", "push day", "pull day", "leg day"
- **Example**: `Push day 45 mins, felt strong` → logs strength workout, 45 min

### 4. nutrition

Log meals with AI macro estimation.

- **Keywords**: "ate", "had for", "breakfast", "lunch", "dinner", "snack", "meal", "calories", "protein"
- **Example**: `Had grilled chicken salad for lunch` → GPT-4o-mini estimates macros, creates entry

### 5. daily_outcomes

Set top 3 priorities for the day.

- **Keywords**: "outcomes", "top 3", "top three", "today i want", "my goals", "focus today", "ship today"
- **Example**: `Top 3: Ship landing page, review proposals, gym session` → stores in day.top3Outcomes

### 6. evening_reflection

End-of-day reflection and mood assessment.

- **Keywords**: "day was", "reflection", "wrapping up", "productive day", "great day"
- **Example**: `Day was productive, shipped the feature, energy dipped after lunch` → updates day.reflectionPm

### 7. morning_done (shortcut)

Instant completion of all morning rituals without LLM call.

- **Exact match only**: "morning done", "morning complete", "rituals done", "habits done"
- Zero latency, no LLM cost

### 8. fasting

Track intermittent fasting windows.

- **Keywords**: "fasting", "fasted", "broke fast", "intermittent", "16:8", "18:6"
- **Example**: `Broke fast at 1pm, 16:8 today` → stores in health entry notes

### Multi-Intent Support

A single message can trigger multiple intents. Example:

> "morning done slept 8h energy 5 weight 81kg"

This triggers: `morning_ritual` (morning done shortcut) + `health_log` (sleep, energy, weight). All intents process and responses combine.

## Voice Processing

- **STT**: OpenAI Whisper — voice messages transcribed, then processed as text
- **TTS**: OpenAI TTS — responses can be sent back as voice
- Requires `OPENAI_API_KEY`

## Image Processing

- **Vision**: GPT-4o-mini with vision — meal photos analyzed for nutrition logging
- Photo messages sent to bot are analyzed and logged as nutrition entries

## Nudge Engine

5 check types running every 30 minutes:

1. **Morning ritual check** — nudge if rituals not started by 10am
2. **Outcomes check** — nudge if top 3 not set by 11am
3. **Health check** — nudge if no health entry by 2pm
4. **Nutrition check** — nudge if no meals logged by 3pm
5. **Evening reflection** — nudge if no reflection by 9pm

Exports `lastNudgeRunAt` for health monitoring.

## Webhook Gotchas

### Route Ordering (Critical)

Webhook POST route MUST be registered BEFORE `serveStatic()`/`setupVite()` SPA catch-all.

The SPA catch-all uses `app.use("*path")` which intercepts ALL HTTP methods including POST. If the webhook route is registered after it, Telegram gets `index.html` instead of a proper response.

### Body Consumption

Must use `bot.handleUpdate(req.body)` NOT `bot.webhookCallback()` because `express.json()` middleware consumes the raw body stream before Telegraf can read it.

### Webhook Removal

`removeTelegramWebhook()` in `server/index.ts` must be skipped when `TELEGRAM_WEBHOOK_URL` is set, otherwise it removes the production webhook on startup.

## Rate Limiting

- 10 messages per 60 seconds per chat (Telegram adapter)
- Long messages split at newlines with 4000 char buffer (Telegram's 4096 char limit)

## Message Logging

All messages (incoming and outgoing) logged to `telegram_messages` table with:
- `chatId`, `messageId`, `direction`, `content`, `sender`, `messageType`, `metadata`
