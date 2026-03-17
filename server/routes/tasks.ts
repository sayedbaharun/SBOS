/**
 * Tasks Routes
 * CRUD operations for tasks with calendar sync support
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertTaskSchema } from "@shared/schema";
import { z } from "zod";
import { SLOT_TIMES, VALID_TASK_STATUSES } from "./constants";

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

// Nullable fields that need sanitization
const NULLABLE_FIELDS = ['dueDate', 'focusDate', 'notes', 'ventureId', 'projectId', 'phaseId', 'dayId', 'focusSlot'];

// Sanitize body - convert empty strings to null for optional fields
function sanitizeBody(body: Record<string, any>): Record<string, any> {
  const sanitized = { ...body };
  for (const field of NULLABLE_FIELDS) {
    if (sanitized[field] === '') {
      sanitized[field] = null;
    }
  }
  return sanitized;
}

// Check if Google Calendar is configured
function isCalendarConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  );
}

// Get all tasks (with filters and pagination)
// Pagination: add ?limit=N&offset=M to paginate. Without these, returns array (backwards compatible)
router.get("/", async (req: Request, res: Response) => {
  try {
    // Check if pagination is requested
    const wantsPagination = req.query.limit !== undefined || req.query.offset !== undefined;
    // Parse with fallback and bounds checking to handle NaN and negative values
    const parsedLimit = parseInt(req.query.limit as string);
    const parsedOffset = parseInt(req.query.offset as string);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 100 : parsedLimit, 1), 500);
    const offset = Math.max(Number.isNaN(parsedOffset) ? 0 : parsedOffset, 0);

    const filters: Record<string, any> = {
      ventureId: req.query.venture_id as string,
      projectId: req.query.project_id as string,
      phaseId: req.query.phase_id as string,
      status: req.query.status as string,
      focusDate: req.query.focus_date as string,
      focusDateGte: req.query.focus_date_gte as string,
      focusDateLte: req.query.focus_date_lte as string,
      dueDate: req.query.due_date as string,
      limit,
      offset,
    };

    // Remove undefined filters
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, value]) => value !== undefined)
    );

    // Validate status filter if present
    if (cleanFilters.status) {
      const statuses = (cleanFilters.status as string).split(',').map(s => s.trim());
      const validStatusValues = statuses.filter(s => VALID_TASK_STATUSES.includes(s));

      if (validStatusValues.length === 0 && statuses.length > 0) {
        return wantsPagination
          ? res.json({ data: [], pagination: { limit, offset, hasMore: false } })
          : res.json([]);
      }

      cleanFilters.status = validStatusValues.join(',');
    }

    const tasks = await storage.getTasks(cleanFilters);

    // Normalize tags to ensure they're always arrays
    const normalizedTasks = tasks.map(normalizeTask);

    // Return with pagination metadata if pagination was requested, otherwise return array
    if (wantsPagination) {
      res.json({
        data: normalizedTasks,
        pagination: {
          limit,
          offset,
          count: normalizedTasks.length,
          hasMore: normalizedTasks.length === limit,
        }
      });
    } else {
      res.json(normalizedTasks);
    }
  } catch (error) {
    logger.error({ error }, "Error fetching tasks");
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// Get tasks for a specific date (defaults to today)
// Includes: focusDate = date OR dueDate <= date (overdue) OR dayId = date's dayId
router.get("/today", async (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date as string;
    const targetDate = dateParam || new Date().toISOString().split('T')[0];

    // Validate date format if provided
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    const tasks = await storage.getTasksForToday(targetDate);
    // Normalize tags to ensure they're always arrays
    res.json(tasks.map(normalizeTask));
  } catch (error) {
    logger.error({ error }, "Error fetching tasks for date");
    res.status(500).json({ error: "Failed to fetch tasks for date" });
  }
});

// Get single task
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const task = await storage.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    // Normalize tags to ensure they're always arrays
    res.json(normalizeTask(task));
  } catch (error) {
    logger.error({ error }, "Error fetching task");
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

// Create task
router.post("/", async (req: Request, res: Response) => {
  try {
    const sanitizedBody = sanitizeBody(req.body);
    logger.info({ rawVentureId: req.body.ventureId, sanitizedVentureId: sanitizedBody.ventureId }, "Task creation: ventureId trace");
    const validatedData = insertTaskSchema.parse(sanitizedBody);
    const task = await storage.createTask(validatedData);
    // Normalize tags to ensure they're always arrays
    res.status(201).json(normalizeTask(task));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid task data", details: error.errors });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error, errorMessage, body: req.body }, "Error creating task");
      res.status(500).json({ error: "Failed to create task", details: errorMessage });
    }
  }
});

// Update task
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    logger.info({ taskId: req.params.id, body: req.body }, "Updating task");
    const sanitizedBody = sanitizeBody(req.body);

    // Get existing task for calendar sync
    const existingTask = await storage.getTask(req.params.id);
    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    const updates = insertTaskSchema.partial().parse(sanitizedBody);
    logger.info({ taskId: req.params.id, updates }, "Validated task updates");

    // Calendar sync logic
    let calendarEventId: string | null | undefined = (existingTask as any).calendarEventId;

    if (isCalendarConfigured()) {
      try {
        const { createFocusTimeBlock, updateEvent, deleteEvent } = await import("../google-calendar");

        const newFocusDate = updates.focusDate ?? existingTask.focusDate;
        const newFocusSlot = updates.focusSlot ?? existingTask.focusSlot;
        const hadSchedule = existingTask.focusDate && existingTask.focusSlot;
        const hasSchedule = newFocusDate && newFocusSlot;

        // If schedule is being removed, delete calendar event
        if (hadSchedule && !hasSchedule && calendarEventId) {
          try {
            await deleteEvent(calendarEventId);
            calendarEventId = null;
            logger.info({ taskId: req.params.id, eventId: calendarEventId }, "Deleted calendar event for unscheduled task");
          } catch (calError) {
            logger.warn({ error: calError, taskId: req.params.id }, "Failed to delete calendar event");
          }
        }
        // If schedule is being added or changed
        else if (hasSchedule) {
          const slotTimes = SLOT_TIMES[newFocusSlot as string];
          if (slotTimes) {
            const [year, month, day] = (newFocusDate as string).split('-').map(Number);
            const startTime = new Date(year, month - 1, day, Math.floor(slotTimes.startHour), (slotTimes.startHour % 1) * 60);
            const endTime = new Date(year, month - 1, day, Math.floor(slotTimes.endHour), (slotTimes.endHour % 1) * 60);

            const eventTitle = `📋 ${existingTask.title}`;
            const eventDescription = existingTask.notes || `Task: ${existingTask.title}\nPriority: ${existingTask.priority || 'P2'}`;

            // Update existing event or create new one
            if (calendarEventId) {
              try {
                await updateEvent(calendarEventId, {
                  summary: eventTitle,
                  startTime,
                  endTime,
                  description: eventDescription,
                });
                logger.info({ taskId: req.params.id, eventId: calendarEventId }, "Updated calendar event");
              } catch (updateError) {
                // If update fails (event deleted externally), create new one
                logger.warn({ error: updateError }, "Failed to update event, creating new one");
                const newEvent = await createFocusTimeBlock(eventTitle, startTime, endTime, eventDescription);
                calendarEventId = newEvent.id || null;
              }
            } else {
              // Create new calendar event
              const newEvent = await createFocusTimeBlock(eventTitle, startTime, endTime, eventDescription);
              calendarEventId = newEvent.id || null;
              logger.info({ taskId: req.params.id, eventId: calendarEventId }, "Created calendar event for scheduled task");
            }
          }
        }
      } catch (calendarError) {
        logger.warn({ error: calendarError, taskId: req.params.id }, "Calendar sync failed, continuing with task update");
      }
    }

    // Include calendar event ID in updates if changed
    const existingCalendarId = (existingTask as any).calendarEventId;
    if (calendarEventId !== existingCalendarId && calendarEventId !== undefined) {
      (updates as any).calendarEventId = calendarEventId;
    }

    const task = await storage.updateTask(req.params.id, updates);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Normalize tags to ensure they're always arrays
    const normalizedTask = normalizeTask(task);

    // If task was marked completed and has a project, check project completion
    if (updates.status === 'completed' && task.projectId) {
      const allTasks = await storage.getTasks({ projectId: task.projectId });
      const allDone = allTasks.every(t => t.status === 'completed');

      if (allDone) {
        return res.json({
          task: normalizedTask,
          suggestion: {
            type: 'project_completion',
            message: `All tasks in project completed. Mark project as done?`,
            projectId: task.projectId
          }
        });
      }
    }

    res.json({ task: normalizedTask, calendarSynced: isCalendarConfigured() && !!calendarEventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid task data", details: error.errors });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error, errorMessage, errorStack, taskId: req.params.id, body: req.body }, "Error updating task");
      res.status(500).json({ error: "Failed to update task", details: errorMessage });
    }
  }
});

// Delete task
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    // Get task first to check for calendar event
    const task = await storage.getTask(req.params.id);

    // Delete calendar event if exists
    if (task?.calendarEventId && isCalendarConfigured()) {
      try {
        const { deleteEvent } = await import("../google-calendar");
        await deleteEvent(task.calendarEventId);
        logger.info({ taskId: req.params.id, eventId: task.calendarEventId }, "Deleted calendar event for deleted task");
      } catch (calError) {
        logger.warn({ error: calError, taskId: req.params.id }, "Failed to delete calendar event");
      }
    }

    await storage.deleteTask(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting task");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
