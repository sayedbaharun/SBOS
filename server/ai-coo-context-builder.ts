/**
 * AI COO Context Builder
 *
 * Builds comprehensive system context for the AI Chief Operating Officer.
 * Aggregates data from ALL sources: ventures, trading, health, nutrition,
 * shopping, books, captures, days, and docs.
 */

import { storage } from "./storage";
import { logger } from "./logger";

export interface SystemOverview {
  // Ventures & Projects
  ventures: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
    list: Array<{
      id: string;
      name: string;
      status: string;
      domain: string;
      projectCount: number;
      taskCount: number;
    }>;
  };
  projects: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
  };

  // Tasks
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    todayCount: number;
    overdueCount: number;
    highPriority: number; // P0 + P1
  };

  // Inbox
  captures: {
    total: number;
    unclarified: number;
    byType: Record<string, number>;
  };

  // Health & Wellness
  health: {
    latestEntry: any;
    weeklyAverages: {
      sleepHours: number;
      energyLevel: number;
      stressLevel: string;
    } | null;
    workoutsThisWeek: number;
  };

  // Nutrition
  nutrition: {
    todayCalories: number;
    todayProtein: number;
    mealsLogged: number;
  };

  // Trading
  trading: {
    activeStrategies: number;
    todayChecklist: {
      completed: boolean;
      mentalState: number | null;
      session: string | null;
    } | null;
    recentPnL: number;
    sessionsThisWeek: number;
  };

  // Life Management
  shopping: {
    toBuy: number;
    byCategory: Record<string, number>;
  };
  books: {
    reading: number;
    toRead: number;
    finished: number;
  };

  // Day & Rituals
  today: {
    id: string | null;
    mood: string | null;
    top3Completed: number;
    morningRitualDone: boolean;
    eveningReviewDone: boolean;
    primaryVentureFocus: string | null;
  };

  // Knowledge Base
  docs: {
    total: number;
    byType: Record<string, number>;
    recentlyUpdated: number;
  };
}

/**
 * Build a comprehensive system overview for the AI COO
 */
export async function buildSystemOverview(): Promise<SystemOverview> {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // Fetch all data in parallel for performance
    const [
      ventures,
      projects,
      tasks,
      captures,
      healthEntries,
      nutritionEntries,
      tradingStrategies,
      todayChecklist,
      shoppingItems,
      books,
      dayData,
      docs,
    ] = await Promise.all([
      storage.getVentures(),
      storage.getProjects(),
      storage.getTasks({}),
      storage.getCaptures(),
      storage.getHealthEntries({ dateGte: weekAgo }),
      storage.getNutritionEntries({ date: today }),
      storage.getTradingStrategies(),
      storage.getDailyTradingChecklistByDate(today).catch(() => null),
      storage.getShoppingItems(),
      storage.getBooks(),
      storage.getDay(today).catch(() => null),
      storage.getDocs({ limit: 200 }),
    ]);

    // Calculate venture stats with project/task counts
    const ventureStats = ventures.map(v => ({
      id: v.id,
      name: v.name,
      status: v.status || 'active',
      domain: v.domain || 'other',
      projectCount: projects.filter(p => p.ventureId === v.id).length,
      taskCount: tasks.filter(t => t.ventureId === v.id).length,
    }));

    // Task stats
    const taskByStatus: Record<string, number> = {};
    let overdueCount = 0;
    let highPriorityCount = 0;
    const todayTasks = tasks.filter(t => t.focusDate === today || t.dueDate === today);

    tasks.forEach(t => {
      const status = t.status || 'backlog';
      taskByStatus[status] = (taskByStatus[status] || 0) + 1;

      if (t.dueDate && t.dueDate < today && t.status !== 'completed' && t.status !== 'on_hold') {
        overdueCount++;
      }
      if ((t.priority === 'P0' || t.priority === 'P1') && t.status !== 'completed' && t.status !== 'on_hold') {
        highPriorityCount++;
      }
    });

    // Capture stats
    const captureByType: Record<string, number> = {};
    let unclarifiedCount = 0;
    captures.forEach(c => {
      const type = c.type || 'note';
      captureByType[type] = (captureByType[type] || 0) + 1;
      if (!c.clarified) unclarifiedCount++;
    });

    // Health stats
    const latestHealth = healthEntries[0] || null;
    const weeklyHealth = healthEntries.length > 0 ? {
      sleepHours: healthEntries.reduce((sum, h) => sum + (h.sleepHours || 0), 0) / healthEntries.length,
      energyLevel: healthEntries.reduce((sum, h) => sum + (h.energyLevel || 3), 0) / healthEntries.length,
      stressLevel: getMostCommon(healthEntries.map(h => h.stressLevel).filter((s): s is string => s !== null)),
    } : null;
    const workoutsThisWeek = healthEntries.filter(h => h.workoutDone).length;

    // Nutrition stats
    const todayNutrition = nutritionEntries.reduce((acc, n) => ({
      calories: acc.calories + (n.calories || 0),
      protein: acc.protein + (n.proteinG || 0),
      meals: acc.meals + 1,
    }), { calories: 0, protein: 0, meals: 0 });

    // Trading stats
    const activeStrategies = tradingStrategies.filter(s => s.isActive).length;
    const tradingData = {
      activeStrategies,
      todayChecklist: todayChecklist ? {
        completed: Boolean(todayChecklist.data?.endOfSessionReview),
        mentalState: todayChecklist.data?.mentalState ?? null,
        session: todayChecklist.data?.session ?? null,
      } : null,
      recentPnL: 0, // Could calculate from journal entries
      sessionsThisWeek: 0, // Could calculate from checklists
    };

    // Shopping stats
    const toBuyItems = shoppingItems.filter(s => s.status === 'to_buy');
    const shoppingByCategory: Record<string, number> = {};
    toBuyItems.forEach(s => {
      const cat = s.category || 'other';
      shoppingByCategory[cat] = (shoppingByCategory[cat] || 0) + 1;
    });

    // Books stats
    const booksByStatus = {
      reading: books.filter(b => b.status === 'reading').length,
      toRead: books.filter(b => b.status === 'to_read').length,
      finished: books.filter(b => b.status === 'finished').length,
    };

    // Day stats
    const todayData = dayData ? {
      id: dayData.id,
      mood: dayData.mood,
      top3Completed: countCompletedOutcomes(dayData.top3Outcomes),
      morningRitualDone: Boolean(dayData.morningRituals && Object.keys(dayData.morningRituals as object).length > 0),
      eveningReviewDone: Boolean(dayData.eveningRituals && (dayData.eveningRituals as any)?.reviewCompleted),
      primaryVentureFocus: dayData.primaryVentureFocus || null,
    } : {
      id: null,
      mood: null,
      top3Completed: 0,
      morningRitualDone: false,
      eveningReviewDone: false,
      primaryVentureFocus: null,
    };

    // Docs stats
    const docByType: Record<string, number> = {};
    docs.forEach(d => {
      const type = d.type || 'page';
      docByType[type] = (docByType[type] || 0) + 1;
    });
    const recentlyUpdated = docs.filter(d => {
      if (!d.updatedAt) return false;
      const updated = new Date(d.updatedAt);
      const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return updated > weekAgoDate;
    }).length;

    // Project stats
    const projectByStatus: Record<string, number> = {};
    projects.forEach(p => {
      const status = p.status || 'not_started';
      projectByStatus[status] = (projectByStatus[status] || 0) + 1;
    });

    // Venture stats
    const ventureByStatus: Record<string, number> = {};
    ventures.forEach(v => {
      const status = v.status || 'active';
      ventureByStatus[status] = (ventureByStatus[status] || 0) + 1;
    });

    return {
      ventures: {
        total: ventures.length,
        active: ventures.filter(v => v.status === 'active' || v.status === 'building' || v.status === 'ongoing').length,
        byStatus: ventureByStatus,
        list: ventureStats,
      },
      projects: {
        total: projects.length,
        active: projects.filter(p => p.status === 'in_progress').length,
        byStatus: projectByStatus,
      },
      tasks: {
        total: tasks.length,
        byStatus: taskByStatus,
        todayCount: todayTasks.length,
        overdueCount,
        highPriority: highPriorityCount,
      },
      captures: {
        total: captures.length,
        unclarified: unclarifiedCount,
        byType: captureByType,
      },
      health: {
        latestEntry: latestHealth,
        weeklyAverages: weeklyHealth,
        workoutsThisWeek,
      },
      nutrition: {
        todayCalories: Math.round(todayNutrition.calories),
        todayProtein: Math.round(todayNutrition.protein),
        mealsLogged: todayNutrition.meals,
      },
      trading: tradingData,
      shopping: {
        toBuy: toBuyItems.length,
        byCategory: shoppingByCategory,
      },
      books: booksByStatus,
      today: todayData,
      docs: {
        total: docs.length,
        byType: docByType,
        recentlyUpdated,
      },
    };
  } catch (error) {
    logger.error({ error }, "Error building system overview");
    throw error;
  }
}

/**
 * Build a natural language context summary for the AI COO
 */
export async function buildCOOContextSummary(): Promise<string> {
  const overview = await buildSystemOverview();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let context = `## SYSTEM STATUS REPORT - ${today}\n\n`;

  // Today's Focus
  context += `### TODAY'S STATUS\n`;
  if (overview.today.mood) {
    context += `- Mood: ${overview.today.mood}\n`;
  }
  context += `- Tasks scheduled: ${overview.tasks.todayCount}\n`;
  context += `- Top 3 outcomes completed: ${overview.today.top3Completed}/3\n`;
  context += `- Morning ritual: ${overview.today.morningRitualDone ? '✓ Done' : '○ Not completed'}\n`;
  context += `- Evening review: ${overview.today.eveningReviewDone ? '✓ Done' : '○ Pending'}\n`;
  if (overview.today.primaryVentureFocus) {
    context += `- Primary venture focus: ${overview.today.primaryVentureFocus}\n`;
  }
  context += `\n`;

  // Urgent Attention
  if (overview.tasks.overdueCount > 0 || overview.tasks.highPriority > 0 || overview.captures.unclarified > 0) {
    context += `### ⚠️ NEEDS ATTENTION\n`;
    if (overview.tasks.overdueCount > 0) {
      context += `- **${overview.tasks.overdueCount} overdue tasks** need immediate attention\n`;
    }
    if (overview.tasks.highPriority > 0) {
      context += `- ${overview.tasks.highPriority} high-priority (P0/P1) tasks pending\n`;
    }
    if (overview.captures.unclarified > 0) {
      context += `- ${overview.captures.unclarified} inbox items need clarification\n`;
    }
    context += `\n`;
  }

  // Ventures Overview
  context += `### VENTURES (${overview.ventures.total})\n`;
  context += `Active: ${overview.ventures.active} | `;
  context += Object.entries(overview.ventures.byStatus).map(([s, c]) => `${s}: ${c}`).join(' | ');
  context += `\n`;
  if (overview.ventures.list.length > 0) {
    overview.ventures.list.slice(0, 5).forEach(v => {
      context += `- **${v.name}** (${v.domain}): ${v.projectCount} projects, ${v.taskCount} tasks\n`;
    });
  }
  context += `\n`;

  // Projects
  context += `### PROJECTS (${overview.projects.total})\n`;
  context += `In Progress: ${overview.projects.active} | `;
  context += Object.entries(overview.projects.byStatus).map(([s, c]) => `${s}: ${c}`).join(' | ');
  context += `\n\n`;

  // Tasks
  context += `### TASKS (${overview.tasks.total})\n`;
  context += Object.entries(overview.tasks.byStatus).map(([s, c]) => `${s}: ${c}`).join(' | ');
  context += `\n\n`;

  // Health & Wellness
  context += `### HEALTH & WELLNESS\n`;
  if (overview.health.latestEntry) {
    const h = overview.health.latestEntry;
    context += `Latest: Sleep ${h.sleepHours}h, Energy ${h.energyLevel}/5`;
    if (h.mood) context += `, Mood: ${h.mood}`;
    context += `\n`;
  }
  if (overview.health.weeklyAverages) {
    context += `Weekly avg: ${overview.health.weeklyAverages.sleepHours.toFixed(1)}h sleep, ${overview.health.weeklyAverages.energyLevel.toFixed(1)}/5 energy\n`;
  }
  context += `Workouts this week: ${overview.health.workoutsThisWeek}\n\n`;

  // Nutrition
  context += `### NUTRITION (Today)\n`;
  context += `Calories: ${overview.nutrition.todayCalories} | Protein: ${overview.nutrition.todayProtein}g | Meals: ${overview.nutrition.mealsLogged}\n\n`;

  // Trading
  if (overview.trading.activeStrategies > 0 || overview.trading.todayChecklist) {
    context += `### TRADING\n`;
    context += `Active strategies: ${overview.trading.activeStrategies}\n`;
    if (overview.trading.todayChecklist) {
      context += `Today's checklist: ${overview.trading.todayChecklist.completed ? '✓ Completed' : '○ In Progress'}`;
      if (overview.trading.todayChecklist.session) {
        context += ` (${overview.trading.todayChecklist.session} session)`;
      }
      context += `\n`;
    }
    context += `\n`;
  }

  // Life Management
  context += `### LIFE MANAGEMENT\n`;
  context += `Shopping: ${overview.shopping.toBuy} items to buy\n`;
  context += `Books: ${overview.books.reading} reading, ${overview.books.toRead} to read, ${overview.books.finished} finished\n\n`;

  // Knowledge Base
  context += `### KNOWLEDGE BASE\n`;
  context += `Total docs: ${overview.docs.total} | Recently updated: ${overview.docs.recentlyUpdated}\n`;
  context += `Types: ${Object.entries(overview.docs.byType).map(([t, c]) => `${t}: ${c}`).join(', ')}\n`;

  return context;
}

// Helper functions
function getMostCommon(arr: string[]): string {
  if (arr.length === 0) return 'medium';
  const counts: Record<string, number> = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function countCompletedOutcomes(top3: any): number {
  if (!top3 || !Array.isArray(top3)) return 0;
  return top3.filter((o: any) => o?.completed).length;
}
