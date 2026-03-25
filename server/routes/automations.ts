/**
 * Automation Routes
 * CRUD + execution for user-defined cron and webhook automations
 */
import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { automations, insertAutomationSchema } from "@shared/schema";
import { z } from "zod";
import crypto from "crypto";

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

// List all automations
router.get("/", async (_req: Request, res: Response) => {
  try {
    const database = await getDb();
    const rows = await database.select().from(automations).orderBy(automations.createdAt);
    res.json(rows);
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to list automations");
    res.status(500).json({ error: "Failed to list automations" });
  }
});

// Get single automation
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const [row] = await database.select().from(automations).where(eq(automations.id, String(req.params.id)));
    if (!row) return res.status(404).json({ error: "Automation not found" });
    res.json(row);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to get automation" });
  }
});

// Create automation
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertAutomationSchema.parse(req.body);

    // Generate webhook slug if webhook type
    if (data.type === "webhook" && !data.webhookSlug) {
      (data as any).webhookSlug = crypto.randomBytes(16).toString("hex");
    }

    // Generate webhook secret if auth is bearer/secret
    if (data.config?.webhookAuth && data.config.webhookAuth !== "none" && !data.config.webhookSecret) {
      data.config.webhookSecret = crypto.randomBytes(32).toString("hex");
    }

    const database = await getDb();
    const [row] = await database.insert(automations).values(data).returning();

    // If cron type and active, register with scheduler
    if (row.type === "cron" && row.isActive && row.cronExpression) {
      registerCronAutomation(row).catch((err: any) =>
        logger.warn({ error: err.message }, "Failed to register cron automation")
      );
    }

    res.status(201).json(row);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid automation data", details: error.issues });
    } else {
      logger.error({ error: error.message }, "Failed to create automation");
      res.status(500).json({ error: "Failed to create automation" });
    }
  }
});

// Update automation
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertAutomationSchema.partial().parse(req.body);
    const database = await getDb();
    const [row] = await database
      .update(automations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(automations.id, String(req.params.id)))
      .returning();

    if (!row) return res.status(404).json({ error: "Automation not found" });

    // Re-register cron if schedule changed
    if (row.type === "cron") {
      unregisterCronAutomation(row.id);
      if (row.isActive && row.cronExpression) {
        registerCronAutomation(row).catch(() => {});
      }
    }

    res.json(row);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid data", details: error.issues });
    } else {
      res.status(500).json({ error: "Failed to update automation" });
    }
  }
});

// Delete automation
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    unregisterCronAutomation(String(req.params.id));
    await database.delete(automations).where(eq(automations.id, String(req.params.id)));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

// Manually trigger an automation
router.post("/:id/run", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const [row] = await database.select().from(automations).where(eq(automations.id, String(req.params.id)));
    if (!row) return res.status(404).json({ error: "Automation not found" });

    // Fire and forget
    executeAutomation(row, req.body).catch((err: any) =>
      logger.error({ error: err.message, automationId: row.id }, "Manual automation run failed")
    );

    res.json({ success: true, message: "Automation triggered" });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to trigger automation" });
  }
});

// ─── Webhook endpoint (public, auth checked per-automation) ──────

router.post("/webhook/:slug", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const [automation] = await database
      .select()
      .from(automations)
      .where(eq(automations.webhookSlug, String(req.params.slug)));

    if (!automation || !automation.isActive) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    // Check auth
    const authType = automation.config?.webhookAuth || "none";
    if (authType === "bearer") {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (token !== automation.config?.webhookSecret) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    } else if (authType === "secret") {
      const secret = req.headers["x-webhook-secret"] || req.query.secret;
      if (secret !== automation.config?.webhookSecret) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    // Fire and forget
    executeAutomation(automation, req.body).catch((err: any) =>
      logger.error({ error: err.message, automationId: automation.id }, "Webhook automation failed")
    );

    res.json({ success: true, message: "Webhook received" });
  } catch (error: any) {
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ─── Execution logic ──────

async function executeAutomation(automation: any, webhookPayload?: any): Promise<void> {
  const database = await getDb();

  try {
    // Build the prompt, optionally injecting webhook payload
    let prompt = automation.prompt;
    if (webhookPayload && Object.keys(webhookPayload).length > 0) {
      prompt += `\n\n[Webhook payload]\n${JSON.stringify(webhookPayload, null, 2)}`;
    }

    const { executeAgentChat } = await import("../agents/agent-runtime");
    const result = await executeAgentChat(
      automation.agentSlug,
      prompt,
      `automation:${automation.id}`
    );

    // Update run stats
    await database
      .update(automations)
      .set({
        lastRunAt: new Date(),
        runCount: automation.runCount + 1,
        lastError: null,
      })
      .where(eq(automations.id, automation.id));

    logger.info({
      automationId: automation.id,
      name: automation.name,
      agent: automation.agentSlug,
      tokensUsed: result.tokensUsed,
    }, "Automation executed successfully");
  } catch (err: any) {
    await database
      .update(automations)
      .set({
        lastRunAt: new Date(),
        runCount: automation.runCount + 1,
        lastError: err.message,
      })
      .where(eq(automations.id, automation.id));

    throw err;
  }
}

// ─── Cron registration ──────

const activeCrons = new Map<string, ReturnType<typeof import("node-cron").schedule>>();

async function registerCronAutomation(automation: any): Promise<void> {
  const cron = await import("node-cron");

  if (!cron.default.validate(automation.cronExpression)) {
    logger.warn({ id: automation.id, cron: automation.cronExpression }, "Invalid cron expression");
    return;
  }

  const tz = automation.timezone || "Asia/Dubai";
  const task = cron.default.schedule(automation.cronExpression, () => {
    executeAutomation(automation).catch((err: any) =>
      logger.error({ error: err.message, automationId: automation.id }, "Cron automation failed")
    );
  }, { timezone: tz });

  activeCrons.set(automation.id, task);
  logger.info({ id: automation.id, name: automation.name, cron: automation.cronExpression, timezone: tz }, "Cron automation registered");
}

function unregisterCronAutomation(automationId: string): void {
  const task = activeCrons.get(automationId);
  if (task) {
    task.stop();
    activeCrons.delete(automationId);
  }
}

/**
 * Initialize all active cron automations on server startup.
 */
export async function initializeAutomations(): Promise<void> {
  try {
    const database = await getDb();
    const rows = await database
      .select()
      .from(automations)
      .where(eq(automations.isActive, true));

    const cronRows = rows.filter((r: any) => r.type === "cron" && r.cronExpression);
    for (const row of cronRows) {
      await registerCronAutomation(row).catch(() => {});
    }

    logger.info({ count: cronRows.length }, "Cron automations initialized");
  } catch (err: any) {
    logger.warn({ error: err.message }, "Failed to initialize automations");
  }
}

export default router;
