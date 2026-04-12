// Load environment variables from .env file (must be first)
import 'dotenv/config';
// Build: 2026-02-20T16:00

import crypto from "crypto";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import session from "express-session";
import rateLimit from "express-rate-limit";
import connectPgSimple from "connect-pg-simple";
import pkg from "pg";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logger as appLogger } from "./logger";
import { storage } from "./storage";
import { validateEnvironmentOrExit } from "./env-validator";

const { Pool } = pkg;

// Validate environment variables before starting the application
validateEnvironmentOrExit();

const app = express();

// Trust proxy for Railway/production deployments
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ============================================================================
// SECURITY: HTTP Headers with Helmet
// ============================================================================
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  // Content Security Policy - prevents XSS and injection attacks
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for Vite in dev
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://r2cdn.perplexity.ai"],
      connectSrc: ["'self'", "https://openrouter.ai", "https://api.telegram.org", "https://oauth2.googleapis.com", "https://www.googleapis.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  } : false, // Disable in development for Vite HMR
  crossOriginEmbedderPolicy: false,
  // Additional security headers
  hsts: isProduction ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true, // Prevents MIME sniffing
  xDnsPrefetchControl: { allow: false },
  xFrameOptions: { action: 'deny' }, // Prevents clickjacking
  xXssProtection: true,
}));

// ============================================================================
// SECURITY: Rate Limiting - Prevents brute force and DoS attacks
// ============================================================================

// Global rate limiter - protects non-API routes from abuse
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 100 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip /health, dev HMR paths, and /api (has its own limiter below to avoid stacking)
  skip: (req) =>
    req.path === '/health' ||
    req.path.startsWith('/@') ||
    req.path.startsWith('/node_modules') ||
    req.path.startsWith('/src') ||
    req.path.startsWith('/api'),
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API rate limiter — authenticated users get a bypass (single-user personal app).
// Unauthenticated traffic (bots, scrapers) is still capped.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 200 : 500,
  message: { error: 'API rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !!(req as any).session?.userId,
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// ============================================================================
// SECURITY: CORS Configuration - Strict origin validation
// ============================================================================
const buildAllowedOrigins = () => {
  const origins: string[] = [];

  // Only allow localhost in development
  if (!isProduction) {
    origins.push('http://localhost:5000', 'http://localhost:5173');
  }

  // Add Railway deployment domain (automatically set by Railway)
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    origins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }

  // Add custom origins from environment variable
  if (process.env.ALLOWED_ORIGINS) {
    const customOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    origins.push(...customOrigins);
  }

  return origins;
};

const allowedOrigins = buildAllowedOrigins();

app.use(cors({
  origin: (origin, callback) => {
    // In production, require origin header (block requests without origin except from same-origin)
    if (isProduction && !origin) {
      // Allow same-origin requests (browser requests from the app itself)
      callback(null, true);
      return;
    }

    // In development, allow no-origin requests (curl, Postman, etc.)
    if (!origin && !isProduction) {
      callback(null, true);
      return;
    }

    if (origin && allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (!isProduction) {
      // Be more permissive in development
      callback(null, true);
    } else {
      log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400, // 24 hours
}));

// ============================================================================
// SECURITY: Session Configuration
// ============================================================================
const PgSession = connectPgSimple(session);

// Create a pool for session storage
// Default: Allow self-signed certificates (common for Railway/Neon)
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" } : false,
  // Connection pool settings to prevent ERR_CONNECTION_RESET on Neon/Railway
  max: 5, // Fewer connections needed for sessions
  min: 1, // At least 1 connection
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return error after 10 seconds if no connection
  keepAlive: true, // Enable TCP keep-alive
  keepAliveInitialDelayMillis: 10000, // Start keep-alive after 10 seconds of idle
});

// Handle session pool errors to prevent unhandled exceptions
sessionPool.on('error', (err) => {
  log(`Session pool error: ${err.message}`);
});

// SESSION_SECRET is validated in env-validator.ts - this will fail in production if not set
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production-unsafe';

app.use(session({
  store: new PgSession({
    pool: sessionPool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: sessionSecret,
  name: 'sbos.sid', // Custom cookie name (don't reveal we're using Express)
  resave: false,
  saveUninitialized: false,
  rolling: true, // Refresh session on activity
  cookie: {
    httpOnly: true, // Prevents XSS attacks from reading cookie
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? 'strict' : 'lax', // CSRF protection
    maxAge: 4 * 60 * 60 * 1000, // 4 hours (reduced from 24 for security)
  },
}));

// CSRF Token middleware - generates token for forms
app.use((req, res, next) => {
  // Generate CSRF token if not present
  const session = req.session as any;
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = session.csrfToken;
  next();
});

// ============================================================================
// SECURITY: Request Body Size Limits
// ============================================================================
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure database schema is up to date (auto-migration for critical fixes)
  await storage.ensureSchema();

  const server = await registerRoutes(app);

  // Initialize WebSocket event bus for real-time dashboard updates
  try {
    const { initWebSocket } = await import('./ws/event-bus');
    initWebSocket(server);
    log('✓ WebSocket event bus initialized on /ws');
  } catch (wsError) {
    log('WebSocket setup skipped:', String(wsError));
  }

  // Register Telegram webhook route BEFORE the SPA catch-all
  // The catch-all in serveStatic/setupVite uses app.use("*path") which intercepts ALL methods including POST
  // So this must be registered first to ensure Telegram POSTs reach the handler
  if (process.env.TELEGRAM_WEBHOOK_URL && process.env.TELEGRAM_BOT_TOKEN) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    // Dedup: track recent update_ids to prevent double-processing on webhook retries
    const recentUpdateIds = new Map<number, number>(); // update_id -> timestamp
    const DEDUP_MAX_SIZE = 1000;
    const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

    app.post('/api/telegram/webhook', async (req, res) => {
      try {
        // Validate secret token if configured
        if (secret) {
          const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
          if (headerSecret !== secret) {
            log('Telegram webhook: secret mismatch');
            res.status(403).json({ error: 'Forbidden' });
            return;
          }
        }

        const update = req.body;
        const updateId = update?.update_id;

        // Dedup check
        if (updateId && recentUpdateIds.has(updateId)) {
          log(`Telegram webhook: duplicate update_id=${updateId}, ignoring`);
          res.status(200).json({ ok: true });
          return;
        }

        // Track this update_id
        if (updateId) {
          recentUpdateIds.set(updateId, Date.now());
          // Evict old entries
          if (recentUpdateIds.size > DEDUP_MAX_SIZE) {
            const now = Date.now();
            Array.from(recentUpdateIds.entries()).forEach(([id, ts]) => {
              if (now - ts > DEDUP_TTL_MS) recentUpdateIds.delete(id);
            });
          }
        }

        // Dynamically get the adapter's bot (it's initialized in the listen callback)
        const { telegramAdapter } = await import('./channels/adapters/telegram-adapter');
        const bot = telegramAdapter.bot;
        if (!bot) {
          log('Telegram webhook: bot not yet initialized');
          res.status(200).json({ ok: true });
          return;
        }

        log(`Telegram webhook: update_id=${updateId}, has_message=${!!update.message}, text="${update.message?.text || 'N/A'}", chat_id=${update.message?.chat?.id || 'N/A'}`);

        // Respond immediately — don't let agent processing block the webhook
        res.status(200).json({ ok: true });

        // Process asynchronously with timeout
        const WEBHOOK_TIMEOUT_MS = 120_000; // 2 minutes
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Webhook processing timed out after 120s")), WEBHOOK_TIMEOUT_MS)
        );

        Promise.race([
          bot.handleUpdate(update),
          timeoutPromise,
        ]).catch((err) => {
          log('Telegram webhook async processing error:', String(err));
          // Try to notify the user if possible
          const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
          if (chatId) {
            bot.telegram.sendMessage(chatId, "Sorry, that took too long to process. Please try again.")
              .catch(() => {}); // Best effort
          }
        });
      } catch (err) {
        log('Telegram webhook handleUpdate error:', String(err));
        res.status(200).json({ ok: true }); // Always 200 to Telegram
      }
    });
    log('✓ Telegram webhook route registered at /api/telegram/webhook (before SPA catch-all)');
  }

  // WhatsApp webhook routes (Cloud API requires GET for verification, POST for events)
  if (process.env.WHATSAPP_ACCESS_TOKEN) {
    app.get('/api/webhooks/whatsapp', (req, res) => {
      import('./channels/adapters/whatsapp-adapter').then(({ whatsappWebhookVerify }) => {
        whatsappWebhookVerify(req, res);
      }).catch(() => res.sendStatus(500));
    });

    app.post('/api/webhooks/whatsapp', (req, res) => {
      import('./channels/adapters/whatsapp-adapter').then(({ whatsappWebhookHandler }) => {
        whatsappWebhookHandler(req, res);
      }).catch(() => res.sendStatus(200)); // Always 200 to WhatsApp
    });

    log('✓ WhatsApp webhook routes registered at /api/webhooks/whatsapp');
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // FORCE_STATIC=1 can be used to serve production build in development mode
  const forceStatic = process.env.FORCE_STATIC === '1' || process.env.FORCE_STATIC === 'true';

  if (app.get("env") === "development" && !forceStatic) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Error handler MUST be registered AFTER all other middleware/routes
  // to catch errors from static serving and all other handlers
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Use structured logger so stack traces appear in Railway logs
    appLogger.error({ err, status }, `Unhandled ${status}: ${message}`);

    const body: Record<string, any> = { message };
    if (process.env.NODE_ENV !== "production") {
      body.detail = String(err);
    }
    res.status(status).json(body);
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: process.platform === 'linux', // Only supported on Linux
  }, async () => {
    log(`serving on port ${port}`);

    // Seed default categories if needed
    try {
      const { seedCategories } = await import('./seed-categories');
      await seedCategories();
      log('✓ Categories seeding check complete');
    } catch (error) {
      log('Categories seeding skipped:', String(error));
    }

    // Clear stale Telegram webhook ONLY if we're using polling mode
    // If TELEGRAM_WEBHOOK_URL is set, the adapter will set its own webhook
    if (!process.env.TELEGRAM_WEBHOOK_URL) {
      try {
        const { removeTelegramWebhook } = await import('./telegram-bot');
        await removeTelegramWebhook();
        log('✓ Telegram webhook cleared (using polling via channel adapter)');
      } catch (error) {
        log('Telegram webhook cleanup skipped:', String(error));
      }
    } else {
      log('✓ Telegram webhook mode — skipping webhook cleanup');
    }

    // Initialize SB-OS automations
    if (process.env.DISABLE_CRONS === 'true') {
      log('⏸ SB-OS automations DISABLED (DISABLE_CRONS=true) — no crons, no agent scheduler, no nudges');
    } else try {
      const { scheduleDailyDayCreation } = await import('./automations/daily-day-creation');
      const { scheduleWeeklyPlanningReminder } = await import('./automations/weekly-planning-reminder');

      scheduleDailyDayCreation();
      scheduleWeeklyPlanningReminder();

      // Initialize TickTick auto-sync (every 30 min, skips if no token)
      const { scheduleTickTickAutoSync } = await import('./automations/ticktick-auto-sync');
      scheduleTickTickAutoSync();

      // Initialize RAG embedding jobs
      const { scheduleEmbeddingJobs } = await import('./embedding-jobs');
      scheduleEmbeddingJobs();

      // Build BM25 index (async, non-blocking)
      import('./bm25').then(({ getOrBuildIndex }) =>
        getOrBuildIndex().catch((err: any) =>
          log('BM25 index build deferred:', err.message)
        )
      );

      // Sync agent templates to DB on startup (ensures new schedule entries, tools, permissions are applied)
      try {
        const agentPath = await import('path');
        const { seedFromTemplates } = await import('./agents/agent-registry');
        const templateDir = agentPath.default.resolve(process.cwd(), 'server', 'agents', 'templates');
        const syncResult = await seedFromTemplates(templateDir);
        log(`Agent templates synced (${syncResult.seeded} updated, ${syncResult.skipped} skipped)`);
      } catch (syncError) {
        log('Agent template sync skipped: ' + String(syncError));
      }

      // Initialize agent scheduler (proactive agent execution — reads schedules from DB)
      const { initializeScheduler } = await import('./agents/agent-scheduler');
      await initializeScheduler();

      // Initialize user-defined automations (cron + webhook triggers)
      try {
        const { initializeAutomations } = await import('./routes/automations');
        await initializeAutomations();
        log('✓ User automations initialized');
      } catch (automationError) {
        log('Automations setup skipped:', String(automationError));
      }

      log('✓ SB-OS automations initialized (day creation, weekly planning, RAG embeddings, agent scheduler)');
    } catch (error) {
      log('SB-OS automations setup skipped:', String(error));
    }

    // Initialize channel adapters (Telegram, WhatsApp, etc.) — runs independently of DISABLE_CRONS
    try {
      const { registerAdapter, startAllAdapters } = await import('./channels/channel-manager');
      const { telegramAdapter } = await import('./channels/adapters/telegram-adapter');
      registerAdapter(telegramAdapter);

      // Register WhatsApp adapter if configured
      try {
        const { whatsappAdapter } = await import('./channels/adapters/whatsapp-adapter');
        registerAdapter(whatsappAdapter);
      } catch (waErr) {
        log('WhatsApp adapter skipped:', String(waErr));
      }

      await startAllAdapters();
      log('✓ Channel adapters initialized');
    } catch (channelError) {
      log('Channel adapters setup skipped:', String(channelError));
    }

    // Start LLM provider health probing (every 60s)
    try {
      const { probeProviderHealth } = await import('./model-manager');
      // Initial probe
      probeProviderHealth().catch(() => {});
      // Periodic probe every 60s
      setInterval(() => probeProviderHealth().catch(() => {}), 60_000);
      log('✓ LLM provider health monitor started');
    } catch (healthError) {
      log('Provider health monitor skipped:', String(healthError));
    }

    // Start outbound message queue processor (Project Ironclad) — runs independently of DISABLE_CRONS
    try {
      const { startMessageQueueProcessor } = await import('./infra/message-queue');
      startMessageQueueProcessor();
      log('✓ Outbound message queue processor started');
    } catch (mqError) {
      log('Message queue processor setup skipped:', String(mqError));
    }

    // Initialize memory systems (non-blocking)
    try {
      // Qdrant: create collections if they don't exist, then ensure indexes + KB sync
      import('./memory/qdrant-store').then(({ initCollections, ensurePayloadIndexes }) =>
        initCollections()
          .then(() => ensurePayloadIndexes())
          .then(() => log('✓ Qdrant memory collections + indexes initialized'))
          .catch((err: any) => log('⚠ Qdrant init deferred:', err.message))
      );

      // Qdrant KB: init collection + bulk sync docs
      import('./memory/kb-qdrant').then(({ initKBCollection, bulkSyncDocsToQdrant }) =>
        initKBCollection()
          .then(() => bulkSyncDocsToQdrant())
          .then(({ synced, skipped }) => log(`✓ Qdrant KB: ${synced} docs synced, ${skipped} skipped`))
          .catch((err: any) => log('⚠ Qdrant KB sync deferred:', err.message))
      );

      // FalkorDB: init graph schema (if configured)
      if (process.env.FALKORDB_URL) {
        import('./memory/graph-store').then(({ initGraphSchema }) =>
          initGraphSchema()
            .then(() => log('✓ FalkorDB graph schema initialized'))
            .catch((err: any) => log('⚠ FalkorDB init deferred:', err.message))
        );
      }

      // Pinecone: validate connection + trigger backfill if empty
      import('./memory/pinecone-store').then(({ getPineconeStatus }) =>
        getPineconeStatus()
          .then((status) => {
            if (status.available) {
              const count = status.stats?.totalRecordCount || 0;
              log(`✓ Pinecone connected (${status.indexName}, ${count} records)`);
              if (count === 0) {
                log('⚡ Pinecone has 0 records — triggering backfill');
                import('./agents/scheduled-jobs').then(({ executeScheduledJob }) =>
                  executeScheduledJob('_system', '_system', 'pinecone_backfill')
                    .then(() => log('✓ Pinecone backfill complete'))
                    .catch((err: any) => log('⚠ Pinecone backfill failed:', err.message))
                ).catch(() => {});
              }
            } else {
              log(`⚠ Pinecone unavailable: ${status.error}`);
            }
          })
          .catch((err: any) => log('⚠ Pinecone check deferred:', err.message))
      );
    } catch (error) {
      log('Memory systems init skipped:', String(error));
    }

    // Graceful shutdown
    const gracefulShutdown = async () => {
      log('Shutting down gracefully...');

      // 10s hard timeout to prevent hanging
      const shutdownTimeout = setTimeout(() => {
        log('Shutdown timeout reached (10s), forcing exit');
        process.exit(1);
      }, 10_000);

      // Stop message queue processor
      try {
        const { stopMessageQueueProcessor } = await import('./infra/message-queue');
        stopMessageQueueProcessor();
        log('Message queue processor stopped');
      } catch (error) {
        log('Error stopping message queue:', String(error));
      }

      // Stop all channel adapters (Telegram, etc.)
      try {
        const { stopAllAdapters } = await import('./channels/channel-manager');
        await stopAllAdapters();
        log('Channel adapters stopped');
      } catch (error) {
        log('Error stopping channel adapters:', String(error));
      }

      // Stop agent scheduler
      try {
        const { stopAllJobs } = await import('./agents/agent-scheduler');
        stopAllJobs();
        log('Agent scheduler stopped');
      } catch (error) {
        log('Error stopping agent scheduler:', String(error));
      }

      clearTimeout(shutdownTimeout);
      process.exit(0);
    };

    process.once('SIGINT', gracefulShutdown);
    process.once('SIGTERM', gracefulShutdown);
  });
})();
