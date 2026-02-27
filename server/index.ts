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

// Global rate limiter - 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 100 : 1000, // More permissive in development
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path.startsWith('/@') || req.path.startsWith('/node_modules') || req.path.startsWith('/src'),
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API rate limiter - more permissive than auth
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 60 : 300, // 60 requests/minute in production
  message: { error: 'API rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
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

        // Dynamically get the adapter's bot (it's initialized in the listen callback)
        const { telegramAdapter } = await import('./channels/adapters/telegram-adapter');
        const bot = telegramAdapter.bot;
        if (!bot) {
          log('Telegram webhook: bot not yet initialized');
          res.status(200).json({ ok: true });
          return;
        }

        const update = req.body;
        log(`Telegram webhook: update_id=${update.update_id}, has_message=${!!update.message}, text="${update.message?.text || 'N/A'}", chat_id=${update.message?.chat?.id || 'N/A'}`);
        await bot.handleUpdate(update);
        res.status(200).json({ ok: true });
      } catch (err) {
        log('Telegram webhook handleUpdate error:', String(err));
        res.status(200).json({ ok: true }); // Always 200 to Telegram
      }
    });
    log('✓ Telegram webhook route registered at /api/telegram/webhook (before SPA catch-all)');
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

    // Log error but don't re-throw (prevents server crash)
    log(`Error ${status}: ${message}`);
    if (status === 500) {
      console.error('Server error:', err);
    }

    res.status(status).json({ message });
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
    try {
      const { scheduleDailyDayCreation } = await import('./automations/daily-day-creation');
      const { scheduleWeeklyPlanningReminder } = await import('./automations/weekly-planning-reminder');
      const { scheduleDailyReflectionReminder } = await import('./automations/daily-reflection-reminder');

      scheduleDailyDayCreation();
      scheduleWeeklyPlanningReminder();
      scheduleDailyReflectionReminder();

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

      // Initialize channel adapters (Telegram, etc.)
      try {
        const { registerAdapter, startAllAdapters } = await import('./channels/channel-manager');
        const { telegramAdapter } = await import('./channels/adapters/telegram-adapter');
        registerAdapter(telegramAdapter);
        await startAllAdapters();

        log('✓ Channel adapters initialized');
      } catch (channelError) {
        log('Channel adapters setup skipped:', String(channelError));
      }

      // Initialize nudge engine (event-driven proactive notifications)
      try {
        const { scheduleNudgeEngine } = await import('./automations/nudge-engine');
        scheduleNudgeEngine();
        log('✓ Nudge engine initialized');
      } catch (nudgeError) {
        log('Nudge engine setup skipped:', String(nudgeError));
      }

      log('✓ SB-OS automations initialized (day creation, reminders, RAG embeddings, agent scheduler, nudges)');
    } catch (error) {
      log('SB-OS automations setup skipped:', String(error));
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

      // Pinecone: validate connection
      import('./memory/pinecone-store').then(({ getPineconeStatus }) =>
        getPineconeStatus()
          .then((status) => {
            if (status.available) {
              log(`✓ Pinecone connected (${status.indexName}, ${status.stats?.totalRecordCount || 0} records)`);
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

      // Stop SB-OS automations
      try {
        // Automations use node-cron which doesn't need explicit cleanup
        log('Automations stopped');
      } catch (error) {
        log('Error stopping automations:', String(error));
      }

      if (telegramBot) {
        try {
          await telegramBot.stop();
          log('Telegram bot stopped');
        } catch (error) {
          log('Error stopping Telegram bot:', String(error));
        }
      }
      process.exit(0);
    };

    process.once('SIGINT', gracefulShutdown);
    process.once('SIGTERM', gracefulShutdown);
  });
})();
