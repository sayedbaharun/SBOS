/**
 * External Agent Authentication Middleware
 * Validates API key from Authorization header and attaches agent to request.
 */
import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { storage } from "../storage";
import { logger } from "../logger";
import type { ExternalAgent } from "@shared/schema";

// Extend Express Request to include external agent
declare global {
  namespace Express {
    interface Request {
      externalAgent?: ExternalAgent;
    }
  }
}

/**
 * Hash an API key for storage/lookup (SHA-256)
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Middleware that authenticates external agents via Bearer token.
 * Attaches `req.externalAgent` on success.
 */
export async function requireExternalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <api-key>" });
    return;
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    res.status(401).json({ error: "API key is empty" });
    return;
  }

  try {
    const keyHash = hashApiKey(apiKey);
    const agent = await storage.getExternalAgentByApiKeyHash(keyHash);

    if (!agent) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (agent.status === "revoked") {
      res.status(403).json({ error: "Agent access has been revoked" });
      return;
    }

    if (agent.status === "suspended") {
      res.status(403).json({ error: "Agent access is suspended" });
      return;
    }

    // Update last seen (fire-and-forget)
    storage.updateExternalAgentLastSeen(agent.id).catch((err) => {
      logger.error({ error: err, agentId: agent.id }, "Failed to update external agent lastSeenAt");
    });

    req.externalAgent = agent;
    next();
  } catch (error) {
    logger.error({ error }, "External auth middleware error");
    res.status(500).json({ error: "Authentication failed" });
  }
}
