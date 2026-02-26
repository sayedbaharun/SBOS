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

  app.get('/api/health/pipeline', async (req, res) => {
    try {
      const { runPipelineHealthCheck } = await import("../agents/scheduled-jobs");
      const result = await runPipelineHealthCheck();
      const statusCode = result.overall === "pass" ? 200 : 503;
      res.status(statusCode).json(result);
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
