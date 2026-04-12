/**
 * Default Event Subscriptions Seed
 * Creates the canonical wiring between event types and agent slugs on startup.
 * Safe to run multiple times — uses conflict-safe insert.
 */
import { logger } from "../logger";
import { storage } from "../storage";
import { eventSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const defaultSubscriptions = [
  { eventType: "task.agent_ready", agentSlug: "chief-of-staff", filterJson: null },
  { eventType: "review.rejected", agentSlug: "chief-of-staff", filterJson: null },
  { eventType: "kr.at_risk", agentSlug: "chief-of-staff", filterJson: null },
];

/**
 * Seeds the default event subscriptions if they don't already exist.
 * Fire-and-forget safe — catches all errors internally.
 */
export async function seedDefaultEventSubscriptions(): Promise<void> {
  try {
    const db = (storage as any).db;
    let inserted = 0;

    for (const sub of defaultSubscriptions) {
      // Check if subscription already exists for this (eventType, agentSlug) pair
      const existing = await db
        .select({ id: eventSubscriptions.id })
        .from(eventSubscriptions)
        .where(
          and(
            eq(eventSubscriptions.eventType, sub.eventType),
            eq(eventSubscriptions.agentSlug, sub.agentSlug)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(eventSubscriptions).values({
          eventType: sub.eventType,
          agentSlug: sub.agentSlug,
          filterJson: sub.filterJson,
          active: true,
        });
        inserted++;
      }
    }

    if (inserted > 0) {
      logger.info({ inserted }, "seedDefaultEventSubscriptions: seeded default event subscriptions");
    } else {
      logger.debug("seedDefaultEventSubscriptions: all default subscriptions already exist");
    }
  } catch (err: any) {
    logger.warn({ error: err?.message }, "seedDefaultEventSubscriptions: failed (non-fatal)");
  }
}
