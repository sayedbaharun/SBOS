/**
 * Dashboard Routes
 * Handles readiness, ventures overview, inbox, tasks, urgent items, top3, day, and next meeting
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { PRIORITY_ORDER } from "./constants";

const router = Router();

/**
 * Ensures tags is always an array. Handles cases where tags might be:
 * - null/undefined -> returns []
 * - a string -> splits by comma and trims
 * - already an array -> returns as-is
 */
function ensureTagsArray(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }
  return [];
}

/**
 * Normalizes a task object to ensure tags is always an array
 */
function normalizeTask<T extends { tags?: unknown }>(task: T): T & { tags: string[] } {
  return {
    ...task,
    tags: ensureTagsArray(task.tags),
  };
}

// Get readiness score based on health data
router.get("/readiness", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[Readiness API] Hit. Date: ${today}`);
    const entries = await storage.getHealthEntries({ dateGte: today, dateLte: today });
    const entry = entries[0];
    console.log(`[Readiness API] Entry found:`, entry ? "Yes" : "No");

    if (!entry) {
      return res.json({
        percentage: 0,
        sleep: 0,
        mood: "unknown",
        status: "no_data"
      });
    }

    // Calculate Readiness Score
    let score = 0;

    // 1. Sleep (50%) - Granular
    if (entry.sleepHours) {
      const sleepScore = Math.min((entry.sleepHours / 8) * 50, 50);
      score += sleepScore;
    }

    // 2. Energy (20%)
    if (entry.energyLevel) {
      score += (entry.energyLevel / 5) * 20;
    }

    // 3. Mood (15%)
    if (entry.mood === 'peak' || entry.mood === 'high') {
      score += 15;
    } else if (entry.mood === 'medium') {
      score += 10;
    } else {
      score += 5;
    }

    // 4. Stress (10%)
    if (entry.stressLevel === 'low') {
      score += 10;
    } else if (entry.stressLevel === 'medium') {
      score += 5;
    }

    // 5. Workout (5%)
    if (entry.workoutDone) {
      score += 5;
    }

    score = Math.round(score);

    res.json({
      percentage: score,
      sleep: entry.sleepHours || 0,
      mood: entry.mood || "unknown",
      status: "calculated"
    });
  } catch (error) {
    console.error("[Readiness API] Error:", error);
    res.status(500).json({ message: "Failed to calculate readiness" });
  }
});

// Get ventures overview for dashboard
router.get("/ventures", async (req: Request, res: Response) => {
  try {
    const [allVentures, allProjects, taskCountsByVenture] = await Promise.all([
      storage.getVentures(),
      storage.getProjects(),
      storage.getActiveTaskCountsByVenture(),
    ]);

    const activeVentures = allVentures.filter(v =>
      ['ongoing', 'building', 'planning', 'active', 'development'].includes(v.status)
    );

    const mappedVentures = activeVentures.map(v => {
      const projectCount = allProjects.filter(p => p.ventureId === v.id).length;
      const taskCounts = taskCountsByVenture.get(v.id) || { total: 0, overdueP0: 0, dueTodayP0P1: 0 };

      let urgency: 'critical' | 'warning' | 'clear' = 'clear';
      let urgencyColor = "bg-green-500";
      let urgencyLabel = "";

      if (taskCounts.overdueP0 > 0) {
        urgency = 'critical';
        urgencyColor = "bg-red-500";
        urgencyLabel = `${taskCounts.overdueP0} overdue`;
      } else if (taskCounts.dueTodayP0P1 > 0) {
        urgency = 'warning';
        urgencyColor = "bg-yellow-500";
        urgencyLabel = `${taskCounts.dueTodayP0P1} due today`;
      }

      return {
        id: v.id,
        name: v.name,
        projectCount,
        taskCount: taskCounts.total,
        urgency,
        urgencyColor,
        urgencyLabel,
        overdueP0Count: taskCounts.overdueP0,
        dueTodayCount: taskCounts.dueTodayP0P1
      };
    });

    const urgencyOrder = { critical: 0, warning: 1, clear: 2 };
    mappedVentures.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    res.json(mappedVentures);
  } catch (error) {
    console.error("[Dashboard Ventures] Error:", error);
    res.status(500).json({ message: "Failed to fetch ventures" });
  }
});

// Get inbox count and preview
router.get("/inbox", async (req: Request, res: Response) => {
  try {
    const items = await storage.getCaptures({ clarified: false });

    const topItems = items
      .slice(0, 3)
      .map(item => ({
        id: item.id,
        title: item.title,
        type: item.type,
        source: item.source
      }));

    res.json({
      count: items.length,
      items: topItems
    });
  } catch (error) {
    console.error("[Dashboard Inbox] Error:", error);
    res.status(500).json({ message: "Failed to fetch inbox count" });
  }
});

// Get today's tasks
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tasks = await storage.getTasksForToday(today);

    const activeTasks = tasks.filter(t => !['completed', 'on_hold'].includes(t.status));

    activeTasks.sort((a, b) => {
      const pA = PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] ?? 99;
      const pB = PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ?? 99;
      return pA - pB;
    });

    // Normalize tags to ensure they're always arrays
    res.json(activeTasks.map(normalizeTask));
  } catch (error) {
    console.error("[Dashboard Tasks] Error:", error);
    res.status(500).json({ message: "Failed to fetch today's tasks" });
  }
});

// Get urgent tasks
router.get("/urgent", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const urgentTasks = await storage.getUrgentTasks(today, 5);

    const isOnFire = urgentTasks.some(t =>
      t.priority === 'P0' && t.dueDate && t.dueDate < today
    );

    // Normalize tags to ensure they're always arrays
    res.json({
      tasks: urgentTasks.map(normalizeTask),
      count: urgentTasks.length,
      onFire: isOnFire
    });
  } catch (error) {
    console.error("[Dashboard Urgent] Error:", error);
    res.status(500).json({ message: "Failed to fetch urgent tasks" });
  }
});

// Get top 3 priority tasks for today
router.get("/top3", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get top priority tasks (P0, P1) that are active
    const topTasks = await storage.getTopPriorityTasks(today, 3);

    // Enhance tasks with additional context
    const enhancedTasks = topTasks.map(task => {
      const isOverdue = task.dueDate && task.dueDate < today;
      const isDueToday = task.dueDate === today;

      return {
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate,
        focusDate: task.focusDate,
        ventureId: task.ventureId,
        projectId: task.projectId,
        isOverdue,
        isDueToday
      };
    });

    res.json({ tasks: enhancedTasks });
  } catch (error) {
    console.error("[Dashboard Top3] Error:", error);
    res.status(500).json({ message: "Failed to fetch top 3 tasks" });
  }
});

// Get current day data
router.get("/day", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const day = await storage.getDayOrCreate(today);

    // Get the primary venture name if set
    let primaryVentureName = null;
    if (day.primaryVentureFocus) {
      const venture = await storage.getVenture(String(day.primaryVentureFocus));
      primaryVentureName = venture?.name || null;
    }

    res.json({
      id: day.id,
      date: day.date,
      title: day.title,
      mood: day.mood,
      top3Outcomes: day.top3Outcomes,
      oneThingToShip: day.oneThingToShip,
      reflectionAm: day.reflectionAm,
      reflectionPm: day.reflectionPm,
      primaryVentureFocus: day.primaryVentureFocus,
      primaryVentureName
    });
  } catch (error) {
    console.error("[Dashboard Day] Error:", error);
    res.status(500).json({ message: "Failed to fetch day summary" });
  }
});

// Get next meeting from Google Calendar
router.get("/next-meeting", async (req: Request, res: Response) => {
  try {
    // Check if calendar is configured
    const calendarConfigured = !!(
      process.env.GOOGLE_CALENDAR_CLIENT_ID &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    );

    if (!calendarConfigured) {
      return res.json({
        configured: false,
        meeting: null
      });
    }

    // Get events from now until end of day
    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const { listEvents } = await import("../google-calendar");
      const events = await listEvents(now, endOfDay, 5);

      // Find the next upcoming event (not already started)
      const upcomingEvents = events.filter((event: any) => {
        const eventStart = new Date(event.start?.dateTime || event.start?.date);
        return eventStart > now;
      });

      if (upcomingEvents.length === 0) {
        return res.json({
          configured: true,
          meeting: null
        });
      }

      const nextEvent = upcomingEvents[0];
      const startTimeStr = nextEvent.start?.dateTime || nextEvent.start?.date;
      if (!startTimeStr) {
        return res.json({
          configured: true,
          meeting: null
        });
      }
      const eventStart = new Date(startTimeStr);
      const minutesUntil = Math.round((eventStart.getTime() - now.getTime()) / 60000);

      res.json({
        configured: true,
        meeting: {
          id: nextEvent.id,
          title: nextEvent.summary || "Untitled Event",
          startTime: nextEvent.start?.dateTime || nextEvent.start?.date,
          endTime: nextEvent.end?.dateTime || nextEvent.end?.date,
          minutesUntil,
          location: nextEvent.location || null,
          meetLink: nextEvent.hangoutLink || null,
          link: nextEvent.htmlLink,
        }
      });
    } catch (calendarError) {
      logger.error({ error: calendarError }, "Error fetching calendar events");
      res.json({
        connected: true,
        meeting: null,
        error: "Failed to fetch calendar events"
      });
    }
  } catch (error) {
    console.error("[Dashboard Next Meeting] Error:", error);
    res.status(500).json({ message: "Failed to fetch next meeting" });
  }
});

// Get daily scorecard data
router.get("/scorecard", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Fetch all required data in parallel
    const [healthEntries, nutritionEntries, dayData, tradingChecklists] = await Promise.all([
      storage.getHealthEntries({ dateGte: today, dateLte: today }),
      storage.getNutritionEntries({ date: today }),
      storage.getDay(today),
      storage.getDailyTradingChecklists({ date: today }),
    ]);

    const health = healthEntries[0];
    const day = dayData;
    const tradingChecklist = tradingChecklists[0];

    // Calculate nutrition totals (with defensive checks)
    const totalProtein = Array.isArray(nutritionEntries)
      ? nutritionEntries.reduce((sum, e) => sum + (e.proteinG || 0), 0)
      : 0;
    const totalCalories = Array.isArray(nutritionEntries)
      ? nutritionEntries.reduce((sum, e) => sum + (e.calories || 0), 0)
      : 0;

    // Calculate trading P&L from trading journal or checklist
    let tradingPnL: number | null = null;
    const sessions = day?.tradingJournal?.sessions;
    if (Array.isArray(sessions) && sessions.length > 0) {
      tradingPnL = sessions.reduce((sum: number, s: { pnl?: number }) => sum + (s.pnl || 0), 0);
    } else if (tradingChecklist?.trades && Array.isArray(tradingChecklist.trades)) {
      tradingPnL = (tradingChecklist.trades as any[]).reduce((sum, t) => sum + (t.pnl || 0), 0);
    }

    // Build metrics with status
    const metrics = [
      {
        label: "Sleep",
        target: "7+ hrs",
        actual: health?.sleepHours ? `${health.sleepHours}h` : null,
        status: !health?.sleepHours ? 'pending' :
                health.sleepHours >= 7 ? 'success' :
                health.sleepHours >= 6 ? 'warning' : 'danger'
      },
      {
        label: "Weight",
        target: "↓ trend",
        actual: health?.weightKg ? `${health.weightKg}kg` : null,
        status: health?.weightKg ? 'success' : 'pending'
      },
      {
        label: "Fasting",
        target: "16 hrs",
        actual: day?.eveningRituals?.fastingHours ? `${day.eveningRituals.fastingHours}h` : null,
        status: !day?.eveningRituals?.fastingHours ? 'pending' :
                day.eveningRituals.fastingHours >= 16 ? 'success' :
                day.eveningRituals.fastingHours >= 14 ? 'warning' : 'danger'
      },
      {
        label: "Protein",
        target: "200g+",
        actual: day?.proteinMet ? "Yes" : (totalProtein > 0 ? `${Math.round(totalProtein)}g` : null),
        status: day?.proteinMet ? 'success' :
                totalProtein === 0 ? 'pending' :
                totalProtein >= 200 ? 'success' :
                totalProtein >= 150 ? 'warning' : 'danger'
      },
      {
        label: "Calories",
        target: ">2100",
        actual: day?.caloriesOver2100 ? "Yes" : (totalCalories > 0 ? `${Math.round(totalCalories)}` : null),
        status: day?.caloriesOver2100 ? 'success' :
                totalCalories === 0 ? 'pending' :
                totalCalories >= 2100 ? 'success' :
                totalCalories >= 1800 ? 'warning' : 'danger'
      },
      {
        label: "Deep Work",
        target: "5 hrs",
        actual: day?.eveningRituals?.deepWorkHours ? `${day.eveningRituals.deepWorkHours}h` : null,
        status: !day?.eveningRituals?.deepWorkHours ? 'pending' :
                day.eveningRituals.deepWorkHours >= 5 ? 'success' :
                day.eveningRituals.deepWorkHours >= 3 ? 'warning' : 'danger'
      },
      {
        label: "Trading P&L",
        target: "green",
        actual: tradingPnL !== null ? (tradingPnL >= 0 ? `+$${tradingPnL}` : `-$${Math.abs(tradingPnL)}`) : null,
        status: tradingPnL === null ? 'pending' :
                tradingPnL > 0 ? 'success' :
                tradingPnL === 0 ? 'warning' : 'danger'
      },
      {
        label: "Workout",
        target: "Y/N",
        actual: health?.workoutDone !== undefined ? (health.workoutDone ? "Yes" : "No") : null,
        status: health?.workoutDone === undefined ? 'pending' :
                health.workoutDone ? 'success' : 'danger'
      },
    ];

    // Check ritual completion
    const morningComplete = !!(day?.morningRituals?.completedAt);
    const eveningComplete = !!(day?.eveningRituals?.completedAt);

    res.json({
      date: today,
      metrics,
      morningComplete,
      eveningComplete,
    });
  } catch (error) {
    console.error("[Dashboard Scorecard] Error:", error);
    res.status(500).json({
      message: "Failed to fetch scorecard",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET /api/dashboard/scorecard-history?days=7 — daily scores for sparkline
router.get("/scorecard-history", async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(String(req.query.days || "7")), 30);
    const history: Array<{ date: string; score: number }> = [];

    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];

      const [healthEntries, dayData] = await Promise.all([
        storage.getHealthEntries({ dateGte: dateStr, dateLte: dateStr }),
        storage.getDay(dateStr),
      ]);
      const health = healthEntries[0];

      let score = 0;
      if (health?.sleepHours) score += Math.min((health.sleepHours / 8) * 40, 40);
      if (health?.energyLevel) score += (health.energyLevel / 5) * 20;
      if (health?.workoutDone) score += 20;
      if (dayData?.morningRituals) score += 10;
      if (dayData?.eveningRituals?.reviewCompleted) score += 10;

      history.push({ date: dateStr, score: Math.round(score) });
    }

    res.json(history);
  } catch (error) {
    console.error("[Dashboard Scorecard History] Error:", error);
    res.status(500).json({ error: "Failed to fetch scorecard history" });
  }
});

// GET /api/dashboard/ventures-v2 — ventures with active goal + key result progress
router.get("/ventures-v2", async (req: Request, res: Response) => {
  try {
    const ventures = await storage.getVentures();
    const results = await Promise.all(
      ventures
        .filter((v) => v.status !== "archived")
        .map(async (v) => {
          const activeGoal = await storage.getActiveVentureGoal(v.id);
          if (!activeGoal) {
            return { ...v, activeGoal: null, progressPercent: 0, overallStatus: "no_goal", keyResults: [] };
          }
          const krs = await storage.getKeyResults(activeGoal.id);
          const totalProgress = krs.length > 0
            ? krs.reduce((sum, kr) => sum + (kr.targetValue > 0 ? Math.min(1, kr.currentValue / kr.targetValue) : 0), 0) / krs.length
            : 0;
          const overallStatus =
            krs.every((kr) => kr.status === "completed") ? "completed" :
            krs.some((kr) => kr.status === "behind") ? "behind" :
            krs.some((kr) => kr.status === "at_risk") ? "at_risk" : "on_track";

          return {
            ...v,
            activeGoal,
            keyResults: krs,
            progressPercent: Math.round(totalProgress * 100),
            overallStatus,
          };
        })
    );
    res.json(results);
  } catch (error) {
    console.error("[Dashboard Ventures V2] Error:", error);
    res.status(500).json({ error: "Failed to fetch ventures v2" });
  }
});

// GET /api/dashboard/financials — budget + spending aggregation
router.get("/financials", async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjects({});
    const totalBudget = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const totalSpent = projects.reduce((sum, p) => sum + (p.budgetSpent || 0), 0);
    const totalRevenue = projects.reduce((sum, p) => sum + (p.revenueGenerated || 0), 0);

    res.json({
      totalBudget,
      totalSpent,
      totalRevenue,
      netPosition: totalRevenue - totalSpent,
      projectCount: projects.length,
      overspentProjects: projects.filter((p) => (p.budgetSpent || 0) > (p.budget || 0)).length,
    });
  } catch (error) {
    console.error("[Dashboard Financials] Error:", error);
    res.status(500).json({ error: "Failed to fetch financials" });
  }
});

// GET /api/dashboard/venture-goals — all active venture goals with key results + venture info
router.get("/venture-goals", async (req: Request, res: Response) => {
  try {
    const data = await storage.getAllActiveGoalsWithProgress();
    // Compute aggregate progress per goal
    const enriched = data.map((goal) => {
      const krs = goal.keyResults;
      const totalProgress = krs.length > 0
        ? krs.reduce((sum, kr) => sum + Math.min(1, kr.currentValue / kr.targetValue), 0) / krs.length
        : 0;
      const completedKRs = krs.filter((kr) => kr.status === "completed").length;
      const atRiskKRs = krs.filter((kr) => kr.status === "at_risk").length;
      const behindKRs = krs.filter((kr) => kr.status === "behind").length;

      const overallStatus =
        behindKRs > 0 ? "behind" :
        atRiskKRs > 0 ? "at_risk" :
        completedKRs === krs.length && krs.length > 0 ? "completed" : "on_track";

      return {
        ...goal,
        progressPercent: Math.round(totalProgress * 100),
        overallStatus,
      };
    });
    res.json(enriched);
  } catch (error) {
    console.error("[Dashboard Venture Goals] Error:", error);
    res.status(500).json({ error: "Failed to fetch venture goals" });
  }
});

export default router;
