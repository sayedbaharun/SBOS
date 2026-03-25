/**
 * WHOOP Integration Routes
 * OAuth callback, manual sync trigger, connection status
 */
import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  syncWhoopData,
  isWhoopConnected,
} from "../integrations/whoop";
import { randomUUID } from "crypto";

const router = Router();

// Store OAuth state tokens in memory (short-lived, single user)
const pendingStates = new Map<string, number>();

/**
 * GET /api/whoop/status — Check connection status
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const connected = await isWhoopConnected();
    const token = connected ? await storage.getIntegrationToken("whoop") : null;

    res.json({
      connected,
      lastSynced: token?.updatedAt || null,
      expiresAt: token?.expiresAt || null,
    });
  } catch (error: any) {
    logger.error({ error }, "Error checking WHOOP status");
    res.status(500).json({ error: "Failed to check WHOOP status" });
  }
});

/**
 * GET /api/whoop/authorize — Start OAuth flow (redirect user to WHOOP)
 */
router.get("/authorize", (_req: Request, res: Response) => {
  const clientId = process.env.WHOOP_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({ error: "WHOOP_CLIENT_ID not configured" });
  }

  const state = randomUUID();
  pendingStates.set(state, Date.now());

  // Clean up old states (>10 min)
  Array.from(pendingStates.entries()).forEach(([s, ts]) => {
    if (Date.now() - ts > 600_000) pendingStates.delete(s);
  });

  const url = getAuthorizationUrl(state);
  res.json({ url });
});

/**
 * GET /api/whoop/callback — OAuth callback from WHOOP
 */
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      logger.warn({ error }, "WHOOP OAuth denied");
      return res.redirect("/settings/integrations?whoop=denied");
    }

    if (!code || !state) {
      return res.status(400).json({ error: "Missing code or state parameter" });
    }

    // Validate state
    if (!pendingStates.has(state)) {
      return res.status(400).json({ error: "Invalid or expired OAuth state" });
    }
    pendingStates.delete(state);

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Store tokens in DB
    await storage.upsertIntegrationToken("whoop", {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      scopes: "read:recovery read:cycles read:sleep read:workout offline",
    });

    logger.info("WHOOP OAuth connected successfully");

    // Redirect back to settings page
    res.redirect("/settings/integrations?whoop=connected");
  } catch (error: any) {
    logger.error({ error }, "WHOOP OAuth callback error");
    res.redirect("/settings/integrations?whoop=error");
  }
});

/**
 * POST /api/whoop/sync — Manually trigger WHOOP data sync
 */
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body || {};
    const result = await syncWhoopData(startDate, endDate);
    res.json(result);
  } catch (error: any) {
    logger.error({ error }, "WHOOP sync error");
    res.status(500).json({ error: error.message || "WHOOP sync failed" });
  }
});

/**
 * DELETE /api/whoop/disconnect — Remove WHOOP connection
 */
router.delete("/disconnect", async (_req: Request, res: Response) => {
  try {
    await storage.deleteIntegrationToken("whoop");
    logger.info("WHOOP disconnected");
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ error }, "Error disconnecting WHOOP");
    res.status(500).json({ error: "Failed to disconnect WHOOP" });
  }
});

export default router;
