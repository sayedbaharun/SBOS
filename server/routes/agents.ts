/**
 * Agent Routes
 *
 * REST endpoints for the hierarchical multi-agent system.
 * Handles agent CRUD, chat, delegation, and status.
 */
import { Router, Request, Response } from "express";
import { eq, desc, and, sql, getTableColumns } from "drizzle-orm";
import { logger } from "../logger";
import {
  agents,
  agentConversations,
  agentTasks,
  agentMemory,
  insertAgentSchema,
  type Agent,
} from "@shared/schema";
import { z } from "zod";
import { ilike, gte, or } from "drizzle-orm";
import { executeAgentChat } from "../agents/agent-runtime";
import { loadAllAgents, loadAgent, seedFromTemplates, invalidateCache } from "../agents/agent-registry";
import { delegateFromUser } from "../agents/delegation-engine";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// CROSS-AGENT CONVERSATION SEARCH
// ============================================================================

// Get recent conversations across ALL agents
router.get("/conversations/recent", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const hours = parseInt(String(req.query.hours || "72"));
    const limit = Math.min(parseInt(String(req.query.limit || "100")), 500);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const conversations = await database
      .select({
        id: agentConversations.id,
        agentId: agentConversations.agentId,
        role: agentConversations.role,
        content: agentConversations.content,
        metadata: agentConversations.metadata,
        createdAt: agentConversations.createdAt,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentConversations)
      .leftJoin(agents, eq(agentConversations.agentId, agents.id))
      .where(gte(agentConversations.createdAt, since))
      .orderBy(desc(agentConversations.createdAt))
      .limit(limit);

    res.json(conversations);
  } catch (error) {
    logger.error({ error }, "Error fetching recent conversations");
    res.status(500).json({ error: "Failed to fetch recent conversations" });
  }
});

// Full-text search across ALL agent conversations (no time limit)
router.get("/conversations/search", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    const limit = Math.min(parseInt(String(req.query.limit || "20")), 100);

    const conversations = await database
      .select({
        id: agentConversations.id,
        agentId: agentConversations.agentId,
        role: agentConversations.role,
        content: agentConversations.content,
        metadata: agentConversations.metadata,
        createdAt: agentConversations.createdAt,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentConversations)
      .leftJoin(agents, eq(agentConversations.agentId, agents.id))
      .where(ilike(agentConversations.content, `%${query}%`))
      .orderBy(desc(agentConversations.createdAt))
      .limit(limit);

    res.json(conversations);
  } catch (error) {
    logger.error({ error }, "Error searching conversations");
    res.status(500).json({ error: "Failed to search conversations" });
  }
});

// ============================================================================
// LOCAL MODEL STATUS
// ============================================================================

router.get("/local-model/status", async (req: Request, res: Response) => {
  try {
    const { isLocalAvailable, getLocalModelInfo } = await import("../model-manager");
    const info = getLocalModelInfo();
    const available = await isLocalAvailable();
    if (available) {
      res.json({ available: true, model: info.model, url: info.url });
    } else {
      res.json({ available: false, fallback: info.fallback });
    }
  } catch (error) {
    logger.error({ error }, "Error checking local model status");
    res.status(500).json({ error: "Failed to check local model status" });
  }
});

// ============================================================================
// AGENT CRUD
// ============================================================================

// List all agents (with optional role filter)
router.get("/", async (req: Request, res: Response) => {
  try {
    const agentList = await loadAllAgents();
    const roleFilter = req.query.role as string | undefined;
    const filtered = roleFilter
      ? agentList.filter((a) => a.role === roleFilter)
      : agentList;
    res.json(filtered);
  } catch (error) {
    logger.error({ error }, "Error listing agents");
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// Token usage stats (MUST be before /:slug routes)
router.get("/token-usage", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { tokenUsageLog } = await import("@shared/schema");

    const days = parseInt(String(req.query.days) || "7", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Daily breakdown by model
    const dailyByModel = await database
      .select({
        date: sql<string>`DATE(${tokenUsageLog.createdAt})`.as("date"),
        model: tokenUsageLog.model,
        totalTokens: sql<number>`SUM(${tokenUsageLog.totalTokens})`.as("total_tokens"),
        totalCostCents: sql<number>`SUM(${tokenUsageLog.estimatedCostCents})`.as("total_cost_cents"),
        callCount: sql<number>`COUNT(*)`.as("call_count"),
      })
      .from(tokenUsageLog)
      .where(gte(tokenUsageLog.createdAt, since))
      .groupBy(sql`DATE(${tokenUsageLog.createdAt})`, tokenUsageLog.model)
      .orderBy(sql`DATE(${tokenUsageLog.createdAt})`);

    // By agent
    const byAgent = await database
      .select({
        agentId: tokenUsageLog.agentId,
        agentName: agents.name,
        totalTokens: sql<number>`SUM(${tokenUsageLog.totalTokens})`.as("total_tokens"),
        totalCostCents: sql<number>`SUM(${tokenUsageLog.estimatedCostCents})`.as("total_cost_cents"),
        callCount: sql<number>`COUNT(*)`.as("call_count"),
      })
      .from(tokenUsageLog)
      .leftJoin(agents, eq(tokenUsageLog.agentId, agents.id))
      .where(gte(tokenUsageLog.createdAt, since))
      .groupBy(tokenUsageLog.agentId, agents.name)
      .orderBy(sql`SUM(${tokenUsageLog.estimatedCostCents}) DESC`);

    // Totals
    const [totals] = await database
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${tokenUsageLog.totalTokens}), 0)`.as("total_tokens"),
        totalCostCents: sql<number>`COALESCE(SUM(${tokenUsageLog.estimatedCostCents}), 0)`.as("total_cost_cents"),
        callCount: sql<number>`COUNT(*)`.as("call_count"),
      })
      .from(tokenUsageLog)
      .where(gte(tokenUsageLog.createdAt, since));

    res.json({ days, since: since.toISOString(), totals, dailyByModel, byAgent });
  } catch (error) {
    logger.error({ error }, "Error fetching token usage");
    res.status(500).json({ error: "Failed to fetch token usage" });
  }
});

// Aggregate compaction stats (MUST be before /:slug routes)
router.get("/compaction-stats", async (_req: Request, res: Response) => {
  try {
    const { getAggregateCompactionStats } = await import("../agents/compaction-tuner");
    const stats = await getAggregateCompactionStats();
    res.json(stats);
  } catch (error) {
    logger.error({ error }, "Error fetching aggregate compaction stats");
    res.status(500).json({ error: "Failed to fetch compaction stats" });
  }
});

// Unified agent metrics dashboard (MUST be before /:slug routes)
router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { tokenUsageLog } = await import("@shared/schema");
    const { getScheduleStatus } = await import("../agents/agent-scheduler");

    const days = parseInt(String(req.query.days) || "7", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. All active agents
    const allAgents = await database
      .select({ id: agents.id, slug: agents.slug, name: agents.name, isActive: agents.isActive })
      .from(agents)
      .where(eq(agents.isActive, true));

    // 2. Token usage per agent
    const tokensByAgent = await database
      .select({
        agentId: tokenUsageLog.agentId,
        totalTokens: sql<number>`COALESCE(SUM(${tokenUsageLog.totalTokens}), 0)`.as("total_tokens"),
        totalCostCents: sql<number>`COALESCE(SUM(${tokenUsageLog.estimatedCostCents}), 0)`.as("total_cost_cents"),
        callCount: sql<number>`COUNT(*)`.as("call_count"),
      })
      .from(tokenUsageLog)
      .where(gte(tokenUsageLog.createdAt, since))
      .groupBy(tokenUsageLog.agentId);

    // 3. Chat invocations per agent (count user messages)
    const chatByAgent = await database
      .select({
        agentId: agentConversations.agentId,
        chatInvocations: sql<number>`COUNT(*)`.as("chat_invocations"),
        lastChat: sql<string>`MAX(${agentConversations.createdAt})`.as("last_chat"),
      })
      .from(agentConversations)
      .where(and(
        eq(agentConversations.role, "user"),
        gte(agentConversations.createdAt, since)
      ))
      .groupBy(agentConversations.agentId);

    // 4. Delegation stats per agent
    const delegationByAgent = await database
      .select({
        assignedTo: agentTasks.assignedTo,
        total: sql<number>`COUNT(*)`.as("total"),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${agentTasks.status} = 'completed')`.as("completed"),
        failed: sql<number>`COUNT(*) FILTER (WHERE ${agentTasks.status} = 'failed')`.as("failed"),
        avgExecMs: sql<number>`AVG(EXTRACT(EPOCH FROM (${agentTasks.completedAt} - ${agentTasks.startedAt})) * 1000) FILTER (WHERE ${agentTasks.completedAt} IS NOT NULL AND ${agentTasks.startedAt} IS NOT NULL)`.as("avg_exec_ms"),
        lastTask: sql<string>`MAX(${agentTasks.createdAt})`.as("last_task"),
      })
      .from(agentTasks)
      .where(gte(agentTasks.createdAt, since))
      .groupBy(agentTasks.assignedTo);

    // 5. Scheduler stats (in-memory)
    const scheduleStatus = getScheduleStatus();

    // Build lookup maps
    const tokenMap = new Map(tokensByAgent.map(t => [t.agentId, t]));
    const chatMap = new Map(chatByAgent.map(c => [c.agentId, c]));
    const delegationMap = new Map(delegationByAgent.map(d => [d.assignedTo, d]));

    // Aggregate scheduler stats per agent slug
    const scheduleMap = new Map<string, { runs: number; errors: number }>();
    for (const s of scheduleStatus) {
      const existing = scheduleMap.get(s.agentSlug) || { runs: 0, errors: 0 };
      existing.runs += s.runCount;
      existing.errors += s.errorCount;
      scheduleMap.set(s.agentSlug, existing);
    }

    // Combine into unified response
    const agentMetrics = allAgents.map(agent => {
      const tokens = tokenMap.get(agent.id);
      const chat = chatMap.get(agent.id);
      const delegation = delegationMap.get(agent.id);
      const schedule = scheduleMap.get(agent.slug);

      const chatInvocations = chat ? Number(chat.chatInvocations) : 0;
      const scheduledRuns = schedule?.runs || 0;
      const scheduledErrors = schedule?.errors || 0;
      const delegationsReceived = delegation ? Number(delegation.total) : 0;
      const delegationsCompleted = delegation ? Number(delegation.completed) : 0;
      const delegationsFailed = delegation ? Number(delegation.failed) : 0;
      const totalActivity = chatInvocations + scheduledRuns + delegationsReceived;
      const totalErrors = scheduledErrors + delegationsFailed;
      const errorRate = totalActivity > 0 ? totalErrors / totalActivity : 0;

      // Determine last activity timestamp
      const timestamps = [chat?.lastChat, delegation?.lastTask].filter(Boolean);
      const lastActivity = timestamps.length > 0
        ? new Date(Math.max(...timestamps.map(t => new Date(t!).getTime()))).toISOString()
        : null;

      let status: "active" | "dormant" | "failing" = "dormant";
      if (totalActivity > 0) {
        status = errorRate > 0.3 ? "failing" : "active";
      }

      return {
        agentId: agent.id,
        slug: agent.slug,
        name: agent.name,
        isActive: agent.isActive,
        chatInvocations,
        scheduledRuns,
        scheduledErrors,
        delegationsReceived,
        delegationsCompleted,
        delegationsFailed,
        avgExecutionTimeMs: delegation?.avgExecMs ? Math.round(Number(delegation.avgExecMs)) : null,
        totalTokens: tokens ? Number(tokens.totalTokens) : 0,
        totalCostCents: tokens ? Number(tokens.totalCostCents) : 0,
        lastActivity,
        status,
      };
    });

    // Sort by total activity descending
    agentMetrics.sort((a, b) => {
      const aTotal = a.chatInvocations + a.scheduledRuns + a.delegationsReceived;
      const bTotal = b.chatInvocations + b.scheduledRuns + b.delegationsReceived;
      return bTotal - aTotal;
    });

    res.json({ window: { days, since: since.toISOString() }, agents: agentMetrics });
  } catch (error) {
    logger.error({ error }, "Error fetching agent metrics");
    res.status(500).json({ error: "Failed to fetch agent metrics" });
  }
});

// Get single agent by slug
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }
    res.json(agent);
  } catch (error) {
    logger.error({ error }, "Error fetching agent");
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

// Get agent hierarchy (org chart from agent up to root)
router.get("/:slug/hierarchy", async (req: Request, res: Response) => {
  try {
    const { getAgentHierarchy } = await import("../agents/agent-registry");
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }
    const hierarchy = await getAgentHierarchy(agent.id);
    res.json(hierarchy);
  } catch (error) {
    logger.error({ error }, "Error fetching agent hierarchy");
    res.status(500).json({ error: "Failed to fetch hierarchy" });
  }
});

// Get agent's direct reports (children)
router.get("/:slug/children", async (req: Request, res: Response) => {
  try {
    const { getAgentChildren } = await import("../agents/agent-registry");
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }
    const children = await getAgentChildren(agent.id);
    res.json(children);
  } catch (error) {
    logger.error({ error }, "Error fetching agent children");
    res.status(500).json({ error: "Failed to fetch children" });
  }
});

// Create new agent
router.post("/", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const validatedData = insertAgentSchema.parse(req.body);

    const [created] = await database
      .insert(agents)
      .values(validatedData)
      .returning();

    invalidateCache();
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid agent data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating agent");
      res.status(500).json({ error: "Failed to create agent" });
    }
  }
});

// Update agent
router.patch("/:slug", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const updates = insertAgentSchema.partial().parse(req.body);
    const [updated] = await database
      .update(agents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(agents.id, agent.id))
      .returning();

    invalidateCache(agent.slug);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid agent data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating agent");
      res.status(500).json({ error: "Failed to update agent" });
    }
  }
});

// Deactivate agent (soft delete)
router.delete("/:slug", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    await database
      .update(agents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    invalidateCache(agent.slug);
    res.json({ success: true, message: `Agent "${agent.slug}" deactivated` });
  } catch (error) {
    logger.error({ error }, "Error deactivating agent");
    res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

// ============================================================================
// AGENT CHAT
// ============================================================================

// Chat with an agent
router.post("/:slug/chat", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const userId = (req as any).session?.userId || "default";
    const result = await executeAgentChat(
      String(req.params.slug),
      message,
      userId
    );

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      res.status(404).json({ error: error.message });
    } else if (error.message?.includes("inactive")) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error({ error, slug: req.params.slug }, "Error in agent chat");
      res.status(500).json({ error: "Failed to process chat message" });
    }
  }
});

// Get agent conversation history
router.get("/:slug/conversations", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const limit = parseInt(String(req.query.limit || "50"));
    const conversations = await database
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.agentId, agent.id))
      .orderBy(desc(agentConversations.createdAt))
      .limit(limit);

    res.json(conversations.reverse());
  } catch (error) {
    logger.error({ error }, "Error fetching conversations");
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Clear agent conversation history
router.delete("/:slug/conversations", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    await database
      .delete(agentConversations)
      .where(eq(agentConversations.agentId, agent.id));

    res.json({ success: true, message: "Conversations cleared" });
  } catch (error) {
    logger.error({ error }, "Error clearing conversations");
    res.status(500).json({ error: "Failed to clear conversations" });
  }
});

// ============================================================================
// DELEGATION
// ============================================================================

// Delegate a task to an agent (from user)
router.post("/:slug/delegate", async (req: Request, res: Response) => {
  try {
    const { title, description, priority } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const result = await delegateFromUser(
      String(req.params.slug),
      title,
      description || "",
      priority
    );

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({ taskId: result.taskId });
  } catch (error) {
    logger.error({ error }, "Error delegating task");
    res.status(500).json({ error: "Failed to delegate task" });
  }
});

// Get delegation log (all agent tasks)
router.get("/delegation/log", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const limit = parseInt(String(req.query.limit || "50"));
    const status = req.query.status as string | undefined;

    const tasks = await database
      .select({
        ...getTableColumns(agentTasks),
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentTasks)
      .leftJoin(agents, eq(agentTasks.assignedTo, agents.id))
      .where(status ? eq(agentTasks.status, status as any) : undefined)
      .orderBy(desc(agentTasks.createdAt))
      .limit(limit);
    res.json(tasks);
  } catch (error) {
    logger.error({ error }, "Error fetching delegation log");
    res.status(500).json({ error: "Failed to fetch delegation log" });
  }
});

// Get tasks for a specific agent
router.get("/:slug/tasks", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const tasks = await database
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.assignedTo, agent.id))
      .orderBy(desc(agentTasks.createdAt))
      .limit(50);

    res.json(tasks);
  } catch (error) {
    logger.error({ error }, "Error fetching agent tasks");
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// ============================================================================
// AGENT MEMORY
// ============================================================================

// Get agent's memories
router.get("/:slug/memory", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const memories = await database
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.agentId, agent.id))
      .orderBy(desc(agentMemory.importance));

    res.json(memories);
  } catch (error) {
    logger.error({ error }, "Error fetching agent memory");
    res.status(500).json({ error: "Failed to fetch memory" });
  }
});

// Add memory to agent
router.post("/:slug/memory", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const agent = await loadAgent(String(req.params.slug));
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const { memoryType, content, importance } = req.body;
    if (!memoryType || !content) {
      return res.status(400).json({ error: "memoryType and content are required" });
    }

    const [memory] = await database
      .insert(agentMemory)
      .values({
        agentId: agent.id,
        memoryType,
        content,
        importance: importance || 0.5,
      })
      .returning();

    res.status(201).json(memory);
  } catch (error) {
    logger.error({ error }, "Error adding agent memory");
    res.status(500).json({ error: "Failed to add memory" });
  }
});

// ============================================================================
// ADMIN / SEEDING
// ============================================================================

// Seed agents from soul templates
router.post("/admin/seed", async (req: Request, res: Response) => {
  try {
    const templateDir = path.resolve(
      process.cwd(),
      "server",
      "agents",
      "templates"
    );
    const result = await seedFromTemplates(templateDir);
    res.json({
      success: true,
      ...result,
      message: `Seeded/updated ${result.seeded} agents, skipped ${result.skipped}`,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errMsg, stack: errStack }, "Error seeding agents");
    res.status(500).json({ error: "Failed to seed agents", detail: errMsg });
  }
});

// Get org chart (hierarchical agent structure)
router.get("/admin/org-chart", async (req: Request, res: Response) => {
  try {
    const allAgents = await loadAllAgents();

    // Build tree structure
    const agentMap = new Map<string, any>();
    const roots: any[] = [];

    for (const agent of allAgents) {
      agentMap.set(agent.id, {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        isActive: agent.isActive,
        modelTier: agent.modelTier,
        children: [],
      });
    }

    for (const agent of allAgents) {
      const node = agentMap.get(agent.id);
      if (agent.parentId && agentMap.has(agent.parentId)) {
        agentMap.get(agent.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json(roots);
  } catch (error) {
    logger.error({ error }, "Error building org chart");
    res.status(500).json({ error: "Failed to build org chart" });
  }
});

// ============================================================================
// CHANNELS
// ============================================================================

// Get all channel adapter statuses
router.get("/admin/channels", async (req: Request, res: Response) => {
  try {
    const { getAllAdapterStatus } = await import("../channels/channel-manager");
    const statuses = getAllAdapterStatus();
    res.json(statuses);
  } catch (error) {
    logger.error({ error }, "Error fetching channel statuses");
    res.status(500).json({ error: "Failed to fetch channel statuses" });
  }
});

// Send a proactive message via a channel
router.post("/admin/channels/send", async (req: Request, res: Response) => {
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { platform, chatId, text } = req.body;
    if (!platform || !chatId || !text) {
      return res.status(400).json({ error: "platform, chatId, and text are required" });
    }

    await sendProactiveMessage(platform, chatId, text);
    res.json({ success: true, message: `Message sent via ${platform}` });
  } catch (error) {
    logger.error({ error }, "Error sending proactive message");
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Setup Hikma Digital venture (one-time, idempotent)
router.post("/admin/setup-hikma", async (req: Request, res: Response) => {
  try {
    const { setupHikmaDigitalVenture } = await import("../agents/setup-hikma-venture");
    const result = await setupHikmaDigitalVenture();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// SCHEDULER
// ============================================================================

// Get all scheduled jobs status
// Dead letter jobs — failed scheduled jobs (Project Ironclad Phase 2)
router.get("/admin/dead-letters", async (req: Request, res: Response) => {
  try {
    const { storage } = await import("../storage");
    const limit = parseInt(String(req.query.limit) || "50", 10);
    const deadLetters = await storage.getDeadLetterJobs(limit);
    res.json(deadLetters);
  } catch (error) {
    logger.error({ error }, "Error fetching dead letter jobs");
    res.status(500).json({ error: "Failed to fetch dead letter jobs" });
  }
});

// Currently running tasks and sub-agent runs
router.get("/admin/running", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { storage } = await import("../storage");

    const [inProgressTasks, runningSubAgents] = await Promise.all([
      database
        .select({
          id: agentTasks.id,
          title: agentTasks.title,
          status: agentTasks.status,
          assignedTo: agentTasks.assignedTo,
          createdAt: agentTasks.createdAt,
          agentName: agents.name,
          agentSlug: agents.slug,
        })
        .from(agentTasks)
        .leftJoin(agents, eq(agentTasks.assignedTo, agents.id))
        .where(eq(agentTasks.status, "in_progress")),
      storage.getSubAgentRuns({ status: "running" }),
    ]);

    res.json({
      agentTasks: inProgressTasks,
      subAgentRuns: runningSubAgents,
      total: inProgressTasks.length + runningSubAgents.length,
    });
  } catch (error) {
    logger.error({ error }, "Error fetching running tasks");
    res.status(500).json({ error: "Failed to fetch running tasks" });
  }
});

// Message queue stats (Project Ironclad Phase 1)
router.get("/admin/queue-stats", async (req: Request, res: Response) => {
  try {
    const { storage } = await import("../storage");
    const stats = await storage.getQueueStats();
    res.json(stats);
  } catch (error) {
    logger.error({ error }, "Error fetching queue stats");
    res.status(500).json({ error: "Failed to fetch queue stats" });
  }
});

router.get("/admin/schedules", async (req: Request, res: Response) => {
  try {
    const { getScheduleStatus } = await import("../agents/agent-scheduler");
    const schedules = getScheduleStatus();
    res.json(schedules);
  } catch (error) {
    logger.error({ error }, "Error fetching schedules");
    res.status(500).json({ error: "Failed to fetch schedules" });
  }
});

// Manually trigger a scheduled job for an agent
router.post("/:slug/trigger-schedule", async (req: Request, res: Response) => {
  try {
    const { triggerJob } = await import("../agents/agent-scheduler");
    const { jobName } = req.body;
    if (!jobName || typeof jobName !== "string") {
      return res.status(400).json({ error: "jobName is required" });
    }

    const result = await triggerJob(String(req.params.slug), jobName);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: `Job "${jobName}" triggered for ${req.params.slug}` });
  } catch (error) {
    logger.error({ error }, "Error triggering scheduled job");
    res.status(500).json({ error: "Failed to trigger job" });
  }
});

// Reload schedules for an agent (after updating schedule config)
router.post("/:slug/reload-schedule", async (req: Request, res: Response) => {
  try {
    const { reloadAgentSchedule } = await import("../agents/agent-scheduler");
    await reloadAgentSchedule(String(req.params.slug));
    res.json({ success: true, message: `Schedule reloaded for ${req.params.slug}` });
  } catch (error) {
    logger.error({ error }, "Error reloading schedule");
    res.status(500).json({ error: "Failed to reload schedule" });
  }
});

// Per-agent compaction stats
router.get("/:slug/compaction-stats", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const [agent] = await database
      .select()
      .from(agents)
      .where(eq(agents.slug, String(req.params.slug)));

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const { getAgentCompactionStats } = await import("../agents/compaction-tuner");
    const stats = await getAgentCompactionStats(agent.id);
    res.json(stats || { message: "No compaction data yet" });
  } catch (error) {
    logger.error({ error }, "Error fetching agent compaction stats");
    res.status(500).json({ error: "Failed to fetch compaction stats" });
  }
});

// ============================================================================
// MULTI-MODEL COUNCIL
// ============================================================================

/**
 * POST /api/agents/council
 * Run multi-model council for high-stakes decisions.
 * Body: { question: string, context?: string, mode?: "standard" | "fractal", synthesisModel?: string }
 */
router.post("/council", async (req: Request, res: Response) => {
  try {
    const { question, context, mode, synthesisModel } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const { runCouncil } = await import("../agents/multi-model-council");
    const result = await runCouncil({ question, context, mode, synthesisModel });
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Council execution failed");
    res.status(500).json({ error: "Council execution failed", details: error.message });
  }
});

export default router;
