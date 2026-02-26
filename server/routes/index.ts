/**
 * Main Routes Index
 * Registers all route modules and creates the HTTP server
 */
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireAuth } from "../auth";
import uploadRoutes from "../upload-routes";

// Import all route modules
import authRoutes from "./auth";
import dashboardRoutes from "./dashboard";
import venturesRoutes from "./ventures";
import projectsRoutes from "./projects";
import phasesRoutes from "./phases";
import tasksRoutes from "./tasks";
import capturesRoutes from "./captures";
import daysRoutes from "./days";
import weeksRoutes from "./weeks";
import healthRoutes from "./health";
import bloodworkRoutes from "./bloodwork";
import nutritionRoutes from "./nutrition";
import docsRoutes from "./docs";
import attachmentsRoutes from "./attachments";
import settingsRoutes from "./settings";
import calendarRoutes from "./calendar";
import driveRoutes from "./drive";
import shoppingRoutes from "./shopping";
import booksRoutes from "./books";
import financeRoutes from "./finance";
import peopleRoutes from "./people";
import { strategiesRouter, checklistsRouter } from "./trading";
import ticktickRoutes from "./ticktick";
import aiChatRoutes from "./ai-chat";
import foresightRoutes from "./foresight";
import fearSettingsRoutes from "./fear-settings";
import decisionMemoriesRoutes from "./decision-memories";
import aiDocsRoutes from "./ai-docs";
import aiLearningRoutes from "./ai-learning";
import ventureLabRoutes from "./venture-lab";
import ragRoutes from "./rag";
import webClipRoutes from "./web-clip";
import knowledgeFilesRoutes from "./knowledge-files";
import memoryRoutes from "./memory";
import voiceRoutes from "./voice";
import agentRoutes from "./agents";
import sessionRoutes from "./sessions";
import externalRoutes from "./external";
import researchRoutes from "./research";

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // HEALTH CHECK (No auth required)
  // ============================================================================

  app.get('/health', async (req, res) => {
    const health = {
      status: 'healthy' as 'healthy' | 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: false,
      }
    };

    // Check database connectivity with lightweight ping instead of loading all ventures
    try {
      health.checks.database = await storage.ping();
      if (!health.checks.database) {
        health.status = 'degraded';
      }
    } catch (error) {
      logger.error({ error }, 'Health check: Database connectivity failed');
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // ============================================================================
  // PIPELINE HEALTH CHECK (No auth required — monitoring endpoint)
  // ============================================================================

  app.get('/api/pipeline-health', async (req, res) => {
    try {
      const { runPipelineHealthCheck } = await import("../agents/scheduled-jobs");
      const result = await runPipelineHealthCheck();
      const statusCode = result.overall === "pass" ? 200 : 503;

      // Return HTML dashboard if accessed from browser, JSON for programmatic access
      if (req.headers.accept?.includes("text/html")) {
        const checks = result.checks as Record<string, any>;
        const statusIcon = (s: string) => s === "pass" ? "\u2705" : s === "skip" ? "\u23ed\ufe0f" : "\u274c";
        const overallColor = result.overall === "pass" ? "#22c55e" : "#ef4444";
        const rows = Object.entries(checks).map(([key, val]: [string, any]) => {
          const label: Record<string, string> = {
            sessionLogIngestion: "Session Log Ingestion",
            unprocessedBacklog: "Nightly Cron Backlog",
            qdrantStatus: "Qdrant Vector Store",
            pineconeStatus: "Pinecone Cloud Backup",
          };
          return `<tr>
            <td style="padding:12px 16px;border-bottom:1px solid #1e293b">${statusIcon(val.status)} ${label[key] || key}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #1e293b;color:${val.status === "pass" ? "#86efac" : val.status === "skip" ? "#94a3b8" : "#fca5a5"}">${val.status.toUpperCase()}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #1e293b;color:#94a3b8">${val.detail}</td>
          </tr>`;
        }).join("");
        const alertsHtml = (result.alerts as string[]).length > 0
          ? `<div style="margin-top:20px;padding:16px;background:#451a03;border:1px solid #92400e;border-radius:8px">
              <strong style="color:#fbbf24">Alerts:</strong>
              <ul style="margin:8px 0 0;padding-left:20px">${(result.alerts as string[]).map(a => `<li style="color:#fde68a;margin:4px 0">${a}</li>`).join("")}</ul>
            </div>`
          : `<div style="margin-top:20px;padding:16px;background:#052e16;border:1px solid #166534;border-radius:8px;color:#86efac">No alerts — all systems operational.</div>`;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SB-OS Pipeline Health</title></head>
          <body style="margin:0;padding:20px;background:#0f172a;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif">
            <div style="max-width:600px;margin:0 auto">
              <h1 style="font-size:24px;margin-bottom:4px">SB-OS Pipeline Health</h1>
              <p style="color:#64748b;margin-top:0">${new Date(result.timestamp as string).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })} Dubai</p>
              <div style="display:inline-block;padding:8px 20px;border-radius:20px;font-weight:bold;font-size:18px;background:${overallColor};color:white;margin-bottom:20px">
                ${result.overall === "pass" ? "ALL SYSTEMS GO" : "ISSUES DETECTED"}
              </div>
              <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden">
                <thead><tr style="background:#334155">
                  <th style="padding:10px 16px;text-align:left">Component</th>
                  <th style="padding:10px 16px;text-align:left">Status</th>
                  <th style="padding:10px 16px;text-align:left">Detail</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
              ${alertsHtml}
              <p style="margin-top:20px;color:#475569;font-size:12px">Auto-checks every 4 hours. Alerts sent via Telegram @SBNexusBot.</p>
            </div>
          </body></html>`;
        res.status(statusCode).type("html").send(html);
      } else {
        res.status(statusCode).json(result);
      }
    } catch (error: any) {
      logger.error({ error }, "Pipeline health check endpoint failed");
      res.status(500).json({ overall: "fail", error: error.message });
    }
  });

  // ============================================================================
  // FAVICON FALLBACK (redirect to PNG icon since favicon.ico doesn't exist)
  // ============================================================================
  app.get('/favicon.ico', (req, res) => {
    res.redirect(301, '/icons/icon-32x32.png');
  });

  // ============================================================================
  // AUTH ROUTES (No auth required for these endpoints)
  // ============================================================================
  app.use('/api/auth', authRoutes);

  // ============================================================================
  // EXTERNAL AGENT API (uses its own Bearer token auth, not session auth)
  // ============================================================================
  app.use('/api/external', externalRoutes);

  // ============================================================================
  // PROTECTED ROUTES - All routes below require authentication
  // ============================================================================

  // Apply authentication middleware to all /api routes except auth and external endpoints
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for auth and external endpoints (they have their own auth)
    if (req.path.startsWith('/auth/') || req.path.startsWith('/external/')) {
      return next();
    }
    // Apply requireAuth
    requireAuth(req, res, next);
  });

  // ============================================================================
  // CORE ENTITIES
  // ============================================================================
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/ventures', venturesRoutes);
  app.use('/api/venture-lab', ventureLabRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/phases', phasesRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/captures', capturesRoutes);
  app.use('/api/days', daysRoutes);
  app.use('/api/weeks', weeksRoutes);

  // ============================================================================
  // HEALTH & NUTRITION
  // ============================================================================
  app.use('/api/health', healthRoutes);
  app.use('/api/bloodwork', bloodworkRoutes);
  app.use('/api/nutrition', nutritionRoutes);

  // ============================================================================
  // KNOWLEDGE & DOCUMENTS
  // ============================================================================
  app.use('/api/docs', docsRoutes);
  app.use('/api/docs', webClipRoutes);
  app.use('/api/docs/ai', aiDocsRoutes);
  app.use('/api/ai/learning', aiLearningRoutes);
  app.use('/api/attachments', attachmentsRoutes);
  app.use('/api/knowledge-files', knowledgeFilesRoutes);

  // ============================================================================
  // RAG (Retrieval Augmented Generation)
  // Vector search, embeddings, and context injection for AI
  // ============================================================================
  app.use('/api/rag', ragRoutes);

  // ============================================================================
  // MEMORY SYSTEM (Hybrid Qdrant + Pinecone)
  // Session compaction, offline autonomy, and mobile access
  // ============================================================================
  app.use('/api/memory', memoryRoutes);

  // ============================================================================
  // VOICE (Jarvis-style interaction: STT, TTS, voice chat)
  // ============================================================================
  app.use('/api/voice', voiceRoutes);

  // ============================================================================
  // SETTINGS & USER PREFERENCES
  // ============================================================================
  app.use('/api/settings', settingsRoutes);

  // ============================================================================
  // EXTERNAL INTEGRATIONS
  // ============================================================================
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/drive', driveRoutes);
  app.use('/api/ticktick', ticktickRoutes);

  // ============================================================================
  // LIFE MANAGEMENT
  // ============================================================================
  app.use('/api/shopping', shoppingRoutes);
  app.use('/api/books', booksRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/people', peopleRoutes);

  // ============================================================================
  // TRADING
  // ============================================================================
  app.use('/api/trading-strategies', strategiesRouter);
  app.use('/api/trading-checklists', checklistsRouter);

  // ============================================================================
  // STRATEGIC FORESIGHT
  // Venture-scoped scenario planning, indicators, signals, analyses
  // ============================================================================
  app.use('/api/ventures/:ventureId/foresight', foresightRoutes);

  // ============================================================================
  // DECISION MAKING
  // Fear-setting exercises for major decisions
  // ============================================================================
  app.use('/api/fear-settings', fearSettingsRoutes);

  // ============================================================================
  // DECISION MEMORIES
  // Lightweight decision capture with outcome loop for learning
  // ============================================================================
  app.use('/api/decision-memories', decisionMemoriesRoutes);

  // ============================================================================
  // AI & CHAT
  // The AI chat router handles multiple endpoint groups:
  // - /api/ai-models -> /models
  // - /api/ai-agent-prompts/* -> /agent-prompts/*
  // - /api/chat/* -> /chat/*
  // - /api/ventures/:ventureId/chat/* -> /ventures/:ventureId/chat/*
  // - /api/ventures/:ventureId/ai/* -> /ventures/:ventureId/ai/*
  // - /api/project-scaffolding/* -> /project-scaffolding/*
  // ============================================================================
  app.use('/api', aiChatRoutes);

  // ============================================================================
  // HIERARCHICAL AGENT SYSTEM
  // Multi-agent organization with delegation, hierarchy, and memory
  // ============================================================================
  app.use('/api/agents', agentRoutes);

  // ============================================================================
  // SESSION LOGS
  // Cross-session continuity for Claude Code and other clients
  // ============================================================================
  app.use('/api/sessions', sessionRoutes);

  // ============================================================================
  // RESEARCH INBOX
  // Review and approve external agent research submissions
  // ============================================================================
  app.use('/api/research', researchRoutes);

  // ============================================================================
  // FILE UPLOADS
  // ============================================================================
  app.use('/api', uploadRoutes);

  // ============================================================================
  // ENTITY RELATIONSHIP GRAPH
  // ============================================================================
  app.get('/api/entities/relations', requireAuth, async (req: any, res: any) => {
    try {
      const limit = parseInt(String(req.query.limit || '100'), 10);
      const relations = await storage.getAllEntityRelations(limit);
      res.json(relations);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch entity relations' });
    }
  });

  app.get('/api/entities/relations/:name', requireAuth, async (req: any, res: any) => {
    try {
      const name = String(req.params.name);
      const relations = await storage.getEntityRelations(name);
      res.json(relations);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch entity relations' });
    }
  });

  app.get('/api/ws/status', requireAuth, async (_req: any, res: any) => {
    try {
      const { getWSStats } = await import('../ws/event-bus');
      res.json(getWSStats());
    } catch {
      res.json({ connected: 0, channels: [] });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
