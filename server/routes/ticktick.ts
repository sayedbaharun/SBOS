/**
 * TickTick Integration Routes
 * Sync tasks between TickTick and SB-OS
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import * as ticktick from "../ticktick";

const router = Router();

// Guard middleware: return 503 if TickTick token not configured
function requireTickTickToken(req: Request, res: Response, next: Function) {
  if (!process.env.TICKTICK_ACCESS_TOKEN) {
    return res.status(503).json({ error: "TickTick not configured", connected: false });
  }
  next();
}

router.use(requireTickTickToken);

// Get TickTick connection status
router.get("/status", async (req: Request, res: Response) => {
  try {
    const status = await ticktick.checkConnection();
    res.json(status);
  } catch (error) {
    logger.error({ error }, "Error checking TickTick status");
    res.status(500).json({ error: "Failed to check TickTick connection" });
  }
});

// Get all TickTick projects (lists)
router.get("/projects", async (req: Request, res: Response) => {
  try {
    const projects = await ticktick.getProjects();
    res.json(projects);
  } catch (error) {
    logger.error({ error }, "Error fetching TickTick projects");
    res.status(500).json({ error: "Failed to fetch TickTick projects" });
  }
});

// Get tasks from a specific TickTick project
router.get("/projects/:projectId/tasks", async (req: Request, res: Response) => {
  try {
    const tasks = await ticktick.getProjectTasks(req.params.projectId);
    res.json(tasks);
  } catch (error) {
    logger.error({ error, projectId: req.params.projectId }, "Error fetching TickTick tasks");
    res.status(500).json({ error: "Failed to fetch TickTick tasks" });
  }
});

// Get or create the SB-OS Inbox project in TickTick
router.post("/inbox/setup", async (req: Request, res: Response) => {
  try {
    const inboxName = req.body.name || process.env.TICKTICK_INBOX_NAME || "SB-OS Inbox";
    const project = await ticktick.getOrCreateInboxProject(inboxName);
    res.json({
      success: true,
      project,
      message: `Inbox project "${project.name}" is ready. Add tasks to this list in TickTick and sync them to SB-OS.`,
    });
  } catch (error) {
    logger.error({ error }, "Error setting up TickTick inbox");
    res.status(500).json({ error: "Failed to setup TickTick inbox" });
  }
});

// Helper: Get or create "Personal" venture
async function getOrCreatePersonalVenture(): Promise<string> {
  const ventures = await storage.getVentures();
  const personal = ventures.find(v => (v as any).domain === "personal" && v.status !== "archived");
  if (personal) return personal.id;

  const created = await storage.createVenture({
    name: "Personal",
    domain: "personal" as any,
    status: "ongoing",
    oneLiner: "Personal tasks and TickTick imports",
  } as any);
  return created.id;
}

// Helper: Get or create "TickTick Inbox" project under Personal venture
async function getOrCreateTickTickProject(ventureId: string): Promise<string> {
  const projects = await storage.getProjects({ ventureId });
  const existing = projects.find(p => p.name === "TickTick Inbox");
  if (existing) return existing.id;

  const created = await storage.createProject({
    name: "TickTick Inbox",
    ventureId,
    status: "in_progress",
    category: "admin_general" as any,
  } as any);
  return created.id;
}

// Helper: Get or create weekly phase (Week commencing Monday)
async function getOrCreateWeekPhase(projectId: string): Promise<string> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const weekLabel = `Week commencing ${monday.toISOString().split('T')[0]}`;

  const phases = await storage.getPhases({ projectId });
  const existing = phases.find(p => p.name === weekLabel);
  if (existing) return existing.id;

  const created = await storage.createPhase({
    name: weekLabel,
    projectId,
    status: "in_progress" as any,
    order: phases.length + 1,
  } as any);
  return created.id;
}

// Sync tasks from TickTick inbox to SB-OS tasks (under Personal venture)
router.post("/sync", async (req: Request, res: Response) => {
  try {
    // Get the inbox project ID
    const inboxProjectId = req.body.projectId || await ticktick.getInboxProjectId();

    if (!inboxProjectId) {
      return res.status(400).json({
        error: "No inbox project configured",
        message: "Please set up the inbox first using POST /api/ticktick/inbox/setup or provide a projectId",
      });
    }

    // Set up Personal venture → TickTick Inbox project → weekly phase
    const personalVentureId = await getOrCreatePersonalVenture();
    const ticktickProjectId = await getOrCreateTickTickProject(personalVentureId);
    const weekPhaseId = await getOrCreateWeekPhase(ticktickProjectId);

    // Fetch tasks from TickTick
    const ticktickTasks = await ticktick.getProjectTasks(inboxProjectId);

    // Filter to only incomplete tasks
    const incompleteTasks = ticktickTasks.filter(
      t => t.status === ticktick.TICKTICK_STATUS.NORMAL
    );

    const result = {
      synced: 0,
      skipped: 0,
      errors: [] as string[],
      items: [] as Array<{ tickTickId: string; title: string; taskId?: string }>,
    };

    // Get existing tasks with TickTick external IDs to avoid duplicates
    const existingTasks = await storage.getTasks({ ventureId: personalVentureId });
    const existingExternalIds = new Set(
      existingTasks
        .filter(t => t.externalId?.startsWith('ticktick:'))
        .map(t => t.externalId)
    );

    // Process each TickTick task
    for (const task of incompleteTasks) {
      const externalId = `ticktick:${task.id}`;

      // Skip if already synced
      if (existingExternalIds.has(externalId)) {
        result.skipped++;
        result.items.push({
          tickTickId: task.id,
          title: task.title,
        });
        continue;
      }

      try {
        const { cleanTitle } = ticktick.extractTagsFromTitle(task.title);

        // Create task in SB-OS
        const newTask = await storage.createTask({
          title: cleanTitle || task.title,
          notes: task.content || task.desc || null,
          ventureId: personalVentureId,
          projectId: ticktickProjectId,
          phaseId: weekPhaseId,
          status: "todo",
          type: "personal" as any,
          externalId,
        } as any);

        result.synced++;
        result.items.push({
          tickTickId: task.id,
          title: task.title,
          taskId: newTask.id,
        });

        logger.info({
          tickTickId: task.id,
          taskId: newTask.id,
          title: task.title,
        }, "Synced TickTick task to SB-OS task");

      } catch (error: any) {
        result.errors.push(`Failed to sync task "${task.title}": ${error.message}`);
        logger.error({ error, taskId: task.id }, "Error syncing TickTick task");
      }
    }

    // Track cleared tasks
    let cleared = 0;

    // Clear inbox by deleting synced tasks from TickTick
    if (req.body.clearInboxAfterSync) {
      for (const item of result.items) {
        if (item.taskId) {
          try {
            await ticktick.deleteTask(inboxProjectId, item.tickTickId);
            cleared++;
            logger.info({ tickTickId: item.tickTickId }, "Deleted TickTick task after sync");
          } catch (error) {
            logger.warn({ error, tickTickId: item.tickTickId }, "Failed to delete TickTick task after sync");
          }
        }
      }
    }
    // Legacy: complete tasks instead of deleting (keeps them in TickTick completed section)
    else if (req.body.completeAfterSync) {
      for (const item of result.items) {
        if (item.taskId) {
          try {
            await ticktick.completeTask(inboxProjectId, item.tickTickId);
          } catch (error) {
            logger.warn({ error, tickTickId: item.tickTickId }, "Failed to complete TickTick task after sync");
          }
        }
      }
    }

    res.json({
      success: true,
      ...result,
      cleared,
      personalVentureId,
      ticktickProjectId,
      weekPhaseId,
      message: `Synced ${result.synced} new tasks to Personal venture, skipped ${result.skipped} existing${cleared > 0 ? `, cleared ${cleared} from TickTick inbox` : ''}`,
    });

  } catch (error) {
    logger.error({ error }, "Error syncing from TickTick");
    res.status(500).json({ error: "Failed to sync from TickTick" });
  }
});

// Sync shopping items from TickTick to SB-OS
router.post("/sync-shopping", async (req: Request, res: Response) => {
  try {
    // Get the shopping project ID from request or find by name
    let shoppingProjectId = req.body.projectId;

    if (!shoppingProjectId) {
      // Try to find a project with "shopping" in the name
      const projects = await ticktick.getProjects();
      const shoppingProject = projects.find(p =>
        p.name.toLowerCase().includes('shopping')
      );

      if (!shoppingProject) {
        return res.status(400).json({
          error: "No shopping project found",
          message: "Please create a project named 'Shopping' or 'SB-OS Shopping' in TickTick, or provide a projectId",
          availableProjects: projects.map(p => ({ id: p.id, name: p.name })),
        });
      }
      shoppingProjectId = shoppingProject.id;
    }

    // Fetch tasks from TickTick shopping list
    const ticktickTasks = await ticktick.getProjectTasks(shoppingProjectId);

    // Filter to only incomplete tasks
    const incompleteTasks = ticktickTasks.filter(
      t => t.status === ticktick.TICKTICK_STATUS.NORMAL
    );

    const result = {
      synced: 0,
      skipped: 0,
      errors: [] as string[],
      items: [] as Array<{ tickTickId: string; title: string; shoppingItemId?: string }>,
    };

    // Get existing shopping items with TickTick external IDs to avoid duplicates
    const existingItems = await storage.getShoppingItems({});
    const existingExternalIds = new Set(
      existingItems
        .filter((item: any) => item.externalId?.startsWith('ticktick:'))
        .map((item: any) => item.externalId)
    );

    // Map TickTick priority to SB-OS priority
    const priorityMap: Record<number, 'P1' | 'P2' | 'P3'> = {
      [ticktick.TICKTICK_PRIORITY.HIGH]: 'P1',
      [ticktick.TICKTICK_PRIORITY.MEDIUM]: 'P2',
      [ticktick.TICKTICK_PRIORITY.LOW]: 'P3',
      [ticktick.TICKTICK_PRIORITY.NONE]: 'P3',
    };

    // Process each TickTick task
    for (const task of incompleteTasks) {
      // Include projectId in externalId for bidirectional sync
      const externalId = `ticktick:${shoppingProjectId}:${task.id}`;

      // Skip if already synced (check both old and new format)
      const oldFormatId = `ticktick:${task.id}`;
      if (existingExternalIds.has(externalId) || existingExternalIds.has(oldFormatId)) {
        result.skipped++;
        result.items.push({
          tickTickId: task.id,
          title: task.title,
        });
        continue;
      }

      try {
        // Determine category from tags or title
        let category: 'groceries' | 'personal' | 'household' | 'business' = 'personal';
        const titleLower = task.title.toLowerCase();
        const tags = task.tags || [];
        const tagsLower = tags.map(t => t.toLowerCase());

        if (tagsLower.includes('groceries') || tagsLower.includes('food') ||
            titleLower.includes('grocery') || titleLower.includes('food')) {
          category = 'groceries';
        } else if (tagsLower.includes('household') || tagsLower.includes('home') ||
                   titleLower.includes('household') || titleLower.includes('house')) {
          category = 'household';
        } else if (tagsLower.includes('business') || tagsLower.includes('work') ||
                   titleLower.includes('office') || titleLower.includes('work')) {
          category = 'business';
        }

        // Create shopping item in SB-OS
        const shoppingItem = await storage.createShoppingItem({
          item: task.title,
          priority: priorityMap[task.priority] || 'P2',
          category,
          notes: task.content || task.desc || null,
          externalId,
          status: 'to_buy',
        });

        result.synced++;
        result.items.push({
          tickTickId: task.id,
          title: task.title,
          shoppingItemId: shoppingItem.id,
        });

        logger.info({
          tickTickId: task.id,
          shoppingItemId: shoppingItem.id,
          title: task.title,
        }, "Synced TickTick task to shopping item");

      } catch (error: any) {
        result.errors.push(`Failed to sync item "${task.title}": ${error.message}`);
        logger.error({ error, taskId: task.id }, "Error syncing TickTick task to shopping");
      }
    }

    // Clear synced items from TickTick if requested
    let cleared = 0;
    if (req.body.clearAfterSync) {
      for (const item of result.items) {
        if (item.shoppingItemId) {
          try {
            await ticktick.deleteTask(shoppingProjectId, item.tickTickId);
            cleared++;
            logger.info({ tickTickId: item.tickTickId }, "Deleted TickTick shopping task after sync");
          } catch (error) {
            logger.warn({ error, tickTickId: item.tickTickId }, "Failed to delete TickTick task after sync");
          }
        }
      }
    }

    res.json({
      success: true,
      ...result,
      cleared,
      message: `Synced ${result.synced} new shopping items, skipped ${result.skipped} existing${cleared > 0 ? `, cleared ${cleared} from TickTick` : ''}`,
    });

  } catch (error) {
    logger.error({ error }, "Error syncing shopping from TickTick");
    res.status(500).json({ error: "Failed to sync shopping from TickTick" });
  }
});

// Complete a task in TickTick (after processing in SB-OS)
router.post("/tasks/:taskId/complete", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    await ticktick.completeTask(projectId, req.params.taskId);
    res.json({ success: true, message: "Task completed in TickTick" });
  } catch (error) {
    logger.error({ error, taskId: req.params.taskId }, "Error completing TickTick task");
    res.status(500).json({ error: "Failed to complete TickTick task" });
  }
});

// Create a task in TickTick (push from SB-OS)
router.post("/tasks", async (req: Request, res: Response) => {
  try {
    const { title, projectId, content, dueDate, priority } = req.body;

    if (!title || !projectId) {
      return res.status(400).json({ error: "title and projectId are required" });
    }

    const task = await ticktick.createTask({
      title,
      projectId,
      content,
      dueDate,
      priority,
    });

    res.status(201).json(task);
  } catch (error) {
    logger.error({ error }, "Error creating TickTick task");
    res.status(500).json({ error: "Failed to create TickTick task" });
  }
});

// Push SB-OS tasks with focusDate/dueDate to TickTick
router.post("/push-tasks", async (req: Request, res: Response) => {
  try {
    // Get TickTick projects to map domains
    const ticktickProjects = await ticktick.getProjects();

    // Map domain names to TickTick project IDs
    const domainToProject: Record<string, string> = {};

    for (const project of ticktickProjects) {
      // Remove emojis and normalize the name
      const normalizedName = project.name.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim().toLowerCase();

      if (normalizedName.includes('work')) domainToProject['work'] = project.id;
      if (normalizedName.includes('home')) domainToProject['home'] = project.id;
      if (normalizedName.includes('health')) domainToProject['health'] = project.id;
      if (normalizedName.includes('finance')) domainToProject['finance'] = project.id;
      if (normalizedName.includes('travel')) domainToProject['travel'] = project.id;
      if (normalizedName.includes('learning')) domainToProject['learning'] = project.id;
      if (normalizedName.includes('play')) domainToProject['play'] = project.id;
      if (normalizedName.includes('calls')) domainToProject['calls'] = project.id;
      if (normalizedName.includes('personal')) domainToProject['personal'] = project.id;
      if (normalizedName.includes('shopping')) domainToProject['shopping'] = project.id;
    }

    const defaultProjectId = ticktickProjects[0]?.id;

    // Get active tasks with focusDate or dueDate
    const allTasks = await storage.getTasks({});
    const tasksToSync = allTasks.filter(task =>
      (task.focusDate || task.dueDate) &&
      !['completed', 'on_hold'].includes(task.status) &&
      !task.externalId?.startsWith('ticktick:')
    );

    const result = {
      pushed: 0,
      skipped: 0,
      errors: [] as string[],
      items: [] as Array<{ taskId: string; title: string; tickTickId?: string; tickTickProject?: string }>,
    };

    // Map SB-OS priority to TickTick priority
    const priorityMap: Record<string, number> = {
      'P0': ticktick.TICKTICK_PRIORITY.HIGH,
      'P1': ticktick.TICKTICK_PRIORITY.MEDIUM,
      'P2': ticktick.TICKTICK_PRIORITY.LOW,
      'P3': ticktick.TICKTICK_PRIORITY.NONE,
    };

    for (const task of tasksToSync) {
      try {
        const projectId = (task.domain && domainToProject[task.domain]) || defaultProjectId;

        if (!projectId) {
          result.errors.push(`No TickTick project found for task "${task.title}"`);
          continue;
        }

        const taskDate = task.focusDate || task.dueDate;

        const ticktickTask = await ticktick.createTask({
          title: task.title,
          projectId,
          content: task.notes || undefined,
          dueDate: taskDate ? `${taskDate}T09:00:00.000+0000` : undefined,
          priority: task.priority ? priorityMap[task.priority] : ticktick.TICKTICK_PRIORITY.NONE,
        });

        await storage.updateTask(task.id, {
          externalId: `ticktick:${ticktickTask.id}`,
        });

        result.pushed++;
        result.items.push({
          taskId: task.id,
          title: task.title,
          tickTickId: ticktickTask.id,
          tickTickProject: ticktickProjects.find(p => p.id === projectId)?.name,
        });

        logger.info({
          taskId: task.id,
          tickTickId: ticktickTask.id,
          title: task.title,
        }, "Pushed SB-OS task to TickTick");

      } catch (error: any) {
        result.errors.push(`Failed to push task "${task.title}": ${error.message}`);
        logger.error({ error, taskId: task.id }, "Error pushing task to TickTick");
      }
    }

    res.json({
      success: true,
      ...result,
      message: `Pushed ${result.pushed} tasks to TickTick`,
    });

  } catch (error) {
    logger.error({ error }, "Error pushing tasks to TickTick");
    res.status(500).json({ error: "Failed to push tasks to TickTick" });
  }
});

export default router;
