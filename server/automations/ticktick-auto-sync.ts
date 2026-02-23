/**
 * TickTick Auto-Sync
 *
 * Cron job that runs every 30 minutes to pull TickTick inbox tasks
 * into SB-OS capture items. Skips already-synced items via externalId.
 *
 * Only runs if TICKTICK_ACCESS_TOKEN is set.
 */

import cron from "node-cron";
import { logger } from "../logger";

export function scheduleTickTickAutoSync() {
  if (!process.env.TICKTICK_ACCESS_TOKEN) {
    logger.info("TICKTICK_ACCESS_TOKEN not set — TickTick auto-sync disabled");
    return;
  }

  // Run every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    try {
      const ticktick = await import("../ticktick");
      const { storage } = await import("../storage");

      const inboxProjectId = await ticktick.getInboxProjectId();
      if (!inboxProjectId) {
        logger.debug("No TickTick inbox project configured — skipping auto-sync");
        return;
      }

      const tasks = await ticktick.getProjectTasks(inboxProjectId);
      const incomplete = tasks.filter(
        (t) => t.status === ticktick.TICKTICK_STATUS.NORMAL
      );

      if (incomplete.length === 0) return;

      // Get existing external IDs to skip duplicates
      const existingCaptures = await storage.getCaptures({ clarified: false });
      const existingIds = new Set(
        existingCaptures
          .filter((c: any) => c.externalId?.startsWith("ticktick:"))
          .map((c: any) => c.externalId)
      );

      let synced = 0;
      for (const task of incomplete) {
        const externalId = `ticktick:${task.id}`;
        if (existingIds.has(externalId)) continue;

        try {
          const captureData = ticktick.tickTickTaskToCaptureItem(task);
          await storage.createCapture({
            title: captureData.title,
            type: captureData.type,
            source: captureData.source,
            notes: captureData.notes,
            externalId: captureData.externalId,
            clarified: false,
          });
          synced++;
        } catch (err: any) {
          logger.warn(
            { error: err.message, taskId: task.id },
            "TickTick auto-sync: failed to sync task"
          );
        }
      }

      if (synced > 0) {
        logger.info({ synced }, "TickTick auto-sync completed");
      }
    } catch (error: any) {
      logger.warn(
        { error: error.message },
        "TickTick auto-sync failed (non-critical)"
      );
    }
  });

  logger.info("TickTick auto-sync scheduled (every 30 minutes)");
}
