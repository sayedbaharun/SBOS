import {
  type Venture,
  type InsertVenture,
  type Project,
  type InsertProject,
  type Phase,
  type InsertPhase,
  type Task,
  type InsertTask,
  type CaptureItem,
  type InsertCaptureItem,
  type Day,
  type InsertDay,
  type Week,
  type InsertWeek,
  type HealthEntry,
  type InsertHealthEntry,
  type BloodworkEntry,
  type InsertBloodworkEntry,
  type NutritionEntry,
  type InsertNutritionEntry,
  type Doc,
  type InsertDoc,
  type Attachment,
  type InsertAttachment,
  type User,
  type UpsertUser,
  type UserPreferences,
  type InsertUserPreferences,
  type CustomCategory,
  type InsertCustomCategory,
  type ShoppingItem,
  type InsertShoppingItem,
  type Book,
  type InsertBook,
  type AiAgentPrompt,
  type InsertAiAgentPrompt,
  type ChatMessage,
  type InsertChatMessage,
  type CooChatSession,
  type InsertCooChatSession,
  type VentureConversation,
  type InsertVentureConversation,
  type VentureContextCache,
  type InsertVentureContextCache,
  type VentureAgentAction,
  type InsertVentureAgentAction,
  type TradingStrategy,
  type InsertTradingStrategy,
  type DailyTradingChecklist,
  type InsertDailyTradingChecklist,
  type FinancialAccount,
  type InsertFinancialAccount,
  type AccountSnapshot,
  type InsertAccountSnapshot,
  type NetWorthSnapshot,
  type InsertNetWorthSnapshot,
  type Person,
  type InsertPerson,
  type TradingChatSession,
  type InsertTradingChatSession,
  type TradingConversation,
  type InsertTradingConversation,
  type TradingAgentConfig,
  type InsertTradingAgentConfig,
  type TradingKnowledgeDoc,
  type InsertTradingKnowledgeDoc,
  type VentureScenario,
  type InsertVentureScenario,
  type ScenarioIndicator,
  type InsertScenarioIndicator,
  type TrendSignal,
  type InsertTrendSignal,
  type StrategicAnalysis,
  type InsertStrategicAnalysis,
  type WhatIfQuestion,
  type InsertWhatIfQuestion,
  type ForesightConversation,
  type InsertForesightConversation,
  type FearSetting,
  type InsertFearSetting,
  type DecisionMemory,
  type InsertDecisionMemory,
  type UpdateDecisionMemory,
  type CloseDecisionMemory,
  type DecisionDerivedMetadata,
  type DocAiFeedback,
  type InsertDocAiFeedback,
  type DocAiExample,
  type InsertDocAiExample,
  type DocAiPattern,
  type InsertDocAiPattern,
  type DocAiTeaching,
  type InsertDocAiTeaching,
  type VentureIdea,
  type InsertVentureIdea,
  type DocChunk,
  type InsertDocChunk,
  type KnowledgeFile,
  type InsertKnowledgeFile,
  ventures,
  projects,
  phases,
  tasks,
  captureItems,
  days,
  weeks,
  healthEntries,
  bloodworkEntries,
  nutritionEntries,
  docs,
  docChunks,
  attachments,
  users,
  userPreferences,
  customCategories,
  shoppingItems,
  books,
  aiAgentPrompts,
  chatMessages,
  cooChatSessions,
  ventureConversations,
  ventureContextCache,
  ventureAgentActions,
  tradingStrategies,
  dailyTradingChecklists,
  financialAccounts,
  accountSnapshots,
  netWorthSnapshots,
  people,
  tradingChatSessions,
  tradingConversations,
  tradingAgentConfig,
  tradingKnowledgeDocs,
  ventureScenarios,
  scenarioIndicators,
  trendSignals,
  strategicAnalyses,
  whatIfQuestions,
  foresightConversations,
  fearSettings,
  decisionMemories,
  docAiFeedback,
  docAiExamples,
  docAiPatterns,
  docAiTeachings,
  ventureIdeas,
  knowledgeFiles,
  auditLogs,
  type AuditLog,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { eq, desc, and, or, gte, lte, not, inArray, like, sql, asc, isNull } from "drizzle-orm";
import { db as database } from "../db";
import { calculateDocQuality } from "./doc-quality";

/**
 * Escape special SQL LIKE wildcard characters to prevent wildcard injection.
 * In PostgreSQL/SQL, the LIKE operator treats % and _ as wildcards:
 * - % matches zero or more characters
 * - _ matches exactly one character
 *
 * This function escapes these characters so they are treated literally,
 * preventing users from crafting queries that bypass intended search behavior.
 *
 * @param input - The user-provided search string
 * @returns The escaped string safe for use in LIKE patterns
 */
export function escapeLikeWildcards(input: string): string {
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/%/g, '\\%')    // Escape % wildcard
    .replace(/_/g, '\\_');   // Escape _ wildcard
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Audit logs
  getRecentAuditLogs(userId: string, limit?: number): Promise<AuditLog[]>;

  // Ventures
  getVentures(): Promise<Venture[]>;
  getVenture(id: string): Promise<Venture | undefined>;
  getVentureBySlug(slug: string): Promise<Venture | undefined>;
  getVentureByIdOrSlug(idOrSlug: string): Promise<Venture | undefined>;
  createVenture(data: InsertVenture): Promise<Venture>;
  updateVenture(id: string, data: Partial<InsertVenture>): Promise<Venture | undefined>;
  deleteVenture(id: string): Promise<void>;

  // Projects
  getProjects(filters?: { ventureId?: string; limit?: number; offset?: number }): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  // Phases
  getPhases(filters?: { projectId?: string }): Promise<Phase[]>;
  getPhase(id: string): Promise<Phase | undefined>;
  createPhase(data: InsertPhase): Promise<Phase>;
  updatePhase(id: string, data: Partial<InsertPhase>): Promise<Phase | undefined>;
  deletePhase(id: string): Promise<void>;

  // Tasks
  getTasks(filters?: {
    ventureId?: string;
    projectId?: string;
    status?: string;
    focusDate?: string;
    focusDateGte?: string;
    focusDateLte?: string;
    dueDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<Task[]>;
  getTasksForToday(date: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(data: InsertTask): Promise<Task>;
  updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;

  // Dashboard-optimized queries
  getActiveTaskCountsByVenture(): Promise<Map<string, { total: number; overdueP0: number; dueTodayP0P1: number }>>;
  getUrgentTasks(today: string, limit?: number): Promise<Task[]>;
  getTopPriorityTasks(today: string, limit?: number): Promise<Task[]>;
  getActiveTasksCount(projectId?: string): Promise<number>;

  // Capture Items
  getCaptures(filters?: { clarified?: boolean; ventureId?: string; limit?: number; offset?: number }): Promise<CaptureItem[]>;
  getCapture(id: string): Promise<CaptureItem | undefined>;
  createCapture(data: InsertCaptureItem): Promise<CaptureItem>;
  updateCapture(id: string, data: Partial<InsertCaptureItem>): Promise<CaptureItem | undefined>;
  convertCaptureToTask(captureId: string, taskData: InsertTask): Promise<{ task: Task; capture: CaptureItem }>;
  deleteCapture(id: string): Promise<void>;

  // Days
  getDays(filters?: { dateGte?: string; dateLte?: string }): Promise<Day[]>;
  getDay(date: string): Promise<Day | undefined>;
  getDayOrCreate(date: string): Promise<Day>;
  createDay(data: InsertDay): Promise<Day>;
  updateDay(date: string, data: Partial<InsertDay>): Promise<Day | undefined>;
  deleteDay(date: string): Promise<void>;

  // Weeks
  getWeeks(filters?: { year?: number }): Promise<Week[]>;
  getWeek(id: string): Promise<Week | undefined>;
  getWeekByDate(date: string): Promise<Week | undefined>;
  getCurrentWeek(): Promise<Week | undefined>;
  getWeekOrCreate(year: number, weekNumber: number): Promise<Week>;
  createWeek(data: InsertWeek): Promise<Week>;
  updateWeek(id: string, data: Partial<InsertWeek>): Promise<Week | undefined>;

  // Health Entries
  getHealthEntries(filters?: { dateGte?: string; dateLte?: string }): Promise<HealthEntry[]>;
  getHealthEntry(id: string): Promise<HealthEntry | undefined>;
  createHealthEntry(data: InsertHealthEntry): Promise<HealthEntry>;
  updateHealthEntry(id: string, data: Partial<InsertHealthEntry>): Promise<HealthEntry | undefined>;

  // Bloodwork Entries
  getBloodworkEntries(filters?: { dateGte?: string; dateLte?: string }): Promise<BloodworkEntry[]>;
  getBloodworkEntry(id: string): Promise<BloodworkEntry | undefined>;
  createBloodworkEntry(data: InsertBloodworkEntry): Promise<BloodworkEntry>;
  updateBloodworkEntry(id: string, data: Partial<InsertBloodworkEntry>): Promise<BloodworkEntry | undefined>;
  deleteBloodworkEntry(id: string): Promise<void>;

  // Nutrition Entries
  getNutritionEntries(filters?: { dayId?: string; date?: string }): Promise<NutritionEntry[]>;
  getNutritionEntry(id: string): Promise<NutritionEntry | undefined>;
  createNutritionEntry(data: InsertNutritionEntry): Promise<NutritionEntry>;
  updateNutritionEntry(id: string, data: Partial<InsertNutritionEntry>): Promise<NutritionEntry | undefined>;
  deleteNutritionEntry(id: string): Promise<void>;

  // Docs
  getDocs(filters?: {
    ventureId?: string;
    projectId?: string;
    type?: string;
    domain?: string;
    status?: string;
    parentId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<Doc[]>;
  getDoc(id: string): Promise<Doc | undefined>;
  getDocChildren(parentId: string | null, ventureId?: string): Promise<Doc[]>;
  getDocTree(ventureId: string): Promise<Doc[]>;
  createDoc(data: InsertDoc): Promise<Doc>;
  updateDoc(id: string, data: Partial<InsertDoc>): Promise<Doc | undefined>;
  deleteDoc(id: string): Promise<void>;
  deleteDocRecursive(id: string): Promise<void>;
  reorderDocs(docIds: string[], parentId: string | null): Promise<void>;
  searchDocs(query: string): Promise<Doc[]>;
  updateDocQualityScore(docId: string): Promise<{ qualityScore: number; aiReady: boolean }>;
  markDocReviewed(docId: string): Promise<void>;
  getDocsNeedingReview(limit?: number): Promise<Doc[]>;
  getDocQualityMetrics(): Promise<{
    totalDocs: number;
    aiReadyDocs: number;
    aiReadyPercent: number;
    averageScore: number;
    needsReview: number;
  }>;

  // Doc Chunks (for RAG embeddings)
  createDocChunk(data: InsertDocChunk): Promise<DocChunk>;
  getDocChunks(docId: string): Promise<DocChunk[]>;
  getDocChunksWithEmbeddings(ventureId?: string): Promise<(DocChunk & { docTitle?: string })[]>;
  updateDocChunkEmbedding(id: string, embedding: string): Promise<void>;
  deleteDocChunks(docId: string): Promise<void>;
  getDocsNeedingEmbedding(limit?: number): Promise<Doc[]>;
  updateDocEmbedding(docId: string, embedding: string, model: string): Promise<void>;

  // Attachments
  getAttachments(docId: string): Promise<Attachment[]>;
  getAttachment(id: string): Promise<Attachment | undefined>;
  createAttachment(data: InsertAttachment): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;

  // User Preferences
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(userId: string, data: Partial<InsertUserPreferences>): Promise<UserPreferences>;

  // Custom Categories
  getCategories(filters?: { type?: string; enabled?: boolean }): Promise<CustomCategory[]>;
  getCategory(id: string): Promise<CustomCategory | undefined>;
  createCategory(data: InsertCustomCategory): Promise<CustomCategory>;
  updateCategory(id: string, data: Partial<InsertCustomCategory>): Promise<CustomCategory | undefined>;
  deleteCategory(id: string): Promise<void>;

  // Shopping Items
  getShoppingItems(filters?: { status?: string; priority?: string; category?: string }): Promise<ShoppingItem[]>;
  getShoppingItem(id: string): Promise<ShoppingItem | undefined>;
  createShoppingItem(data: InsertShoppingItem): Promise<ShoppingItem>;
  updateShoppingItem(id: string, data: Partial<InsertShoppingItem>): Promise<ShoppingItem | undefined>;
  deleteShoppingItem(id: string): Promise<void>;

  // Books
  getBooks(filters?: { status?: string }): Promise<Book[]>;
  getBook(id: string): Promise<Book | undefined>;
  createBook(data: InsertBook): Promise<Book>;
  updateBook(id: string, data: Partial<InsertBook>): Promise<Book | undefined>;
  deleteBook(id: string): Promise<void>;

  // Financial Accounts
  getFinancialAccounts(filters?: { type?: string; isActive?: boolean; isAsset?: boolean }): Promise<FinancialAccount[]>;
  getFinancialAccount(id: string): Promise<FinancialAccount | undefined>;
  createFinancialAccount(data: InsertFinancialAccount): Promise<FinancialAccount>;
  updateFinancialAccount(id: string, data: Partial<InsertFinancialAccount>): Promise<FinancialAccount | undefined>;
  deleteFinancialAccount(id: string): Promise<void>;
  updateAccountBalance(accountId: string, balance: number, note?: string): Promise<FinancialAccount>;

  // Account Snapshots
  getAccountSnapshots(accountId: string, limit?: number): Promise<AccountSnapshot[]>;
  createAccountSnapshot(data: InsertAccountSnapshot): Promise<AccountSnapshot>;

  // Net Worth
  getNetWorth(): Promise<{ totalAssets: number; totalLiabilities: number; netWorth: number; byType: Record<string, number> }>;
  getNetWorthSnapshots(userId: string, limit?: number): Promise<NetWorthSnapshot[]>;
  createNetWorthSnapshot(userId: string): Promise<NetWorthSnapshot>;

  // People / Relationships CRM
  getPeople(filters?: {
    relationship?: string;
    importance?: string;
    ventureId?: string;
    needsEnrichment?: boolean;
  }): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  getPersonByGoogleId(googleContactId: string): Promise<Person | undefined>;
  getPersonByExternalId(externalContactId: string): Promise<Person | undefined>;
  getPersonByEmail(email: string): Promise<Person | undefined>;
  createPerson(data: InsertPerson): Promise<Person>;
  updatePerson(id: string, data: Partial<InsertPerson>): Promise<Person | undefined>;
  deletePerson(id: string): Promise<void>;
  getStalePeople(today: string): Promise<Person[]>;
  getUpcomingFollowUps(today: string, days?: number): Promise<Person[]>;
  logContact(id: string, date: string): Promise<Person | undefined>;

  // Schema Management
  ensureSchema(): Promise<void>;

  // Health Check
  ping(): Promise<boolean>;

  // Strategic Foresight - Scenarios
  getVentureScenarios(ventureId: string, filters?: { status?: string; quadrant?: string; timeHorizon?: string }): Promise<VentureScenario[]>;
  getVentureScenario(id: string): Promise<VentureScenario | undefined>;
  createVentureScenario(data: InsertVentureScenario): Promise<VentureScenario>;
  updateVentureScenario(id: string, data: Partial<InsertVentureScenario>): Promise<VentureScenario | undefined>;
  deleteVentureScenario(id: string): Promise<void>;

  // Strategic Foresight - Indicators
  getScenarioIndicators(filters: { ventureId?: string; scenarioId?: string; status?: string; category?: string }): Promise<ScenarioIndicator[]>;
  getScenarioIndicator(id: string): Promise<ScenarioIndicator | undefined>;
  createScenarioIndicator(data: InsertScenarioIndicator): Promise<ScenarioIndicator>;
  updateScenarioIndicator(id: string, data: Partial<InsertScenarioIndicator>): Promise<ScenarioIndicator | undefined>;
  deleteScenarioIndicator(id: string): Promise<void>;

  // Strategic Foresight - Trend Signals
  getTrendSignals(ventureId: string, filters?: { status?: string; category?: string; strength?: string }): Promise<TrendSignal[]>;
  getTrendSignal(id: string): Promise<TrendSignal | undefined>;
  createTrendSignal(data: InsertTrendSignal): Promise<TrendSignal>;
  updateTrendSignal(id: string, data: Partial<InsertTrendSignal>): Promise<TrendSignal | undefined>;
  deleteTrendSignal(id: string): Promise<void>;

  // Strategic Foresight - Analyses
  getStrategicAnalyses(ventureId: string, filters?: { framework?: string; status?: string }): Promise<StrategicAnalysis[]>;
  getStrategicAnalysis(id: string): Promise<StrategicAnalysis | undefined>;
  createStrategicAnalysis(data: InsertStrategicAnalysis): Promise<StrategicAnalysis>;
  updateStrategicAnalysis(id: string, data: Partial<InsertStrategicAnalysis>): Promise<StrategicAnalysis | undefined>;
  deleteStrategicAnalysis(id: string): Promise<void>;

  // Strategic Foresight - What-If Questions
  getWhatIfQuestions(ventureId: string, filters?: { category?: string; explored?: boolean }): Promise<WhatIfQuestion[]>;
  getWhatIfQuestion(id: string): Promise<WhatIfQuestion | undefined>;
  createWhatIfQuestion(data: InsertWhatIfQuestion): Promise<WhatIfQuestion>;
  updateWhatIfQuestion(id: string, data: Partial<InsertWhatIfQuestion>): Promise<WhatIfQuestion | undefined>;
  deleteWhatIfQuestion(id: string): Promise<void>;

  // Strategic Foresight - Conversations
  getForesightConversations(ventureId: string, limit?: number): Promise<ForesightConversation[]>;
  createForesightConversation(data: InsertForesightConversation): Promise<ForesightConversation>;
  clearForesightConversations(ventureId: string): Promise<void>;

  // Strategic Foresight - Dashboard Summary
  getForesightSummary(ventureId: string): Promise<{
    scenarioCount: number;
    scenariosByQuadrant: Record<string, number>;
    indicatorsByStatus: { green: number; yellow: number; red: number };
    recentSignals: TrendSignal[];
    unexploredQuestions: number;
  }>;

  // Decision Memories
  getDecisionMemories(filters?: {
    tags?: string[];
    archetype?: string;
    closed?: boolean; // true = has outcomeRecordedAt, false = no outcomeRecordedAt
    limit?: number;
    offset?: number;
  }): Promise<DecisionMemory[]>;
  getDecisionMemory(id: string): Promise<DecisionMemory | undefined>;
  createDecisionMemory(data: InsertDecisionMemory): Promise<DecisionMemory>;
  updateDecisionMemory(id: string, data: UpdateDecisionMemory): Promise<DecisionMemory | undefined>;
  closeDecisionMemory(id: string, data: CloseDecisionMemory): Promise<DecisionMemory | undefined>;
  deleteDecisionMemory(id: string): Promise<void>;
  getDueDecisions(asOfDate?: Date): Promise<DecisionMemory[]>;
  getEarlyCheckDecisions(asOfDate?: Date): Promise<DecisionMemory[]>;
  retrieveDecisionsForAI(query: string, tags?: string[], limit?: number): Promise<DecisionMemory[]>;
  exportDecisionMemories(): Promise<DecisionMemory[]>;

  // Doc AI Feedback & Learning
  createDocAiFeedback(data: InsertDocAiFeedback): Promise<DocAiFeedback>;
  getDocAiFeedback(opts: { docId?: string; limit?: number }): Promise<DocAiFeedback[]>;
  createDocAiExample(data: InsertDocAiExample): Promise<DocAiExample>;
  getDocAiExamples(opts: {
    fieldName: string;
    docType: string;
    docDomain?: string;
    limit?: number;
  }): Promise<DocAiExample[]>;
  updateDocAiExampleUsage(id: string): Promise<void>;
  createDocAiPattern(data: InsertDocAiPattern): Promise<DocAiPattern>;
  getDocAiPatterns(opts: {
    fieldName: string;
    docType?: string;
    docDomain?: string;
  }): Promise<DocAiPattern[]>;
  createDocAiTeaching(data: InsertDocAiTeaching): Promise<DocAiTeaching>;
  getDocAiTeachings(opts: {
    fieldName: string;
    docType?: string;
    docDomain?: string;
    ventureId?: string;
  }): Promise<DocAiTeaching[]>;
  getDocAiMetrics(days: number): Promise<{
    totalSuggestions: number;
    acceptanceRate: number;
    examplesCount: number;
    teachingsCount: number;
  }>;
}

// PostgreSQL Storage Implementation
/**
 * Generate a URL-friendly slug from a name
 * e.g., "MyDub.ai" -> "mydub-ai", "2026 Arc" -> "2026-arc"
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-')          // Replace spaces with hyphens
    .replace(/-+/g, '-')           // Collapse multiple hyphens
    .replace(/^-|-$/g, '')         // Trim leading/trailing hyphens
    .substring(0, 100);            // Limit length
}

/**
 * Check if a string looks like a UUID
 */
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export class DBStorage implements IStorage {
  private db = database;

  constructor() {
    // Using shared database connection from db/index.ts
  }

  // ============================================================================
  // SCHEMA MANAGEMENT
  // ============================================================================

  async ensureSchema(): Promise<void> {
    try {
      // Check if password_hash column exists in users table
      const result = await this.db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
      `);

      if (result.rows.length === 0) {
        console.log("🔧 Auto-Migration: Adding missing password_hash column to users table...");
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" varchar`);
        console.log("✅ Auto-Migration: Successfully added password_hash column");
      }

      // Add security columns for 2FA and session tracking
      console.log("🔧 Auto-Migration: Ensuring security columns exist...");
      await this.db.execute(sql`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "totp_secret" varchar,
        ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb,
        ADD COLUMN IF NOT EXISTS "totp_recovery_key_hash" varchar,
        ADD COLUMN IF NOT EXISTS "last_known_ip" varchar(45),
        ADD COLUMN IF NOT EXISTS "last_known_user_agent" text,
        ADD COLUMN IF NOT EXISTS "trusted_devices" jsonb,
        ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp
      `);
      console.log("✅ Auto-Migration: Security columns ensured");

      // Add user profile columns (date/time format preferences)
      console.log("🔧 Auto-Migration: Ensuring user profile columns exist...");
      await this.db.execute(sql`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "date_format" varchar DEFAULT 'yyyy-MM-dd',
        ADD COLUMN IF NOT EXISTS "time_format" varchar DEFAULT '24h',
        ADD COLUMN IF NOT EXISTS "week_starts_on" integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "last_login_at" timestamp,
        ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "locked_until" timestamp
      `);
      console.log("✅ Auto-Migration: User profile columns ensured");

      // Check and create trading_strategies table
      const tradingStrategiesExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'trading_strategies'
      `);

      if (tradingStrategiesExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating trading_strategies table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "trading_strategies" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL,
            "description" text,
            "instruments" jsonb DEFAULT '[]',
            "is_active" boolean DEFAULT true,
            "is_default" boolean DEFAULT false,
            "config" jsonb NOT NULL,
            "notes" text,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_trading_strategies_is_active" ON "trading_strategies" ("is_active")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_trading_strategies_is_default" ON "trading_strategies" ("is_default")`);
        console.log("✅ Auto-Migration: Created trading_strategies table");
      }

      // Check and create daily_trading_checklists table
      const dailyChecklistsExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'daily_trading_checklists'
      `);

      if (dailyChecklistsExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating daily_trading_checklists table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "daily_trading_checklists" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "day_id" text NOT NULL REFERENCES "days"("id") ON DELETE CASCADE,
            "date" date NOT NULL,
            "strategy_id" uuid REFERENCES "trading_strategies"("id") ON DELETE SET NULL,
            "data" jsonb NOT NULL,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_daily_trading_checklists_day_id" ON "daily_trading_checklists" ("day_id")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_daily_trading_checklists_date" ON "daily_trading_checklists" ("date")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_daily_trading_checklists_strategy_id" ON "daily_trading_checklists" ("strategy_id")`);
        console.log("✅ Auto-Migration: Created daily_trading_checklists table");
      }

      // Check and create trading_conversations table
      const tradingConversationsExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'trading_conversations'
      `);

      if (tradingConversationsExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating trading_conversations table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "trading_conversations" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
            "role" text NOT NULL,
            "content" text NOT NULL,
            "metadata" jsonb,
            "created_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_trading_conversations_user_id" ON "trading_conversations" ("user_id")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_trading_conversations_created_at" ON "trading_conversations" ("created_at")`);
        console.log("✅ Auto-Migration: Created trading_conversations table");
      }

      // Check and create trading_agent_config table
      const tradingAgentConfigExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'trading_agent_config'
      `);

      if (tradingAgentConfigExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating trading_agent_config table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "trading_agent_config" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
            "system_prompt" text,
            "trading_style" text,
            "instruments" text,
            "timeframes" text,
            "risk_rules" text,
            "trading_hours" text,
            "quick_actions" jsonb DEFAULT '[]',
            "preferred_model" text,
            "focus_areas" jsonb DEFAULT '[]',
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_trading_agent_config_user_id" ON "trading_agent_config" ("user_id")`);
        console.log("✅ Auto-Migration: Created trading_agent_config table");
      }

      // Check and create financial_account_type enum
      const finAccountTypeEnumExists = await this.db.execute(sql`
        SELECT 1 FROM pg_type WHERE typname = 'financial_account_type'
      `);

      if (finAccountTypeEnumExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating financial_account_type enum...");
        await this.db.execute(sql`
          CREATE TYPE "financial_account_type" AS ENUM (
            'checking', 'savings', 'investment', 'retirement', 'crypto',
            'property', 'vehicle', 'jewelry', 'collectible', 'other_asset',
            'credit_card', 'loan', 'mortgage', 'other_debt'
          )
        `);
        console.log("✅ Auto-Migration: Created financial_account_type enum");
      }

      // Check and create financial_accounts table
      const financialAccountsExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'financial_accounts'
      `);

      if (financialAccountsExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating financial_accounts table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "financial_accounts" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL,
            "type" "financial_account_type" NOT NULL,
            "institution" text,
            "current_balance" real DEFAULT 0 NOT NULL,
            "currency" varchar(3) DEFAULT 'USD' NOT NULL,
            "is_asset" boolean DEFAULT true NOT NULL,
            "is_active" boolean DEFAULT true NOT NULL,
            "icon" varchar(10),
            "color" varchar(7),
            "notes" text,
            "metadata" jsonb,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_financial_accounts_type" ON "financial_accounts" ("type")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_financial_accounts_is_asset" ON "financial_accounts" ("is_asset")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_financial_accounts_is_active" ON "financial_accounts" ("is_active")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_financial_accounts_created_at" ON "financial_accounts" ("created_at")`);
        console.log("✅ Auto-Migration: Created financial_accounts table");
      }

      // Check and create account_snapshots table
      const accountSnapshotsExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'account_snapshots'
      `);

      if (accountSnapshotsExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating account_snapshots table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "account_snapshots" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "account_id" uuid NOT NULL REFERENCES "financial_accounts"("id") ON DELETE CASCADE,
            "balance" real NOT NULL,
            "note" text,
            "created_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_account_snapshots_account_id" ON "account_snapshots" ("account_id")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_account_snapshots_created_at" ON "account_snapshots" ("created_at")`);
        console.log("✅ Auto-Migration: Created account_snapshots table");
      }

      // Check and create net_worth_snapshots table
      const netWorthSnapshotsExists = await this.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'net_worth_snapshots'
      `);

      if (netWorthSnapshotsExists.rows.length === 0) {
        console.log("🔧 Auto-Migration: Creating net_worth_snapshots table...");
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "net_worth_snapshots" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "date" date NOT NULL UNIQUE,
            "total_assets" real NOT NULL,
            "total_liabilities" real NOT NULL,
            "net_worth" real NOT NULL,
            "breakdown" jsonb,
            "created_at" timestamp DEFAULT now() NOT NULL
          )
        `);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_net_worth_snapshots_date" ON "net_worth_snapshots" ("date")`);
        await this.db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_net_worth_snapshots_created_at" ON "net_worth_snapshots" ("created_at")`);
        console.log("✅ Auto-Migration: Created net_worth_snapshots table");
      }
      // One-time: migrate morning rituals reading → water (clears test data)
      const hasOldRituals = await this.db.execute(sql`
        SELECT 1 FROM "days"
        WHERE "morning_rituals"::text LIKE '%reading%'
        LIMIT 1
      `);
      if (hasOldRituals.rows.length > 0) {
        console.log("🔧 Auto-Migration: Clearing old morning/evening ritual test data (reading → water)...");
        await this.db.execute(sql`UPDATE "days" SET "morning_rituals" = NULL WHERE "morning_rituals"::text LIKE '%reading%'`);
        await this.db.execute(sql`UPDATE "days" SET "evening_rituals" = NULL WHERE "evening_rituals" IS NOT NULL`);
        await this.db.execute(sql`
          UPDATE "user_preferences"
          SET "morning_ritual_config" = NULL
          WHERE "morning_ritual_config"::text LIKE '%reading%'
        `);
        console.log("✅ Auto-Migration: Old ritual data cleared, config reset to new defaults");
      }

    } catch (error) {
      console.error("❌ Auto-Migration Error:", error);
      // Don't throw, let the app try to start anyway
    }
  }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await this.db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // ============================================================================
  // AUDIT LOGS
  // ============================================================================

  async getRecentAuditLogs(userId: string, limit: number = 50): Promise<AuditLog[]> {
    return await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // VENTURES
  // ============================================================================

  async getVentures(): Promise<Venture[]> {
    return await this.db
      .select()
      .from(ventures)
      .orderBy(desc(ventures.createdAt));
  }

  async getVenture(id: string): Promise<Venture | undefined> {
    const [venture] = await this.db
      .select()
      .from(ventures)
      .where(eq(ventures.id, id))
      .limit(1);
    return venture;
  }

  async getVentureBySlug(slug: string): Promise<Venture | undefined> {
    const [venture] = await this.db
      .select()
      .from(ventures)
      .where(eq(ventures.slug, slug))
      .limit(1);
    return venture;
  }

  async getVentureByIdOrSlug(idOrSlug: string): Promise<Venture | undefined> {
    // If it looks like a UUID, lookup by ID first
    if (isUUID(idOrSlug)) {
      const venture = await this.getVenture(idOrSlug);
      if (venture) return venture;
    }
    // Otherwise try slug lookup
    return this.getVentureBySlug(idOrSlug);
  }

  async createVenture(insertVenture: InsertVenture): Promise<Venture> {
    // Auto-generate slug from name if not provided
    let slug = insertVenture.slug || generateSlug(insertVenture.name);

    // Ensure slug is unique by appending a number if needed
    let counter = 1;
    let uniqueSlug = slug;
    while (await this.getVentureBySlug(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }

    const [venture] = await this.db
      .insert(ventures)
      .values({ ...insertVenture, slug: uniqueSlug })
      .returning();
    return venture;
  }

  async updateVenture(id: string, updates: Partial<InsertVenture>): Promise<Venture | undefined> {
    // If name is being updated and no custom slug provided, regenerate slug
    if (updates.name && !updates.slug) {
      const existingVenture = await this.getVenture(id);
      if (existingVenture) {
        let slug = generateSlug(updates.name);
        // Check if slug is already taken by another venture
        const slugOwner = await this.getVentureBySlug(slug);
        if (slugOwner && slugOwner.id !== id) {
          let counter = 1;
          while (await this.getVentureBySlug(`${slug}-${counter}`)) {
            counter++;
          }
          slug = `${slug}-${counter}`;
        }
        updates.slug = slug;
      }
    }

    const [updated] = await this.db
      .update(ventures)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ventures.id, id))
      .returning();
    return updated;
  }

  async deleteVenture(id: string): Promise<void> {
    await this.db.delete(ventures).where(eq(ventures.id, id));
  }

  // ============================================================================
  // PROJECTS
  // ============================================================================

  async getProjects(filters?: { ventureId?: string; limit?: number; offset?: number }): Promise<Project[]> {
    const queryLimit = filters?.limit ?? 100;
    const queryOffset = filters?.offset ?? 0;

    if (filters?.ventureId) {
      return await this.db
        .select()
        .from(projects)
        .where(eq(projects.ventureId, filters.ventureId))
        .orderBy(desc(projects.createdAt))
        .limit(queryLimit)
        .offset(queryOffset);
    }

    return await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .limit(queryLimit)
      .offset(queryOffset);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return project;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await this.db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await this.db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  // ============================================================================
  // PHASES
  // ============================================================================

  async getPhases(filters?: { projectId?: string }): Promise<Phase[]> {
    if (filters?.projectId) {
      return await this.db
        .select()
        .from(phases)
        .where(eq(phases.projectId, filters.projectId))
        .orderBy(phases.order);
    }

    return await this.db
      .select()
      .from(phases)
      .orderBy(phases.order);
  }

  async getPhase(id: string): Promise<Phase | undefined> {
    const [phase] = await this.db
      .select()
      .from(phases)
      .where(eq(phases.id, id));
    return phase;
  }

  async createPhase(insertPhase: InsertPhase): Promise<Phase> {
    const [phase] = await this.db
      .insert(phases)
      .values(insertPhase)
      .returning();
    return phase;
  }

  async updatePhase(id: string, updates: Partial<InsertPhase>): Promise<Phase | undefined> {
    const [updated] = await this.db
      .update(phases)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(phases.id, id))
      .returning();
    return updated;
  }

  async deletePhase(id: string): Promise<void> {
    await this.db.delete(phases).where(eq(phases.id, id));
  }

  // ============================================================================
  // TASKS
  // ============================================================================

  async getTasks(filters?: {
    ventureId?: string;
    projectId?: string;
    phaseId?: string;
    status?: string;
    focusDate?: string;
    focusDateGte?: string;
    focusDateLte?: string;
    dueDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<Task[]> {
    const conditions = [];

    if (filters?.ventureId) {
      conditions.push(eq(tasks.ventureId, filters.ventureId));
    }
    if (filters?.projectId) {
      conditions.push(eq(tasks.projectId, filters.projectId));
    }
    if (filters?.phaseId) {
      conditions.push(eq(tasks.phaseId, filters.phaseId));
    }
    if (filters?.status) {
      // Handle comma-separated status values (e.g., "next,in_progress")
      const statusValues = filters.status.split(',').map(s => s.trim());
      if (statusValues.length === 1) {
        conditions.push(eq(tasks.status, statusValues[0] as any));
      } else {
        conditions.push(inArray(tasks.status, statusValues as any));
      }
    }
    if (filters?.focusDate) {
      conditions.push(eq(tasks.focusDate, filters.focusDate));
    }
    if (filters?.focusDateGte) {
      conditions.push(gte(tasks.focusDate, filters.focusDateGte));
    }
    if (filters?.focusDateLte) {
      conditions.push(lte(tasks.focusDate, filters.focusDateLte));
    }
    if (filters?.dueDate) {
      conditions.push(eq(tasks.dueDate, filters.dueDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Apply pagination with default limit of 100 to prevent loading entire table
    const queryLimit = filters?.limit ?? 100;
    const queryOffset = filters?.offset ?? 0;

    return await this.db
      .select()
      .from(tasks)
      .where(whereClause)
      .orderBy(tasks.priority, desc(tasks.createdAt))
      .limit(queryLimit)
      .offset(queryOffset);
  }

  async getTasksForToday(date: string): Promise<Task[]> {
    // Tasks where focus_date = today OR due_date <= today (overdue) OR day_id = today's day_id
    // Include all tasks (including done/cancelled) so users can see what they accomplished
    const dayId = `day_${date}`;

    return await this.db
      .select()
      .from(tasks)
      .where(
        or(
          eq(tasks.focusDate, date),
          lte(tasks.dueDate, date),
          eq(tasks.dayId, dayId)
        )
      )
      .orderBy(tasks.priority, desc(tasks.createdAt))
      .limit(100); // Reasonable limit for daily view
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return task;
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const [task] = await this.db
      .insert(tasks)
      .values(insertTask as any)
      .returning();
    return task;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const updateData: any = { ...updates, updatedAt: new Date() };

    // If status is being set to 'completed', set completedAt
    if (updates.status === 'completed' && !updates.completedAt) {
      updateData.completedAt = new Date();
    }

    // If status is changed from 'completed' to something else, clear completedAt
    if (updates.status && updates.status !== 'completed') {
      updateData.completedAt = null;
    }

    const [updated] = await this.db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, id));
  }

  // ============================================================================
  // DASHBOARD-OPTIMIZED QUERIES
  // ============================================================================

  /**
   * Get active task counts grouped by venture - single aggregation query
   * Replaces loading ALL tasks and filtering in JS
   */
  async getActiveTaskCountsByVenture(): Promise<Map<string, { total: number; overdueP0: number; dueTodayP0P1: number }>> {
    const today = new Date().toISOString().split('T')[0];

    // Single query with conditional aggregation
    const results = await this.db
      .select({
        ventureId: tasks.ventureId,
        total: sql<number>`count(*)::int`,
        overdueP0: sql<number>`count(*) filter (where ${tasks.priority} = 'P0' and ${tasks.dueDate} < ${today})::int`,
        dueTodayP0P1: sql<number>`count(*) filter (where (${tasks.priority} = 'P0' or ${tasks.priority} = 'P1') and ${tasks.dueDate} = ${today})::int`,
      })
      .from(tasks)
      .where(not(inArray(tasks.status, ['completed', 'on_hold'])))
      .groupBy(tasks.ventureId);

    const map = new Map<string, { total: number; overdueP0: number; dueTodayP0P1: number }>();
    for (const row of results) {
      if (row.ventureId) {
        map.set(row.ventureId, {
          total: row.total,
          overdueP0: row.overdueP0,
          dueTodayP0P1: row.dueTodayP0P1,
        });
      }
    }
    return map;
  }

  /**
   * Get urgent tasks (overdue P0 + due today P0/P1) with database-level filtering
   */
  async getUrgentTasks(today: string, limit: number = 10): Promise<Task[]> {
    return await this.db
      .select()
      .from(tasks)
      .where(
        and(
          not(inArray(tasks.status, ['completed', 'on_hold'])),
          or(
            // Overdue P0
            and(eq(tasks.priority, 'P0'), lte(tasks.dueDate, today)),
            // Due today P0 or P1
            and(
              inArray(tasks.priority, ['P0', 'P1']),
              eq(tasks.dueDate, today)
            )
          )
        )
      )
      .orderBy(tasks.priority, tasks.dueDate)
      .limit(limit);
  }

  /**
   * Get top priority tasks - prioritizes today-relevant tasks first
   * Sort order:
   * 1. Today-relevant (overdue, due today, focusDate = today) come first
   * 2. Within that, sort by priority (P0, P1, P2, P3)
   * 3. Then by urgency (overdue > due today > focus today > future)
   * 4. Fall back to high-priority future tasks if not enough today-relevant
   */
  async getTopPriorityTasks(today: string, limit: number = 5): Promise<Task[]> {
    return await this.db
      .select()
      .from(tasks)
      .where(not(inArray(tasks.status, ['completed', 'on_hold'])))
      .orderBy(
        // Today-relevant tasks first (overdue, due today, or focusDate = today)
        sql`case
          when ${tasks.dueDate} < ${today} then 0
          when ${tasks.dueDate} = ${today} then 0
          when ${tasks.focusDate} = ${today} then 0
          else 1
        end`,
        // Then by priority (P0, P1, P2, P3)
        sql`case ${tasks.priority} when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end`,
        // Then by urgency within priority (overdue first, then due today, then focus today)
        sql`case
          when ${tasks.dueDate} < ${today} then 0
          when ${tasks.dueDate} = ${today} then 1
          when ${tasks.focusDate} = ${today} then 2
          else 3
        end`,
        desc(tasks.createdAt)
      )
      .limit(limit);
  }

  /**
   * Get count of non-done tasks for a project - for completion check
   */
  async getActiveTasksCount(projectId?: string): Promise<number> {
    const conditions = [not(inArray(tasks.status, ['completed', 'on_hold']))];
    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId));
    }

    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...conditions));

    return result?.count ?? 0;
  }

  // ============================================================================
  // CAPTURE ITEMS
  // ============================================================================

  async getCaptures(filters?: { clarified?: boolean; ventureId?: string; limit?: number; offset?: number }): Promise<CaptureItem[]> {
    const conditions = [];
    const queryLimit = filters?.limit ?? 100;
    const queryOffset = filters?.offset ?? 0;

    if (filters?.clarified !== undefined) {
      conditions.push(eq(captureItems.clarified, filters.clarified));
    }

    if (filters?.ventureId) {
      conditions.push(eq(captureItems.ventureId, filters.ventureId));
    }

    if (conditions.length > 0) {
      return await this.db
        .select()
        .from(captureItems)
        .where(and(...conditions))
        .orderBy(desc(captureItems.createdAt))
        .limit(queryLimit)
        .offset(queryOffset);
    }

    return await this.db
      .select()
      .from(captureItems)
      .orderBy(desc(captureItems.createdAt))
      .limit(queryLimit)
      .offset(queryOffset);
  }

  async getCapture(id: string): Promise<CaptureItem | undefined> {
    const [capture] = await this.db
      .select()
      .from(captureItems)
      .where(eq(captureItems.id, id))
      .limit(1);
    return capture;
  }

  async createCapture(insertCapture: InsertCaptureItem): Promise<CaptureItem> {
    const [capture] = await this.db
      .insert(captureItems)
      .values(insertCapture)
      .returning();
    return capture;
  }

  async updateCapture(id: string, updates: Partial<InsertCaptureItem>): Promise<CaptureItem | undefined> {
    const [updated] = await this.db
      .update(captureItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(captureItems.id, id))
      .returning();
    return updated;
  }

  async convertCaptureToTask(captureId: string, taskData: InsertTask): Promise<{ task: Task; capture: CaptureItem }> {
    const capture = await this.getCapture(captureId);
    if (!capture) {
      throw new Error('Capture not found');
    }

    // Create task with data from capture and taskData
    const mergedData = {
      ...taskData,
      title: taskData.title || capture.title,
      status: taskData.status || 'todo' as any,
      domain: taskData.domain || capture.domain,
      ventureId: taskData.ventureId || capture.ventureId,
      projectId: taskData.projectId || capture.projectId,
      notes: taskData.notes || capture.notes,
    };

    const task = await this.createTask(mergedData);

    // Update capture to mark as clarified and link to task
    const updatedCapture = await this.updateCapture(captureId, {
      linkedTaskId: task.id,
      clarified: true,
    });

    return { task, capture: updatedCapture! };
  }

  async deleteCapture(id: string): Promise<void> {
    await this.db.delete(captureItems).where(eq(captureItems.id, id));
  }

  // ============================================================================
  // DAYS
  // ============================================================================

  async getDays(filters?: { dateGte?: string; dateLte?: string }): Promise<Day[]> {
    const conditions = [];

    if (filters?.dateGte) {
      conditions.push(gte(days.date, filters.dateGte));
    }
    if (filters?.dateLte) {
      conditions.push(lte(days.date, filters.dateLte));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(days)
      .where(whereClause)
      .orderBy(desc(days.date));
  }

  async getDay(date: string): Promise<Day | undefined> {
    const [day] = await this.db
      .select()
      .from(days)
      .where(eq(days.date, date))
      .limit(1);
    return day;
  }

  async getDayOrCreate(date: string): Promise<Day> {
    let day = await this.getDay(date);

    if (!day) {
      day = await this.createDay({
        id: `day_${date}`,
        date,
        title: `${date} – [Untitled]`,
      });
    }

    return day;
  }

  async createDay(insertDay: InsertDay): Promise<Day> {
    const [day] = await this.db
      .insert(days)
      .values(insertDay as any)
      .returning();
    return day;
  }

  async updateDay(date: string, updates: Partial<InsertDay>): Promise<Day | undefined> {
    const [updated] = await this.db
      .update(days)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(days.date, date))
      .returning();
    return updated;
  }

  async deleteDay(date: string): Promise<void> {
    await this.db.delete(days).where(eq(days.date, date));
  }

  // ============================================================================
  // WEEKS
  // ============================================================================

  async getWeeks(filters?: { year?: number }): Promise<Week[]> {
    const conditions = [];

    if (filters?.year) {
      conditions.push(eq(weeks.year, filters.year));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(weeks)
      .where(whereClause)
      .orderBy(desc(weeks.year), desc(weeks.weekNumber));
  }

  async getWeek(id: string): Promise<Week | undefined> {
    const [week] = await this.db
      .select()
      .from(weeks)
      .where(eq(weeks.id, id))
      .limit(1);
    return week;
  }

  async getWeekByDate(date: string): Promise<Week | undefined> {
    // Find the week that contains this date
    const targetDate = new Date(date);
    const year = targetDate.getFullYear();

    // Get ISO week number
    const startOfYear = new Date(year, 0, 1);
    const days_diff = Math.floor((targetDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days_diff + startOfYear.getDay() + 1) / 7);

    const weekId = `week_${year}-${String(weekNumber).padStart(2, '0')}`;
    return this.getWeek(weekId);
  }

  async getCurrentWeek(): Promise<Week | undefined> {
    const today = new Date().toISOString().split('T')[0];
    return this.getWeekByDate(today);
  }

  async getWeekOrCreate(year: number, weekNumber: number): Promise<Week> {
    const weekId = `week_${year}-${String(weekNumber).padStart(2, '0')}`;
    let week = await this.getWeek(weekId);

    if (!week) {
      // Calculate the Monday of this week
      const jan1 = new Date(year, 0, 1);
      const daysToMonday = (weekNumber - 1) * 7 - jan1.getDay() + 1;
      const weekStart = new Date(year, 0, 1 + daysToMonday);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      week = await this.createWeek({
        id: weekId,
        weekStart: weekStartStr,
        weekNumber,
        year,
      });
    }

    return week;
  }

  async createWeek(insertWeek: InsertWeek): Promise<Week> {
    const [week] = await this.db
      .insert(weeks)
      .values(insertWeek as any)
      .returning();
    return week;
  }

  async updateWeek(id: string, updates: Partial<InsertWeek>): Promise<Week | undefined> {
    const [updated] = await this.db
      .update(weeks)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(weeks.id, id))
      .returning();
    return updated;
  }

  // ============================================================================
  // HEALTH ENTRIES
  // ============================================================================

  async getHealthEntries(filters?: { dateGte?: string; dateLte?: string }): Promise<HealthEntry[]> {
    const conditions = [];

    if (filters?.dateGte) {
      conditions.push(gte(healthEntries.date, filters.dateGte));
    }
    if (filters?.dateLte) {
      conditions.push(lte(healthEntries.date, filters.dateLte));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(healthEntries)
      .where(whereClause)
      .orderBy(desc(healthEntries.date));
  }

  async getHealthEntry(id: string): Promise<HealthEntry | undefined> {
    const [entry] = await this.db
      .select()
      .from(healthEntries)
      .where(eq(healthEntries.id, id))
      .limit(1);
    return entry;
  }

  async createHealthEntry(insertEntry: InsertHealthEntry): Promise<HealthEntry> {
    const [entry] = await this.db
      .insert(healthEntries)
      .values(insertEntry as any)
      .returning();
    return entry;
  }

  async updateHealthEntry(id: string, updates: Partial<InsertHealthEntry>): Promise<HealthEntry | undefined> {
    const [updated] = await this.db
      .update(healthEntries)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(healthEntries.id, id))
      .returning();
    return updated;
  }

  // ============================================================================
  // BLOODWORK ENTRIES
  // ============================================================================

  async getBloodworkEntries(filters?: { dateGte?: string; dateLte?: string }): Promise<BloodworkEntry[]> {
    const conditions = [];

    if (filters?.dateGte) {
      conditions.push(gte(bloodworkEntries.date, filters.dateGte));
    }
    if (filters?.dateLte) {
      conditions.push(lte(bloodworkEntries.date, filters.dateLte));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(bloodworkEntries)
      .where(whereClause)
      .orderBy(desc(bloodworkEntries.date));
  }

  async getBloodworkEntry(id: string): Promise<BloodworkEntry | undefined> {
    const [entry] = await this.db
      .select()
      .from(bloodworkEntries)
      .where(eq(bloodworkEntries.id, id))
      .limit(1);
    return entry;
  }

  async createBloodworkEntry(insertEntry: InsertBloodworkEntry): Promise<BloodworkEntry> {
    const [entry] = await this.db
      .insert(bloodworkEntries)
      .values(insertEntry as any)
      .returning();
    return entry;
  }

  async updateBloodworkEntry(id: string, updates: Partial<InsertBloodworkEntry>): Promise<BloodworkEntry | undefined> {
    const [updated] = await this.db
      .update(bloodworkEntries)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(bloodworkEntries.id, id))
      .returning();
    return updated;
  }

  async deleteBloodworkEntry(id: string): Promise<void> {
    await this.db.delete(bloodworkEntries).where(eq(bloodworkEntries.id, id));
  }

  // ============================================================================
  // NUTRITION ENTRIES
  // ============================================================================

  async getNutritionEntries(filters?: { dayId?: string; date?: string }): Promise<NutritionEntry[]> {
    const conditions = [];

    if (filters?.dayId) {
      conditions.push(eq(nutritionEntries.dayId, filters.dayId));
    }
    if (filters?.date) {
      // Extract date from datetime field (PostgreSQL date casting)
      // We'll filter by dayId instead which is more reliable
      const dayId = `day_${filters.date}`;
      conditions.push(eq(nutritionEntries.dayId, dayId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(nutritionEntries)
      .where(whereClause)
      .orderBy(nutritionEntries.datetime);
  }

  async getNutritionEntry(id: string): Promise<NutritionEntry | undefined> {
    const [entry] = await this.db
      .select()
      .from(nutritionEntries)
      .where(eq(nutritionEntries.id, id))
      .limit(1);
    return entry;
  }

  async createNutritionEntry(insertEntry: InsertNutritionEntry): Promise<NutritionEntry> {
    const [entry] = await this.db
      .insert(nutritionEntries)
      .values(insertEntry as any)
      .returning();
    return entry;
  }

  async updateNutritionEntry(id: string, updates: Partial<InsertNutritionEntry>): Promise<NutritionEntry | undefined> {
    const [updated] = await this.db
      .update(nutritionEntries)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(nutritionEntries.id, id))
      .returning();
    return updated;
  }

  async deleteNutritionEntry(id: string): Promise<void> {
    await this.db.delete(nutritionEntries).where(eq(nutritionEntries.id, id));
  }

  // ============================================================================
  // DOCS
  // ============================================================================

  async getDocs(filters?: {
    ventureId?: string;
    projectId?: string;
    type?: string;
    domain?: string;
    status?: string;
    parentId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<Doc[]> {
    const conditions = [];
    const queryLimit = filters?.limit ?? 200;
    const queryOffset = filters?.offset ?? 0;

    if (filters?.ventureId) {
      conditions.push(eq(docs.ventureId, filters.ventureId));
    }
    if (filters?.projectId) {
      conditions.push(eq(docs.projectId, filters.projectId));
    }
    if (filters?.type) {
      conditions.push(eq(docs.type, filters.type as any));
    }
    if (filters?.domain) {
      conditions.push(eq(docs.domain, filters.domain as any));
    }
    if (filters?.status) {
      conditions.push(eq(docs.status, filters.status as any));
    }
    // Handle parentId filter - null means root level docs
    if (filters?.parentId !== undefined) {
      if (filters.parentId === null) {
        // Use SQL IS NULL check for root level docs
        conditions.push(isNull(docs.parentId));
      } else {
        conditions.push(eq(docs.parentId, filters.parentId));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(docs)
      .where(whereClause)
      .orderBy(docs.order, desc(docs.updatedAt))
      .limit(queryLimit)
      .offset(queryOffset);
  }

  async getDoc(id: string): Promise<Doc | undefined> {
    const [doc] = await this.db
      .select()
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);
    return doc;
  }

  async createDoc(insertDoc: InsertDoc): Promise<Doc> {
    const [doc] = await this.db
      .insert(docs)
      .values(insertDoc as any)
      .returning();

    // Auto-calculate quality score for new docs
    await this.updateDocQualityScore(doc.id);

    // Return the updated doc with quality score
    const updatedDoc = await this.getDoc(doc.id);
    return updatedDoc!;
  }

  async updateDoc(id: string, updates: Partial<InsertDoc>): Promise<Doc | undefined> {
    const [updated] = await this.db
      .update(docs)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(docs.id, id))
      .returning();

    // Auto-recalculate quality score after update
    if (updated) {
      await this.updateDocQualityScore(id);
      // Return the updated doc with new quality score
      return await this.getDoc(id);
    }

    return updated;
  }

  async deleteDoc(id: string): Promise<void> {
    await this.db.delete(docs).where(eq(docs.id, id));
  }

  async searchDocs(query: string): Promise<Doc[]> {
    // Escape LIKE wildcards to prevent wildcard injection attacks
    const escapedQuery = escapeLikeWildcards(query);

    // Search in title and body
    return await this.db
      .select()
      .from(docs)
      .where(
        or(
          like(docs.title, `%${escapedQuery}%`),
          like(docs.body, `%${escapedQuery}%`)
        )
      )
      .orderBy(desc(docs.updatedAt))
      .limit(50); // Reasonable limit for search results
  }

  async getDocChildren(parentId: string | null, ventureId?: string): Promise<Doc[]> {
    const conditions = [];

    if (parentId === null) {
      // Root level docs - parentId IS NULL
      conditions.push(isNull(docs.parentId));
    } else {
      conditions.push(eq(docs.parentId, parentId));
    }

    if (ventureId) {
      conditions.push(eq(docs.ventureId, ventureId));
    }

    return await this.db
      .select()
      .from(docs)
      .where(and(...conditions))
      .orderBy(docs.order, docs.title);
  }

  async getDocTree(ventureId: string): Promise<Doc[]> {
    // Get all docs for a venture - the tree structure is built client-side
    return await this.db
      .select()
      .from(docs)
      .where(eq(docs.ventureId, ventureId))
      .orderBy(docs.order, docs.title);
  }

  async deleteDocRecursive(id: string): Promise<void> {
    // Use recursive CTE to get all descendants in a single query
    // This replaces the N+1 recursive function calls
    const result = await this.db.execute(sql`
      WITH RECURSIVE doc_tree AS (
        SELECT id FROM docs WHERE id = ${id}
        UNION ALL
        SELECT d.id FROM docs d
        INNER JOIN doc_tree dt ON d.parent_id = dt.id
      )
      SELECT id FROM doc_tree
    `);

    const allIds = (result.rows as { id: string }[]).map(row => row.id);

    // Delete all attachments for these docs
    if (allIds.length > 0) {
      await this.db.delete(attachments).where(inArray(attachments.docId, allIds));
    }

    // Delete all docs
    await this.db.delete(docs).where(inArray(docs.id, allIds));
  }

  async reorderDocs(docIds: string[], parentId: string | null): Promise<void> {
    // Batch update using individual parameterized queries for security
    if (docIds.length === 0) return;

    const now = new Date();

    // Use parameterized queries to prevent SQL injection
    // Update each doc with its new order value
    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i];
      // Validate UUID format to prevent injection
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId)) {
        throw new Error(`Invalid doc ID format: ${docId}`);
      }

      await this.db.update(docs)
        .set({
          order: i,
          parentId: parentId,
          updatedAt: now,
        } as any)
        .where(eq(docs.id, docId));
    }
  }

  async updateDocQualityScore(docId: string): Promise<{ qualityScore: number; aiReady: boolean }> {
    // Get the doc
    const doc = await this.getDoc(docId);
    if (!doc) {
      throw new Error(`Doc not found: ${docId}`);
    }

    // Calculate quality
    const breakdown = calculateDocQuality(doc);

    // Update the doc
    await this.db.update(docs)
      .set({
        qualityScore: breakdown.score,
        aiReady: breakdown.aiReady,
        updatedAt: new Date(),
      } as any)
      .where(eq(docs.id, docId));

    return {
      qualityScore: breakdown.score,
      aiReady: breakdown.aiReady,
    };
  }

  async markDocReviewed(docId: string): Promise<void> {
    await this.db.update(docs)
      .set({
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(docs.id, docId));

    // Recalculate quality score
    await this.updateDocQualityScore(docId);
  }

  async getDocsNeedingReview(limit: number = 20): Promise<Doc[]> {
    // Get docs with low quality scores, ordered by score ASC
    return await this.db
      .select()
      .from(docs)
      .where(eq(docs.status, 'active'))
      .orderBy(asc(docs.qualityScore))
      .limit(limit);
  }

  async getDocQualityMetrics(): Promise<{
    totalDocs: number;
    aiReadyDocs: number;
    aiReadyPercent: number;
    averageScore: number;
    needsReview: number;
  }> {
    // Use SQL aggregations instead of fetching all docs for efficiency
    const result = await this.db
      .select({
        totalDocs: sql<number>`count(*)::int`,
        aiReadyDocs: sql<number>`count(*) filter (where ${docs.aiReady} = true)::int`,
        averageScore: sql<number>`coalesce(round(avg(${docs.qualityScore}))::int, 0)`,
        needsReview: sql<number>`count(*) filter (where coalesce(${docs.qualityScore}, 0) < 70)::int`,
      })
      .from(docs)
      .where(eq(docs.status, 'active'));

    const { totalDocs, aiReadyDocs, averageScore, needsReview } = result[0] || {
      totalDocs: 0,
      aiReadyDocs: 0,
      averageScore: 0,
      needsReview: 0,
    };

    const aiReadyPercent = totalDocs > 0 ? Math.round((aiReadyDocs / totalDocs) * 100) : 0;

    return {
      totalDocs,
      aiReadyDocs,
      aiReadyPercent,
      averageScore,
      needsReview,
    };
  }

  // ============================================================================
  // DOC CHUNKS (for RAG embeddings)
  // ============================================================================

  async createDocChunk(data: InsertDocChunk): Promise<DocChunk> {
    const [chunk] = await this.db.insert(docChunks).values(data).returning();
    return chunk;
  }

  async getDocChunks(docId: string): Promise<DocChunk[]> {
    return await this.db
      .select()
      .from(docChunks)
      .where(eq(docChunks.docId, docId))
      .orderBy(docChunks.chunkIndex);
  }

  async getDocChunksWithEmbeddings(ventureId?: string): Promise<(DocChunk & { docTitle?: string })[]> {
    // Join with docs to get title and filter by venture
    const query = this.db
      .select({
        id: docChunks.id,
        docId: docChunks.docId,
        chunkIndex: docChunks.chunkIndex,
        content: docChunks.content,
        embedding: docChunks.embedding,
        startOffset: docChunks.startOffset,
        endOffset: docChunks.endOffset,
        metadata: docChunks.metadata,
        createdAt: docChunks.createdAt,
        docTitle: docs.title,
      })
      .from(docChunks)
      .innerJoin(docs, eq(docChunks.docId, docs.id))
      .where(
        and(
          not(sql`${docChunks.embedding} IS NULL`),
          ventureId ? eq(docs.ventureId, ventureId) : undefined
        )
      );

    const results = await query;
    return results.map(r => ({
      id: r.id,
      docId: r.docId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      embedding: r.embedding,
      startOffset: r.startOffset,
      endOffset: r.endOffset,
      metadata: r.metadata,
      createdAt: r.createdAt,
      docTitle: r.docTitle,
    }));
  }

  async updateDocChunkEmbedding(id: string, embedding: string): Promise<void> {
    await this.db
      .update(docChunks)
      .set({ embedding })
      .where(eq(docChunks.id, id));
  }

  async deleteDocChunks(docId: string): Promise<void> {
    await this.db.delete(docChunks).where(eq(docChunks.docId, docId));
  }

  async getDocsNeedingEmbedding(limit: number = 50): Promise<Doc[]> {
    // Get docs that are active and don't have embeddings yet
    return await this.db
      .select()
      .from(docs)
      .where(
        and(
          eq(docs.status, 'active'),
          or(
            sql`${docs.embedding} IS NULL`,
            sql`${docs.embeddingUpdatedAt} < ${docs.updatedAt}`
          )
        )
      )
      .orderBy(desc(docs.updatedAt))
      .limit(limit);
  }

  async updateDocEmbedding(docId: string, embedding: string, model: string): Promise<void> {
    await this.db
      .update(docs)
      .set({
        embedding,
        embeddingModel: model,
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(docs.id, docId));
  }

  // ============================================================================
  // ATTACHMENTS
  // ============================================================================

  async getAttachments(docId: string): Promise<Attachment[]> {
    return await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.docId, docId))
      .orderBy(attachments.createdAt);
  }

  async getAttachment(id: string): Promise<Attachment | undefined> {
    const [attachment] = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);
    return attachment;
  }

  async createAttachment(insertAttachment: InsertAttachment): Promise<Attachment> {
    const [attachment] = await this.db
      .insert(attachments)
      .values(insertAttachment)
      .returning();
    return attachment;
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.delete(attachments).where(eq(attachments.id, id));
  }

  // ============================================================================
  // USER PREFERENCES
  // ============================================================================

  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return prefs;
  }

  async upsertUserPreferences(userId: string, data: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    // Check if preferences exist
    const existing = await this.getUserPreferences(userId);

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(userPreferences)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(userPreferences.userId, userId))
        .returning();
      return updated;
    } else {
      // Create new
      const [created] = await this.db
        .insert(userPreferences)
        .values({ ...data, userId } as any)
        .returning();
      return created;
    }
  }

  // ============================================================================
  // CUSTOM CATEGORIES
  // ============================================================================

  async getCategories(filters?: { type?: string; enabled?: boolean }): Promise<CustomCategory[]> {
    const conditions = [];

    if (filters?.type) {
      conditions.push(eq(customCategories.type, filters.type as any));
    }
    if (filters?.enabled !== undefined) {
      conditions.push(eq(customCategories.enabled, filters.enabled));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(customCategories)
      .where(whereClause)
      .orderBy(customCategories.sortOrder, customCategories.label);
  }

  async getCategory(id: string): Promise<CustomCategory | undefined> {
    const [category] = await this.db
      .select()
      .from(customCategories)
      .where(eq(customCategories.id, id))
      .limit(1);
    return category;
  }

  async createCategory(data: InsertCustomCategory): Promise<CustomCategory> {
    const [category] = await this.db
      .insert(customCategories)
      .values(data as any)
      .returning();
    return category;
  }

  async updateCategory(id: string, updates: Partial<InsertCustomCategory>): Promise<CustomCategory | undefined> {
    const [updated] = await this.db
      .update(customCategories)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(customCategories.id, id))
      .returning();
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.delete(customCategories).where(eq(customCategories.id, id));
  }

  // ============================================================================
  // SHOPPING ITEMS
  // ============================================================================

  async getShoppingItems(filters?: { status?: string; priority?: string; category?: string }): Promise<ShoppingItem[]> {
    const conditions = [];

    if (filters?.status) {
      conditions.push(eq(shoppingItems.status, filters.status as any));
    }
    if (filters?.priority) {
      conditions.push(eq(shoppingItems.priority, filters.priority as any));
    }
    if (filters?.category) {
      conditions.push(eq(shoppingItems.category, filters.category as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(shoppingItems)
      .where(whereClause)
      .orderBy(shoppingItems.priority, desc(shoppingItems.createdAt));
  }

  async getShoppingItem(id: string): Promise<ShoppingItem | undefined> {
    const [item] = await this.db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.id, id))
      .limit(1);
    return item;
  }

  async createShoppingItem(data: InsertShoppingItem): Promise<ShoppingItem> {
    const [item] = await this.db
      .insert(shoppingItems)
      .values(data)
      .returning();
    return item;
  }

  async updateShoppingItem(id: string, updates: Partial<InsertShoppingItem>): Promise<ShoppingItem | undefined> {
    const [updated] = await this.db
      .update(shoppingItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(shoppingItems.id, id))
      .returning();
    return updated;
  }

  async deleteShoppingItem(id: string): Promise<void> {
    await this.db.delete(shoppingItems).where(eq(shoppingItems.id, id));
  }

  // ============================================================================
  // BOOKS
  // ============================================================================

  async getBooks(filters?: { status?: string }): Promise<Book[]> {
    const conditions = [];

    if (filters?.status) {
      conditions.push(eq(books.status, filters.status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await this.db
      .select()
      .from(books)
      .where(whereClause)
      .orderBy(desc(books.createdAt));
  }

  async getBook(id: string): Promise<Book | undefined> {
    const [book] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, id))
      .limit(1);
    return book;
  }

  async createBook(data: InsertBook): Promise<Book> {
    const [book] = await this.db
      .insert(books)
      .values(data)
      .returning();
    return book;
  }

  async updateBook(id: string, updates: Partial<InsertBook>): Promise<Book | undefined> {
    const [updated] = await this.db
      .update(books)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(books.id, id))
      .returning();
    return updated;
  }

  async deleteBook(id: string): Promise<void> {
    await this.db.delete(books).where(eq(books.id, id));
  }

  // ============================================================================
  // AI AGENT PROMPTS
  // ============================================================================

  async getAiAgentPromptByVenture(ventureId: string): Promise<AiAgentPrompt | undefined> {
    try {
      const results = await this.db
        .select()
        .from(aiAgentPrompts)
        .where(eq(aiAgentPrompts.ventureId, ventureId))
        .limit(1);
      return results[0];
    } catch (error) {
      // Table might not exist yet if migration hasn't been run
      console.error("Error fetching AI agent prompt:", error);
      return undefined;
    }
  }

  async getAiAgentPrompt(id: string): Promise<AiAgentPrompt | undefined> {
    const results = await this.db
      .select()
      .from(aiAgentPrompts)
      .where(eq(aiAgentPrompts.id, id))
      .limit(1);
    return results[0];
  }

  async createAiAgentPrompt(data: InsertAiAgentPrompt): Promise<AiAgentPrompt> {
    const results = await this.db.insert(aiAgentPrompts).values(data as any).returning();
    return results[0];
  }

  async updateAiAgentPrompt(
    id: string,
    updates: Partial<InsertAiAgentPrompt>
  ): Promise<AiAgentPrompt | undefined> {
    const results = await this.db
      .update(aiAgentPrompts)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(aiAgentPrompts.id, id))
      .returning();
    return results[0];
  }

  async deleteAiAgentPrompt(id: string): Promise<void> {
    await this.db.delete(aiAgentPrompts).where(eq(aiAgentPrompts.id, id));
  }

  // ============================================================================
  // COO CHAT SESSIONS
  // ============================================================================

  async getCooChatSessions(userId: string): Promise<CooChatSession[]> {
    try {
      return await this.db
        .select()
        .from(cooChatSessions)
        .where(eq(cooChatSessions.userId, userId))
        .orderBy(desc(cooChatSessions.updatedAt));
    } catch (error) {
      console.error("Error fetching COO chat sessions (table may not exist):", error);
      return [];
    }
  }

  async getCooChatSession(id: string): Promise<CooChatSession | undefined> {
    try {
      const [session] = await this.db
        .select()
        .from(cooChatSessions)
        .where(eq(cooChatSessions.id, id));
      return session;
    } catch (error) {
      console.error("Error fetching COO chat session:", error);
      return undefined;
    }
  }

  async createCooChatSession(data: InsertCooChatSession): Promise<CooChatSession> {
    try {
      const [session] = await this.db
        .insert(cooChatSessions)
        .values(data as any)
        .returning();
      return session;
    } catch (error) {
      console.error("Error creating COO chat session:", error);
      throw error;
    }
  }

  async updateCooChatSession(
    id: string,
    updates: Partial<InsertCooChatSession>
  ): Promise<CooChatSession | undefined> {
    try {
      const [session] = await this.db
        .update(cooChatSessions)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(cooChatSessions.id, id))
        .returning();
      return session;
    } catch (error) {
      console.error("Error updating COO chat session:", error);
      return undefined;
    }
  }

  async deleteCooChatSession(id: string): Promise<void> {
    try {
      // Delete all messages in the session first
      await this.db.delete(chatMessages).where(eq(chatMessages.sessionId, id));
      // Then delete the session
      await this.db.delete(cooChatSessions).where(eq(cooChatSessions.id, id));
    } catch (error) {
      console.error("Error deleting COO chat session:", error);
    }
  }

  // ============================================================================
  // CHAT MESSAGES
  // ============================================================================

  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const results = await this.db.insert(chatMessages).values(data as any).returning();
    // Update session's updatedAt if sessionId is provided
    if (data.sessionId) {
      await this.db
        .update(cooChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(cooChatSessions.id, data.sessionId));
    }
    return results[0];
  }

  async getChatHistory(userId: string, limit: number = 50, sessionId?: string): Promise<ChatMessage[]> {
    if (sessionId) {
      return await this.db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.userId, userId),
            eq(chatMessages.sessionId, sessionId)
          )
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(limit);
    }
    return await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
  }

  async deleteChatHistory(userId: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.db.delete(chatMessages).where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId)
        )
      );
    } else {
      await this.db.delete(chatMessages).where(eq(chatMessages.userId, userId));
    }
  }

  // Stub for telegram-bot.ts (Phase 2 - will implement proper messaging table)
  async createMessage(data: any): Promise<any> {
    console.log('[Phase 2] createMessage stub called:', data.platform, data.sender);
    return { id: 'stub', ...data };
  }

  // ============================================================================
  // VENTURE AI AGENT SYSTEM
  // ============================================================================

  // Venture Conversations
  async createVentureConversation(data: InsertVentureConversation): Promise<VentureConversation> {
    try {
      const results = await this.db.insert(ventureConversations).values(data as any).returning();
      return results[0];
    } catch (error) {
      console.error("Error creating venture conversation (table may not exist):", error);
      // Return a mock object to prevent crashes when table doesn't exist
      return {
        id: randomUUID(),
        ventureId: data.ventureId,
        userId: data.userId,
        role: data.role as any,
        content: data.content,
        metadata: data.metadata as any || null,
        createdAt: new Date(),
      };
    }
  }

  async getVentureConversations(
    ventureId: string,
    userId: string,
    limit: number = 20
  ): Promise<VentureConversation[]> {
    try {
      return await this.db
        .select()
        .from(ventureConversations)
        .where(
          and(
            eq(ventureConversations.ventureId, ventureId),
            eq(ventureConversations.userId, userId)
          )
        )
        .orderBy(desc(ventureConversations.createdAt))
        .limit(limit);
    } catch (error) {
      // Table might not exist yet if migration hasn't been run
      console.error("Error fetching venture conversations (table may not exist):", error);
      return [];
    }
  }

  async deleteVentureConversations(ventureId: string, userId: string): Promise<void> {
    try {
      await this.db
        .delete(ventureConversations)
        .where(
          and(
            eq(ventureConversations.ventureId, ventureId),
            eq(ventureConversations.userId, userId)
          )
        );
    } catch (error) {
      console.error("Error deleting venture conversations (table may not exist):", error);
    }
  }

  // Venture Context Cache
  async getVentureContextCache(
    ventureId: string,
    contextType: string
  ): Promise<VentureContextCache | undefined> {
    try {
      const results = await this.db
        .select()
        .from(ventureContextCache)
        .where(
          and(
            eq(ventureContextCache.ventureId, ventureId),
            eq(ventureContextCache.contextType, contextType as any)
          )
        )
        .limit(1);
      return results[0];
    } catch (error) {
      // Table might not exist yet if migration hasn't been run
      console.error("Error fetching venture context cache (table may not exist):", error);
      return undefined;
    }
  }

  async upsertVentureContextCache(
    data: InsertVentureContextCache & { ventureId: string; contextType: string }
  ): Promise<VentureContextCache> {
    try {
      // Check if exists
      const existing = await this.getVentureContextCache(data.ventureId, data.contextType);

      if (existing) {
        const results = await this.db
          .update(ventureContextCache)
          .set({
            content: data.content,
            tokenCount: data.tokenCount,
            lastBuiltAt: data.lastBuiltAt || new Date(),
            validUntil: data.validUntil,
            metadata: data.metadata as any,
            updatedAt: new Date(),
          } as any)
          .where(eq(ventureContextCache.id, existing.id))
          .returning();
        return results[0];
      }

      const results = await this.db.insert(ventureContextCache).values(data as any).returning();
      return results[0];
    } catch (error) {
      console.error("Error upserting venture context cache (table may not exist):", error);
      // Return a mock object to prevent crashes
      return {
        id: 'mock',
        ventureId: data.ventureId,
        contextType: data.contextType as any,
        content: data.content,
        tokenCount: data.tokenCount || null,
        lastBuiltAt: new Date(),
        validUntil: data.validUntil || null,
        metadata: data.metadata as any || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  async invalidateVentureContextCache(ventureId: string): Promise<void> {
    try {
      await this.db
        .update(ventureContextCache)
        .set({ validUntil: new Date() })
        .where(eq(ventureContextCache.ventureId, ventureId));
    } catch (error) {
      console.error("Error invalidating venture context cache (table may not exist):", error);
    }
  }

  // Venture Agent Actions (Audit Log)
  async createVentureAgentAction(data: InsertVentureAgentAction): Promise<VentureAgentAction> {
    try {
      const results = await this.db.insert(ventureAgentActions).values(data as any).returning();
      return results[0];
    } catch (error) {
      console.error("Error creating venture agent action (table may not exist):", error);
      // Return a mock object to prevent crashes
      return {
        id: 'mock',
        ventureId: data.ventureId,
        userId: data.userId,
        conversationId: data.conversationId || null,
        action: data.action,
        entityType: data.entityType || null,
        entityId: data.entityId || null,
        parameters: data.parameters || null,
        result: (data.result || 'pending') as any,
        errorMessage: data.errorMessage || null,
        executedAt: new Date(),
      };
    }
  }

  async getVentureAgentActions(
    ventureId: string,
    limit: number = 50
  ): Promise<VentureAgentAction[]> {
    try {
      return await this.db
        .select()
        .from(ventureAgentActions)
        .where(eq(ventureAgentActions.ventureId, ventureId))
        .orderBy(desc(ventureAgentActions.executedAt))
        .limit(limit);
    } catch (error) {
      // Table might not exist yet if migration hasn't been run
      console.error("Error fetching venture agent actions (table may not exist):", error);
      return [];
    }
  }

  // ============================================================================
  // TRADING AI AGENT CHAT SESSIONS
  // ============================================================================

  async getTradingChatSessions(userId: string): Promise<TradingChatSession[]> {
    try {
      return await this.db
        .select()
        .from(tradingChatSessions)
        .where(eq(tradingChatSessions.userId, userId))
        .orderBy(desc(tradingChatSessions.updatedAt));
    } catch (error) {
      console.error("Error fetching trading chat sessions (table may not exist):", error);
      return [];
    }
  }

  async getTradingChatSession(id: string): Promise<TradingChatSession | undefined> {
    try {
      const [session] = await this.db
        .select()
        .from(tradingChatSessions)
        .where(eq(tradingChatSessions.id, id))
        .limit(1);
      return session;
    } catch (error) {
      console.error("Error fetching trading chat session (table may not exist):", error);
      return undefined;
    }
  }

  async createTradingChatSession(data: InsertTradingChatSession): Promise<TradingChatSession> {
    try {
      const [session] = await this.db
        .insert(tradingChatSessions)
        .values(data as any)
        .returning();
      return session;
    } catch (error) {
      console.error("Error creating trading chat session:", error);
      throw error;
    }
  }

  async updateTradingChatSession(
    id: string,
    updates: Partial<InsertTradingChatSession>
  ): Promise<TradingChatSession | undefined> {
    try {
      const [updated] = await this.db
        .update(tradingChatSessions)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(tradingChatSessions.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating trading chat session:", error);
      throw error;
    }
  }

  async deleteTradingChatSession(id: string): Promise<void> {
    try {
      // Messages are deleted via CASCADE
      await this.db
        .delete(tradingChatSessions)
        .where(eq(tradingChatSessions.id, id));
    } catch (error) {
      console.error("Error deleting trading chat session:", error);
      throw error;
    }
  }

  // ============================================================================
  // TRADING AI AGENT CONVERSATIONS
  // ============================================================================

  async createTradingConversation(data: InsertTradingConversation): Promise<TradingConversation> {
    try {
      const results = await this.db.insert(tradingConversations).values(data as any).returning();

      // Update the session's updatedAt timestamp if sessionId is provided
      if (data.sessionId) {
        await this.db
          .update(tradingChatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(tradingChatSessions.id, data.sessionId));
      }

      return results[0];
    } catch (error) {
      console.error("Error creating trading conversation (table may not exist):", error);
      // Return a mock object to prevent crashes when table doesn't exist
      return {
        id: randomUUID(),
        userId: data.userId,
        sessionId: data.sessionId || null,
        role: data.role as any,
        content: data.content,
        metadata: data.metadata as any || null,
        createdAt: new Date(),
      };
    }
  }

  async getTradingConversations(
    userId: string,
    limit: number = 20,
    sessionId?: string
  ): Promise<TradingConversation[]> {
    try {
      const conditions = [eq(tradingConversations.userId, userId)];

      if (sessionId) {
        conditions.push(eq(tradingConversations.sessionId, sessionId));
      }

      return await this.db
        .select()
        .from(tradingConversations)
        .where(and(...conditions))
        .orderBy(desc(tradingConversations.createdAt))
        .limit(limit);
    } catch (error) {
      console.error("Error fetching trading conversations (table may not exist):", error);
      return [];
    }
  }

  async deleteTradingConversations(userId: string, sessionId?: string): Promise<void> {
    try {
      const conditions = [eq(tradingConversations.userId, userId)];

      if (sessionId) {
        conditions.push(eq(tradingConversations.sessionId, sessionId));
      }

      await this.db
        .delete(tradingConversations)
        .where(and(...conditions));
    } catch (error) {
      console.error("Error deleting trading conversations (table may not exist):", error);
    }
  }

  // Trading Agent Config
  async getTradingAgentConfig(userId: string): Promise<TradingAgentConfig | undefined> {
    try {
      const results = await this.db
        .select()
        .from(tradingAgentConfig)
        .where(eq(tradingAgentConfig.userId, userId))
        .limit(1);
      return results[0];
    } catch (error) {
      console.error("Error fetching trading agent config (table may not exist):", error);
      return undefined;
    }
  }

  async upsertTradingAgentConfig(userId: string, data: Partial<InsertTradingAgentConfig>): Promise<TradingAgentConfig> {
    try {
      // Check if config exists
      const existing = await this.getTradingAgentConfig(userId);

      if (existing) {
        // Update existing
        const results = await this.db
          .update(tradingAgentConfig)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(tradingAgentConfig.userId, userId))
          .returning();
        return results[0];
      } else {
        // Create new
        const results = await this.db
          .insert(tradingAgentConfig)
          .values({ ...data, userId } as any)
          .returning();
        return results[0];
      }
    } catch (error) {
      console.error("Error upserting trading agent config (table may not exist):", error);
      // Return a default config object to prevent crashes
      return {
        id: randomUUID(),
        userId,
        systemPrompt: data.systemPrompt || null,
        tradingStyle: data.tradingStyle || null,
        instruments: data.instruments || null,
        timeframes: data.timeframes || null,
        riskRules: data.riskRules || null,
        tradingHours: data.tradingHours || null,
        quickActions: data.quickActions || [],
        preferredModel: data.preferredModel || null,
        focusAreas: data.focusAreas || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  async deleteTradingAgentConfig(userId: string): Promise<void> {
    try {
      await this.db
        .delete(tradingAgentConfig)
        .where(eq(tradingAgentConfig.userId, userId));
    } catch (error) {
      console.error("Error deleting trading agent config (table may not exist):", error);
    }
  }

  // ============================================================================
  // TRADING KNOWLEDGE DOCUMENTS
  // ============================================================================

  async getTradingKnowledgeDocs(
    userId: string,
    filters?: {
      category?: string;
      includeInContext?: boolean;
      limit?: number;
    }
  ): Promise<TradingKnowledgeDoc[]> {
    try {
      const conditions = [eq(tradingKnowledgeDocs.userId, userId)];

      if (filters?.category) {
        conditions.push(eq(tradingKnowledgeDocs.category, filters.category as any));
      }
      if (filters?.includeInContext !== undefined) {
        conditions.push(eq(tradingKnowledgeDocs.includeInContext, filters.includeInContext));
      }

      const query = this.db
        .select()
        .from(tradingKnowledgeDocs)
        .where(and(...conditions))
        .orderBy(desc(tradingKnowledgeDocs.priority), desc(tradingKnowledgeDocs.createdAt));

      if (filters?.limit) {
        return await query.limit(filters.limit);
      }

      return await query;
    } catch (error) {
      console.error("Error fetching trading knowledge docs (table may not exist):", error);
      return [];
    }
  }

  async getTradingKnowledgeDoc(id: string): Promise<TradingKnowledgeDoc | undefined> {
    try {
      const [doc] = await this.db
        .select()
        .from(tradingKnowledgeDocs)
        .where(eq(tradingKnowledgeDocs.id, id))
        .limit(1);
      return doc;
    } catch (error) {
      console.error("Error fetching trading knowledge doc (table may not exist):", error);
      return undefined;
    }
  }

  async createTradingKnowledgeDoc(data: InsertTradingKnowledgeDoc): Promise<TradingKnowledgeDoc> {
    try {
      const [doc] = await this.db
        .insert(tradingKnowledgeDocs)
        .values(data as any)
        .returning();
      return doc;
    } catch (error) {
      console.error("Error creating trading knowledge doc:", error);
      throw error;
    }
  }

  async updateTradingKnowledgeDoc(
    id: string,
    updates: Partial<InsertTradingKnowledgeDoc>
  ): Promise<TradingKnowledgeDoc | undefined> {
    try {
      const [updated] = await this.db
        .update(tradingKnowledgeDocs)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(tradingKnowledgeDocs.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating trading knowledge doc:", error);
      throw error;
    }
  }

  async deleteTradingKnowledgeDoc(id: string): Promise<void> {
    try {
      await this.db
        .delete(tradingKnowledgeDocs)
        .where(eq(tradingKnowledgeDocs.id, id));
    } catch (error) {
      console.error("Error deleting trading knowledge doc:", error);
      throw error;
    }
  }

  async getTradingKnowledgeDocsForContext(userId: string): Promise<TradingKnowledgeDoc[]> {
    // Get docs that are included in AI context, sorted by priority
    return this.getTradingKnowledgeDocs(userId, {
      includeInContext: true,
      limit: 20 // Limit to prevent context overflow
    });
  }

  // ============================================================================
  // TRADING STRATEGIES
  // ============================================================================

  async getTradingStrategies(filters?: { isActive?: boolean }): Promise<TradingStrategy[]> {
    try {
      const conditions = [];

      if (filters?.isActive !== undefined) {
        conditions.push(eq(tradingStrategies.isActive, filters.isActive));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(tradingStrategies)
        .where(whereClause)
        .orderBy(desc(tradingStrategies.isDefault), desc(tradingStrategies.createdAt));
    } catch (error) {
      console.error("Error fetching trading strategies (table may not exist):", error);
      return [];
    }
  }

  async getTradingStrategy(id: string): Promise<TradingStrategy | undefined> {
    try {
      const [strategy] = await this.db
        .select()
        .from(tradingStrategies)
        .where(eq(tradingStrategies.id, id))
        .limit(1);
      return strategy;
    } catch (error) {
      console.error("Error fetching trading strategy (table may not exist):", error);
      return undefined;
    }
  }

  async getDefaultTradingStrategy(): Promise<TradingStrategy | undefined> {
    try {
      const [strategy] = await this.db
        .select()
        .from(tradingStrategies)
        .where(and(eq(tradingStrategies.isDefault, true), eq(tradingStrategies.isActive, true)))
        .limit(1);
      return strategy;
    } catch (error) {
      console.error("Error fetching default trading strategy (table may not exist):", error);
      return undefined;
    }
  }

  async createTradingStrategy(data: InsertTradingStrategy): Promise<TradingStrategy> {
    try {
      // If this is set as default, unset other defaults first
      if (data.isDefault) {
        await this.db
          .update(tradingStrategies)
          .set({ isDefault: false, updatedAt: new Date() });
      }

      const [strategy] = await this.db
        .insert(tradingStrategies)
        .values(data as any)
        .returning();
      return strategy;
    } catch (error) {
      console.error("Error creating trading strategy:", error);
      throw error;
    }
  }

  async updateTradingStrategy(id: string, updates: Partial<InsertTradingStrategy>): Promise<TradingStrategy | undefined> {
    try {
      // If setting as default, unset other defaults first
      if (updates.isDefault) {
        await this.db
          .update(tradingStrategies)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(not(eq(tradingStrategies.id, id)));
      }

      const [updated] = await this.db
        .update(tradingStrategies)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(tradingStrategies.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating trading strategy:", error);
      return undefined;
    }
  }

  async deleteTradingStrategy(id: string): Promise<void> {
    try {
      await this.db.delete(tradingStrategies).where(eq(tradingStrategies.id, id));
    } catch (error) {
      console.error("Error deleting trading strategy:", error);
    }
  }

  // ============================================================================
  // DAILY TRADING CHECKLISTS
  // ============================================================================

  async getDailyTradingChecklists(filters?: { date?: string; strategyId?: string }): Promise<DailyTradingChecklist[]> {
    try {
      const conditions = [];

      if (filters?.date) {
        conditions.push(eq(dailyTradingChecklists.date, filters.date));
      }
      if (filters?.strategyId) {
        conditions.push(eq(dailyTradingChecklists.strategyId, filters.strategyId));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(dailyTradingChecklists)
        .where(whereClause)
        .orderBy(desc(dailyTradingChecklists.date));
    } catch (error) {
      console.error("Error fetching daily trading checklists (table may not exist):", error);
      return [];
    }
  }

  async getDailyTradingChecklist(id: string): Promise<DailyTradingChecklist | undefined> {
    try {
      const [checklist] = await this.db
        .select()
        .from(dailyTradingChecklists)
        .where(eq(dailyTradingChecklists.id, id))
        .limit(1);
      return checklist;
    } catch (error) {
      console.error("Error fetching daily trading checklist (table may not exist):", error);
      return undefined;
    }
  }

  async getDailyTradingChecklistByDate(date: string): Promise<DailyTradingChecklist | undefined> {
    try {
      const [checklist] = await this.db
        .select()
        .from(dailyTradingChecklists)
        .where(eq(dailyTradingChecklists.date, date))
        .limit(1);
      return checklist;
    } catch (error) {
      console.error("Error fetching daily trading checklist by date (table may not exist):", error);
      return undefined;
    }
  }

  async createDailyTradingChecklist(data: InsertDailyTradingChecklist): Promise<DailyTradingChecklist> {
    try {
      const [checklist] = await this.db
        .insert(dailyTradingChecklists)
        .values(data as any)
        .returning();
      return checklist;
    } catch (error) {
      console.error("Error creating daily trading checklist:", error);
      throw error;
    }
  }

  async updateDailyTradingChecklist(id: string, updates: Partial<InsertDailyTradingChecklist>): Promise<DailyTradingChecklist | undefined> {
    try {
      const [updated] = await this.db
        .update(dailyTradingChecklists)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(dailyTradingChecklists.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating daily trading checklist:", error);
      return undefined;
    }
  }

  async deleteDailyTradingChecklist(id: string): Promise<void> {
    try {
      await this.db.delete(dailyTradingChecklists).where(eq(dailyTradingChecklists.id, id));
    } catch (error) {
      console.error("Error deleting daily trading checklist:", error);
    }
  }

  // ============================================================================
  // FINANCIAL ACCOUNTS
  // ============================================================================

  async getFinancialAccounts(filters?: { type?: string; isActive?: boolean; isAsset?: boolean }): Promise<FinancialAccount[]> {
    try {
      const conditions = [];

      if (filters?.type) {
        conditions.push(eq(financialAccounts.type, filters.type as any));
      }
      if (filters?.isActive !== undefined) {
        conditions.push(eq(financialAccounts.isActive, filters.isActive));
      }
      if (filters?.isAsset !== undefined) {
        conditions.push(eq(financialAccounts.isAsset, filters.isAsset));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(financialAccounts)
        .where(whereClause)
        .orderBy(financialAccounts.isAsset, financialAccounts.type, financialAccounts.name);
    } catch (error) {
      console.error("Error fetching financial accounts:", error);
      return [];
    }
  }

  async getFinancialAccount(id: string): Promise<FinancialAccount | undefined> {
    try {
      const [account] = await this.db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.id, id))
        .limit(1);
      return account;
    } catch (error) {
      console.error("Error fetching financial account:", error);
      return undefined;
    }
  }

  async createFinancialAccount(data: InsertFinancialAccount): Promise<FinancialAccount> {
    const [account] = await this.db
      .insert(financialAccounts)
      .values(data as any)
      .returning();

    // Create initial snapshot
    await this.createAccountSnapshot({
      accountId: account.id,
      balance: account.currentBalance,
      note: "Initial balance",
    });

    return account;
  }

  async updateFinancialAccount(id: string, updates: Partial<InsertFinancialAccount>): Promise<FinancialAccount | undefined> {
    try {
      const [updated] = await this.db
        .update(financialAccounts)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(financialAccounts.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating financial account:", error);
      return undefined;
    }
  }

  async deleteFinancialAccount(id: string): Promise<void> {
    try {
      await this.db.delete(financialAccounts).where(eq(financialAccounts.id, id));
    } catch (error) {
      console.error("Error deleting financial account:", error);
    }
  }

  async updateAccountBalance(accountId: string, balance: number, note?: string): Promise<FinancialAccount> {
    // Update the account's current balance
    const [updated] = await this.db
      .update(financialAccounts)
      .set({ currentBalance: balance, updatedAt: new Date() })
      .where(eq(financialAccounts.id, accountId))
      .returning();

    if (!updated) {
      throw new Error("Account not found");
    }

    // Create a snapshot for the balance change
    await this.createAccountSnapshot({
      accountId,
      balance,
      note: note || undefined,
    });

    return updated;
  }

  // ============================================================================
  // ACCOUNT SNAPSHOTS
  // ============================================================================

  async getAccountSnapshots(accountId: string, limit: number = 100): Promise<AccountSnapshot[]> {
    try {
      return await this.db
        .select()
        .from(accountSnapshots)
        .where(eq(accountSnapshots.accountId, accountId))
        .orderBy(desc(accountSnapshots.createdAt))
        .limit(limit);
    } catch (error) {
      console.error("Error fetching account snapshots:", error);
      return [];
    }
  }

  async createAccountSnapshot(data: InsertAccountSnapshot): Promise<AccountSnapshot> {
    const [snapshot] = await this.db
      .insert(accountSnapshots)
      .values(data as any)
      .returning();
    return snapshot;
  }

  // ============================================================================
  // NET WORTH
  // ============================================================================

  async getNetWorth(): Promise<{ totalAssets: number; totalLiabilities: number; netWorth: number; byType: Record<string, number> }> {
    try {
      const accounts = await this.getFinancialAccounts({ isActive: true });

      let totalAssets = 0;
      let totalLiabilities = 0;
      const byType: Record<string, number> = {};

      for (const account of accounts) {
        const balance = account.currentBalance;

        if (account.isAsset) {
          totalAssets += balance;
        } else {
          totalLiabilities += balance;
        }

        // Group by type
        byType[account.type] = (byType[account.type] || 0) + balance;
      }

      return {
        totalAssets,
        totalLiabilities,
        netWorth: totalAssets - totalLiabilities,
        byType,
      };
    } catch (error) {
      console.error("Error calculating net worth:", error);
      return { totalAssets: 0, totalLiabilities: 0, netWorth: 0, byType: {} };
    }
  }

  async getNetWorthSnapshots(userId: string, limit: number = 12): Promise<NetWorthSnapshot[]> {
    try {
      return await this.db
        .select()
        .from(netWorthSnapshots)
        .where(eq(netWorthSnapshots.userId, userId))
        .orderBy(desc(netWorthSnapshots.snapshotDate))
        .limit(limit);
    } catch (error) {
      console.error("Error fetching net worth snapshots:", error);
      return [];
    }
  }

  async createNetWorthSnapshot(userId: string): Promise<NetWorthSnapshot> {
    const netWorth = await this.getNetWorth();
    const accounts = await this.getFinancialAccounts({ isActive: true });

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const month = now.getMonth() + 1; // 1-12
    const year = now.getFullYear();

    // Get previous snapshot for change calculation
    const previousSnapshots = await this.db
      .select()
      .from(netWorthSnapshots)
      .where(eq(netWorthSnapshots.userId, userId))
      .orderBy(desc(netWorthSnapshots.snapshotDate))
      .limit(1);

    const previousSnapshot = previousSnapshots[0];

    const changeFromPrevious = previousSnapshot
      ? netWorth.netWorth - previousSnapshot.netWorth
      : null;
    const changePercentage = previousSnapshot && previousSnapshot.netWorth !== 0
      ? ((netWorth.netWorth - previousSnapshot.netWorth) / previousSnapshot.netWorth) * 100
      : null;

    // Check if snapshot for today already exists
    const existing = await this.db
      .select()
      .from(netWorthSnapshots)
      .where(and(
        eq(netWorthSnapshots.userId, userId),
        eq(netWorthSnapshots.snapshotDate, today)
      ))
      .limit(1);

    // Build holdings snapshot
    const holdingsSnapshot = {
      byType: netWorth.byType,
      byAccount: accounts.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.currentBalance,
        isAsset: a.isAsset,
      })),
    };

    if (existing.length > 0) {
      // Update existing snapshot
      const [updated] = await this.db
        .update(netWorthSnapshots)
        .set({
          totalAssets: netWorth.totalAssets,
          totalLiabilities: netWorth.totalLiabilities,
          netWorth: netWorth.netWorth,
          changeFromPrevious,
          changePercentage,
          holdingsSnapshot,
        })
        .where(eq(netWorthSnapshots.id, existing[0].id))
        .returning();
      return updated;
    }

    // Create new snapshot
    const [snapshot] = await this.db
      .insert(netWorthSnapshots)
      .values({
        userId,
        snapshotDate: today,
        month,
        year,
        totalAssets: netWorth.totalAssets,
        totalLiabilities: netWorth.totalLiabilities,
        netWorth: netWorth.netWorth,
        changeFromPrevious,
        changePercentage,
        holdingsSnapshot,
      } as any)
      .returning();

    return snapshot;
  }

  // ============================================================================
  // PEOPLE / RELATIONSHIPS CRM
  // ============================================================================

  async getPeople(filters?: {
    relationship?: string;
    importance?: string;
    ventureId?: string;
    needsEnrichment?: boolean;
  }): Promise<Person[]> {
    try {
      const conditions = [];

      if (filters?.relationship) {
        conditions.push(eq(people.relationship, filters.relationship as any));
      }
      if (filters?.importance) {
        conditions.push(eq(people.importance, filters.importance as any));
      }
      if (filters?.ventureId) {
        conditions.push(eq(people.ventureId, filters.ventureId));
      }
      if (filters?.needsEnrichment !== undefined) {
        conditions.push(eq(people.needsEnrichment, filters.needsEnrichment));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(people)
        .where(whereClause)
        .orderBy(desc(people.updatedAt));
    } catch (error) {
      console.error("Error fetching people (table may not exist):", error);
      return [];
    }
  }

  async getPerson(id: string): Promise<Person | undefined> {
    try {
      const [person] = await this.db
        .select()
        .from(people)
        .where(eq(people.id, id))
        .limit(1);
      return person;
    } catch (error) {
      console.error("Error fetching person (table may not exist):", error);
      return undefined;
    }
  }

  async getPersonByGoogleId(googleContactId: string): Promise<Person | undefined> {
    try {
      const [person] = await this.db
        .select()
        .from(people)
        .where(eq(people.googleContactId, googleContactId))
        .limit(1);
      return person;
    } catch (error) {
      console.error("Error fetching person by Google ID (table may not exist):", error);
      return undefined;
    }
  }

  async getPersonByExternalId(externalContactId: string): Promise<Person | undefined> {
    try {
      const [person] = await this.db
        .select()
        .from(people)
        .where(eq(people.externalContactId, externalContactId))
        .limit(1);
      return person;
    } catch (error) {
      console.error("Error fetching person by external ID (table may not exist):", error);
      return undefined;
    }
  }

  async getPersonByEmail(email: string): Promise<Person | undefined> {
    try {
      const [person] = await this.db
        .select()
        .from(people)
        .where(eq(people.email, email))
        .limit(1);
      return person;
    } catch (error) {
      console.error("Error fetching person by email (table may not exist):", error);
      return undefined;
    }
  }

  async createPerson(data: InsertPerson): Promise<Person> {
    try {
      const [person] = await this.db
        .insert(people)
        .values(data as any)
        .returning();
      return person;
    } catch (error) {
      console.error("Error creating person:", error);
      throw error;
    }
  }

  async updatePerson(id: string, updates: Partial<InsertPerson>): Promise<Person | undefined> {
    try {
      const [updated] = await this.db
        .update(people)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(people.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating person:", error);
      return undefined;
    }
  }

  async deletePerson(id: string): Promise<void> {
    try {
      await this.db.delete(people).where(eq(people.id, id));
    } catch (error) {
      console.error("Error deleting person:", error);
    }
  }

  /**
   * Get people who are overdue for contact based on their contact frequency
   */
  async getStalePeople(today: string): Promise<Person[]> {
    try {
      // Get all people with a contact frequency and last contact date
      // Filter in application logic based on frequency
      const allPeople = await this.db
        .select()
        .from(people)
        .where(
          and(
            not(eq(people.contactFrequency, 'as_needed')),
            // Has a last contact date or never contacted (needs attention)
            or(
              sql`${people.lastContactDate} IS NOT NULL`,
              sql`${people.lastContactDate} IS NULL`
            )
          )
        )
        .orderBy(people.lastContactDate);

      // Calculate staleness based on frequency
      const frequencyDays: Record<string, number> = {
        weekly: 7,
        biweekly: 14,
        monthly: 30,
        quarterly: 90,
        yearly: 365,
      };

      const todayDate = new Date(today);
      return allPeople.filter(person => {
        if (!person.contactFrequency || person.contactFrequency === 'as_needed') {
          return false;
        }
        if (!person.lastContactDate) {
          // Never contacted - definitely stale
          return true;
        }

        const lastContact = new Date(person.lastContactDate);
        const daysSinceContact = Math.floor((todayDate.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));
        const threshold = frequencyDays[person.contactFrequency] || 30;

        return daysSinceContact > threshold;
      });
    } catch (error) {
      console.error("Error fetching stale people (table may not exist):", error);
      return [];
    }
  }

  /**
   * Get people with upcoming follow-ups in the next N days
   */
  async getUpcomingFollowUps(today: string, days: number = 7): Promise<Person[]> {
    try {
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + days);
      const endDateStr = endDate.toISOString().split('T')[0];

      return await this.db
        .select()
        .from(people)
        .where(
          and(
            gte(people.nextFollowUp, today),
            lte(people.nextFollowUp, endDateStr)
          )
        )
        .orderBy(people.nextFollowUp);
    } catch (error) {
      console.error("Error fetching upcoming follow-ups (table may not exist):", error);
      return [];
    }
  }

  /**
   * Log a contact with a person (updates lastContactDate)
   */
  async logContact(id: string, date: string): Promise<Person | undefined> {
    try {
      const [updated] = await this.db
        .update(people)
        .set({
          lastContactDate: date,
          updatedAt: new Date(),
        } as any)
        .where(eq(people.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error logging contact:", error);
      return undefined;
    }
  }

  // ============================================================================
  // STRATEGIC FORESIGHT MODULE
  // ============================================================================

  // ----------------------------------------------------------------------------
  // VENTURE SCENARIOS
  // ----------------------------------------------------------------------------

  async getVentureScenarios(
    ventureId: string,
    filters?: { status?: string; quadrant?: string; timeHorizon?: string }
  ): Promise<VentureScenario[]> {
    try {
      const conditions = [eq(ventureScenarios.ventureId, ventureId)];

      if (filters?.status) {
        conditions.push(eq(ventureScenarios.status, filters.status as any));
      }
      if (filters?.quadrant) {
        conditions.push(eq(ventureScenarios.quadrant, filters.quadrant as any));
      }
      if (filters?.timeHorizon) {
        conditions.push(eq(ventureScenarios.timeHorizon, filters.timeHorizon as any));
      }

      return await this.db
        .select()
        .from(ventureScenarios)
        .where(and(...conditions))
        .orderBy(desc(ventureScenarios.updatedAt));
    } catch (error) {
      console.error("Error fetching venture scenarios:", error);
      return [];
    }
  }

  async getVentureScenario(id: string): Promise<VentureScenario | undefined> {
    try {
      const [scenario] = await this.db
        .select()
        .from(ventureScenarios)
        .where(eq(ventureScenarios.id, id));
      return scenario;
    } catch (error) {
      console.error("Error fetching venture scenario:", error);
      return undefined;
    }
  }

  async createVentureScenario(data: InsertVentureScenario): Promise<VentureScenario> {
    const [scenario] = await this.db
      .insert(ventureScenarios)
      .values(data as any)
      .returning();
    return scenario;
  }

  async updateVentureScenario(
    id: string,
    data: Partial<InsertVentureScenario>
  ): Promise<VentureScenario | undefined> {
    try {
      const [updated] = await this.db
        .update(ventureScenarios)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(ventureScenarios.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating venture scenario:", error);
      return undefined;
    }
  }

  async deleteVentureScenario(id: string): Promise<void> {
    await this.db.delete(ventureScenarios).where(eq(ventureScenarios.id, id));
  }

  // ----------------------------------------------------------------------------
  // SCENARIO INDICATORS
  // ----------------------------------------------------------------------------

  async getScenarioIndicators(
    filters: { ventureId?: string; scenarioId?: string; status?: string; category?: string }
  ): Promise<ScenarioIndicator[]> {
    try {
      const conditions = [];

      if (filters.ventureId) {
        conditions.push(eq(scenarioIndicators.ventureId, filters.ventureId));
      }
      if (filters.scenarioId) {
        conditions.push(eq(scenarioIndicators.scenarioId, filters.scenarioId));
      }
      if (filters.status) {
        conditions.push(eq(scenarioIndicators.currentStatus, filters.status as any));
      }
      if (filters.category) {
        conditions.push(eq(scenarioIndicators.category, filters.category as any));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(scenarioIndicators)
        .where(whereClause)
        .orderBy(desc(scenarioIndicators.updatedAt));
    } catch (error) {
      console.error("Error fetching scenario indicators:", error);
      return [];
    }
  }

  async getScenarioIndicator(id: string): Promise<ScenarioIndicator | undefined> {
    try {
      const [indicator] = await this.db
        .select()
        .from(scenarioIndicators)
        .where(eq(scenarioIndicators.id, id));
      return indicator;
    } catch (error) {
      console.error("Error fetching scenario indicator:", error);
      return undefined;
    }
  }

  async createScenarioIndicator(data: InsertScenarioIndicator): Promise<ScenarioIndicator> {
    const [indicator] = await this.db
      .insert(scenarioIndicators)
      .values(data)
      .returning();
    return indicator;
  }

  async updateScenarioIndicator(
    id: string,
    data: Partial<InsertScenarioIndicator>
  ): Promise<ScenarioIndicator | undefined> {
    try {
      const [updated] = await this.db
        .update(scenarioIndicators)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(scenarioIndicators.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating scenario indicator:", error);
      return undefined;
    }
  }

  async deleteScenarioIndicator(id: string): Promise<void> {
    await this.db.delete(scenarioIndicators).where(eq(scenarioIndicators.id, id));
  }

  // ----------------------------------------------------------------------------
  // TREND SIGNALS
  // ----------------------------------------------------------------------------

  async getTrendSignals(
    ventureId: string,
    filters?: { status?: string; category?: string; strength?: string }
  ): Promise<TrendSignal[]> {
    try {
      const conditions = [eq(trendSignals.ventureId, ventureId)];

      if (filters?.status) {
        conditions.push(eq(trendSignals.status, filters.status as any));
      }
      if (filters?.category) {
        conditions.push(eq(trendSignals.category, filters.category as any));
      }
      if (filters?.strength) {
        conditions.push(eq(trendSignals.signalStrength, filters.strength as any));
      }

      return await this.db
        .select()
        .from(trendSignals)
        .where(and(...conditions))
        .orderBy(desc(trendSignals.createdAt));
    } catch (error) {
      console.error("Error fetching trend signals:", error);
      return [];
    }
  }

  async getTrendSignal(id: string): Promise<TrendSignal | undefined> {
    try {
      const [signal] = await this.db
        .select()
        .from(trendSignals)
        .where(eq(trendSignals.id, id));
      return signal;
    } catch (error) {
      console.error("Error fetching trend signal:", error);
      return undefined;
    }
  }

  async createTrendSignal(data: InsertTrendSignal): Promise<TrendSignal> {
    const [signal] = await this.db
      .insert(trendSignals)
      .values(data as any)
      .returning();
    return signal;
  }

  async updateTrendSignal(
    id: string,
    data: Partial<InsertTrendSignal>
  ): Promise<TrendSignal | undefined> {
    try {
      const [updated] = await this.db
        .update(trendSignals)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(trendSignals.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating trend signal:", error);
      return undefined;
    }
  }

  async deleteTrendSignal(id: string): Promise<void> {
    await this.db.delete(trendSignals).where(eq(trendSignals.id, id));
  }

  // ----------------------------------------------------------------------------
  // STRATEGIC ANALYSES
  // ----------------------------------------------------------------------------

  async getStrategicAnalyses(
    ventureId: string,
    filters?: { framework?: string; status?: string }
  ): Promise<StrategicAnalysis[]> {
    try {
      const conditions = [eq(strategicAnalyses.ventureId, ventureId)];

      if (filters?.framework) {
        conditions.push(eq(strategicAnalyses.framework, filters.framework as any));
      }
      if (filters?.status) {
        conditions.push(eq(strategicAnalyses.status, filters.status as any));
      }

      return await this.db
        .select()
        .from(strategicAnalyses)
        .where(and(...conditions))
        .orderBy(desc(strategicAnalyses.createdAt));
    } catch (error) {
      console.error("Error fetching strategic analyses:", error);
      return [];
    }
  }

  async getStrategicAnalysis(id: string): Promise<StrategicAnalysis | undefined> {
    try {
      const [analysis] = await this.db
        .select()
        .from(strategicAnalyses)
        .where(eq(strategicAnalyses.id, id));
      return analysis;
    } catch (error) {
      console.error("Error fetching strategic analysis:", error);
      return undefined;
    }
  }

  async createStrategicAnalysis(data: InsertStrategicAnalysis): Promise<StrategicAnalysis> {
    const [analysis] = await this.db
      .insert(strategicAnalyses)
      .values(data as any)
      .returning();
    return analysis;
  }

  async updateStrategicAnalysis(
    id: string,
    data: Partial<InsertStrategicAnalysis>
  ): Promise<StrategicAnalysis | undefined> {
    try {
      const [updated] = await this.db
        .update(strategicAnalyses)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(strategicAnalyses.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating strategic analysis:", error);
      return undefined;
    }
  }

  async deleteStrategicAnalysis(id: string): Promise<void> {
    await this.db.delete(strategicAnalyses).where(eq(strategicAnalyses.id, id));
  }

  // ----------------------------------------------------------------------------
  // WHAT-IF QUESTIONS
  // ----------------------------------------------------------------------------

  async getWhatIfQuestions(
    ventureId: string,
    filters?: { category?: string; explored?: boolean }
  ): Promise<WhatIfQuestion[]> {
    try {
      const conditions = [eq(whatIfQuestions.ventureId, ventureId)];

      if (filters?.category) {
        conditions.push(eq(whatIfQuestions.category, filters.category as any));
      }
      if (filters?.explored !== undefined) {
        conditions.push(eq(whatIfQuestions.explored, filters.explored));
      }

      return await this.db
        .select()
        .from(whatIfQuestions)
        .where(and(...conditions))
        .orderBy(desc(whatIfQuestions.createdAt));
    } catch (error) {
      console.error("Error fetching what-if questions:", error);
      return [];
    }
  }

  async getWhatIfQuestion(id: string): Promise<WhatIfQuestion | undefined> {
    try {
      const [question] = await this.db
        .select()
        .from(whatIfQuestions)
        .where(eq(whatIfQuestions.id, id));
      return question;
    } catch (error) {
      console.error("Error fetching what-if question:", error);
      return undefined;
    }
  }

  async createWhatIfQuestion(data: InsertWhatIfQuestion): Promise<WhatIfQuestion> {
    const [question] = await this.db
      .insert(whatIfQuestions)
      .values(data)
      .returning();
    return question;
  }

  async updateWhatIfQuestion(
    id: string,
    data: Partial<InsertWhatIfQuestion>
  ): Promise<WhatIfQuestion | undefined> {
    try {
      const [updated] = await this.db
        .update(whatIfQuestions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(whatIfQuestions.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating what-if question:", error);
      return undefined;
    }
  }

  async deleteWhatIfQuestion(id: string): Promise<void> {
    await this.db.delete(whatIfQuestions).where(eq(whatIfQuestions.id, id));
  }

  // ----------------------------------------------------------------------------
  // FORESIGHT CONVERSATIONS
  // ----------------------------------------------------------------------------

  async getForesightConversations(ventureId: string, limit: number = 50): Promise<ForesightConversation[]> {
    try {
      return await this.db
        .select()
        .from(foresightConversations)
        .where(eq(foresightConversations.ventureId, ventureId))
        .orderBy(foresightConversations.createdAt)
        .limit(limit);
    } catch (error) {
      console.error("Error fetching foresight conversations:", error);
      return [];
    }
  }

  async createForesightConversation(data: InsertForesightConversation): Promise<ForesightConversation> {
    const [conversation] = await this.db
      .insert(foresightConversations)
      .values(data as any)
      .returning();
    return conversation;
  }

  async clearForesightConversations(ventureId: string): Promise<void> {
    await this.db
      .delete(foresightConversations)
      .where(eq(foresightConversations.ventureId, ventureId));
  }

  // ----------------------------------------------------------------------------
  // FORESIGHT DASHBOARD SUMMARY
  // ----------------------------------------------------------------------------

  async getForesightSummary(ventureId: string): Promise<{
    scenarioCount: number;
    scenariosByQuadrant: Record<string, number>;
    indicatorsByStatus: { green: number; yellow: number; red: number };
    recentSignals: TrendSignal[];
    unexploredQuestions: number;
  }> {
    try {
      // Run aggregation queries in parallel for efficiency
      const [scenarioStats, indicatorStats, recentSignals, questionStats] = await Promise.all([
        // Scenario counts by quadrant (single query)
        this.db
          .select({
            total: sql<number>`count(*)::int`,
            growth: sql<number>`count(*) filter (where ${ventureScenarios.quadrant} = 'growth')::int`,
            collapse: sql<number>`count(*) filter (where ${ventureScenarios.quadrant} = 'collapse')::int`,
            transformation: sql<number>`count(*) filter (where ${ventureScenarios.quadrant} = 'transformation')::int`,
            constraint: sql<number>`count(*) filter (where ${ventureScenarios.quadrant} = 'constraint')::int`,
          })
          .from(ventureScenarios)
          .where(eq(ventureScenarios.ventureId, ventureId)),

        // Indicator counts by status (single query)
        this.db
          .select({
            green: sql<number>`count(*) filter (where ${scenarioIndicators.currentStatus} = 'green')::int`,
            yellow: sql<number>`count(*) filter (where ${scenarioIndicators.currentStatus} = 'yellow')::int`,
            red: sql<number>`count(*) filter (where ${scenarioIndicators.currentStatus} = 'red')::int`,
          })
          .from(scenarioIndicators)
          .where(eq(scenarioIndicators.ventureId, ventureId)),

        // Recent signals (limit 5, already ordered by createdAt desc)
        this.db
          .select()
          .from(trendSignals)
          .where(eq(trendSignals.ventureId, ventureId))
          .orderBy(desc(trendSignals.createdAt))
          .limit(5),

        // Unexplored questions count (single query)
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(whatIfQuestions)
          .where(and(
            eq(whatIfQuestions.ventureId, ventureId),
            eq(whatIfQuestions.explored, false)
          )),
      ]);

      const scenariosByQuadrant = {
        growth: scenarioStats[0]?.growth ?? 0,
        collapse: scenarioStats[0]?.collapse ?? 0,
        transformation: scenarioStats[0]?.transformation ?? 0,
        constraint: scenarioStats[0]?.constraint ?? 0,
      };

      const indicatorsByStatus = {
        green: indicatorStats[0]?.green ?? 0,
        yellow: indicatorStats[0]?.yellow ?? 0,
        red: indicatorStats[0]?.red ?? 0,
      };

      return {
        scenarioCount: scenarioStats[0]?.total ?? 0,
        scenariosByQuadrant,
        indicatorsByStatus,
        recentSignals,
        unexploredQuestions: questionStats[0]?.count ?? 0,
      };
    } catch (error) {
      console.error("Error fetching foresight summary:", error);
      return {
        scenarioCount: 0,
        scenariosByQuadrant: { growth: 0, collapse: 0, transformation: 0, constraint: 0 },
        indicatorsByStatus: { green: 0, yellow: 0, red: 0 },
        recentSignals: [],
        unexploredQuestions: 0,
      };
    }
  }

  // ----------------------------------------------------------------------------
  // FEAR SETTINGS
  // ----------------------------------------------------------------------------

  async getFearSettings(filters?: { userId?: string; ventureId?: string; status?: string }): Promise<FearSetting[]> {
    try {
      let query = this.db.select().from(fearSettings);
      const conditions = [];

      if (filters?.userId) {
        conditions.push(eq(fearSettings.userId, filters.userId));
      }
      if (filters?.ventureId) {
        conditions.push(eq(fearSettings.ventureId, filters.ventureId));
      }
      if (filters?.status) {
        conditions.push(eq(fearSettings.status, filters.status as any));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      return await query.orderBy(desc(fearSettings.createdAt));
    } catch (error) {
      console.error("Error fetching fear settings:", error);
      return [];
    }
  }

  async getFearSetting(id: string): Promise<FearSetting | undefined> {
    try {
      const [result] = await this.db
        .select()
        .from(fearSettings)
        .where(eq(fearSettings.id, id))
        .limit(1);
      return result;
    } catch (error) {
      console.error("Error fetching fear setting:", error);
      return undefined;
    }
  }

  async createFearSetting(data: InsertFearSetting): Promise<FearSetting> {
    const [result] = await this.db
      .insert(fearSettings)
      .values(data as any)
      .returning();
    return result;
  }

  async updateFearSetting(id: string, updates: Partial<InsertFearSetting>): Promise<FearSetting | undefined> {
    const [result] = await this.db
      .update(fearSettings)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(fearSettings.id, id))
      .returning();
    return result;
  }

  async deleteFearSetting(id: string): Promise<void> {
    await this.db.delete(fearSettings).where(eq(fearSettings.id, id));
  }

  // ----------------------------------------------------------------------------
  // DECISION MEMORIES
  // ----------------------------------------------------------------------------

  async getDecisionMemories(filters?: {
    tags?: string[];
    archetype?: string;
    closed?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DecisionMemory[]> {
    try {
      const conditions = [];
      const queryLimit = filters?.limit ?? 100;
      const queryOffset = filters?.offset ?? 0;

      // Filter by closed state (computed from outcomeRecordedAt)
      if (filters?.closed === true) {
        conditions.push(sql`${decisionMemories.outcomeRecordedAt} IS NOT NULL`);
      } else if (filters?.closed === false) {
        conditions.push(sql`${decisionMemories.outcomeRecordedAt} IS NULL`);
      }

      // Filter by archetype (in derived JSON)
      if (filters?.archetype) {
        conditions.push(
          sql`${decisionMemories.derived}->>'archetype' = ${filters.archetype}`
        );
      }

      // Filter by tags (check if any tag matches)
      if (filters?.tags && filters.tags.length > 0) {
        const tagConditions = filters.tags.map(
          (tag) => sql`${decisionMemories.tags} @> ${JSON.stringify([tag])}::jsonb`
        );
        conditions.push(or(...tagConditions));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      return await this.db
        .select()
        .from(decisionMemories)
        .where(whereClause)
        .orderBy(desc(decisionMemories.createdAt))
        .limit(queryLimit)
        .offset(queryOffset);
    } catch (error) {
      console.error("Error fetching decision memories:", error);
      return [];
    }
  }

  async getDecisionMemory(id: string): Promise<DecisionMemory | undefined> {
    try {
      const [result] = await this.db
        .select()
        .from(decisionMemories)
        .where(eq(decisionMemories.id, id))
        .limit(1);
      return result;
    } catch (error) {
      console.error("Error fetching decision memory:", error);
      return undefined;
    }
  }

  async createDecisionMemory(data: InsertDecisionMemory): Promise<DecisionMemory> {
    const [result] = await this.db
      .insert(decisionMemories)
      .values(data as any)
      .returning();
    return result;
  }

  async updateDecisionMemory(
    id: string,
    updates: UpdateDecisionMemory
  ): Promise<DecisionMemory | undefined> {
    const [result] = await this.db
      .update(decisionMemories)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(decisionMemories.id, id))
      .returning();
    return result;
  }

  async closeDecisionMemory(
    id: string,
    data: CloseDecisionMemory
  ): Promise<DecisionMemory | undefined> {
    const [result] = await this.db
      .update(decisionMemories)
      .set({
        outcome: data.outcome,
        outcomeNotes: data.outcomeNotes,
        outcomeRecordedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(decisionMemories.id, id))
      .returning();
    return result;
  }

  async deleteDecisionMemory(id: string): Promise<void> {
    await this.db.delete(decisionMemories).where(eq(decisionMemories.id, id));
  }

  /**
   * Get decisions that are due for follow-up (followUpAt <= now AND outcome not recorded)
   */
  async getDueDecisions(asOfDate?: Date): Promise<DecisionMemory[]> {
    const now = asOfDate || new Date();
    try {
      return await this.db
        .select()
        .from(decisionMemories)
        .where(
          and(
            sql`${decisionMemories.followUpAt} IS NOT NULL`,
            lte(decisionMemories.followUpAt, now),
            sql`${decisionMemories.outcomeRecordedAt} IS NULL`
          )
        )
        .orderBy(decisionMemories.followUpAt);
    } catch (error) {
      console.error("Error fetching due decisions:", error);
      return [];
    }
  }

  /**
   * Get decisions eligible for "early signal" check:
   * - outcomeRecordedAt IS NULL
   * - createdAt + 7 days <= now
   * - followUpAt is either null or > now (i.e., the full follow-up isn't due yet)
   */
  async getEarlyCheckDecisions(asOfDate?: Date): Promise<DecisionMemory[]> {
    const now = asOfDate || new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    try {
      return await this.db
        .select()
        .from(decisionMemories)
        .where(
          and(
            sql`${decisionMemories.outcomeRecordedAt} IS NULL`,
            lte(decisionMemories.createdAt, sevenDaysAgo),
            or(
              sql`${decisionMemories.followUpAt} IS NULL`,
              gte(decisionMemories.followUpAt, now)
            )
          )
        )
        .orderBy(decisionMemories.createdAt);
    } catch (error) {
      console.error("Error fetching early check decisions:", error);
      return [];
    }
  }

  /**
   * Retrieve decisions for AI context injection.
   * Prioritizes: archetype match > tag overlap > recency > closed decisions
   * Returns top N (default 10) with bias toward closed decisions.
   */
  async retrieveDecisionsForAI(
    query: string,
    tags?: string[],
    limit: number = 10
  ): Promise<DecisionMemory[]> {
    try {
      // Get closed decisions first (max 7), then open (max 3)
      const closedLimit = Math.min(7, limit);
      const openLimit = Math.min(3, limit - closedLimit);

      // Build search conditions for text matching
      const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

      // Get closed decisions
      const closedConditions = [sql`${decisionMemories.outcomeRecordedAt} IS NOT NULL`];

      // Add tag matching if provided
      if (tags && tags.length > 0) {
        const tagConditions = tags.map(
          (tag) => sql`${decisionMemories.tags} @> ${JSON.stringify([tag])}::jsonb`
        );
        closedConditions.push(or(...tagConditions) as any);
      }

      const closedDecisions = await this.db
        .select()
        .from(decisionMemories)
        .where(and(...closedConditions))
        .orderBy(desc(decisionMemories.createdAt))
        .limit(closedLimit);

      // Get open decisions if we need more
      let openDecisions: DecisionMemory[] = [];
      if (openLimit > 0 && closedDecisions.length < limit) {
        const openConditions = [sql`${decisionMemories.outcomeRecordedAt} IS NULL`];

        if (tags && tags.length > 0) {
          const tagConditions = tags.map(
            (tag) => sql`${decisionMemories.tags} @> ${JSON.stringify([tag])}::jsonb`
          );
          openConditions.push(or(...tagConditions) as any);
        }

        openDecisions = await this.db
          .select()
          .from(decisionMemories)
          .where(and(...openConditions))
          .orderBy(desc(decisionMemories.createdAt))
          .limit(openLimit);
      }

      // Combine and return
      return [...closedDecisions, ...openDecisions].slice(0, limit);
    } catch (error) {
      console.error("Error retrieving decisions for AI:", error);
      return [];
    }
  }

  /**
   * Export all decision memories for backup/export
   */
  async exportDecisionMemories(): Promise<DecisionMemory[]> {
    try {
      return await this.db
        .select()
        .from(decisionMemories)
        .orderBy(desc(decisionMemories.createdAt));
    } catch (error) {
      console.error("Error exporting decision memories:", error);
      return [];
    }
  }

  // ============================================================================
  // DOC AI FEEDBACK & LEARNING
  // ============================================================================

  async createDocAiFeedback(data: InsertDocAiFeedback): Promise<DocAiFeedback> {
    const [feedback] = await this.db
      .insert(docAiFeedback)
      .values(data)
      .returning();
    return feedback;
  }

  async getDocAiFeedback(opts: { docId?: string; limit?: number }): Promise<DocAiFeedback[]> {
    const conditions = [];
    if (opts.docId) {
      conditions.push(eq(docAiFeedback.docId, opts.docId));
    }

    const query = this.db
      .select()
      .from(docAiFeedback)
      .orderBy(desc(docAiFeedback.createdAt));

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    if (opts.limit) {
      query.limit(opts.limit);
    }

    return await query;
  }

  async createDocAiExample(data: InsertDocAiExample): Promise<DocAiExample> {
    const [example] = await this.db
      .insert(docAiExamples)
      .values(data)
      .returning();
    return example;
  }

  async getDocAiExamples(opts: {
    fieldName: string;
    docType: string;
    docDomain?: string;
    limit?: number;
  }): Promise<DocAiExample[]> {
    const conditions = [
      eq(docAiExamples.fieldName, opts.fieldName),
      eq(docAiExamples.isActive, true),
    ];

    if (opts.docType) {
      conditions.push(eq(docAiExamples.docType, opts.docType));
    }

    if (opts.docDomain) {
      conditions.push(eq(docAiExamples.docDomain, opts.docDomain));
    }

    const query = this.db
      .select()
      .from(docAiExamples)
      .where(and(...conditions))
      .orderBy(desc(docAiExamples.successRate), desc(docAiExamples.qualityScore));

    if (opts.limit) {
      query.limit(opts.limit);
    }

    return await query;
  }

  async updateDocAiExampleUsage(id: string): Promise<void> {
    await this.db
      .update(docAiExamples)
      .set({ timesUsed: sql`${docAiExamples.timesUsed} + 1` })
      .where(eq(docAiExamples.id, id));
  }

  async createDocAiPattern(data: InsertDocAiPattern): Promise<DocAiPattern> {
    const [pattern] = await this.db
      .insert(docAiPatterns)
      .values(data)
      .returning();
    return pattern;
  }

  async getDocAiPatterns(opts: {
    fieldName: string;
    docType?: string;
    docDomain?: string;
  }): Promise<DocAiPattern[]> {
    const conditions = [
      eq(docAiPatterns.fieldName, opts.fieldName),
      eq(docAiPatterns.isActive, true),
    ];

    if (opts.docType) {
      conditions.push(eq(docAiPatterns.docType, opts.docType));
    }

    if (opts.docDomain) {
      conditions.push(eq(docAiPatterns.docDomain, opts.docDomain));
    }

    return await this.db
      .select()
      .from(docAiPatterns)
      .where(and(...conditions));
  }

  async createDocAiTeaching(data: InsertDocAiTeaching): Promise<DocAiTeaching> {
    const [teaching] = await this.db
      .insert(docAiTeachings)
      .values(data)
      .returning();
    return teaching;
  }

  async getDocAiTeachings(opts: {
    fieldName: string;
    docType?: string;
    docDomain?: string;
    ventureId?: string;
  }): Promise<DocAiTeaching[]> {
    const conditions = [
      eq(docAiTeachings.fieldName, opts.fieldName),
      eq(docAiTeachings.isActive, true),
    ];

    if (opts.docType) {
      conditions.push(eq(docAiTeachings.docType, opts.docType));
    }

    if (opts.docDomain) {
      conditions.push(eq(docAiTeachings.docDomain, opts.docDomain));
    }

    if (opts.ventureId) {
      conditions.push(eq(docAiTeachings.ventureId, opts.ventureId));
    }

    return await this.db
      .select()
      .from(docAiTeachings)
      .where(and(...conditions));
  }

  async getDocAiMetrics(days: number): Promise<{
    totalSuggestions: number;
    acceptanceRate: number;
    examplesCount: number;
    teachingsCount: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Get feedback count
    const feedbackResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(docAiFeedback)
      .where(gte(docAiFeedback.createdAt, cutoffDate));
    const totalSuggestions = Number(feedbackResult[0]?.count || 0);

    // Get acceptance count (where userAction = 'accept')
    const acceptedResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(docAiFeedback)
      .where(
        and(
          gte(docAiFeedback.createdAt, cutoffDate),
          eq(docAiFeedback.userAction, 'accept')
        )
      );
    const acceptedCount = Number(acceptedResult[0]?.count || 0);
    const acceptanceRate = totalSuggestions > 0 ? acceptedCount / totalSuggestions : 0;

    // Get examples count
    const examplesResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(docAiExamples)
      .where(eq(docAiExamples.isActive, true));
    const examplesCount = Number(examplesResult[0]?.count || 0);

    // Get teachings count
    const teachingsResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(docAiTeachings)
      .where(eq(docAiTeachings.isActive, true));
    const teachingsCount = Number(teachingsResult[0]?.count || 0);

    return {
      totalSuggestions,
      acceptanceRate,
      examplesCount,
      teachingsCount,
    };
  }

  // ============================================================================
  // VENTURE IDEAS (Venture Lab)
  // ============================================================================

  async getVentureIdeas(filters?: {
    status?: string;
    verdict?: string;
    limit?: number;
    offset?: number;
  }): Promise<VentureIdea[]> {
    try {
      const conditions = [];

      if (filters?.status) {
        conditions.push(eq(ventureIdeas.status, filters.status as any));
      }

      if (filters?.verdict) {
        conditions.push(eq(ventureIdeas.verdict, filters.verdict as any));
      }

      let query = this.db
        .select()
        .from(ventureIdeas)
        .orderBy(desc(ventureIdeas.createdAt));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      if (filters?.limit) {
        query = query.limit(filters.limit) as any;
      }

      if (filters?.offset) {
        query = query.offset(filters.offset) as any;
      }

      return await query;
    } catch (error) {
      console.error("Error fetching venture ideas (table may not exist):", error);
      return [];
    }
  }

  async getVentureIdea(id: string): Promise<VentureIdea | undefined> {
    try {
      const results = await this.db
        .select()
        .from(ventureIdeas)
        .where(eq(ventureIdeas.id, id))
        .limit(1);
      return results[0];
    } catch (error) {
      console.error("Error fetching venture idea (table may not exist):", error);
      return undefined;
    }
  }

  async getVentureIdeaByScoreHash(hash: string): Promise<VentureIdea | undefined> {
    try {
      const results = await this.db
        .select()
        .from(ventureIdeas)
        .where(eq(ventureIdeas.scoreInputHash, hash))
        .limit(1);
      return results[0];
    } catch (error) {
      console.error("Error fetching venture idea by hash (table may not exist):", error);
      return undefined;
    }
  }

  async createVentureIdea(data: InsertVentureIdea): Promise<VentureIdea> {
    const [idea] = await this.db
      .insert(ventureIdeas)
      .values(data as any)
      .returning();
    return idea;
  }

  async updateVentureIdea(id: string, updates: Partial<InsertVentureIdea>): Promise<VentureIdea | undefined> {
    try {
      const [updated] = await this.db
        .update(ventureIdeas)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(ventureIdeas.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating venture idea (table may not exist):", error);
      return undefined;
    }
  }

  async deleteVentureIdea(id: string): Promise<void> {
    try {
      await this.db.delete(ventureIdeas).where(eq(ventureIdeas.id, id));
    } catch (error) {
      console.error("Error deleting venture idea (table may not exist):", error);
    }
  }

  // ============================================================================
  // KNOWLEDGE FILES (File uploads with AI reading)
  // ============================================================================

  async getKnowledgeFiles(
    filters?: {
      ventureId?: string;
      projectId?: string;
      taskId?: string;
      docId?: string;
      category?: string;
      processingStatus?: string;
      includeInAiContext?: boolean;
      limit?: number;
    }
  ): Promise<KnowledgeFile[]> {
    try {
      const conditions: any[] = [];

      if (filters?.ventureId) {
        conditions.push(eq(knowledgeFiles.ventureId, filters.ventureId));
      }
      if (filters?.projectId) {
        conditions.push(eq(knowledgeFiles.projectId, filters.projectId));
      }
      if (filters?.taskId) {
        conditions.push(eq(knowledgeFiles.taskId, filters.taskId));
      }
      if (filters?.docId) {
        conditions.push(eq(knowledgeFiles.docId, filters.docId));
      }
      if (filters?.category) {
        conditions.push(eq(knowledgeFiles.category, filters.category as any));
      }
      if (filters?.processingStatus) {
        conditions.push(eq(knowledgeFiles.processingStatus, filters.processingStatus as any));
      }
      if (filters?.includeInAiContext !== undefined) {
        conditions.push(eq(knowledgeFiles.includeInAiContext, filters.includeInAiContext));
      }

      const query = this.db
        .select()
        .from(knowledgeFiles)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(knowledgeFiles.aiContextPriority), desc(knowledgeFiles.createdAt));

      if (filters?.limit) {
        return await query.limit(filters.limit);
      }

      return await query;
    } catch (error) {
      console.error("Error fetching knowledge files (table may not exist):", error);
      return [];
    }
  }

  async getKnowledgeFile(id: string): Promise<KnowledgeFile | undefined> {
    try {
      const [file] = await this.db
        .select()
        .from(knowledgeFiles)
        .where(eq(knowledgeFiles.id, id))
        .limit(1);
      return file;
    } catch (error) {
      console.error("Error fetching knowledge file (table may not exist):", error);
      return undefined;
    }
  }

  async getKnowledgeFileByDriveId(driveFileId: string): Promise<KnowledgeFile | undefined> {
    try {
      const [file] = await this.db
        .select()
        .from(knowledgeFiles)
        .where(eq(knowledgeFiles.googleDriveFileId, driveFileId))
        .limit(1);
      return file;
    } catch (error) {
      console.error("Error fetching knowledge file by drive ID (table may not exist):", error);
      return undefined;
    }
  }

  async createKnowledgeFile(data: InsertKnowledgeFile): Promise<KnowledgeFile> {
    try {
      const [file] = await this.db
        .insert(knowledgeFiles)
        .values(data as any)
        .returning();
      return file;
    } catch (error) {
      console.error("Error creating knowledge file:", error);
      throw error;
    }
  }

  async updateKnowledgeFile(
    id: string,
    updates: Partial<InsertKnowledgeFile>
  ): Promise<KnowledgeFile | undefined> {
    try {
      const [updated] = await this.db
        .update(knowledgeFiles)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(knowledgeFiles.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Error updating knowledge file:", error);
      throw error;
    }
  }

  async deleteKnowledgeFile(id: string): Promise<void> {
    try {
      await this.db
        .delete(knowledgeFiles)
        .where(eq(knowledgeFiles.id, id));
    } catch (error) {
      console.error("Error deleting knowledge file:", error);
      throw error;
    }
  }

  async getKnowledgeFilesForAiContext(
    ventureId: string,
    options?: { limit?: number }
  ): Promise<KnowledgeFile[]> {
    try {
      const query = this.db
        .select()
        .from(knowledgeFiles)
        .where(
          and(
            eq(knowledgeFiles.ventureId, ventureId),
            eq(knowledgeFiles.includeInAiContext, true),
            eq(knowledgeFiles.processingStatus, 'completed' as any)
          )
        )
        .orderBy(desc(knowledgeFiles.aiContextPriority), desc(knowledgeFiles.createdAt));

      if (options?.limit) {
        return await query.limit(options.limit);
      }

      return await query;
    } catch (error) {
      console.error("Error fetching knowledge files for AI context:", error);
      return [];
    }
  }

}

export const storage = new DBStorage();
