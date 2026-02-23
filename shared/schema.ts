import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  uuid,
  jsonb,
  index,
  integer,
  real,
  date,
  pgEnum
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// SB-OS DATABASE SCHEMA
// ============================================================================

// Helper schema for date columns - keeps as string (YYYY-MM-DD format)
// Drizzle's date() type expects strings, not Date objects
const dateStringSchema = z.string().refine(
  (val) => /^\d{4}-\d{2}-\d{2}$/.test(val),
  { message: "Invalid date format, expected YYYY-MM-DD" }
).optional().nullable();

// Required version for non-nullable date columns
const dateStringRequiredSchema = z.string().refine(
  (val) => /^\d{4}-\d{2}-\d{2}$/.test(val),
  { message: "Invalid date format, expected YYYY-MM-DD" }
);

// Helper schema for timestamp columns - coerces to Date objects
const timestampSchema = z.union([z.string(), z.date()]).pipe(z.coerce.date()).optional().nullable();

// This schema defines the data model for SB-OS: The Sayed Baharun
// Productivity Engine. It replaces the previous Aura schema.
// ============================================================================

// ----------------------------------------------------------------------------
// ENUMS
// ----------------------------------------------------------------------------

export const ventureStatusEnum = pgEnum('venture_status', [
  // Legacy values (kept for backward compatibility with existing data)
  'active',      // legacy - use 'ongoing' instead
  'development', // legacy - use 'building' instead
  'paused',      // legacy - use 'on_hold' instead
  // Current values
  'archived',
  'planning',
  'building',
  'on_hold',
  'ongoing'
]);

export const ventureDomainEnum = pgEnum('venture_domain', [
  'saas',
  'media',
  'realty',
  'trading',
  'personal',
  'other'
]);

export const projectStatusEnum = pgEnum('project_status', [
  'not_started',
  'planning',
  'in_progress',
  'blocked',
  'done',
  'archived'
]);

export const projectCategoryEnum = pgEnum('project_category', [
  // Growth
  'marketing',
  'sales_biz_dev',
  'customer_success',
  // Product & Delivery
  'product',
  'tech_engineering',
  'operations',
  'research_dev',
  // Enabling
  'finance',
  'people_hr',
  'legal_compliance',
  'admin_general',
  'strategy_leadership'
]);

export const priorityEnum = pgEnum('priority', ['P0', 'P1', 'P2', 'P3']);

export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'in_progress',
  'completed',
  'on_hold'
]);

export const taskTypeEnum = pgEnum('task_type', [
  'business',
  'deep_work',
  'admin',
  'health',
  'learning',
  'personal'
]);

export const domainEnum = pgEnum('domain', [
  'home',
  'work',
  'health',
  'finance',
  'travel',
  'learning',
  'play',
  'calls',
  'personal'
]);

export const focusSlotEnum = pgEnum('focus_slot', [
  // Current schedule slots
  'morning_routine',  // 7:00-9:00 AM: Health, planning, breakfast
  'deep_work_1',      // 9:00-11:00 AM: Deep work session 1
  'admin_block',      // 11:00 AM-12:00 PM: Admin, email, quick tasks
  'lunch',            // 12:00-1:00 PM: Lunch break
  'gym',              // 1:00-3:00 PM: Gym/Workout
  'afternoon',        // 3:00-11:00 PM: Flexible - meetings, calls, other work
  'evening_review',   // 11:00 PM-12:00 AM: Evening reflection and planning
  'meetings',         // Flexible: Meetings, calls (can overlap other slots)
  'buffer',           // Flexible: Flex time, unexpected tasks
  // Legacy values (kept for backward compatibility)
  'deep_work_2',      // Legacy
  'admin_block_1',    // Legacy
  'admin_block_2',    // Legacy
  'admin',            // Legacy
  'walk',             // Legacy
  'deep_work',        // Legacy
  'evening'           // Legacy
]);

export const captureTypeEnum = pgEnum('capture_type', [
  'idea',
  'task',
  'note',
  'link',
  'question'
]);

export const captureSourceEnum = pgEnum('capture_source', [
  'brain',
  'email',
  'chat',
  'meeting',
  'web',
  'ticktick'
]);

export const moodEnum = pgEnum('mood', ['low', 'medium', 'high', 'peak']);

export const sleepQualityEnum = pgEnum('sleep_quality', [
  'poor',
  'fair',
  'good',
  'excellent'
]);

export const workoutTypeEnum = pgEnum('workout_type', [
  'strength',
  'cardio',
  'yoga',
  'sport',
  'walk',
  'at_home',
  'none'
]);

export const stressLevelEnum = pgEnum('stress_level', ['low', 'medium', 'high']);

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast',
  'lunch',
  'dinner',
  'snack'
]);

export const docTypeEnum = pgEnum('doc_type', [
  'page',           // General page/note
  'sop',            // Standard Operating Procedure
  'prompt',         // AI/LLM prompts
  'spec',           // Technical specifications
  'template',       // Reusable templates
  'playbook',       // Step-by-step guides
  'strategy',       // Business/trading strategies
  'tech_doc',       // Technical documentation
  'process',        // Process documentation
  'reference',      // Reference material
  'meeting_notes',  // Meeting notes
  'research'        // Research notes
]);

export const docDomainEnum = pgEnum('doc_domain', [
  'venture_ops',    // Venture operations
  'marketing',      // Marketing
  'product',        // Product development
  'sales',          // Sales
  'tech',           // Technology/Engineering
  'trading',        // Trading strategies
  'finance',        // Finance/Accounting
  'legal',          // Legal/Compliance
  'hr',             // Human Resources
  'personal'        // Personal notes
]);

export const docStatusEnum = pgEnum('doc_status', ['draft', 'active', 'archived']);

export const phaseStatusEnum = pgEnum('milestone_status', [
  'not_started',
  'in_progress',
  'done',
  'blocked'
]);

export const categoryTypeEnum = pgEnum('category_type', [
  'domain',
  'task_type',
  'focus_slot'
]);

export const themeEnum = pgEnum('theme', ['light', 'dark', 'system']);

// ----------------------------------------------------------------------------
// CORE TABLES (Keep from Aura)
// ----------------------------------------------------------------------------

// Session storage table - Required for authentication
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Trusted device type for device tracking
export interface TrustedDevice {
  id: string;
  name: string;
  ipAddress: string;
  userAgent: string;
  lastUsed: string;
  createdAt: string;
}

// User storage table - Simplified for single-user (Sayed Baharun)
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"), // bcrypt hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  timezone: varchar("timezone").default("Asia/Dubai"),
  dateFormat: varchar("date_format").default("yyyy-MM-dd"),
  timeFormat: varchar("time_format").default("24h"),
  weekStartsOn: integer("week_starts_on").default(0), // 0 = Sunday
  lastLoginAt: timestamp("last_login_at"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  // 2FA/TOTP fields
  totpSecret: varchar("totp_secret"), // Encrypted TOTP secret
  totpEnabled: boolean("totp_enabled").default(false),
  totpBackupCodes: jsonb("totp_backup_codes").$type<string[]>(), // Hashed backup codes
  totpRecoveryKeyHash: varchar("totp_recovery_key_hash"), // Emergency recovery key (hashed)
  // Device/session tracking
  lastKnownIp: varchar("last_known_ip", { length: 45 }),
  lastKnownUserAgent: text("last_known_user_agent"),
  trustedDevices: jsonb("trusted_devices").$type<TrustedDevice[]>(),
  // Password age tracking
  passwordChangedAt: timestamp("password_changed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Audit log table - Track security-sensitive operations
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(), // 'login', 'logout', 'password_change', 'data_export', etc.
    resource: varchar("resource", { length: 100 }), // 'ventures', 'tasks', 'health', etc.
    resourceId: varchar("resource_id"), // ID of affected resource
    ipAddress: varchar("ip_address", { length: 45 }), // IPv4 or IPv6
    userAgent: text("user_agent"),
    details: jsonb("details").$type<Record<string, unknown>>(), // Additional context
    status: varchar("status", { length: 20 }).default("success"), // 'success', 'failure', 'blocked'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_audit_logs_user_id").on(table.userId),
    index("idx_audit_logs_action").on(table.action),
    index("idx_audit_logs_created_at").on(table.createdAt),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// User preferences - Theme, morning ritual config, notification settings
export interface MorningHabitConfig {
  key: string;
  label: string;
  icon: string;
  hasCount: boolean;
  countLabel?: string;
  defaultCount?: number;
  enabled: boolean;
}

export interface NotificationSettingsConfig {
  browserNotifications?: boolean;
  taskDueReminders?: boolean;
  taskOverdueAlerts?: boolean;
  healthReminders?: boolean;
  weeklyPlanningReminders?: boolean;
  dailyReflectionPrompts?: boolean;
  healthReminderTime?: string;
  weeklyPlanningDay?: number;
  weeklyPlanningTime?: string;
  dailyReflectionTime?: string;
  doNotDisturb?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  theme: themeEnum("theme").default("system"),
  morningRitualConfig: jsonb("morning_ritual_config").$type<{
    habits: MorningHabitConfig[];
  }>(),
  notificationSettings: jsonb("notification_settings").$type<NotificationSettingsConfig>(),
  aiInstructions: text("ai_instructions"),
  aiContext: jsonb("ai_context").$type<{
    userName?: string;
    role?: string;
    goals?: string[];
    preferences?: string;
  }>(),
  // AI Model Settings
  aiModel: text("ai_model").default("openai/gpt-4o"),
  aiTemperature: real("ai_temperature").default(0.7),
  aiMaxTokens: integer("ai_max_tokens").default(4096),
  aiStreamResponses: boolean("ai_stream_responses").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// Custom categories - User-defined domains, task types, focus slots
export const customCategories = pgTable(
  "custom_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: categoryTypeEnum("type").notNull(),
    value: varchar("value", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 7 }),
    icon: varchar("icon", { length: 50 }),
    metadata: jsonb("metadata").$type<{
      time?: string;
      isDefault?: boolean;
    }>(),
    sortOrder: integer("sort_order").default(0),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_custom_categories_type").on(table.type),
    index("idx_custom_categories_enabled").on(table.enabled),
  ]
);

export const insertCustomCategorySchema = createInsertSchema(customCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomCategory = z.infer<typeof insertCustomCategorySchema>;
export type CustomCategory = typeof customCategories.$inferSelect;

// ----------------------------------------------------------------------------
// SB-OS ENTITIES
// ----------------------------------------------------------------------------

// VENTURES: Business/strategic initiatives
export const ventures = pgTable(
  "ventures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 100 }).unique(), // URL-friendly identifier (e.g., "mydub-ai")
    status: ventureStatusEnum("status").default("planning").notNull(),
    oneLiner: text("one_liner"),
    domain: ventureDomainEnum("domain"), // Deprecated but kept for backward compatibility
    primaryFocus: text("primary_focus"), // Deprecated but kept for backward compatibility
    color: varchar("color", { length: 7 }), // Hex color code
    icon: varchar("icon", { length: 10 }), // Emoji
    notes: text("notes"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_ventures_status").on(table.status),
    index("idx_ventures_domain").on(table.domain),
    // Performance: ventures are sorted by createdAt
    index("idx_ventures_created_at").on(table.createdAt),
    index("idx_ventures_slug").on(table.slug),
  ]
);

export const insertVentureSchema = createInsertSchema(ventures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVenture = z.infer<typeof insertVentureSchema>;
export type Venture = typeof ventures.$inferSelect;

// PROJECTS: Concrete initiatives within ventures
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }),
    status: projectStatusEnum("status").default("not_started").notNull(),
    category: projectCategoryEnum("category"),
    priority: priorityEnum("priority"),
    startDate: date("start_date"),
    targetEndDate: date("target_end_date"),
    actualEndDate: date("actual_end_date"),
    outcome: text("outcome"),
    notes: text("notes"),
    budget: real("budget"), // Total budget allocated
    budgetSpent: real("budget_spent").default(0), // Amount spent to date
    revenueGenerated: real("revenue_generated").default(0), // Revenue from project
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_projects_venture_id").on(table.ventureId),
    index("idx_projects_status").on(table.status),
    index("idx_projects_priority").on(table.priority),
    index("idx_projects_target_end_date").on(table.targetEndDate),
  ]
);

export const insertProjectSchema = createInsertSchema(projects)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Keep dates as strings for drizzle date() columns
    startDate: dateStringSchema,
    targetEndDate: dateStringSchema,
    actualEndDate: dateStringSchema,
  });

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// PHASES: Project phases and key deliverables
export const phases = pgTable(
  "milestones", // Keep SQL table name for backward compatibility
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    status: phaseStatusEnum("status").default("not_started").notNull(),
    order: integer("order").default(0), // For sequencing phases
    targetDate: date("target_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_milestones_project_id").on(table.projectId),
    index("idx_milestones_status").on(table.status),
    index("idx_milestones_order").on(table.order),
  ]
);

export const insertPhaseSchema = createInsertSchema(phases)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Keep dates as strings for drizzle date() columns
    targetDate: dateStringSchema,
  });

export type InsertPhase = z.infer<typeof insertPhaseSchema>;
export type Phase = typeof phases.$inferSelect;

// TASKS: Atomic units of execution
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    status: taskStatusEnum("status").default("todo").notNull(),
    priority: priorityEnum("priority"),
    type: taskTypeEnum("type"),
    domain: domainEnum("domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    phaseId: uuid("milestone_id").references(() => phases.id, { onDelete: "cascade" }), // Keep SQL column name for backward compatibility
    dayId: text("day_id").references(() => days.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    focusDate: date("focus_date"),
    focusSlot: focusSlotEnum("focus_slot"),
    estEffort: real("est_effort"), // Hours
    actualEffort: real("actual_effort"), // Hours
    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().default([]),
    externalId: text("external_id"),
    calendarEventId: text("calendar_event_id"), // Google Calendar event ID for two-way sync
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_tasks_venture_id").on(table.ventureId),
    index("idx_tasks_project_id").on(table.projectId),
    index("idx_tasks_milestone_id").on(table.phaseId), // Keep SQL index name for backward compatibility
    index("idx_tasks_day_id").on(table.dayId),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_priority").on(table.priority),
    index("idx_tasks_due_date").on(table.dueDate),
    index("idx_tasks_focus_date").on(table.focusDate),
    index("idx_tasks_type").on(table.type),
    // Performance: composite indexes for common query patterns
    index("idx_tasks_status_priority").on(table.status, table.priority),
    index("idx_tasks_venture_status").on(table.ventureId, table.status),
    index("idx_tasks_focus_status").on(table.focusDate, table.status),
  ]
);

export const insertTaskSchema = createInsertSchema(tasks)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Keep dates as strings for drizzle date() columns
    dueDate: dateStringSchema,
    focusDate: dateStringSchema,
    // Timestamp column can accept Date objects
    completedAt: timestampSchema,
  });

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// CAPTURE ITEMS: Inbox for raw thoughts
export const captureItems = pgTable(
  "capture_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    type: captureTypeEnum("type"),
    source: captureSourceEnum("source"),
    domain: domainEnum("domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    linkedTaskId: uuid("linked_task_id").references(() => tasks.id, { onDelete: "set null" }),
    clarified: boolean("clarified").default(false).notNull(),
    notes: text("notes"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_capture_items_clarified").on(table.clarified),
    index("idx_capture_items_type").on(table.type),
    index("idx_capture_items_source").on(table.source),
    index("idx_capture_items_created_at").on(table.createdAt),
  ]
);

export const insertCaptureItemSchema = createInsertSchema(captureItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCaptureItem = z.infer<typeof insertCaptureItemSchema>;
export type CaptureItem = typeof captureItems.$inferSelect;

// DAYS: Daily logs (central hub for each day)
export const days = pgTable(
  "days",
  {
    id: text("id").primaryKey(), // Format: "day_YYYY-MM-DD"
    date: date("date").notNull().unique(),
    title: text("title"),
    top3Outcomes: jsonb("top_3_outcomes").$type<{
      text: string;
      completed: boolean;
    }[]>(),
    oneThingToShip: text("one_thing_to_ship"),
    reflectionAm: text("reflection_am"),
    reflectionPm: text("reflection_pm"),
    mood: moodEnum("mood"),
    primaryVentureFocus: uuid("primary_venture_focus").references(() => ventures.id, {
      onDelete: "set null"
    }),
    // Morning ritual tracking
    morningRituals: jsonb("morning_rituals").$type<{
      pressUps?: { done: boolean; reps?: number };
      squats?: { done: boolean; reps?: number };
      supplements?: { done: boolean };
      water?: { done: boolean };
      completedAt?: string;
    }>(),
    // Evening ritual tracking
    eveningRituals: jsonb("evening_rituals").$type<{
      reviewCompleted?: boolean;
      journalEntry?: string;
      gratitude?: string[];
      tomorrowPriorities?: string[];
      fastingHours?: number; // Hours fasted (target: 16)
      fastingCompleted?: boolean; // Met 16hr target
      deepWorkHours?: number; // Hours of deep work completed
      completedAt?: string;
    }>(),
    // Trading journal for the day
    tradingJournal: jsonb("trading_journal").$type<{
      sessions: {
        id: string;
        timestamp: string;
        sessionName: string;
        pnl: number;
        notes: string;
        lessons: string;
        emotionalState: 'calm' | 'anxious' | 'confident' | 'frustrated';
      }[];
    }>().default({ sessions: [] }),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_days_date").on(table.date),
    index("idx_days_mood").on(table.mood),
    index("idx_days_primary_venture_focus").on(table.primaryVentureFocus),
  ]
);

export const insertDaySchema = createInsertSchema(days)
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Keep dates as strings for drizzle date() columns
    date: dateStringRequiredSchema,
  });

export type InsertDay = z.infer<typeof insertDaySchema>;
export type Day = typeof days.$inferSelect;

// WEEKS: Weekly planning (Sunday ritual)
export const weeks = pgTable(
  "weeks",
  {
    id: text("id").primaryKey(), // Format: "week_YYYY-WW" (e.g., "week_2025-52")
    weekStart: date("week_start").notNull(), // Monday of the week
    weekNumber: integer("week_number").notNull(), // 1-53
    year: integer("year").notNull(),
    // Weekly Big 3 outcomes
    weeklyBig3: jsonb("weekly_big_3").$type<{
      text: string;
      completed: boolean;
    }[]>(),
    // Primary venture focus for the week
    primaryVentureFocus: uuid("primary_venture_focus").references(() => ventures.id, {
      onDelete: "set null"
    }),
    // Week theme/intention
    theme: text("theme"),
    // Sunday planning reflection
    planningNotes: text("planning_notes"),
    // End of week review
    reviewNotes: text("review_notes"),
    // What went well
    wins: jsonb("wins").$type<string[]>(),
    // What to improve
    improvements: jsonb("improvements").$type<string[]>(),
    // Not-To-Do list for the week (things to avoid/eliminate)
    notToDo: jsonb("not_to_do").$type<{
      item: string;
      reason: string;
      status: "pending" | "honored" | "violated";
    }[]>(),
    // Metrics summary (auto-calculated or manual)
    metrics: jsonb("metrics").$type<{
      tasksCompleted?: number;
      tasksPlanned?: number;
      deepWorkHours?: number;
      tradingPnl?: number;
      avgEnergy?: number;
      avgSleep?: number;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_weeks_week_start").on(table.weekStart),
    index("idx_weeks_year_week").on(table.year, table.weekNumber),
    index("idx_weeks_primary_venture_focus").on(table.primaryVentureFocus),
  ]
);

export const insertWeekSchema = createInsertSchema(weeks)
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    weekStart: dateStringRequiredSchema,
  });

export type InsertWeek = z.infer<typeof insertWeekSchema>;
export type Week = typeof weeks.$inferSelect;

// HEALTH ENTRIES: Daily health metrics
export const healthEntries = pgTable(
  "health_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayId: text("day_id").references(() => days.id, { onDelete: "cascade" }).notNull(),
    date: date("date").notNull(),
    sleepHours: real("sleep_hours"),
    sleepQuality: sleepQualityEnum("sleep_quality"),
    energyLevel: integer("energy_level"), // 1-5 scale
    mood: moodEnum("mood"),
    steps: integer("steps"),
    workoutDone: boolean("workout_done").default(false),
    workoutType: workoutTypeEnum("workout_type"),
    workoutDurationMin: integer("workout_duration_min"),
    weightKg: real("weight_kg"),
    bodyFatPercent: real("body_fat_percent"),
    stressLevel: stressLevelEnum("stress_level"),
    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_health_entries_day_id").on(table.dayId),
    index("idx_health_entries_date").on(table.date),
    index("idx_health_entries_mood").on(table.mood),
    index("idx_health_entries_energy_level").on(table.energyLevel),
  ]
);

export const insertHealthEntrySchema = createInsertSchema(healthEntries)
  .omit({
    id: true,
    dayId: true, // Backend auto-generates from date
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Keep dates as strings for drizzle date() columns
    date: dateStringRequiredSchema,
  });

export type InsertHealthEntry = z.infer<typeof insertHealthEntrySchema>;
export type HealthEntry = typeof healthEntries.$inferSelect;

// BLOODWORK ENTRIES: Quarterly lab results for health optimization
export const bloodworkEntries = pgTable(
  "bloodwork_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    labName: text("lab_name"), // Name of the lab/clinic
    // Metabolic markers (insulin resistance focus)
    hba1c: real("hba1c"), // Glycated hemoglobin (%)
    fastingGlucose: real("fasting_glucose"), // mg/dL
    fastingInsulin: real("fasting_insulin"), // μIU/mL
    homaIr: real("homa_ir"), // Calculated: (glucose * insulin) / 405
    // Lipid panel
    totalCholesterol: real("total_cholesterol"), // mg/dL
    hdlCholesterol: real("hdl_cholesterol"), // mg/dL
    ldlCholesterol: real("ldl_cholesterol"), // mg/dL
    triglycerides: real("triglycerides"), // mg/dL
    // Hormones
    testosterone: real("testosterone"), // ng/dL (total)
    freeTestosterone: real("free_testosterone"), // pg/mL
    cortisol: real("cortisol"), // μg/dL
    // Thyroid
    tsh: real("tsh"), // mIU/L
    freeT3: real("free_t3"), // pg/mL
    freeT4: real("free_t4"), // ng/dL
    // Vitamins & minerals
    vitaminD: real("vitamin_d"), // ng/mL
    vitaminB12: real("vitamin_b12"), // pg/mL
    ferritin: real("ferritin"), // ng/mL
    iron: real("iron"), // μg/dL
    // Inflammation & liver
    crp: real("crp"), // mg/L (C-reactive protein)
    alt: real("alt"), // U/L (liver enzyme)
    ast: real("ast"), // U/L (liver enzyme)
    // Kidney function
    creatinine: real("creatinine"), // mg/dL
    egfr: real("egfr"), // mL/min/1.73m²
    // Notes and context
    notes: text("notes"),
    attachmentUrl: text("attachment_url"), // Link to PDF/image of results
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_bloodwork_entries_date").on(table.date),
  ]
);

export const insertBloodworkEntrySchema = createInsertSchema(bloodworkEntries)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    date: dateStringRequiredSchema,
  });

export type InsertBloodworkEntry = z.infer<typeof insertBloodworkEntrySchema>;
export type BloodworkEntry = typeof bloodworkEntries.$inferSelect;

// NUTRITION ENTRIES: Meal logs
export const nutritionEntries = pgTable(
  "nutrition_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayId: text("day_id").references(() => days.id, { onDelete: "cascade" }).notNull(),
    datetime: timestamp("datetime").notNull(),
    mealType: mealTypeEnum("meal_type"),
    description: text("description"),
    calories: real("calories"),
    proteinG: real("protein_g"),
    carbsG: real("carbs_g"),
    fatsG: real("fats_g"),
    context: text("context"),
    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_nutrition_entries_day_id").on(table.dayId),
    index("idx_nutrition_entries_datetime").on(table.datetime),
    index("idx_nutrition_entries_meal_type").on(table.mealType),
  ]
);

export const insertNutritionEntrySchema = createInsertSchema(nutritionEntries)
  .omit({
    id: true,
    dayId: true, // Backend auto-generates from datetime
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    datetime: z.union([z.string(), z.date()]).pipe(z.coerce.date()),
  });

export type InsertNutritionEntry = z.infer<typeof insertNutritionEntrySchema>;
export type NutritionEntry = typeof nutritionEntries.$inferSelect;

// DOCS: Pages, SOPs, prompts, playbooks, specs, strategies
export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    type: docTypeEnum("type").default("page"),
    domain: docDomainEnum("domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"), // Self-reference for hierarchy (added via migration)
    status: docStatusEnum("status").default("draft").notNull(),
    icon: text("icon"), // Emoji or icon identifier
    coverImage: text("cover_image"), // URL to cover image
    body: text("body"), // Markdown content (legacy, for backward compatibility)
    content: jsonb("content").$type<unknown[]>(), // BlockNote JSON content (rich editor blocks)
    order: integer("order").default(0), // Sort order within parent
    isFolder: boolean("is_folder").default(false), // True for folder-type pages
    tags: jsonb("tags").$type<string[]>().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(), // Flexible metadata storage
    externalId: text("external_id"),

    // AI-Queryable Structured Fields
    summary: text("summary"), // 1-3 sentences describing the doc
    keyPoints: jsonb("key_points").$type<string[]>().default([]), // 3-5 key insights
    applicableWhen: text("applicable_when"), // Context for when to use this doc
    prerequisites: jsonb("prerequisites").$type<string[]>().default([]), // Array of doc IDs
    owner: text("owner"), // Who maintains this doc
    relatedDocs: jsonb("related_docs").$type<string[]>().default([]), // Array of related doc IDs

    // Quality Metadata
    aiReady: boolean("ai_ready").default(false), // Meets quality threshold
    qualityScore: integer("quality_score").default(0), // 0-100 score
    lastReviewedAt: timestamp("last_reviewed_at"), // When last validated

    // Embedding fields for RAG (Level 2)
    embedding: text("embedding"), // Vector embedding stored as JSON string (1536 dimensions)
    embeddingModel: text("embedding_model"), // Model used to generate embedding
    embeddingUpdatedAt: timestamp("embedding_updated_at"), // When embedding was last updated

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_docs_venture_id").on(table.ventureId),
    index("idx_docs_project_id").on(table.projectId),
    index("idx_docs_parent_id").on(table.parentId),
    index("idx_docs_type").on(table.type),
    index("idx_docs_status").on(table.status),
    index("idx_docs_domain").on(table.domain),
    // Performance: docs are frequently sorted by these timestamps
    index("idx_docs_created_at").on(table.createdAt),
    index("idx_docs_updated_at").on(table.updatedAt),
    // AI Knowledge Base: filter by quality and readiness
    index("idx_docs_ai_ready").on(table.aiReady),
    index("idx_docs_quality_score").on(table.qualityScore),
    // RAG: filter by embedding existence
    index("idx_docs_embedding_updated").on(table.embeddingUpdatedAt),
  ]
);

// ATTACHMENTS: Files and images for docs
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id").references(() => docs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // MIME type
    size: integer("size"), // File size in bytes
    url: text("url"), // External URL (Google Drive, S3, etc.)
    storageType: text("storage_type").default("url"), // 'url', 'base64', 'local'
    data: text("data"), // Base64 encoded data for small files
    thumbnailUrl: text("thumbnail_url"), // Thumbnail for images
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_attachments_doc_id").on(table.docId),
    // Performance: attachments are sorted by createdAt
    index("idx_attachments_created_at").on(table.createdAt),
  ]
);

export const insertAttachmentSchema = createInsertSchema(attachments).omit({
  id: true,
  createdAt: true,
});

export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachments.$inferSelect;

// DOC_CHUNKS: Chunked document content for RAG vector search (Level 2)
export const docChunks = pgTable(
  "doc_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id").references(() => docs.id, { onDelete: "cascade" }).notNull(),
    chunkIndex: integer("chunk_index").notNull(), // Order of chunk within doc
    content: text("content").notNull(), // Chunk text content
    embedding: text("embedding"), // Vector embedding as JSON string
    startOffset: integer("start_offset"), // Start position in original doc
    endOffset: integer("end_offset"), // End position in original doc
    metadata: jsonb("metadata").$type<{
      section?: string;
      headings?: string[];
      isCodeBlock?: boolean;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_chunks_doc_id").on(table.docId),
    index("idx_doc_chunks_index").on(table.docId, table.chunkIndex),
  ]
);

export const insertDocChunkSchema = createInsertSchema(docChunks).omit({
  id: true,
  createdAt: true,
});

export type InsertDocChunk = z.infer<typeof insertDocChunkSchema>;
export type DocChunk = typeof docChunks.$inferSelect;

export const insertDocSchema = createInsertSchema(docs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDoc = z.infer<typeof insertDocSchema>;
export type Doc = typeof docs.$inferSelect;

// ----------------------------------------------------------------------------
// RELATIONS
// ----------------------------------------------------------------------------

export const venturesRelations = relations(ventures, ({ many }) => ({
  projects: many(projects),
  tasks: many(tasks),
  docs: many(docs),
  captureItems: many(captureItems),
  days: many(days),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  venture: one(ventures, {
    fields: [projects.ventureId],
    references: [ventures.id],
  }),
  phases: many(phases),
  tasks: many(tasks),
  docs: many(docs),
  captureItems: many(captureItems),
}));

export const phasesRelations = relations(phases, ({ one, many }) => ({
  project: one(projects, {
    fields: [phases.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  venture: one(ventures, {
    fields: [tasks.ventureId],
    references: [ventures.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  phase: one(phases, {
    fields: [tasks.phaseId],
    references: [phases.id],
  }),
  day: one(days, {
    fields: [tasks.dayId],
    references: [days.id],
  }),
}));

export const captureItemsRelations = relations(captureItems, ({ one }) => ({
  venture: one(ventures, {
    fields: [captureItems.ventureId],
    references: [ventures.id],
  }),
  project: one(projects, {
    fields: [captureItems.projectId],
    references: [projects.id],
  }),
  linkedTask: one(tasks, {
    fields: [captureItems.linkedTaskId],
    references: [tasks.id],
  }),
}));

export const daysRelations = relations(days, ({ one, many }) => ({
  primaryVenture: one(ventures, {
    fields: [days.primaryVentureFocus],
    references: [ventures.id],
  }),
  tasks: many(tasks),
  healthEntries: many(healthEntries),
  nutritionEntries: many(nutritionEntries),
}));

export const healthEntriesRelations = relations(healthEntries, ({ one }) => ({
  day: one(days, {
    fields: [healthEntries.dayId],
    references: [days.id],
  }),
}));

export const nutritionEntriesRelations = relations(nutritionEntries, ({ one }) => ({
  day: one(days, {
    fields: [nutritionEntries.dayId],
    references: [days.id],
  }),
}));

export const docsRelations = relations(docs, ({ one, many }) => ({
  venture: one(ventures, {
    fields: [docs.ventureId],
    references: [ventures.id],
  }),
  project: one(projects, {
    fields: [docs.projectId],
    references: [projects.id],
  }),
  parent: one(docs, {
    fields: [docs.parentId],
    references: [docs.id],
    relationName: "docHierarchy",
  }),
  children: many(docs, {
    relationName: "docHierarchy",
  }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  doc: one(docs, {
    fields: [attachments.docId],
    references: [docs.id],
  }),
}));

// ----------------------------------------------------------------------------
// SHOPPING ITEMS
// ----------------------------------------------------------------------------

export const shoppingPriorityEnum = pgEnum('shopping_priority', ['P1', 'P2', 'P3']);
export const shoppingStatusEnum = pgEnum('shopping_status', ['to_buy', 'purchased']);
export const shoppingCategoryEnum = pgEnum('shopping_category', ['groceries', 'personal', 'household', 'business']);

export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item: text("item").notNull(),
    priority: shoppingPriorityEnum("priority").default("P2").notNull(),
    status: shoppingStatusEnum("status").default("to_buy").notNull(),
    category: shoppingCategoryEnum("category").default("personal"),
    notes: text("notes"),
    externalId: text("external_id"),  // e.g., "ticktick:task_id" for synced items
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_shopping_items_status").on(table.status),
    index("idx_shopping_items_priority").on(table.priority),
    index("idx_shopping_items_category").on(table.category),
    index("idx_shopping_items_created_at").on(table.createdAt),
    index("idx_shopping_items_external_id").on(table.externalId),
  ]
);

export const insertShoppingItemSchema = createInsertSchema(shoppingItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShoppingItem = z.infer<typeof insertShoppingItemSchema>;
export type ShoppingItem = typeof shoppingItems.$inferSelect;

// ----------------------------------------------------------------------------
// BOOKS
// ----------------------------------------------------------------------------

export const bookStatusEnum = pgEnum('book_status', ['to_read', 'reading', 'finished']);

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    author: text("author"),
    platforms: jsonb("platforms").$type<string[]>().default([]),
    status: bookStatusEnum("status").default("to_read").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_books_status").on(table.status),
    index("idx_books_created_at").on(table.createdAt),
  ]
);

export const insertBookSchema = createInsertSchema(books, {
  platforms: z.array(z.string()).nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBook = z.infer<typeof insertBookSchema>;
export type Book = typeof books.$inferSelect;

// ----------------------------------------------------------------------------
// FINANCIAL ACCOUNTS (Net Worth Tracking)
// ----------------------------------------------------------------------------

export const financialAccountTypeEnum = pgEnum('financial_account_type', [
  // Cash & Bank
  'checking',      // Bank checking accounts
  'savings',       // Savings accounts
  // Investments
  'investment',    // Brokerage, ISA, 401k, etc.
  'retirement',    // Pension, 401k, IRA
  'crypto',        // Cryptocurrency wallets
  // Physical Assets
  'property',      // Real estate
  'vehicle',       // Cars, motorcycles
  'jewelry',       // Watches, gold, silver
  'collectible',   // Art, wine, other collectibles
  'other_asset',   // Anything else valuable
  // Liabilities
  'credit_card',   // Credit card debt
  'loan',          // Personal loans, car loans
  'mortgage',      // Property mortgages
  'other_debt'     // Other debts
]);

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),                                    // "Chase Checking", "Vanguard ISA", "Gold Coins"
    type: financialAccountTypeEnum("type").notNull(),
    institution: text("institution"),                                 // Bank/broker name or null for physical assets
    currentBalance: real("current_balance").default(0).notNull(),    // Latest balance in USD
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    isAsset: boolean("is_asset").default(true).notNull(),            // true = asset, false = liability
    isActive: boolean("is_active").default(true).notNull(),          // For hiding closed accounts
    icon: varchar("icon", { length: 10 }),                           // Emoji icon
    color: varchar("color", { length: 7 }),                          // Hex color
    notes: text("notes"),
    // Metadata for physical assets (purchase price, location, etc.)
    metadata: jsonb("metadata").$type<{
      purchasePrice?: number;
      purchaseDate?: string;
      location?: string;
      serialNumber?: string;
      estimatedValue?: number;
      lastAppraisalDate?: string;
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_financial_accounts_type").on(table.type),
    index("idx_financial_accounts_is_asset").on(table.isAsset),
    index("idx_financial_accounts_is_active").on(table.isActive),
    index("idx_financial_accounts_created_at").on(table.createdAt),
  ]
);

export const insertFinancialAccountSchema = createInsertSchema(financialAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFinancialAccount = z.infer<typeof insertFinancialAccountSchema>;
export type FinancialAccount = typeof financialAccounts.$inferSelect;

// Account Snapshots: Balance history for tracking changes over time
export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => financialAccounts.id, { onDelete: "cascade" }).notNull(),
    balance: real("balance").notNull(),
    note: text("note"),                                              // Optional note for this update
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_account_snapshots_account_id").on(table.accountId),
    index("idx_account_snapshots_created_at").on(table.createdAt),
  ]
);

export const insertAccountSnapshotSchema = createInsertSchema(accountSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertAccountSnapshot = z.infer<typeof insertAccountSnapshotSchema>;
export type AccountSnapshot = typeof accountSnapshots.$inferSelect;

// NOTE: netWorthSnapshots table is defined later in the file (line ~2314) with the Holdings section
// for comprehensive net worth tracking with asset type breakdowns

// ----------------------------------------------------------------------------
// AI AGENT PROMPTS
// ----------------------------------------------------------------------------

// AI Agent Prompts: Venture-specific AI assistant configuration
export const aiAgentPrompts = pgTable(
  "ai_agent_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull().unique(),
    systemPrompt: text("system_prompt"),
    context: text("context"),
    capabilities: jsonb("capabilities").$type<string[]>().default([]),
    quickActions: jsonb("quick_actions").$type<{
      label: string;
      prompt: string;
    }[]>().default([]),
    // New fields for venture AI agent system
    knowledgeSources: jsonb("knowledge_sources").$type<string[]>().default(['docs', 'tasks', 'projects']), // Which data types to include
    actionPermissions: jsonb("action_permissions").$type<string[]>().default(['read']), // What actions agent can take: read, create_task, create_doc, etc.
    contextRefreshHours: integer("context_refresh_hours").default(24), // Hours between context rebuilds
    maxContextTokens: integer("max_context_tokens").default(8000), // Token budget for context
    preferredModel: text("preferred_model"), // Preferred AI model (e.g., 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet')
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_ai_agent_prompts_venture_id").on(table.ventureId),
    index("idx_ai_agent_prompts_enabled").on(table.enabled),
  ]
);

export const insertAiAgentPromptSchema = createInsertSchema(aiAgentPrompts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAiAgentPrompt = z.infer<typeof insertAiAgentPromptSchema>;

// COO Chat Sessions: Separate conversations with the COO AI assistant
export const cooChatSessions = pgTable(
  "coo_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull().default("New Chat"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_coo_chat_sessions_user_id").on(table.userId),
    index("idx_coo_chat_sessions_updated_at").on(table.updatedAt),
  ]
);

export const insertCooChatSessionSchema = createInsertSchema(cooChatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CooChatSession = typeof cooChatSessions.$inferSelect;
export type InsertCooChatSession = z.infer<typeof insertCooChatSessionSchema>;

// Chat Messages: Web-based AI chat conversations
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    sessionId: uuid("session_id").references(() => cooChatSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      model?: string;
      tokensUsed?: number;
      toolCalls?: any[];
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_chat_messages_user_id").on(table.userId),
    index("idx_chat_messages_session_id").on(table.sessionId),
    index("idx_chat_messages_created_at").on(table.createdAt),
  ]
);

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type AiAgentPrompt = typeof aiAgentPrompts.$inferSelect;

// ----------------------------------------------------------------------------
// VENTURE AI AGENT SYSTEM
// ----------------------------------------------------------------------------

// Venture Conversations: Chat history scoped to specific ventures
export const ventureConversations = pgTable(
  "venture_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      model?: string;
      tokensUsed?: number;
      toolCalls?: any[];
      toolResults?: any[];
      actionsTaken?: string[];
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_venture_conversations_venture_id").on(table.ventureId),
    index("idx_venture_conversations_user_id").on(table.userId),
    index("idx_venture_conversations_created_at").on(table.createdAt),
  ]
);

export const insertVentureConversationSchema = createInsertSchema(ventureConversations).omit({
  id: true,
  createdAt: true,
});

export type VentureConversation = typeof ventureConversations.$inferSelect;
export type InsertVentureConversation = z.infer<typeof insertVentureConversationSchema>;

// Context type enum for venture context cache
export const contextTypeEnum = pgEnum('context_type', ['full', 'summary', 'docs', 'tasks', 'projects']);

// Venture Context Cache: Cached context summaries for AI agents
export const ventureContextCache = pgTable(
  "venture_context_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    contextType: contextTypeEnum("context_type").default("full").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    lastBuiltAt: timestamp("last_built_at").defaultNow().notNull(),
    validUntil: timestamp("valid_until"),
    metadata: jsonb("metadata").$type<{
      projectCount?: number;
      taskCount?: number;
      docCount?: number;
      buildDurationMs?: number;
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_venture_context_cache_venture_id").on(table.ventureId),
    index("idx_venture_context_cache_type").on(table.contextType),
    index("idx_venture_context_cache_valid_until").on(table.validUntil),
  ]
);

export const insertVentureContextCacheSchema = createInsertSchema(ventureContextCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type VentureContextCache = typeof ventureContextCache.$inferSelect;
export type InsertVentureContextCache = z.infer<typeof insertVentureContextCacheSchema>;

// Venture Agent Actions: Audit log for actions taken by venture AI agents
export const ventureAgentActions = pgTable(
  "venture_agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    conversationId: uuid("conversation_id").references(() => ventureConversations.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g., 'create_task', 'update_project', 'create_doc'
    entityType: text("entity_type"), // e.g., 'task', 'project', 'doc', 'phase'
    entityId: uuid("entity_id"), // ID of created/updated entity
    parameters: jsonb("parameters").$type<Record<string, any>>(),
    result: text("result").$type<"success" | "failed" | "rejected" | "pending">().default("pending"),
    errorMessage: text("error_message"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_venture_agent_actions_venture_id").on(table.ventureId),
    index("idx_venture_agent_actions_user_id").on(table.userId),
    index("idx_venture_agent_actions_action").on(table.action),
    index("idx_venture_agent_actions_executed_at").on(table.executedAt),
  ]
);

export const insertVentureAgentActionSchema = createInsertSchema(ventureAgentActions).omit({
  id: true,
  executedAt: true,
});

export type VentureAgentAction = typeof ventureAgentActions.$inferSelect;
export type InsertVentureAgentAction = z.infer<typeof insertVentureAgentActionSchema>;

// ----------------------------------------------------------------------------
// TRADING STRATEGIES
// ----------------------------------------------------------------------------

// Checklist item types for trading strategies
export type TradingChecklistItemType = 'checkbox' | 'text' | 'number' | 'select' | 'time' | 'table';

export interface TradingChecklistItem {
  id: string;
  label: string;
  type: TradingChecklistItemType;
  required: boolean;
  category?: string; // For grouping like "A. The Setup", "B. The Trigger"
  options?: string[]; // For select type
  placeholder?: string;
  description?: string;
  tableColumns?: string[]; // For table type
}

export interface TradingChecklistSection {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  items: TradingChecklistItem[];
}

export interface TradingStrategyConfig {
  sections: TradingChecklistSection[];
}

// Trading session type for the day
export const tradingSessionEnum = pgEnum('trading_session', ['london', 'new_york', 'asian', 'other']);

// Trading Strategies: Templates for trading checklists
export const tradingStrategies = pgTable(
  "trading_strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    instruments: jsonb("instruments").$type<string[]>().default([]), // e.g., ["XAU/USD", "XAG/USD"]
    isActive: boolean("is_active").default(true), // Whether this strategy is currently active
    isDefault: boolean("is_default").default(false), // Whether this is the default strategy
    config: jsonb("config").$type<TradingStrategyConfig>().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trading_strategies_is_active").on(table.isActive),
    index("idx_trading_strategies_is_default").on(table.isDefault),
  ]
);

export const insertTradingStrategySchema = createInsertSchema(tradingStrategies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTradingStrategy = z.infer<typeof insertTradingStrategySchema>;
export type TradingStrategy = typeof tradingStrategies.$inferSelect;

// Daily Trading Checklists: Track daily completion of a strategy
export interface TradingChecklistValue {
  checked?: boolean;
  value?: string | number;
  tableData?: Record<string, string>[];
}

export interface DailyTradingChecklistData {
  strategyId: string;
  strategyName: string;
  instrument?: string; // Optional: specific instrument like "XAU/USD", "XAG/USD"
  session?: 'london' | 'new_york' | 'asian' | 'other';
  mentalState?: number; // 1-10
  highImpactNews?: string;
  primarySetup?: string; // "Primary Setup I'm Hunting" - forces specificity and prevents chasing
  values: Record<string, TradingChecklistValue>; // Map of item id to value
  trades: {
    id: string;
    time: string;
    symbol: string;  // Trading symbol (e.g., XAUUSD, EURUSD)
    pair?: string;   // Legacy field - use symbol instead
    direction: 'long' | 'short';
    entryPrice: string;
    stopLoss: string;
    takeProfit?: string;
    openDate: string;   // Date trade was opened (YYYY-MM-DD)
    closeDate?: string; // Date trade was closed (for multi-day trades)
    result?: 'win' | 'loss' | 'breakeven' | 'pending';
    pnl?: number;
    notes?: string;
  }[];
  endOfSessionReview?: {
    followedPlan: boolean;
    noTradeIsSuccess?: boolean; // "I passed on setups that didn't qualify" - validates discipline
    didWell?: string;
    toImprove?: string;
  };
  completedAt?: string;
}

export const dailyTradingChecklists = pgTable(
  "daily_trading_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayId: text("day_id").references(() => days.id, { onDelete: "cascade" }).notNull(),
    date: date("date").notNull(),
    strategyId: uuid("strategy_id").references(() => tradingStrategies.id, { onDelete: "set null" }),
    data: jsonb("data").$type<DailyTradingChecklistData>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_daily_trading_checklists_day_id").on(table.dayId),
    index("idx_daily_trading_checklists_date").on(table.date),
    index("idx_daily_trading_checklists_strategy_id").on(table.strategyId),
  ]
);

export const insertDailyTradingChecklistSchema = createInsertSchema(dailyTradingChecklists)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Coerce string dates to Date objects for proper validation
    date: z.union([z.string(), z.date()]).pipe(z.coerce.date()),
  });

export type InsertDailyTradingChecklist = z.infer<typeof insertDailyTradingChecklistSchema>;
export type DailyTradingChecklist = typeof dailyTradingChecklists.$inferSelect;

// ----------------------------------------------------------------------------
// PEOPLE / RELATIONSHIPS CRM
// ----------------------------------------------------------------------------

// Enums for People
export const relationshipTypeEnum = pgEnum("relationship_type", [
  "personal_friend",
  "professional_contact",
  "mentor",
  "mentee",
  "investor",
  "founder",
  "employee",
  "contractor",
  "client",
  "prospect",
  "family",
  "acquaintance",
  "other"
]);

export const contactFrequencyEnum = pgEnum("contact_frequency", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
  "as_needed"
]);

export const importanceEnum = pgEnum("importance", [
  "critical",
  "high",
  "standard",
  "low"
]);

// People table: Contact/relationship management
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Basic contact info
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    countryCode: text("country_code"),
    phone2: text("phone2"),
    countryCode2: text("country_code2"),
    company: text("company"),
    jobTitle: text("job_title"),
    birthday: date("birthday"),
    location: text("location"),
    photoUrl: text("photo_url"),
    linkedIn: text("linked_in"),

    // Relationship context
    relationship: relationshipTypeEnum("relationship"),
    importance: importanceEnum("importance").default("standard"),
    howWeMet: text("how_we_met"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),

    // Engagement tracking
    lastContactDate: date("last_contact_date"),
    nextFollowUp: date("next_follow_up"),
    contactFrequency: contactFrequencyEnum("contact_frequency").default("as_needed"),

    // Notes and context
    notes: text("notes"),
    tags: text("tags"),

    // Category (for grouping/filtering contacts)
    categoryId: uuid("category_id").references(() => customCategories.id, { onDelete: "set null" }),

    // Sync metadata (for Google Contacts integration)
    googleContactId: text("google_contact_id").unique(),
    googleEtag: text("google_etag"),

    // Sync metadata (for external Contacts API integration)
    externalContactId: text("external_contact_id").unique(),

    needsEnrichment: boolean("needs_enrichment").default(true),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_people_name").on(table.name),
    index("idx_people_email").on(table.email),
    index("idx_people_relationship").on(table.relationship),
    index("idx_people_importance").on(table.importance),
    index("idx_people_venture_id").on(table.ventureId),
    index("idx_people_google_contact_id").on(table.googleContactId),
    index("idx_people_external_contact_id").on(table.externalContactId),
    index("idx_people_next_follow_up").on(table.nextFollowUp),
    index("idx_people_last_contact_date").on(table.lastContactDate),
    index("idx_people_category_id").on(table.categoryId),
  ]
);

export const insertPersonSchema = createInsertSchema(people).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof people.$inferSelect;

// ----------------------------------------------------------------------------
// TRADING AI AGENT CONVERSATIONS
// ----------------------------------------------------------------------------

// Trading Chat Sessions: Individual chat threads for trading AI agent
export const tradingChatSessions = pgTable(
  "trading_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull().default("New Chat"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trading_chat_sessions_user_id").on(table.userId),
    index("idx_trading_chat_sessions_updated_at").on(table.updatedAt),
  ]
);

export const insertTradingChatSessionSchema = createInsertSchema(tradingChatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TradingChatSession = typeof tradingChatSessions.$inferSelect;
export type InsertTradingChatSession = z.infer<typeof insertTradingChatSessionSchema>;

// Trading Conversations: Chat history for trading AI agent
export const tradingConversations = pgTable(
  "trading_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    sessionId: uuid("session_id").references(() => tradingChatSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      model?: string;
      tokensUsed?: number;
      toolCalls?: any[];
      toolResults?: any[];
      actionsTaken?: string[];
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trading_conversations_user_id").on(table.userId),
    index("idx_trading_conversations_session_id").on(table.sessionId),
    index("idx_trading_conversations_created_at").on(table.createdAt),
  ]
);

export const insertTradingConversationSchema = createInsertSchema(tradingConversations).omit({
  id: true,
  createdAt: true,
});

export type TradingConversation = typeof tradingConversations.$inferSelect;
export type InsertTradingConversation = z.infer<typeof insertTradingConversationSchema>;

// Trading Agent Config: Configuration for the trading AI agent
// Enhanced with wisdom from Paul Tudor Jones, Ray Dalio, Mark Douglas, Brett Steenbarger, Chris Vermeulen
export const tradingAgentConfig = pgTable(
  "trading_agent_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),

    // Agent personality and instructions
    systemPrompt: text("system_prompt"), // Custom system prompt additions
    tradingStyle: text("trading_style"), // e.g., "ICT/SMC concepts", "Price Action", "Scalping"
    instruments: text("instruments"), // e.g., "EURUSD, GBPUSD, Gold"
    timeframes: text("timeframes"), // e.g., "15m, 1H, 4H"
    riskRules: text("risk_rules"), // e.g., "Max 1% per trade, max 3 trades per day"
    tradingHours: text("trading_hours"), // e.g., "London and NY sessions only"

    // Quick actions - predefined prompts
    quickActions: jsonb("quick_actions").$type<Array<{ label: string; prompt: string }>>().default([]),

    // Preferences
    preferredModel: text("preferred_model"), // e.g., "openai/gpt-4o" - used for main chat
    researchModel: text("research_model"), // e.g., "perplexity/sonar-pro" - used for web search
    focusAreas: jsonb("focus_areas").$type<string[]>().default([]), // e.g., ["discipline", "risk management", "journaling"]

    // === ACCOUNT MANAGEMENT (Paul Tudor Jones: "The most important rule is to play great defense") ===
    accountBalance: real("account_balance"), // Current account balance
    accountCurrency: text("account_currency").default("USD"), // Account currency
    maxDrawdownPercent: real("max_drawdown_percent"), // Maximum allowed drawdown % before stopping
    riskPerTradePercent: real("risk_per_trade_percent"), // Risk per trade as % of account
    riskPerTradeAmount: real("risk_per_trade_amount"), // Or fixed $ amount per trade
    brokerName: text("broker_name"), // Broker name for reference

    // === PERFORMANCE GOALS (Ray Dalio: "Pain + Reflection = Progress") ===
    monthlyPnlTarget: real("monthly_pnl_target"), // Monthly P&L target in $
    monthlyPnlTargetPercent: real("monthly_pnl_target_percent"), // Or as % of account
    winRateTarget: real("win_rate_target"), // Target win rate (e.g., 0.55 for 55%)
    averageRRTarget: real("average_rr_target"), // Target average R:R ratio
    maxTradesPerDay: integer("max_trades_per_day"), // Maximum trades allowed per day
    maxTradesPerWeek: integer("max_trades_per_week"), // Maximum trades per week
    maxLossPerDay: real("max_loss_per_day"), // Max $ loss before stopping for day
    maxLossPerDayPercent: real("max_loss_per_day_percent"), // Or as % of account
    maxConsecutiveLosses: integer("max_consecutive_losses"), // Stop after N consecutive losses

    // === SETUP LIBRARY (Chris Vermeulen: "Trade what you see, not what you think") ===
    setupTypes: jsonb("setup_types").$type<Array<{
      name: string;           // e.g., "FVG", "Order Block", "Breaker"
      description: string;    // Setup description
      rules: string[];        // Entry rules
      invalidation: string;   // What invalidates the setup
      targetRR: number;       // Typical R:R target
      winRate?: number;       // Historical win rate for this setup
    }>>().default([]),

    // === PSYCHOLOGY & MENTAL RULES (Mark Douglas: "Trading is 80% mental") ===
    noTradeRules: jsonb("no_trade_rules").$type<string[]>().default([]), // When NOT to trade
    preTradeChecklist: jsonb("pre_trade_checklist").$type<string[]>().default([]), // Mental checklist before every trade
    postTradeReview: jsonb("post_trade_review").$type<string[]>().default([]), // Questions after each trade
    tradingPlan: text("trading_plan"), // Comprehensive trading plan document
    tradingBeliefs: jsonb("trading_beliefs").$type<string[]>().default([]), // Core trading beliefs (Mark Douglas style)

    // === PERFORMANCE PSYCHOLOGY (Brett Steenbarger: "Self-coaching") ===
    strengthsToLeverage: jsonb("strengths_to_leverage").$type<string[]>().default([]), // What you do well
    weaknessesToManage: jsonb("weaknesses_to_manage").$type<string[]>().default([]), // Areas to improve
    emotionalTriggers: jsonb("emotional_triggers").$type<string[]>().default([]), // What causes tilt/FOMO
    recoveryStrategies: jsonb("recovery_strategies").$type<string[]>().default([]), // How to recover from losses

    // === REVIEW CONFIGURATION ===
    weeklyReviewDay: text("weekly_review_day").default("sunday"), // Day for weekly review
    monthlyReviewDay: integer("monthly_review_day").default(1), // Day of month for review
    reviewQuestions: jsonb("review_questions").$type<{
      daily: string[];
      weekly: string[];
      monthly: string[];
    }>().default({ daily: [], weekly: [], monthly: [] }),

    // === MENTORS & INFLUENCES ===
    tradingMentors: jsonb("trading_mentors").$type<string[]>().default([]), // Who you learn from
    keyLessons: jsonb("key_lessons").$type<Array<{
      lesson: string;
      source: string;
      dateAdded: string;
    }>>().default([]), // Key lessons learned

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trading_agent_config_user_id").on(table.userId),
  ]
);

export const insertTradingAgentConfigSchema = createInsertSchema(tradingAgentConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TradingAgentConfig = typeof tradingAgentConfig.$inferSelect;
export type InsertTradingAgentConfig = z.infer<typeof insertTradingAgentConfigSchema>;

// Trading Knowledge Docs: Documents uploaded for AI agent training/context
export const tradingKnowledgeDocCategoryEnum = pgEnum('trading_knowledge_doc_category', [
  'strategy',     // Trading strategies and rules
  'playbook',     // Step-by-step playbooks
  'notes',        // Personal trading notes
  'research',     // Market research and analysis
  'psychology',   // Trading psychology materials
  'education',    // Educational materials
  'other'         // Other documents
]);

export const tradingKnowledgeDocs = pgTable(
  "trading_knowledge_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),

    // Document info
    title: text("title").notNull(),
    description: text("description"),
    category: tradingKnowledgeDocCategoryEnum("category").default("other"),

    // File info
    fileName: text("file_name"),
    fileType: text("file_type"), // MIME type: application/pdf, text/plain, image/png, etc.
    fileSize: integer("file_size"), // Size in bytes

    // Storage: either URL or base64 data
    storageType: text("storage_type").default("base64"), // 'url', 'base64', 'local'
    fileUrl: text("file_url"), // External URL if stored elsewhere
    fileData: text("file_data"), // Base64 encoded file data

    // Extracted/processed content for AI
    extractedText: text("extracted_text"), // Text extracted from PDFs, images (OCR)
    summary: text("summary"), // AI-generated summary

    // AI training settings
    includeInContext: boolean("include_in_context").default(true), // Whether to include in AI context
    priority: integer("priority").default(0), // Higher priority = included first

    // Metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    tags: text("tags"), // Comma-separated tags

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trading_knowledge_docs_user_id").on(table.userId),
    index("idx_trading_knowledge_docs_category").on(table.category),
    index("idx_trading_knowledge_docs_include_in_context").on(table.includeInContext),
    index("idx_trading_knowledge_docs_created_at").on(table.createdAt),
  ]
);

export const insertTradingKnowledgeDocSchema = createInsertSchema(tradingKnowledgeDocs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TradingKnowledgeDoc = typeof tradingKnowledgeDocs.$inferSelect;
export type InsertTradingKnowledgeDoc = z.infer<typeof insertTradingKnowledgeDocSchema>;

// ----------------------------------------------------------------------------
// KNOWLEDGE FILES (Venture-linked file uploads with AI reading)
// ----------------------------------------------------------------------------

// Category enum for knowledge files
export const knowledgeFileCategoryEnum = pgEnum('knowledge_file_category', [
  'document',     // General documents
  'strategy',     // Strategy documents
  'playbook',     // Step-by-step playbooks
  'notes',        // Personal notes
  'research',     // Research and analysis
  'reference',    // Reference materials
  'template',     // Templates
  'image',        // Images and diagrams
  'spreadsheet',  // Spreadsheets and data
  'presentation', // Presentations
  'other'         // Other files
]);

// Storage type enum
export const knowledgeFileStorageEnum = pgEnum('knowledge_file_storage', [
  'google_drive', // Stored in Google Drive
  'base64',       // Base64 encoded in DB
  'url'           // External URL
]);

// Processing status enum
export const knowledgeFileProcessingStatusEnum = pgEnum('knowledge_file_processing_status', [
  'pending',      // Waiting to be processed
  'processing',   // Currently being processed
  'completed',    // Processing complete
  'failed'        // Processing failed
]);

// Knowledge Files: Venture-linked file uploads with AI reading capability
export const knowledgeFiles = pgTable(
  "knowledge_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Ownership & linking
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    docId: uuid("doc_id").references(() => docs.id, { onDelete: "set null" }),

    // File info
    name: text("name").notNull(),
    description: text("description"),
    category: knowledgeFileCategoryEnum("category").default("document"),

    // Original file details
    originalFileName: text("original_file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size"), // Size in bytes

    // Storage
    storageType: knowledgeFileStorageEnum("storage_type").default("google_drive"),
    googleDriveFileId: text("google_drive_file_id"), // Google Drive file ID
    googleDriveUrl: text("google_drive_url"), // Web view link
    storageUrl: text("storage_url"), // For external URLs
    base64Data: text("base64_data"), // For small files stored in DB

    // AI Processing
    processingStatus: knowledgeFileProcessingStatusEnum("processing_status").default("pending"),
    extractedText: text("extracted_text"), // Text extracted from file (PDF, images via OCR)
    aiSummary: text("ai_summary"), // AI-generated summary
    aiTags: jsonb("ai_tags").$type<string[]>().default([]), // AI-suggested tags
    aiMetadata: jsonb("ai_metadata").$type<{
      confidence?: number;
      noteType?: string;
      hasActionItems?: boolean;
      keyTopics?: string[];
      entities?: string[];
      processingModel?: string;
      processingTime?: number;
      errorMessage?: string;
      [key: string]: any;
    }>(),

    // Context inclusion for AI
    includeInAiContext: boolean("include_in_ai_context").default(true),
    aiContextPriority: integer("ai_context_priority").default(0), // Higher = included first

    // User-provided metadata
    tags: text("tags"), // Comma-separated user tags
    notes: text("notes"),

    // Timestamps
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_knowledge_files_venture_id").on(table.ventureId),
    index("idx_knowledge_files_project_id").on(table.projectId),
    index("idx_knowledge_files_task_id").on(table.taskId),
    index("idx_knowledge_files_doc_id").on(table.docId),
    index("idx_knowledge_files_category").on(table.category),
    index("idx_knowledge_files_processing_status").on(table.processingStatus),
    index("idx_knowledge_files_include_in_ai_context").on(table.includeInAiContext),
    index("idx_knowledge_files_google_drive_file_id").on(table.googleDriveFileId),
    index("idx_knowledge_files_created_at").on(table.createdAt),
  ]
);

export const insertKnowledgeFileSchema = createInsertSchema(knowledgeFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type KnowledgeFile = typeof knowledgeFiles.$inferSelect;
export type InsertKnowledgeFile = z.infer<typeof insertKnowledgeFileSchema>;

// ----------------------------------------------------------------------------
// STRATEGIC FORESIGHT MODULE
// ----------------------------------------------------------------------------

// Enums for Strategic Foresight
export const scenarioTimeHorizonEnum = pgEnum('scenario_time_horizon', ['1_year', '3_year', '5_year', '10_year']);
export const scenarioProbabilityEnum = pgEnum('scenario_probability', ['low', 'medium', 'high']);
export const scenarioImpactEnum = pgEnum('scenario_impact', ['low', 'medium', 'high', 'critical']);
export const scenarioQuadrantEnum = pgEnum('scenario_quadrant', ['growth', 'collapse', 'transformation', 'constraint']);
export const scenarioStatusEnum = pgEnum('scenario_status', ['draft', 'active', 'archived']);
export const pestleCategoryEnum = pgEnum('pestle_category', ['political', 'economic', 'social', 'technological', 'legal', 'environmental']);
export const indicatorStatusEnum = pgEnum('indicator_status', ['green', 'yellow', 'red']);
export const signalStrengthEnum = pgEnum('signal_strength', ['weak', 'emerging', 'strong', 'mainstream']);
export const signalRelevanceEnum = pgEnum('signal_relevance', ['low', 'medium', 'high']);
export const signalStatusEnum = pgEnum('signal_status', ['monitoring', 'acted_upon', 'dismissed']);
export const analysisFrameworkEnum = pgEnum('analysis_framework', ['pestle', 'steep', 'swot', 'porters_five', 'custom']);
export const whatIfCategoryEnum = pgEnum('what_if_category', ['disruption', 'opportunity', 'threat', 'transformation']);
export const whatIfSourceEnum = pgEnum('what_if_source', ['ai_generated', 'user_created', 'workshop']);

// Venture Scenarios: Future scenarios for strategic planning
export const ventureScenarios = pgTable(
  "venture_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    timeHorizon: scenarioTimeHorizonEnum("time_horizon").default("3_year"),
    probability: scenarioProbabilityEnum("probability").default("medium"),
    impact: scenarioImpactEnum("impact").default("medium"),
    quadrant: scenarioQuadrantEnum("quadrant"),
    uncertaintyAxis1: text("uncertainty_axis_1"), // First uncertainty dimension (e.g., "Technology adoption")
    uncertaintyAxis2: text("uncertainty_axis_2"), // Second uncertainty dimension (e.g., "Regulation intensity")
    keyAssumptions: jsonb("key_assumptions").$type<string[]>().default([]),
    opportunities: jsonb("opportunities").$type<string[]>().default([]),
    threats: jsonb("threats").$type<string[]>().default([]),
    strategicResponses: jsonb("strategic_responses").$type<{
      action: string;
      priority: string;
      timeline?: string;
      owner?: string;
    }[]>().default([]),
    status: scenarioStatusEnum("status").default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_venture_scenarios_venture_id").on(table.ventureId),
    index("idx_venture_scenarios_status").on(table.status),
    index("idx_venture_scenarios_quadrant").on(table.quadrant),
    index("idx_venture_scenarios_time_horizon").on(table.timeHorizon),
  ]
);

export const insertVentureScenarioSchema = createInsertSchema(ventureScenarios).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVentureScenario = z.infer<typeof insertVentureScenarioSchema>;
export type VentureScenario = typeof ventureScenarios.$inferSelect;

// Scenario Indicators: Early warning signals for scenarios
export const scenarioIndicators = pgTable(
  "scenario_indicators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id").references(() => ventureScenarios.id, { onDelete: "cascade" }),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: pestleCategoryEnum("category"),
    threshold: text("threshold"), // Trigger condition description
    currentStatus: indicatorStatusEnum("current_status").default("green"),
    lastChecked: timestamp("last_checked"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_scenario_indicators_scenario_id").on(table.scenarioId),
    index("idx_scenario_indicators_venture_id").on(table.ventureId),
    index("idx_scenario_indicators_status").on(table.currentStatus),
    index("idx_scenario_indicators_category").on(table.category),
  ]
);

export const insertScenarioIndicatorSchema = createInsertSchema(scenarioIndicators).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertScenarioIndicator = z.infer<typeof insertScenarioIndicatorSchema>;
export type ScenarioIndicator = typeof scenarioIndicators.$inferSelect;

// Trend Signals: Emerging trends and weak signals
export const trendSignals = pgTable(
  "trend_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    source: text("source"), // Where the signal was found
    category: pestleCategoryEnum("category"),
    signalStrength: signalStrengthEnum("signal_strength").default("emerging"),
    relevance: signalRelevanceEnum("relevance").default("medium"),
    potentialImpact: text("potential_impact"), // How it could affect the venture
    linkedScenarioIds: jsonb("linked_scenario_ids").$type<string[]>().default([]),
    status: signalStatusEnum("status").default("monitoring"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trend_signals_venture_id").on(table.ventureId),
    index("idx_trend_signals_category").on(table.category),
    index("idx_trend_signals_strength").on(table.signalStrength),
    index("idx_trend_signals_status").on(table.status),
    index("idx_trend_signals_created_at").on(table.createdAt),
  ]
);

export const insertTrendSignalSchema = createInsertSchema(trendSignals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTrendSignal = z.infer<typeof insertTrendSignalSchema>;
export type TrendSignal = typeof trendSignals.$inferSelect;

// Strategic Analyses: PESTLE/STEEP framework analyses
export interface PestleFactorData {
  factors: string[];
  impact: 'low' | 'medium' | 'high';
  trend: 'improving' | 'stable' | 'worsening';
  opportunities: string[];
  threats: string[];
  notes?: string;
}

export const strategicAnalyses = pgTable(
  "strategic_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    framework: analysisFrameworkEnum("framework").default("pestle"),
    timeHorizon: scenarioTimeHorizonEnum("time_horizon").default("3_year"),
    political: jsonb("political").$type<PestleFactorData>(),
    economic: jsonb("economic").$type<PestleFactorData>(),
    social: jsonb("social").$type<PestleFactorData>(),
    technological: jsonb("technological").$type<PestleFactorData>(),
    legal: jsonb("legal").$type<PestleFactorData>(),
    environmental: jsonb("environmental").$type<PestleFactorData>(),
    summary: text("summary"), // Executive summary
    recommendations: jsonb("recommendations").$type<{
      recommendation: string;
      priority: string;
      rationale?: string;
    }[]>().default([]),
    status: scenarioStatusEnum("status").default("draft"),
    reviewDate: date("review_date"), // Next review date
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_strategic_analyses_venture_id").on(table.ventureId),
    index("idx_strategic_analyses_framework").on(table.framework),
    index("idx_strategic_analyses_status").on(table.status),
    index("idx_strategic_analyses_created_at").on(table.createdAt),
  ]
);

export const insertStrategicAnalysisSchema = createInsertSchema(strategicAnalyses)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    reviewDate: dateStringSchema,
  });

export type InsertStrategicAnalysis = z.infer<typeof insertStrategicAnalysisSchema>;
export type StrategicAnalysis = typeof strategicAnalyses.$inferSelect;

// What-If Questions: Strategic question bank
export const whatIfQuestions = pgTable(
  "what_if_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    question: text("question").notNull(),
    category: whatIfCategoryEnum("category").default("disruption"),
    source: whatIfSourceEnum("source").default("user_created"),
    explored: boolean("explored").default(false),
    explorationNotes: text("exploration_notes"),
    linkedScenarioId: uuid("linked_scenario_id").references(() => ventureScenarios.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_what_if_questions_venture_id").on(table.ventureId),
    index("idx_what_if_questions_category").on(table.category),
    index("idx_what_if_questions_explored").on(table.explored),
    index("idx_what_if_questions_created_at").on(table.createdAt),
  ]
);

export const insertWhatIfQuestionSchema = createInsertSchema(whatIfQuestions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWhatIfQuestion = z.infer<typeof insertWhatIfQuestionSchema>;
export type WhatIfQuestion = typeof whatIfQuestions.$inferSelect;

// Foresight Conversations: Chat history for foresight AI agent
export const foresightConversations = pgTable(
  "foresight_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      model?: string;
      tokensUsed?: number;
      toolCalls?: any[];
      toolResults?: any[];
      actionsTaken?: string[];
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_foresight_conversations_venture_id").on(table.ventureId),
    index("idx_foresight_conversations_user_id").on(table.userId),
    index("idx_foresight_conversations_created_at").on(table.createdAt),
  ]
);

export const insertForesightConversationSchema = createInsertSchema(foresightConversations).omit({
  id: true,
  createdAt: true,
});

export type ForesightConversation = typeof foresightConversations.$inferSelect;
export type InsertForesightConversation = z.infer<typeof insertForesightConversationSchema>;

// Relations for foresight tables
export const ventureScenariosRelations = relations(ventureScenarios, ({ one, many }) => ({
  venture: one(ventures, {
    fields: [ventureScenarios.ventureId],
    references: [ventures.id],
  }),
  indicators: many(scenarioIndicators),
  whatIfQuestions: many(whatIfQuestions),
}));

export const scenarioIndicatorsRelations = relations(scenarioIndicators, ({ one }) => ({
  scenario: one(ventureScenarios, {
    fields: [scenarioIndicators.scenarioId],
    references: [ventureScenarios.id],
  }),
  venture: one(ventures, {
    fields: [scenarioIndicators.ventureId],
    references: [ventures.id],
  }),
}));

export const trendSignalsRelations = relations(trendSignals, ({ one }) => ({
  venture: one(ventures, {
    fields: [trendSignals.ventureId],
    references: [ventures.id],
  }),
}));

export const strategicAnalysesRelations = relations(strategicAnalyses, ({ one }) => ({
  venture: one(ventures, {
    fields: [strategicAnalyses.ventureId],
    references: [ventures.id],
  }),
}));

export const whatIfQuestionsRelations = relations(whatIfQuestions, ({ one }) => ({
  venture: one(ventures, {
    fields: [whatIfQuestions.ventureId],
    references: [ventures.id],
  }),
  linkedScenario: one(ventureScenarios, {
    fields: [whatIfQuestions.linkedScenarioId],
    references: [ventureScenarios.id],
  }),
}));

export const foresightConversationsRelations = relations(foresightConversations, ({ one }) => ({
  venture: one(ventures, {
    fields: [foresightConversations.ventureId],
    references: [ventures.id],
  }),
  user: one(users, {
    fields: [foresightConversations.userId],
    references: [users.id],
  }),
}));

// FEAR SETTINGS: Tim Ferriss-style fear-setting exercise for decisions
export const fearSettingDecisionTypeEnum = pgEnum("fear_setting_decision_type", [
  "venture",
  "project",
  "life_change",
  "investment",
  "other",
]);

export const fearSettingStatusEnum = pgEnum("fear_setting_status", [
  "draft",
  "completed",
  "reviewed",
  "decided",
]);

export const fearSettingDecisionEnum = pgEnum("fear_setting_decision", [
  "proceed",
  "pause",
  "abandon",
  "need_more_info",
]);

export const fearSettings = pgTable(
  "fear_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    // What decision are you facing?
    title: text("title").notNull(),
    description: text("description"),
    decisionType: fearSettingDecisionTypeEnum("decision_type").default("other"),
    // Optional links to venture/project
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    // Page 1: Define fears (What could go wrong?)
    fears: jsonb("fears").$type<{
      fear: string;
      severity: number; // 1-10
    }[]>(),
    // Page 2: Prevent (How to minimize each fear?)
    preventions: jsonb("preventions").$type<{
      fearIndex: number;
      prevention: string;
      effort: number; // 1-10 (effort to implement prevention)
    }[]>(),
    // Page 3: Repair (If it happens, how to recover?)
    repairs: jsonb("repairs").$type<{
      fearIndex: number;
      repair: string;
      reversibility: number; // 1-10 (how reversible is the damage)
    }[]>(),
    // Cost of inaction
    costSixMonths: text("cost_six_months"),
    costOneYear: text("cost_one_year"),
    costThreeYears: text("cost_three_years"),
    // Final decision
    decision: fearSettingDecisionEnum("decision"),
    decisionNotes: text("decision_notes"),
    decidedAt: timestamp("decided_at"),
    // Status
    status: fearSettingStatusEnum("status").default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at"),
  },
  (table) => [
    index("idx_fear_settings_user_id").on(table.userId),
    index("idx_fear_settings_venture_id").on(table.ventureId),
    index("idx_fear_settings_status").on(table.status),
    index("idx_fear_settings_created_at").on(table.createdAt),
  ]
);

export const insertFearSettingSchema = createInsertSchema(fearSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFearSetting = z.infer<typeof insertFearSettingSchema>;
export type FearSetting = typeof fearSettings.$inferSelect;

export const fearSettingsRelations = relations(fearSettings, ({ one }) => ({
  user: one(users, {
    fields: [fearSettings.userId],
    references: [users.id],
  }),
  venture: one(ventures, {
    fields: [fearSettings.ventureId],
    references: [ventures.id],
  }),
  project: one(projects, {
    fields: [fearSettings.projectId],
    references: [projects.id],
  }),
}));

// ============================================================================
// FINANCE / NET WORTH TRACKING
// ============================================================================

// Asset type enum for holdings
export const assetTypeEnum = pgEnum('asset_type', [
  'cash',           // Bank accounts, savings
  'stocks',         // Individual stocks
  'etf',            // Exchange-traded funds
  'crypto',         // Cryptocurrency
  'property',       // Real estate
  'retirement',     // Pension, 401k, ISA
  'bonds',          // Bonds, fixed income
  'commodities',    // Gold, silver, etc.
  'business',       // Business equity
  'other'           // Other assets
]);

// Holdings: Individual assets/investments
export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),

    // Asset details
    name: text("name").notNull(), // e.g., "Apple Inc.", "Bitcoin", "Lloyds Savings"
    symbol: text("symbol"), // e.g., "AAPL", "BTC", null for bank accounts
    assetType: assetTypeEnum("asset_type").notNull(),
    currency: text("currency").default("GBP").notNull(), // GBP, USD, EUR, etc.

    // Quantity and value
    quantity: real("quantity"), // Number of shares/units (null for cash accounts)
    currentPrice: real("current_price"), // Price per unit (null for cash accounts)
    currentValue: real("current_value").notNull(), // Total current value

    // Cost basis for P&L tracking
    costBasis: real("cost_basis"), // Total amount invested

    // Account/platform info
    platform: text("platform"), // e.g., "Trading 212", "Coinbase", "Nationwide"
    accountName: text("account_name"), // e.g., "ISA", "General Investment"

    // Status
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_holdings_user_id").on(table.userId),
    index("idx_holdings_asset_type").on(table.assetType),
    index("idx_holdings_is_active").on(table.isActive),
  ]
);

export const insertHoldingSchema = createInsertSchema(holdings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;

// Net Worth Snapshots: Monthly/periodic net worth records
export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),

    // Snapshot date (typically end of month)
    snapshotDate: date("snapshot_date").notNull(),
    month: integer("month").notNull(), // 1-12
    year: integer("year").notNull(),

    // Totals by asset type
    totalCash: real("total_cash").default(0),
    totalStocks: real("total_stocks").default(0),
    totalEtf: real("total_etf").default(0),
    totalCrypto: real("total_crypto").default(0),
    totalProperty: real("total_property").default(0),
    totalRetirement: real("total_retirement").default(0),
    totalBonds: real("total_bonds").default(0),
    totalCommodities: real("total_commodities").default(0),
    totalBusiness: real("total_business").default(0),
    totalOther: real("total_other").default(0),

    // Overall totals
    totalAssets: real("total_assets").notNull(),
    totalLiabilities: real("total_liabilities").default(0),
    netWorth: real("net_worth").notNull(),

    // Change tracking
    changeFromPrevious: real("change_from_previous"), // Absolute change
    changePercentage: real("change_percentage"), // Percentage change

    // Breakdown snapshot (JSON of all holdings at this point)
    holdingsSnapshot: jsonb("holdings_snapshot").$type<{
      holdings: Array<{
        name: string;
        assetType: string;
        value: number;
        currency: string;
      }>;
    }>(),

    notes: text("notes"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_net_worth_snapshots_user_id").on(table.userId),
    index("idx_net_worth_snapshots_date").on(table.snapshotDate),
    index("idx_net_worth_snapshots_year_month").on(table.year, table.month),
  ]
);

export const insertNetWorthSnapshotSchema = createInsertSchema(netWorthSnapshots).omit({
  id: true,
  createdAt: true,
});

export type NetWorthSnapshot = typeof netWorthSnapshots.$inferSelect;
export type InsertNetWorthSnapshot = z.infer<typeof insertNetWorthSnapshotSchema>;

// ----------------------------------------------------------------------------
// DECISION MEMORIES: Lightweight decision capture with outcome loop
// ----------------------------------------------------------------------------

export const decisionSourceEnum = pgEnum("decision_source", [
  "evening",
  "weekly",
  "capture",
  "ai_chat",
  "manual",
]);

export const decisionOutcomeEnum = pgEnum("decision_outcome", [
  "success",
  "mixed",
  "failure",
  "unknown",
]);

export const decisionReversibilityEnum = pgEnum("decision_reversibility", [
  "reversible",
  "hard_to_reverse",
  "irreversible",
]);

export const decisionRiskLevelEnum = pgEnum("decision_risk_level", [
  "low",
  "medium",
  "high",
]);

// Type for AI-derived metadata (computed at save-time)
export interface DecisionDerivedMetadata {
  canonicalSummary?: string; // <= 280 chars, for retrieval
  principles?: string[]; // inferred decision principles
  constraints?: string[]; // inferred constraints (time, money, risk, etc.)
  reversibility?: "reversible" | "hard_to_reverse" | "irreversible";
  riskLevel?: "low" | "medium" | "high";
  archetype?: string; // e.g., "delegation", "resource_allocation", "tooling_choice", "pricing", "hiring"
}

export const decisionMemories = pgTable(
  "decision_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Source of capture
    source: decisionSourceEnum("source").default("manual").notNull(),

    // Core decision content
    context: text("context").notNull(), // Situation I was facing
    decision: text("decision").notNull(), // What I chose
    reasoning: text("reasoning"), // Free-form "why" (AI can parse structure later)

    // Organization
    tags: jsonb("tags").$type<string[]>().default([]),

    // Follow-up loop
    followUpAt: timestamp("follow_up_at"), // When to check on outcome

    // Outcome (filled later when closing the loop)
    outcome: decisionOutcomeEnum("outcome"), // success | mixed | failure | unknown
    outcomeNotes: text("outcome_notes"), // What I learned
    outcomeRecordedAt: timestamp("outcome_recorded_at"), // When outcome was recorded

    // AI-derived metadata (computed at save-time, can be null if AI call fails)
    derived: jsonb("derived").$type<DecisionDerivedMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Index for finding due decisions
    index("idx_decision_memories_follow_up_at").on(table.followUpAt),
    // Index for finding closed vs open decisions
    index("idx_decision_memories_outcome_recorded_at").on(table.outcomeRecordedAt),
    // Index for recency-based retrieval
    index("idx_decision_memories_created_at").on(table.createdAt),
  ]
);

export const insertDecisionMemorySchema = createInsertSchema(decisionMemories)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    outcomeRecordedAt: true,
  })
  .extend({
    followUpAt: timestampSchema,
  });

export const updateDecisionMemorySchema = insertDecisionMemorySchema.partial();

export const closeDecisionMemorySchema = z.object({
  outcome: z.enum(["success", "mixed", "failure", "unknown"]),
  outcomeNotes: z.string().optional(),
});

export type DecisionMemory = typeof decisionMemories.$inferSelect;
export type InsertDecisionMemory = z.infer<typeof insertDecisionMemorySchema>;
export type UpdateDecisionMemory = z.infer<typeof updateDecisionMemorySchema>;
export type CloseDecisionMemory = z.infer<typeof closeDecisionMemorySchema>;

// ----------------------------------------------------------------------------
// AI KNOWLEDGE BASE: Feedback and Learning System (Phase 2)
// ----------------------------------------------------------------------------

export const aiUserActionEnum = pgEnum("ai_user_action", [
  "accepted",
  "edited",
  "rejected",
  "regenerated",
]);

export const aiPatternTypeEnum = pgEnum("ai_pattern_type", [
  "positive",
  "negative",
]);

export const aiTeachingTypeEnum = pgEnum("ai_teaching_type", [
  "good_example",
  "bad_example",
  "instruction",
]);

// Tracks every AI suggestion and user response for learning
export const docAiFeedback = pgTable(
  "doc_ai_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id").references(() => docs.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(), // 'summary', 'keyPoints', 'applicableWhen'

    // What AI produced
    aiSuggestion: text("ai_suggestion").notNull(),
    aiModel: text("ai_model"),
    aiPromptHash: text("ai_prompt_hash"), // Track which prompt version was used

    // What user did
    userAction: aiUserActionEnum("user_action").notNull(),
    userFinal: text("user_final"), // What user actually saved (null if rejected)
    editDistance: integer("edit_distance"), // How much user changed it (0-100%)

    // Context for learning
    docType: text("doc_type"),
    docDomain: text("doc_domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),

    // Timing
    timeToDecide: integer("time_to_decide"), // Seconds user spent reviewing
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_ai_feedback_doc_id").on(table.docId),
    index("idx_doc_ai_feedback_context").on(table.docType, table.docDomain, table.fieldName),
    index("idx_doc_ai_feedback_created_at").on(table.createdAt),
  ]
);

export const insertDocAiFeedbackSchema = createInsertSchema(docAiFeedback).omit({
  id: true,
  createdAt: true,
});
export type DocAiFeedback = typeof docAiFeedback.$inferSelect;
export type InsertDocAiFeedback = z.infer<typeof insertDocAiFeedbackSchema>;

// Gold standard examples for few-shot learning
export const docAiExamples = pgTable(
  "doc_ai_examples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docType: text("doc_type").notNull(),
    docDomain: text("doc_domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),

    // The gold standard
    contentExcerpt: text("content_excerpt").notNull(), // Source content (first 2000 chars)
    fieldName: text("field_name").notNull(), // Which field this is an example for
    goldOutput: text("gold_output").notNull(), // Human-approved output

    // Quality signals
    qualityScore: integer("quality_score"),
    timesUsed: integer("times_used").default(0),
    successRate: real("success_rate"), // When used as example, how often accepted

    // Lifecycle
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    promotedAt: timestamp("promoted_at"),
  },
  (table) => [
    index("idx_doc_ai_examples_lookup").on(table.docType, table.docDomain, table.fieldName, table.isActive),
  ]
);

export const insertDocAiExampleSchema = createInsertSchema(docAiExamples).omit({
  id: true,
  createdAt: true,
  promotedAt: true,
});
export type DocAiExample = typeof docAiExamples.$inferSelect;
export type InsertDocAiExample = z.infer<typeof insertDocAiExampleSchema>;

// Learned patterns from analyzing feedback
export const docAiPatterns = pgTable(
  "doc_ai_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docType: text("doc_type"),
    docDomain: text("doc_domain"),
    fieldName: text("field_name").notNull(),

    patternType: aiPatternTypeEnum("pattern_type").notNull(), // positive or negative
    pattern: text("pattern").notNull(), // The actual pattern description
    confidence: real("confidence"), // How strong is this pattern (0-1)
    sourceCount: integer("source_count"), // How many examples support it

    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_ai_patterns_lookup").on(table.docType, table.docDomain, table.fieldName, table.isActive),
  ]
);

export const insertDocAiPatternSchema = createInsertSchema(docAiPatterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type DocAiPattern = typeof docAiPatterns.$inferSelect;
export type InsertDocAiPattern = z.infer<typeof insertDocAiPatternSchema>;

// Direct user instructions to AI
export const docAiTeachings = pgTable(
  "doc_ai_teachings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docType: text("doc_type"),
    docDomain: text("doc_domain"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    fieldName: text("field_name").notNull(),

    teachingType: aiTeachingTypeEnum("teaching_type").notNull(),
    content: text("content").notNull(), // The teaching content

    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_doc_ai_teachings_lookup").on(table.docType, table.docDomain, table.fieldName, table.isActive),
  ]
);

export const insertDocAiTeachingSchema = createInsertSchema(docAiTeachings).omit({
  id: true,
  createdAt: true,
});
export type DocAiTeaching = typeof docAiTeachings.$inferSelect;
export type InsertDocAiTeaching = z.infer<typeof insertDocAiTeachingSchema>;

// ----------------------------------------------------------------------------
// VENTURE LAB: Idea Research & Validation System
// ----------------------------------------------------------------------------

// Idea status lifecycle: idea → researching → scored → approved/rejected/parked → compiled
export const ventureIdeaStatusEnum = pgEnum('venture_idea_status', [
  'idea',        // Initial capture
  'researching', // AI research in progress
  'researched',  // Research complete, awaiting scoring
  'scoring',     // AI scoring in progress
  'scored',      // Scored, awaiting human decision
  'approved',    // Human approved, ready for compilation
  'rejected',    // Human rejected (killed)
  'parked',      // Human parked for later
  'compiling',   // Compilation in progress
  'compiled',    // Venture created successfully
  'failed'       // Compilation failed
]);

// Verdict based on score thresholds
export const ventureIdeaVerdictEnum = pgEnum('venture_idea_verdict', [
  'GREEN',   // 80-100: Full venture pack
  'YELLOW',  // 70-79: Pilot pack only
  'RED'      // 0-69: Kill/archive
]);

// Venture Ideas: Track business ideas through research → scoring → approval → compilation
export const ventureIdeas = pgTable(
  "venture_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Idea basics
    name: text("name").notNull(),
    description: text("description").notNull(),
    domain: text("domain"), // saas, media, ecommerce, etc.
    targetCustomer: text("target_customer"),
    initialThoughts: text("initial_thoughts"),

    // Status tracking
    status: ventureIdeaStatusEnum("status").default("idea").notNull(),

    // Research results
    researchDocId: uuid("research_doc_id").references(() => docs.id, { onDelete: "set null" }),
    researchCompletedAt: timestamp("research_completed_at"),
    researchModel: text("research_model"), // Which AI model was used
    researchTokensUsed: integer("research_tokens_used"),

    // Scoring results (JSON for flexibility)
    scoreData: jsonb("score_data").$type<{
      rawScore: number;        // 0-100
      confidence: number;      // 0-1
      finalScore: number;      // rawScore × confidence
      breakdown: {
        buyerClarityBudget: { score: number; max: number; reasoning: string };
        painIntensityUrgency: { score: number; max: number; reasoning: string };
        distributionFeasibility: { score: number; max: number; reasoning: string };
        revenueModelRealism: { score: number; max: number; reasoning: string };
        competitiveEdge: { score: number; max: number; reasoning: string };
        executionComplexity: { score: number; max: number; reasoning: string };
        regulatoryFriction: { score: number; max: number; reasoning: string };
        aiLeverage: { score: number; max: number; reasoning: string };
      };
      killReasons: string[];
      nextValidationSteps: string[];
    }>(),
    verdict: ventureIdeaVerdictEnum("verdict"),
    scoredAt: timestamp("scored_at"),
    scoreInputHash: text("score_input_hash"), // Hash of inputs for determinism check

    // Human approval
    approvalDecision: text("approval_decision"), // approved, parked, killed
    approvalComment: text("approval_comment"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),

    // Compilation results
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    compiledAt: timestamp("compiled_at"),
    compilationData: jsonb("compilation_data").$type<{
      projectsCreated: number;
      phasesCreated: number;
      tasksCreated: number;
      model: string;
      tokensUsed: number;
    }>(),

    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_venture_ideas_status").on(table.status),
    index("idx_venture_ideas_verdict").on(table.verdict),
    index("idx_venture_ideas_venture_id").on(table.ventureId),
    index("idx_venture_ideas_research_doc_id").on(table.researchDocId),
    index("idx_venture_ideas_created_at").on(table.createdAt),
  ]
);

export const insertVentureIdeaSchema = createInsertSchema(ventureIdeas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type VentureIdea = typeof ventureIdeas.$inferSelect;
export type InsertVentureIdea = z.infer<typeof insertVentureIdeaSchema>;

// ============================================================================
// MEMORY SYSTEM TABLES
// ============================================================================

// Task queue for deferred processing (cloud agent -> local execution)
export const memoryTaskQueue = pgTable(
  "memory_task_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskType: text("task_type").notNull(), // "heavy_summarize" | "deep_analysis" | "reindex"
    payload: jsonb("payload").notNull(),
    priority: integer("priority").default(5),
    status: text("status").default("queued").notNull(), // "queued" | "running" | "completed" | "failed"
    source: text("source"), // "cloud_agent" | "mobile"
    result: jsonb("result"),
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_memory_task_queue_status").on(table.status),
    index("idx_memory_task_queue_priority").on(table.priority),
    index("idx_memory_task_queue_created_at").on(table.createdAt),
  ]
);

export const insertMemoryTaskSchema = createInsertSchema(memoryTaskQueue).omit({
  id: true,
  createdAt: true,
});
export type MemoryTask = typeof memoryTaskQueue.$inferSelect;
export type InsertMemoryTask = z.infer<typeof insertMemoryTaskSchema>;

// Sync version tracking between local Qdrant and cloud Pinecone
export const memorySyncLedger = pgTable(
  "memory_sync_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(), // "compacted_memory" | "entity" | "decision"
    entityId: text("entity_id").notNull(),
    localVersion: integer("local_version").notNull(),
    cloudVersion: integer("cloud_version").notNull(),
    lastSyncAt: timestamp("last_sync_at"),
    syncDirection: text("sync_direction"), // "up" | "down" | "conflict"
    status: text("status").default("pending_up").notNull(),
  },
  (table) => [
    index("idx_memory_sync_ledger_entity").on(table.entityType, table.entityId),
    index("idx_memory_sync_ledger_status").on(table.status),
  ]
);

export const insertSyncLedgerSchema = createInsertSchema(memorySyncLedger).omit({
  id: true,
});
export type SyncLedgerEntry = typeof memorySyncLedger.$inferSelect;
export type InsertSyncLedgerEntry = z.infer<typeof insertSyncLedgerSchema>;

// ----------------------------------------------------------------------------
// HIERARCHICAL AGENT SYSTEM
// Agent definitions, conversations, task delegation, and memory
// ----------------------------------------------------------------------------

// Agent role enum — determines model tier defaults and hierarchy position
export const agentRoleEnum = pgEnum('agent_role', [
  'executive',   // C-suite: CMO, CTO, COO — gets top-tier models
  'manager',     // Team leads: Head of Products — gets mid-tier models
  'specialist',  // Domain experts: SEO, Growth — gets fast models
  'worker',      // Execution-focused: content writer — gets fast models
]);

// Agent task status enum
export const agentTaskStatusEnum = pgEnum('agent_task_status', [
  'pending',
  'in_progress',
  'delegated',
  'completed',
  'failed',
  'needs_review',
]);

// Agent memory type enum
export const agentMemoryTypeEnum = pgEnum('agent_memory_type', [
  'learning',
  'preference',
  'context',
  'relationship',
  'decision',
]);

// Agents — hierarchical AI agent definitions (loaded from soul templates or created via UI)
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    role: agentRoleEnum("role").notNull(),
    parentId: uuid("parent_id").references((): any => agents.id, { onDelete: "set null" }),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),

    // Soul — the agent's full identity (markdown definition)
    soul: text("soul").notNull(),

    // Parsed from soul frontmatter (denormalized for queries)
    expertise: jsonb("expertise").$type<string[]>().default([]),
    availableTools: jsonb("available_tools").$type<string[]>().default([]),
    actionPermissions: jsonb("action_permissions").$type<string[]>().default(['read']),
    canDelegateTo: jsonb("can_delegate_to").$type<string[]>().default([]),
    maxDelegationDepth: integer("max_delegation_depth").default(2),

    // Model configuration
    preferredModel: text("preferred_model"),
    modelTier: text("model_tier").$type<'auto' | 'top' | 'mid' | 'fast'>().default('auto'),
    temperature: real("temperature").default(0.7),
    maxTokens: integer("max_tokens").default(4096),

    // Memory
    memoryScope: text("memory_scope").$type<'isolated' | 'shared' | 'inherit_parent'>().default('isolated'),
    maxContextTokens: integer("max_context_tokens").default(8000),

    // Schedule (cron-based proactive execution)
    schedule: jsonb("schedule").$type<Record<string, string>>(),

    // Status
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agents_slug").on(table.slug),
    index("idx_agents_role").on(table.role),
    index("idx_agents_parent_id").on(table.parentId),
    index("idx_agents_venture_id").on(table.ventureId),
    index("idx_agents_is_active").on(table.isActive),
  ]
);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  parent: one(agents, { fields: [agents.parentId], references: [agents.id], relationName: "agentHierarchy" }),
  children: many(agents, { relationName: "agentHierarchy" }),
  venture: one(ventures, { fields: [agents.ventureId], references: [ventures.id] }),
  conversations: many(agentConversations),
  assignedTasks: many(agentTasks, { relationName: "assignedTo" }),
  delegatedTasks: many(agentTasks, { relationName: "assignedBy" }),
  memories: many(agentMemory),
}));

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = z.infer<typeof insertAgentSchema>;

// Agent Conversations — per-agent chat history with delegation threading
export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }).notNull(),
    role: text("role").$type<'user' | 'assistant' | 'system' | 'delegation'>().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<{
      model?: string;
      tokensUsed?: number;
      toolCalls?: any[];
      toolResults?: any[];
      delegationContext?: Record<string, unknown>;
      [key: string]: any;
    }>(),
    parentMessageId: uuid("parent_message_id"),
    delegationFrom: uuid("delegation_from").references(() => agents.id, { onDelete: "set null" }),
    delegationTaskId: uuid("delegation_task_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_conversations_agent_id").on(table.agentId),
    index("idx_agent_conversations_delegation_from").on(table.delegationFrom),
    index("idx_agent_conversations_created_at").on(table.createdAt),
  ]
);

export const agentConversationsRelations = relations(agentConversations, ({ one }) => ({
  agent: one(agents, { fields: [agentConversations.agentId], references: [agents.id] }),
  delegatingAgent: one(agents, { fields: [agentConversations.delegationFrom], references: [agents.id] }),
}));

export const insertAgentConversationSchema = createInsertSchema(agentConversations).omit({
  id: true,
  createdAt: true,
});

export type AgentConversation = typeof agentConversations.$inferSelect;
export type InsertAgentConversation = z.infer<typeof insertAgentConversationSchema>;

// Agent Tasks — inter-agent task delegation with privilege attenuation
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),

    // Assignment
    assignedBy: text("assigned_by").notNull(), // agent UUID or 'user' for direct assignment
    assignedTo: uuid("assigned_to").references(() => agents.id, { onDelete: "cascade" }).notNull(),

    // Delegation chain
    delegationChain: jsonb("delegation_chain").$type<string[]>().default([]),
    depth: integer("depth").default(0),

    // Execution
    status: agentTaskStatusEnum("status").default("pending").notNull(),
    priority: integer("priority").default(5),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),

    // Permissions passed down (privilege attenuation)
    grantedPermissions: jsonb("granted_permissions").$type<string[]>().default([]),
    grantedTools: jsonb("granted_tools").$type<string[]>().default([]),

    // Timing
    deadline: timestamp("deadline"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_tasks_assigned_by").on(table.assignedBy),
    index("idx_agent_tasks_assigned_to").on(table.assignedTo),
    index("idx_agent_tasks_status").on(table.status),
    index("idx_agent_tasks_priority").on(table.priority),
    index("idx_agent_tasks_created_at").on(table.createdAt),
  ]
);

export const agentTasksRelations = relations(agentTasks, ({ one }) => ({
  assignee: one(agents, { fields: [agentTasks.assignedTo], references: [agents.id], relationName: "assignedTo" }),
}));

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({
  id: true,
  createdAt: true,
});

export type AgentTask = typeof agentTasks.$inferSelect;
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;

// Agent Memory — per-agent persistent memory with learning pipeline support
export const agentMemory = pgTable(
  "agent_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }).notNull(),
    memoryType: agentMemoryTypeEnum("memory_type").notNull(),
    content: text("content").notNull(),
    importance: real("importance").default(0.5),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),

    // Learning pipeline columns
    scope: text("scope").$type<"agent" | "shared" | "venture">().default("agent"),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "set null" }),
    tags: jsonb("tags").$type<string[]>().default([]),
    embedding: text("embedding"), // JSON-serialized float[] for semantic search
    embeddingModel: text("embedding_model"),
    sourceConversationId: uuid("source_conversation_id"),
    lastAccessedAt: timestamp("last_accessed_at"),
    accessCount: integer("access_count").default(0),
  },
  (table) => [
    index("idx_agent_memory_agent_id").on(table.agentId),
    index("idx_agent_memory_type").on(table.memoryType),
    index("idx_agent_memory_importance").on(table.importance),
    index("idx_agent_memory_scope").on(table.scope),
    index("idx_agent_memory_venture_id").on(table.ventureId),
  ]
);

export const agentMemoryRelations = relations(agentMemory, ({ one }) => ({
  agent: one(agents, { fields: [agentMemory.agentId], references: [agents.id] }),
}));

export const insertAgentMemorySchema = createInsertSchema(agentMemory).omit({
  id: true,
  createdAt: true,
});

export type AgentMemoryEntry = typeof agentMemory.$inferSelect;
export type InsertAgentMemoryEntry = z.infer<typeof insertAgentMemorySchema>;

// ============================================================================
// SESSION LOGS — cross-session continuity for Claude Code and other clients
// ============================================================================

export const sessionSourceEnum = pgEnum('session_source', [
  'claude-code',
  'telegram',
  'web',
]);

export const sessionLogs = pgTable(
  "session_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: sessionSourceEnum("source").notNull(),
    summary: text("summary").notNull(),
    keyTopics: jsonb("key_topics").$type<string[]>().default([]),
    decisions: jsonb("decisions").$type<string[]>().default([]),
    openThreads: jsonb("open_threads").$type<string[]>().default([]),
    filesModified: jsonb("files_modified").$type<string[]>().default([]),
    tags: jsonb("tags").$type<string[]>().default([]),
    embedding: text("embedding"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_session_logs_source").on(table.source),
    index("idx_session_logs_created_at").on(table.createdAt),
  ]
);

export const insertSessionLogSchema = createInsertSchema(sessionLogs).omit({
  id: true,
  createdAt: true,
});

export type SessionLog = typeof sessionLogs.$inferSelect;
export type InsertSessionLog = z.infer<typeof insertSessionLogSchema>;

// ============================================================================
// ENTITY RELATIONS — lightweight knowledge graph in PostgreSQL
// ============================================================================

export const entityRelationTypeEnum = pgEnum('entity_relation_type', [
  'works_at',
  'works_on',
  'collaborates_with',
  'part_of',
  'related_to',
  'depends_on',
  'owns',
  'mentions',
  'influenced_by',
]);

export const entityRelations = pgTable(
  "entity_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceEntityId: uuid("source_entity_id"),
    sourceName: text("source_name").notNull(),
    sourceType: text("source_type"),
    targetEntityId: uuid("target_entity_id"),
    targetName: text("target_name").notNull(),
    targetType: text("target_type"),
    relationType: entityRelationTypeEnum("relation_type").notNull(),
    strength: real("strength").default(0.5),
    context: text("context"),
    mentionCount: integer("mention_count").default(1),
    firstSeen: timestamp("first_seen").defaultNow().notNull(),
    lastSeen: timestamp("last_seen").defaultNow().notNull(),
  },
  (table) => [
    index("idx_entity_relations_source").on(table.sourceName),
    index("idx_entity_relations_target").on(table.targetName),
    index("idx_entity_relations_type").on(table.relationType),
    index("idx_entity_relations_source_entity").on(table.sourceEntityId),
    index("idx_entity_relations_target_entity").on(table.targetEntityId),
  ]
);

export const insertEntityRelationSchema = createInsertSchema(entityRelations).omit({
  id: true,
  firstSeen: true,
  lastSeen: true,
});

export type EntityRelation = typeof entityRelations.$inferSelect;
export type InsertEntityRelation = z.infer<typeof insertEntityRelationSchema>;
