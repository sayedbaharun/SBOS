/**
 * Trading Command Center Routes
 * Aggregated endpoints: bias, P&L, risk, performance, discipline, news, market snapshot
 */
import { Router, Request, Response } from "express";
import { db } from "../../db";
import { dailyTradingChecklists, tradingBias, tradingRiskConfig } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { logger } from "../logger";

const ccRouter = Router();

// ============================================================================
// MARKET SNAPSHOT — Yahoo Finance free quote endpoint, 60s cache
// ============================================================================
const INSTRUMENTS = [
  { symbol: "DX-Y.NYB", label: "DXY", decimals: 3 },
  { symbol: "%5EGSPC",  label: "SPX", decimals: 2 },
  { symbol: "%5EIXIC",  label: "NAS", decimals: 2 },
  { symbol: "%5EVIX",   label: "VIX", decimals: 2 },
  { symbol: "GC%3DF",   label: "GOLD", decimals: 2 },
  { symbol: "%5ETNX",   label: "10Y", decimals: 3 },
  { symbol: "BTC-USD",  label: "BTC", decimals: 0 },
];

let snapshotCache: { data: unknown; fetchedAt: number } | null = null;
const SNAPSHOT_TTL_MS = 60_000; // 60 seconds

ccRouter.get("/market-snapshot", async (_req: Request, res: Response) => {
  try {
    if (snapshotCache && Date.now() - snapshotCache.fetchedAt < SNAPSHOT_TTL_MS) {
      return res.json(snapshotCache.data);
    }

    const symbols = INSTRUMENTS.map((i) => i.symbol).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1d&interval=5m`;

    const yResp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SB-OS/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!yResp.ok) throw new Error(`Yahoo Finance ${yResp.status}`);
    const raw = (await yResp.json()) as any;

    const quotes = INSTRUMENTS.map((inst) => {
      const spark = raw?.spark?.result?.find((r: any) => r.symbol === decodeURIComponent(inst.symbol));
      const response = spark?.response?.[0];
      const closes = response?.indicators?.quote?.[0]?.close ?? [];
      const validCloses = closes.filter((c: any) => c != null);
      const price = validCloses.at(-1) ?? null;
      const open = validCloses[0] ?? null;
      const change = price != null && open != null ? price - open : null;
      const changePct = open ? (change! / open) * 100 : null;
      return {
        symbol: decodeURIComponent(inst.symbol),
        label: inst.label,
        price,
        change,
        changePct,
        sparkline: validCloses.slice(-20), // last 20 points for mini chart
      };
    });

    const data = { quotes, fetchedAt: new Date().toISOString() };
    snapshotCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (error) {
    logger.error({ error }, "Error fetching market snapshot");
    res.json(snapshotCache?.data ?? { quotes: [], fetchedAt: null, error: "unavailable" });
  }
});

// ============================================================================
// NEWS WIRE — ForexLive RSS, 10min cache
// ============================================================================
let newsCache: { data: unknown; fetchedAt: number } | null = null;
const NEWS_TTL_MS = 10 * 60_000; // 10 minutes

ccRouter.get("/news", async (_req: Request, res: Response) => {
  try {
    if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_TTL_MS) {
      return res.json(newsCache.data);
    }

    // ForexLive RSS — free, no key required
    const rssResp = await fetch("https://www.forexlive.com/feed/news", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SB-OS/1.0)",
        Accept: "application/rss+xml, text/xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!rssResp.ok) throw new Error(`ForexLive ${rssResp.status}`);

    const xml = await rssResp.text();

    // Minimal RSS parser — no dependencies
    const items: { title: string; link: string; pubDate: string; description: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
      const block = match[1];
      const get = (tag: string) => {
        const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`).exec(block);
        return (m?.[1] ?? m?.[2] ?? "").trim();
      };
      const title = get("title");
      const link = get("link") || "";
      const pubDate = get("pubDate") || new Date().toISOString();
      const description = get("description").replace(/<[^>]+>/g, "").trim().slice(0, 200);
      if (title) items.push({ title, link, pubDate, description });
    }

    const data = { items, fetchedAt: new Date().toISOString() };
    newsCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (error) {
    logger.error({ error }, "Error fetching news wire");
    res.json(newsCache?.data ?? { items: [], fetchedAt: null, error: "unavailable" });
  }
});

// ============================================================================
// P&L SUMMARY — aggregate from all checklists trades
// ============================================================================
ccRouter.get("/pnl", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Week start (Monday)
    const weekStart = new Date(now);
    const dayOfWeek = now.getDay();
    const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(now.getDate() - daysBack);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Month start
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // Year start
    const yearStart = `${now.getFullYear()}-01-01`;

    const checklists = await db
      .select()
      .from(dailyTradingChecklists)
      .where(gte(dailyTradingChecklists.date, yearStart))
      .orderBy(desc(dailyTradingChecklists.date));

    let dayPnl = 0, weekPnl = 0, monthPnl = 0, ytdPnl = 0;
    let dayTrades = 0, weekTrades = 0, monthTrades = 0, ytdTrades = 0;
    let dayWins = 0, weekWins = 0;
    const equityCurve: { date: string; pnl: number }[] = [];
    const dailyMap = new Map<string, number>();

    for (const c of checklists) {
      const dateStr = typeof c.date === "string" ? c.date : (c.date as Date).toISOString().split("T")[0];
      const trades = (c.data as any)?.trades ?? [];
      const closedTrades = trades.filter((t: any) => t.result && t.result !== "pending");

      for (const trade of closedTrades) {
        const pnl = Number(trade.pnl ?? 0);
        const isWin = trade.result === "win";

        ytdPnl += pnl;
        ytdTrades++;

        if (dateStr >= monthStart) { monthPnl += pnl; monthTrades++; }
        if (dateStr >= weekStartStr) { weekPnl += pnl; weekTrades++; if (isWin) weekWins++; }
        if (dateStr === today) { dayPnl += pnl; dayTrades++; if (isWin) dayWins++; }

        dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + pnl);
      }
    }

    // Build equity curve from dailyMap (last 30 days cumulative)
    const sortedDates = Array.from(dailyMap.keys()).sort();
    let cumulative = 0;
    for (const d of sortedDates) {
      cumulative += dailyMap.get(d)!;
      equityCurve.push({ date: d, pnl: Math.round(cumulative * 100) / 100 });
    }

    res.json({
      day: { pnl: dayPnl, trades: dayTrades, wins: dayWins },
      week: { pnl: weekPnl, trades: weekTrades, wins: weekWins },
      month: { pnl: monthPnl, trades: monthTrades },
      ytd: { pnl: ytdPnl, trades: ytdTrades },
      equityCurve: equityCurve.slice(-30),
    });
  } catch (error) {
    logger.error({ error }, "Error computing P&L");
    res.status(500).json({ error: "Failed to compute P&L" });
  }
});

// ============================================================================
// PERFORMANCE ANALYTICS — win rate, avg R, expectancy, by instrument/session/DOW
// ============================================================================
ccRouter.get("/performance", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    const fromDate = ninetyDaysAgo.toISOString().split("T")[0];

    const checklists = await db
      .select()
      .from(dailyTradingChecklists)
      .where(gte(dailyTradingChecklists.date, fromDate))
      .orderBy(desc(dailyTradingChecklists.date));

    const byInstrument = new Map<string, { wins: number; losses: number; be: number; totalPnl: number }>();
    const bySession = new Map<string, { wins: number; losses: number; be: number; totalPnl: number }>();
    const byDOW = new Map<number, { wins: number; losses: number; be: number; totalPnl: number }>();

    let totalWins = 0, totalLosses = 0, totalBe = 0, totalPnl = 0;

    for (const c of checklists) {
      const dateStr = typeof c.date === "string" ? c.date : (c.date as Date).toISOString().split("T")[0];
      const session = (c.data as any)?.session ?? "other";
      const dow = new Date(dateStr + "T12:00:00Z").getDay(); // 0=Sun … 6=Sat
      const trades = ((c.data as any)?.trades ?? []).filter((t: any) => t.result && t.result !== "pending");

      for (const trade of trades) {
        const instrument = trade.symbol ?? trade.pair ?? "Unknown";
        const pnl = Number(trade.pnl ?? 0);
        const result = trade.result as string;

        const addTo = (map: Map<any, any>, key: any) => {
          if (!map.has(key)) map.set(key, { wins: 0, losses: 0, be: 0, totalPnl: 0 });
          const m = map.get(key);
          m.totalPnl += pnl;
          if (result === "win") m.wins++;
          else if (result === "loss") m.losses++;
          else m.be++;
        };

        addTo(byInstrument, instrument);
        addTo(bySession, session);
        addTo(byDOW, dow);

        totalPnl += pnl;
        if (result === "win") totalWins++;
        else if (result === "loss") totalLosses++;
        else totalBe++;
      }
    }

    const totalTrades = totalWins + totalLosses + totalBe;
    const winRate = totalTrades > 0 ? Math.round((totalWins / (totalWins + totalLosses || 1)) * 100) : null;
    const expectancy = totalTrades > 0 ? Math.round((totalPnl / totalTrades) * 100) / 100 : null;

    const toArray = (map: Map<any, any>) =>
      Array.from(map.entries())
        .map(([key, v]) => ({
          key,
          wins: v.wins,
          losses: v.losses,
          be: v.be,
          totalPnl: Math.round(v.totalPnl * 100) / 100,
          winRate: v.wins + v.losses > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 100) : null,
          trades: v.wins + v.losses + v.be,
        }))
        .sort((a, b) => b.trades - a.trades);

    const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    res.json({
      overall: { totalTrades, wins: totalWins, losses: totalLosses, be: totalBe, winRate, expectancy, totalPnl: Math.round(totalPnl * 100) / 100 },
      byInstrument: toArray(byInstrument),
      bySession: toArray(bySession),
      byDOW: toArray(byDOW).map((d) => ({ ...d, label: DOW_LABELS[Number(d.key)] })),
      windowDays: 90,
    });
  } catch (error) {
    logger.error({ error }, "Error computing performance");
    res.status(500).json({ error: "Failed to compute performance" });
  }
});

// ============================================================================
// DISCIPLINE SCORECARD — today adherence + current streak
// ============================================================================
ccRouter.get("/discipline", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Load last 60 days of checklists for streak
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(now.getDate() - 60);
    const fromDate = sixtyDaysAgo.toISOString().split("T")[0];

    const checklists = await db
      .select()
      .from(dailyTradingChecklists)
      .where(gte(dailyTradingChecklists.date, fromDate))
      .orderBy(desc(dailyTradingChecklists.date));

    // Today's checklist(s)
    const todayChecklists = checklists.filter((c) => {
      const d = typeof c.date === "string" ? c.date : (c.date as Date).toISOString().split("T")[0];
      return d === today;
    });

    let todayFollowedPlan = false;
    let todayNoTradeOk = false;
    let todayMentalState: number | null = null;
    let todayTradeCount = 0;
    let todayHasReview = false;

    for (const c of todayChecklists) {
      const data = c.data as any;
      const review = data?.endOfSessionReview;
      if (review?.followedPlan) todayFollowedPlan = true;
      if (review?.noTradeIsSuccess) todayNoTradeOk = true;
      if (review) todayHasReview = true;
      if (data?.mentalState) todayMentalState = data.mentalState;
      todayTradeCount += (data?.trades ?? []).length;
    }

    // Compute green-day streak (days where followedPlan = true, ordered back from today)
    type ChecklistData = { date: string; followedPlan: boolean; hasReview: boolean };
    const byDate = new Map<string, ChecklistData>();
    for (const c of checklists) {
      const dateStr = typeof c.date === "string" ? c.date : (c.date as Date).toISOString().split("T")[0];
      const data = c.data as any;
      const review = data?.endOfSessionReview;
      const existing = byDate.get(dateStr);
      byDate.set(dateStr, {
        date: dateStr,
        followedPlan: (existing?.followedPlan ?? false) || (review?.followedPlan ?? false),
        hasReview: (existing?.hasReview ?? false) || !!review,
      });
    }

    const sortedDays = Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    for (const day of sortedDays) {
      if (day.date === today) continue; // skip today (in progress)
      if (day.hasReview && day.followedPlan) streak++;
      else if (day.hasReview && !day.followedPlan) break;
      // No review = no trade day = don't break streak
    }

    res.json({
      today: {
        hasReview: todayHasReview,
        followedPlan: todayFollowedPlan,
        noTradeIsSuccess: todayNoTradeOk,
        mentalState: todayMentalState,
        tradeCount: todayTradeCount,
        checklistCount: todayChecklists.length,
      },
      streak,
      recentDays: sortedDays.slice(0, 7),
    });
  } catch (error) {
    logger.error({ error }, "Error computing discipline scorecard");
    res.status(500).json({ error: "Failed to compute discipline scorecard" });
  }
});

// ============================================================================
// RISK STATUS — today's risk usage + config
// ============================================================================
ccRouter.get("/risk-status", async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Load config
    const configs = await db.select().from(tradingRiskConfig).limit(1);
    const config = configs[0] ?? {
      accountStartingBalance: 10000,
      maxDailyLossPct: 2,
      maxRiskPerTradePct: 1,
      maxTradesPerDay: 3,
      watchlistInstruments: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100", "BTCUSD"],
    };

    // Today's trades
    const todayChecklists = await db
      .select()
      .from(dailyTradingChecklists)
      .where(eq(dailyTradingChecklists.date, today));

    let todayPnl = 0;
    let todayTradeCount = 0;

    for (const c of todayChecklists) {
      const trades = (c.data as any)?.trades ?? [];
      todayTradeCount += trades.length;
      for (const t of trades) {
        if (t.result !== "pending") todayPnl += Number(t.pnl ?? 0);
      }
    }

    const accountBalance = config.accountStartingBalance;
    const maxDailyLoss = -(accountBalance * config.maxDailyLossPct) / 100;
    const dailyLossUsedPct = accountBalance > 0 ? Math.abs(Math.min(0, todayPnl)) / accountBalance * 100 : 0;
    const isMaxLossBreached = todayPnl <= maxDailyLoss;
    const isMaxTradesReached = todayTradeCount >= config.maxTradesPerDay;

    res.json({
      config,
      today: {
        pnl: todayPnl,
        tradeCount: todayTradeCount,
        dailyLossUsedPct: Math.round(dailyLossUsedPct * 10) / 10,
        isMaxLossBreached,
        isMaxTradesReached,
        canTrade: !isMaxLossBreached && !isMaxTradesReached,
      },
    });
  } catch (error) {
    logger.error({ error }, "Error computing risk status");
    res.status(500).json({ error: "Failed to compute risk status" });
  }
});

// PATCH risk config
ccRouter.patch("/risk-config", async (req: Request, res: Response) => {
  try {
    const configs = await db.select().from(tradingRiskConfig).limit(1);
    let updated;
    if (configs.length === 0) {
      const [row] = await db.insert(tradingRiskConfig).values(req.body).returning();
      updated = row;
    } else {
      const [row] = await db.update(tradingRiskConfig)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(tradingRiskConfig.id, configs[0].id))
        .returning();
      updated = row;
    }
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error updating risk config");
    res.status(500).json({ error: "Failed to update risk config" });
  }
});

// ============================================================================
// TRADING BIAS CRUD
// ============================================================================

// GET /api/trading/bias?date=YYYY-MM-DD
ccRouter.get("/bias", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const rows = await db
      .select()
      .from(tradingBias)
      .where(eq(tradingBias.date, date))
      .orderBy(tradingBias.instrument);
    res.json(rows);
  } catch (error) {
    logger.error({ error }, "Error fetching trading bias");
    res.status(500).json({ error: "Failed to fetch trading bias" });
  }
});

// POST /api/trading/bias
ccRouter.post("/bias", async (req: Request, res: Response) => {
  try {
    const { date, instrument, direction, htfContext, keyLevels, invalidation, target, notes } = req.body;
    if (!date || !instrument || !direction) {
      return res.status(400).json({ error: "date, instrument, direction required" });
    }
    // Upsert by date + instrument
    const existing = await db
      .select()
      .from(tradingBias)
      .where(and(eq(tradingBias.date, date), eq(tradingBias.instrument, instrument)))
      .limit(1);

    let row;
    if (existing.length > 0) {
      [row] = await db.update(tradingBias)
        .set({ direction, htfContext, keyLevels: keyLevels ?? [], invalidation, target, notes, updatedAt: new Date() })
        .where(eq(tradingBias.id, existing[0].id))
        .returning();
    } else {
      [row] = await db.insert(tradingBias)
        .values({ date, instrument, direction, htfContext, keyLevels: keyLevels ?? [], invalidation, target, notes })
        .returning();
    }
    res.status(201).json(row);
  } catch (error) {
    logger.error({ error }, "Error saving trading bias");
    res.status(500).json({ error: "Failed to save trading bias" });
  }
});

// PATCH /api/trading/bias/:id — lock bias or update fields
ccRouter.patch("/bias/:id", async (req: Request, res: Response) => {
  try {
    const { lock, ...fields } = req.body;
    const biasId = String(req.params.id);
    const [row] = await db.update(tradingBias)
      .set({ ...fields, lockedAt: lock ? new Date() : undefined, updatedAt: new Date() })
      .where(eq(tradingBias.id, biasId))
      .returning();
    if (!row) return res.status(404).json({ error: "Bias not found" });
    res.json(row);
  } catch (error) {
    logger.error({ error }, "Error updating trading bias");
    res.status(500).json({ error: "Failed to update trading bias" });
  }
});

// DELETE /api/trading/bias/:id
ccRouter.delete("/bias/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(tradingBias).where(eq(tradingBias.id, String(req.params.id)));
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, "Error deleting trading bias");
    res.status(500).json({ error: "Failed to delete trading bias" });
  }
});

export default ccRouter;
