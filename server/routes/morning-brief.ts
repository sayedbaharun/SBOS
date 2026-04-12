/**
 * Morning Brief Route
 * GET /api/dashboard/morning-brief
 *
 * Returns today's pre-computed morning brief, or a placeholder if none exists yet.
 * The brief is generated at 7am Dubai time by the daily_briefing scheduled job.
 */
import { Router, Request, Response } from "express";
import { getUserDate } from "../utils/dates";
import { logger } from "../logger";

const router = Router();

// Lazy DB accessor (same pattern as scheduled-jobs.ts)
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

router.get("/morning-brief", async (req: Request, res: Response) => {
  const todayDate = getUserDate();

  try {
    const database = await getDb();
    const { dailyBriefs } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const rows = await database
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.date, todayDate))
      .limit(1);

    if (rows.length === 0) {
      return res.json({
        date: todayDate,
        headline: "No brief yet — will generate at 7am.",
        bullets: [],
        agentReadyCount: 0,
        reviewPendingCount: 0,
        generatedAt: null,
        agentSlug: null,
      });
    }

    return res.json(rows[0]);
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to fetch morning brief");
    return res.json({
      date: todayDate,
      headline: "No brief yet — will generate at 7am.",
      bullets: [],
      agentReadyCount: 0,
      reviewPendingCount: 0,
      generatedAt: null,
      agentSlug: null,
    });
  }
});

export default router;
