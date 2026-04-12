/**
 * SB-OS Event Bus
 * Lightweight pub/sub: publish events, resolve subscriptions, delegate to agents.
 */
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { storage } from "../storage";
import { eventSubscriptions, eventLog } from "@shared/schema";

// Lazy DB accessor — avoids circular deps on module load
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

/**
 * Publish an event to the bus.
 *
 * 1. Inserts a row in event_log.
 * 2. Queries active subscriptions for this eventType.
 * 3. For each subscription, checks filterJson and maxDepth, then calls delegateFromUser().
 * 4. Updates event_log row with deliveredToAgents list.
 *
 * @returns Array of agent slugs that were triggered (empty on error).
 */
export async function publishEvent(
  eventType: string,
  payload: Record<string, any>
): Promise<string[]> {
  try {
    const database = await getDb();

    // ── Depth guard ──────────────────────────────────────────────────────────
    const currentDepth = payload.__eventDepth ?? 0;
    if (currentDepth >= 3) {
      logger.warn(
        { eventType, currentDepth },
        "Event bus: max cascade depth reached, skipping delegation"
      );
      // Still log the event, just deliver to nobody
      await database.insert(eventLog).values({
        eventType,
        payload,
        deliveredToAgents: [],
      });
      return [];
    }

    // Stamp the depth before delegating
    const enrichedPayload = { ...payload, __eventDepth: currentDepth + 1 };

    // ── Log the event ────────────────────────────────────────────────────────
    const [logRow] = await database
      .insert(eventLog)
      .values({
        eventType,
        payload: enrichedPayload,
        deliveredToAgents: [],
      })
      .returning();

    // ── Find matching subscriptions ──────────────────────────────────────────
    const subs = await database
      .select()
      .from(eventSubscriptions)
      .where(
        and(
          eq(eventSubscriptions.eventType, eventType),
          eq(eventSubscriptions.active, true)
        )
      );

    const deliveredSlugs: string[] = [];

    for (const sub of subs) {
      // ── filterJson check ───────────────────────────────────────────────────
      if (sub.filterJson && typeof sub.filterJson === "object") {
        const filter = sub.filterJson as Record<string, any>;
        const matches = Object.entries(filter).every(
          ([key, val]) => enrichedPayload[key] === val
        );
        if (!matches) {
          continue;
        }
      }

      // ── Dynamic import to avoid circular deps ─────────────────────────────
      try {
        const { delegateFromUser } = await import(
          "../agents/delegation-engine"
        );
        await delegateFromUser(
          sub.agentSlug,
          `Event: ${eventType}`,
          JSON.stringify(enrichedPayload),
          2 // P2 priority (numeric)
        );
        deliveredSlugs.push(sub.agentSlug);
      } catch (delegateErr: any) {
        logger.warn(
          { agentSlug: sub.agentSlug, error: delegateErr?.message },
          "Event bus: delegation failed for subscription"
        );
      }
    }

    // ── Update log row with delivered agents ─────────────────────────────────
    await database
      .update(eventLog)
      .set({ deliveredToAgents: deliveredSlugs })
      .where(eq(eventLog.id, logRow.id));

    logger.info(
      { eventType, deliveredTo: deliveredSlugs, logId: logRow.id },
      "Event published"
    );

    return deliveredSlugs;
  } catch (err: any) {
    logger.warn(
      { eventType, error: err?.message },
      "Event bus: publishEvent failed, returning []"
    );
    return [];
  }
}
