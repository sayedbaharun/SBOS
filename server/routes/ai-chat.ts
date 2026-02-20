/**
 * AI Chat Routes
 * AI agent prompts, chat API, venture agents, and project scaffolding
 */
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertAiAgentPromptSchema, insertTradingKnowledgeDocSchema } from "@shared/schema";
import { AVAILABLE_MODELS } from "../model-manager";
import multer from "multer";
import { z } from "zod";
import { DEFAULT_USER_ID } from "./constants";

const router = Router();

// Configure multer for knowledge doc file uploads (in-memory storage for base64 encoding)
const knowledgeDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow PDFs, text files, and images
    const allowedMimeTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: PDF, TXT, MD, CSV, JPEG, PNG, GIF, WebP`));
    }
  },
});

// Rate limiter for AI endpoints - 20 requests per minute per user
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: {
    error: "Too many AI requests",
    message: "Please wait a moment before sending more messages. Rate limit: 20 requests per minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use session userId if available, otherwise fall back to IP
  keyGenerator: (req) => {
    const session = (req as any).session;
    if (session?.userId) {
      return session.userId;
    }
    // Use the express-rate-limit default IP handling
    return req.ip || "anonymous";
  },
  // Skip validation for keyGenerator since we handle it properly
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

// Helper to ensure default user exists for chat operations
async function ensureDefaultUserExists(): Promise<void> {
  const existingUser = await storage.getUser(DEFAULT_USER_ID);
  if (!existingUser) {
    await storage.upsertUser({
      id: DEFAULT_USER_ID,
      email: "user@sb-os.com",
    });
  }
}

// ============================================================================
// AI MODELS
// ============================================================================

// Get available AI models for selection
router.get("/models", async (_req: Request, res: Response) => {
  res.json(AVAILABLE_MODELS);
});

// Alias for frontend compatibility
router.get("/ai-models", async (_req: Request, res: Response) => {
  res.json(AVAILABLE_MODELS);
});

// ============================================================================
// AI AGENT PROMPTS
// ============================================================================

// Get AI agent prompt for a venture
router.get("/agent-prompts/venture/:ventureId", async (req: Request, res: Response) => {
  try {
    const prompt = await storage.getAiAgentPromptByVenture(req.params.ventureId);
    if (!prompt) {
      // Return a default configuration instead of 404
      return res.json({
        id: null,
        ventureId: req.params.ventureId,
        systemPrompt: null,
        context: null,
        capabilities: [],
        quickActions: [],
        knowledgeSources: ['docs', 'tasks', 'projects'],
        actionPermissions: ['read'],
        contextRefreshHours: 24,
        maxContextTokens: 8000,
        preferredModel: null,
        enabled: true,
        createdAt: null,
        updatedAt: null,
      });
    }
    res.json(prompt);
  } catch (error) {
    logger.error({ error }, "Error fetching AI agent prompt");
    res.json({
      id: null,
      ventureId: req.params.ventureId,
      systemPrompt: null,
      context: null,
      capabilities: [],
      quickActions: [],
      knowledgeSources: ['docs', 'tasks', 'projects'],
      actionPermissions: ['read'],
      contextRefreshHours: 24,
      maxContextTokens: 8000,
      preferredModel: null,
      enabled: true,
      createdAt: null,
      updatedAt: null,
    });
  }
});

// Create AI agent prompt
router.post("/agent-prompts", async (req: Request, res: Response) => {
  try {
    const validatedData = insertAiAgentPromptSchema.parse(req.body);
    const prompt = await storage.createAiAgentPrompt(validatedData);
    res.status(201).json(prompt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid AI agent prompt data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating AI agent prompt");
      res.status(500).json({ error: "Failed to create AI agent prompt" });
    }
  }
});

// Update AI agent prompt
router.patch("/agent-prompts/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertAiAgentPromptSchema.partial().parse(req.body);
    const prompt = await storage.updateAiAgentPrompt(req.params.id, updates);
    if (!prompt) {
      return res.status(404).json({ error: "AI agent prompt not found" });
    }
    res.json(prompt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid AI agent prompt data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating AI agent prompt");
      res.status(500).json({ error: "Failed to update AI agent prompt" });
    }
  }
});

// Delete AI agent prompt
router.delete("/agent-prompts/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteAiAgentPrompt(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting AI agent prompt");
    res.status(500).json({ error: "Failed to delete AI agent prompt" });
  }
});

// ============================================================================
// COO CHAT SESSIONS
// ============================================================================

// Get all COO chat sessions for the user
router.get("/chat/sessions", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const sessions = await storage.getCooChatSessions(userId);
    res.json(sessions);
  } catch (error) {
    logger.error({ error }, "Error fetching COO chat sessions");
    res.json([]);
  }
});

// Create a new COO chat session
router.post("/chat/sessions", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const { title } = req.body;

    const session = await storage.createCooChatSession({
      userId,
      title: title || "New Chat",
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error({ error }, "Error creating COO chat session");
    res.status(500).json({ error: "Failed to create chat session" });
  }
});

// Update a COO chat session (rename)
router.patch("/chat/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;

    const session = await storage.updateCooChatSession(sessionId, { title });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  } catch (error) {
    logger.error({ error }, "Error updating COO chat session");
    res.status(500).json({ error: "Failed to update chat session" });
  }
});

// Delete a COO chat session and its messages
router.delete("/chat/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    await storage.deleteCooChatSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting COO chat session");
    res.status(500).json({ error: "Failed to delete chat session" });
  }
});

// ============================================================================
// CHAT API
// ============================================================================

// Get chat history for current user (optionally by session)
router.get("/chat/history", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;
    const limit = parseInt(req.query.limit as string) || 50;
    const sessionId = req.query.sessionId as string | undefined;

    const messages = await storage.getChatHistory(userId, limit, sessionId);

    // Return in chronological order (oldest first)
    res.json(messages.reverse());
  } catch (error) {
    logger.error({ error }, "Error fetching chat history");
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// Send a chat message and get AI response
router.post("/chat", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Check if OpenRouter API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI service not configured",
        message: "OpenRouter API key is not set."
      });
    }

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    // Save user message
    const userMessage = await storage.createChatMessage({
      userId,
      sessionId: sessionId || null,
      role: "user" as const,
      content: message,
      metadata: null,
    });

    // Get user preferences for custom AI instructions and model selection
    const userPrefs = await storage.getUserPreferences(userId);
    const customInstructions = userPrefs?.aiInstructions || "";
    const aiContext = userPrefs?.aiContext || {};
    const preferredModel = userPrefs?.aiModel || "openai/gpt-4o";
    const temperature = userPrefs?.aiTemperature ?? 0.7;
    const maxTokens = userPrefs?.aiMaxTokens ?? 4096;

    // Get recent chat history for context (scoped to session if provided)
    const recentHistory = await storage.getChatHistory(userId, 20, sessionId);
    const historyMessages = recentHistory.reverse().map(msg => ({
      role: msg.role as "user" | "assistant" | "system",
      content: msg.content,
    }));

    // Call OpenRouter API with function calling
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const today = new Date().toISOString().split('T')[0];

    // Build comprehensive COO context
    let cooContext = '';
    try {
      const { buildCOOContextSummary } = await import("../ai-coo-context-builder");
      cooContext = await buildCOOContextSummary();
    } catch (error) {
      logger.warn({ error }, "Could not build COO context, continuing without it");
    }

    // Check if this is a decision-related question and inject Decision Style Brief
    let decisionStyleBrief = '';
    try {
      const { isDecisionQuestion, generateDecisionStyleBrief } = await import("../decision-style-brief");
      if (isDecisionQuestion(message)) {
        const brief = await generateDecisionStyleBrief();
        if (brief) {
          decisionStyleBrief = `\n${brief}\n`;
        }
      }
    } catch (error) {
      logger.warn({ error }, "Could not generate decision style brief, continuing without it");
    }

    const systemPrompt = `You are the AI Chief Operating Officer (COO) for SB-OS - Sayed Baharun's Personal Operating System.

## YOUR ROLE
You are the strategic right-hand, responsible for:
- Overseeing the ENTIRE operating system across all ventures, trading, health, and life management
- Providing executive-level insights and recommendations
- Ensuring nothing falls through the cracks
- Connecting dots across different domains (work, health, trading, personal life)
- Being proactive about risks, opportunities, and priorities

## YOUR PERSONALITY
- Direct and efficient - no fluff
- Strategic and systems-thinking
- Proactive - surface issues before asked
- Supportive but challenging when needed
- Data-driven but emotionally intelligent

## COMPLETE SYSTEM ACCESS
You have full access to ALL data in SB-OS:

**BUSINESS:**
- Ventures (all business initiatives across SaaS, media, realty, trading, personal)
- Projects (within ventures, with phases and budgets)
- Tasks (all work items with priorities, due dates, focus slots)
- Documents (SOPs, specs, templates, playbooks)
- Captures/Inbox (unprocessed ideas and items)

**TRADING:**
- Trading strategies and daily checklists
- Trading journal with P&L
- Trading sessions (London, NY, Asian)

**HEALTH & WELLNESS:**
- Health metrics (sleep, energy, mood, stress, workouts)
- Nutrition logs (meals, calories, macros)
- Morning and evening rituals

**LIFE MANAGEMENT:**
- Shopping lists with priorities
- Books and reading progress
- Daily planning and reflections

## CURRENT SYSTEM STATUS
${cooContext}

## USER CONTEXT
${aiContext.userName ? `Name: ${aiContext.userName}` : 'Name: Sayed Baharun'}
${aiContext.role ? `Role: ${aiContext.role}` : 'Role: Founder & Operator'}
${aiContext.goals?.length ? `Goals: ${aiContext.goals.join(', ')}` : ''}
${aiContext.preferences ? `Preferences: ${aiContext.preferences}` : ''}

${customInstructions ? `## CUSTOM INSTRUCTIONS\n${customInstructions}\n` : ''}
${decisionStyleBrief}
## OPERATIONAL RULES
1. **Always use tools** to fetch real data - never make assumptions
2. **Be proactive** - if you see issues (overdue tasks, low health metrics, unprocessed inbox), surface them
3. **Connect the dots** - relate health to productivity, trading performance to mental state, etc.
4. **Prioritize ruthlessly** - help focus on highest-leverage activities
5. **Track patterns** - identify recurring issues or opportunities
6. **Be concise** - deliver insights efficiently with markdown formatting
7. **Create and update** - you can create tasks, captures, and more when asked
8. **Challenge assumptions** - push back constructively when needed

Current date: ${today}`;

    // Define tools for database access
    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "get_ventures",
          description: "Get all ventures (business initiatives). Use this when user asks about their ventures, businesses, or initiatives.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_projects",
          description: "Get projects, optionally filtered by venture. Use when user asks about projects.",
          parameters: {
            type: "object",
            properties: {
              ventureId: { type: "string", description: "Optional venture ID to filter by" },
              status: { type: "string", description: "Optional status filter" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_tasks",
          description: "Get tasks with optional filters. Use when user asks about tasks, to-dos, or what they need to do.",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string", description: "Filter by status: idea, next, in_progress, waiting, done, cancelled" },
              ventureId: { type: "string", description: "Filter by venture ID" },
              projectId: { type: "string", description: "Filter by project ID" },
              priority: { type: "string", description: "Filter by priority: P0, P1, P2, P3" },
              focusDate: { type: "string", description: "Filter by focus date (YYYY-MM-DD)" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_today_tasks",
          description: "Get tasks scheduled for today. Use when user asks 'what do I have today' or 'today's tasks'.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Create a new task. Use when user wants to add a task or to-do item.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Task title" },
              status: { type: "string", description: "Status: idea, next, in_progress, waiting, done" },
              priority: { type: "string", description: "Priority: P0, P1, P2, P3" },
              ventureId: { type: "string", description: "Venture ID to associate with" },
              projectId: { type: "string", description: "Project ID to associate with" },
              dueDate: { type: "string", description: "Due date (YYYY-MM-DD)" },
              focusDate: { type: "string", description: "Focus date for scheduling (YYYY-MM-DD)" },
              notes: { type: "string", description: "Additional notes" }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_task",
          description: "Update an existing task. Use when user wants to modify, complete, or change a task.",
          parameters: {
            type: "object",
            properties: {
              taskId: { type: "string", description: "Task ID to update" },
              title: { type: "string" },
              status: { type: "string" },
              priority: { type: "string" },
              notes: { type: "string" },
              dueDate: { type: "string" },
              focusDate: { type: "string" }
            },
            required: ["taskId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_captures",
          description: "Get capture items (inbox/brain dump items). Use when user asks about their captures, inbox, or ideas.",
          parameters: {
            type: "object",
            properties: {
              clarified: { type: "boolean", description: "Filter by clarified status" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_capture",
          description: "Create a quick capture/inbox item. Use for quick thoughts, ideas, or items to process later.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Capture title/content" },
              type: { type: "string", description: "Type: idea, task, note, link, question" },
              notes: { type: "string", description: "Additional notes" }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_health_entries",
          description: "Get health tracking entries. Use when user asks about health, sleep, energy, workouts.",
          parameters: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
              endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
              limit: { type: "number", description: "Max entries to return" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_nutrition_entries",
          description: "Get nutrition/meal entries. Use when user asks about meals, nutrition, calories.",
          parameters: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
              endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
              limit: { type: "number", description: "Max entries to return" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_docs",
          description: "Get documents (SOPs, prompts, specs, templates). Use when user asks about documents or knowledge base.",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string", description: "Filter by type: sop, prompt, spec, template, playbook" },
              ventureId: { type: "string", description: "Filter by venture" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "read_doc",
          description: "Read the full content of a specific document. Use when you need to read the body/content of a document, SOP, or knowledge base entry.",
          parameters: {
            type: "object",
            properties: {
              docId: { type: "string", description: "The document ID to read" }
            },
            required: ["docId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "search_docs",
          description: "Search documents by keyword. Use when user asks to find documents about a topic, or search the knowledge base.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query - keywords to find in documents" },
              type: { type: "string", description: "Optional filter by type: sop, prompt, spec, template, playbook" },
              ventureId: { type: "string", description: "Optional filter by venture" }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "query_knowledge_base",
          description: "Intelligently search and answer questions from the knowledge base (docs + uploaded files). Uses semantic search. Use when user asks 'what do my docs say about X' or needs information from their knowledge base.",
          parameters: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question to answer or topic to search" },
              ventureId: { type: "string", description: "Optional filter by venture" },
              limit: { type: "number", description: "Max results (default 5)" }
            },
            required: ["question"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_insights",
          description: "Get AI-generated insights and patterns. Use when user asks for analysis, patterns, trends, or insights about their data.",
          parameters: {
            type: "object",
            properties: {
              area: {
                type: "string",
                description: "Area to analyze: health, productivity, trading, tasks, projects, overall",
                enum: ["health", "productivity", "trading", "tasks", "projects", "overall"]
              },
              days: { type: "number", description: "Number of days to analyze (default 30)" }
            },
            required: ["area"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_knowledge_files",
          description: "Get uploaded knowledge files (PDFs, images, documents) with their extracted text and AI summaries. Use when user asks about uploaded files, attached documents, or needs content from PDFs/images.",
          parameters: {
            type: "object",
            properties: {
              ventureId: { type: "string", description: "Filter by venture" },
              category: { type: "string", description: "Filter by category: document, strategy, playbook, notes, research, reference, template, image" },
              includeContent: { type: "boolean", description: "Include extracted text content (can be large)" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "read_knowledge_file",
          description: "Read the full content of a specific knowledge file. Use when you need the complete extracted text from a PDF, image, or document.",
          parameters: {
            type: "object",
            properties: {
              fileId: { type: "string", description: "The knowledge file ID" }
            },
            required: ["fileId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_summary",
          description: "Get a summary of the user's system - venture count, active projects, pending tasks, etc.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      // Trading tools
      {
        type: "function",
        function: {
          name: "get_trading_strategies",
          description: "Get trading strategies. Use when user asks about trading strategies, setups, or rules.",
          parameters: {
            type: "object",
            properties: {
              activeOnly: { type: "boolean", description: "Only return active strategies" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_trading_checklist",
          description: "Get today's trading checklist or a specific date. Use when user asks about their trading day, checklist, or session.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date (YYYY-MM-DD), defaults to today" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_trading_journal",
          description: "Get trading journal entries from the day records. Use when user asks about their trades, P&L, or trading history.",
          parameters: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
              endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
              limit: { type: "number", description: "Max entries to return" }
            }
          }
        }
      },
      // Shopping tools
      {
        type: "function",
        function: {
          name: "get_shopping_items",
          description: "Get shopping list items. Use when user asks about shopping, what to buy, or groceries.",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string", description: "Filter by status: to_buy, purchased" },
              category: { type: "string", description: "Filter by category: groceries, personal, household, business" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_shopping_item",
          description: "Add an item to the shopping list.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Item name" },
              quantity: { type: "number", description: "Quantity needed" },
              unit: { type: "string", description: "Unit of measure" },
              category: { type: "string", description: "Category: groceries, personal, household, business" },
              priority: { type: "string", description: "Priority: P1, P2, P3" },
              store: { type: "string", description: "Preferred store" },
              notes: { type: "string", description: "Additional notes" }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_shopping_item",
          description: "Update a shopping item (mark as purchased, change quantity, etc).",
          parameters: {
            type: "object",
            properties: {
              itemId: { type: "string", description: "Shopping item ID" },
              status: { type: "string", description: "Status: to_buy, purchased" },
              quantity: { type: "number" },
              notes: { type: "string" }
            },
            required: ["itemId"]
          }
        }
      },
      // Books tools
      {
        type: "function",
        function: {
          name: "get_books",
          description: "Get books from reading list. Use when user asks about books, reading, or what they're reading.",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string", description: "Filter by status: to_read, reading, finished" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_book",
          description: "Update a book's reading progress or status.",
          parameters: {
            type: "object",
            properties: {
              bookId: { type: "string", description: "Book ID" },
              status: { type: "string", description: "Status: to_read, reading, finished" },
              notes: { type: "string", description: "Reading notes or highlights" },
              rating: { type: "number", description: "Rating 1-5" }
            },
            required: ["bookId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_book",
          description: "Add a new book to the reading list. Use when user wants to add a book, says 'add to my reading list', or mentions wanting to read something.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Book title" },
              author: { type: "string", description: "Author name" },
              status: { type: "string", description: "Status: to_read, reading, finished. Defaults to to_read" },
              platform: { type: "string", description: "Reading platform (Kindle, Audible, Physical, etc.)" },
              notes: { type: "string", description: "Notes about the book or why user wants to read it" }
            },
            required: ["title"]
          }
        }
      },
      // Days and Rituals tools
      {
        type: "function",
        function: {
          name: "get_day",
          description: "Get day record including morning/evening rituals, top 3 outcomes, mood, reflections. Use when user asks about their day, rituals, or planning.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date (YYYY-MM-DD), defaults to today" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_day",
          description: "Update day record - set mood, reflections, top 3 outcomes, ritual completion.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date (YYYY-MM-DD)" },
              mood: { type: "string", description: "Mood: low, medium, high, peak" },
              top3Outcomes: { type: "array", items: { type: "object" }, description: "Array of {text, completed} for top 3 priorities" },
              oneThingToShip: { type: "string", description: "Single most important deliverable" },
              reflectionAm: { type: "string", description: "Morning intention/reflection" },
              reflectionPm: { type: "string", description: "Evening review/reflection" },
              primaryVentureFocus: { type: "string", description: "Venture ID to focus on" }
            },
            required: ["date"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_full_system_overview",
          description: "Get comprehensive overview of entire SB-OS system - all ventures, projects, tasks, health, trading, shopping, books. Use for executive summaries or big-picture questions.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      // === WRITE TOOLS FOR ALL ENTITIES ===
      // Health tools
      {
        type: "function",
        function: {
          name: "create_health_entry",
          description: "Log health metrics for a day. Use when user mentions sleep, energy, mood, workouts, weight, or how they're feeling physically. ALWAYS extract and log at least one metric from what the user mentions (e.g., if they say 'slept 7 hours', set sleepHours to 7).",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date (YYYY-MM-DD). Use today's date if not specified." },
              sleepHours: { type: "number", description: "Hours slept (e.g., 7.5)" },
              sleepQuality: { type: "string", description: "Sleep quality: poor, fair, good, excellent" },
              energyLevel: { type: "number", description: "Energy 1-5 scale" },
              mood: { type: "string", description: "Mood: low, medium, high, peak" },
              steps: { type: "number", description: "Steps walked" },
              weightKg: { type: "number", description: "Weight in kg" },
              stressLevel: { type: "string", description: "Stress: low, medium, high" },
              workoutDone: { type: "boolean", description: "Did workout happen?" },
              workoutType: { type: "string", description: "Workout type: strength, cardio, yoga, sports, none" },
              workoutDurationMin: { type: "number", description: "Workout duration in minutes" },
              notes: { type: "string", description: "Additional health notes" }
            },
            required: ["date"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_health_entry",
          description: "Update an existing health entry.",
          parameters: {
            type: "object",
            properties: {
              entryId: { type: "string", description: "Health entry ID" },
              sleepHours: { type: "number" },
              sleepQuality: { type: "string" },
              energyLevel: { type: "number" },
              mood: { type: "string" },
              steps: { type: "number" },
              weightKg: { type: "number" },
              stressLevel: { type: "string" },
              workoutDone: { type: "boolean" },
              workoutType: { type: "string" },
              workoutDurationMin: { type: "number" },
              notes: { type: "string" }
            },
            required: ["entryId"]
          }
        }
      },
      // Nutrition tools
      {
        type: "function",
        function: {
          name: "create_nutrition_entry",
          description: "Log a meal or food intake. Use when user mentions eating, meals, food, calories, protein, or macros.",
          parameters: {
            type: "object",
            properties: {
              description: { type: "string", description: "Meal description (e.g., 'Grilled chicken salad')" },
              mealType: { type: "string", description: "Meal type: breakfast, lunch, dinner, snack" },
              calories: { type: "number", description: "Approximate calories" },
              proteinG: { type: "number", description: "Protein in grams" },
              carbsG: { type: "number", description: "Carbs in grams" },
              fatsG: { type: "number", description: "Fats in grams" },
              context: { type: "string", description: "Where: home, restaurant, office, travel" },
              notes: { type: "string", description: "Additional notes" }
            },
            required: ["description"]
          }
        }
      },
      // Project tools
      {
        type: "function",
        function: {
          name: "create_project",
          description: "Create a new project under a venture. Use when user wants to start a new project or initiative.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Project name" },
              ventureId: { type: "string", description: "Parent venture ID" },
              status: { type: "string", description: "Status: not_started, planning, in_progress, blocked, done" },
              category: { type: "string", description: "Category: marketing, sales_biz_dev, product, tech_engineering, operations, etc." },
              priority: { type: "string", description: "Priority: P0, P1, P2, P3" },
              outcome: { type: "string", description: "What success looks like" },
              notes: { type: "string", description: "Project notes and strategy" },
              startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
              targetEndDate: { type: "string", description: "Target end date (YYYY-MM-DD)" }
            },
            required: ["name", "ventureId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_project",
          description: "Update an existing project.",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "Project ID" },
              name: { type: "string" },
              status: { type: "string" },
              priority: { type: "string" },
              outcome: { type: "string" },
              notes: { type: "string" },
              targetEndDate: { type: "string" }
            },
            required: ["projectId"]
          }
        }
      },
      // Venture tools
      {
        type: "function",
        function: {
          name: "create_venture",
          description: "Create a new venture/business initiative. Use when user wants to start tracking a new business or major initiative.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Venture name" },
              domain: { type: "string", description: "Domain: saas, media, realty, trading, personal, other" },
              status: { type: "string", description: "Status: planning, building, on_hold, ongoing, archived" },
              oneLiner: { type: "string", description: "One-sentence description" },
              primaryFocus: { type: "string", description: "Main strategic focus" },
              color: { type: "string", description: "Display color (hex)" },
              notes: { type: "string", description: "Additional notes" }
            },
            required: ["name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_venture",
          description: "Update an existing venture.",
          parameters: {
            type: "object",
            properties: {
              ventureId: { type: "string", description: "Venture ID" },
              name: { type: "string" },
              status: { type: "string" },
              oneLiner: { type: "string" },
              primaryFocus: { type: "string" },
              notes: { type: "string" }
            },
            required: ["ventureId"]
          }
        }
      },
      // Doc/Note tools
      {
        type: "function",
        function: {
          name: "create_doc",
          description: "Create a new document with content. ALWAYS generate meaningful body content based on the document type and user's request. Never create empty documents.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Document title" },
              type: { type: "string", description: "Type: page, sop, prompt, spec, template, playbook, process, meeting_notes, research" },
              domain: { type: "string", description: "Domain: venture_ops, marketing, product, tech, trading, personal" },
              body: { type: "string", description: "Document content in markdown. REQUIRED - generate appropriate content based on document type. For SOPs include steps, for playbooks include strategies, for checklists include checkbox items, etc." },
              ventureId: { type: "string", description: "Associated venture ID" },
              projectId: { type: "string", description: "Associated project ID" },
              tags: { type: "string", description: "Comma-separated tags" }
            },
            required: ["title", "body"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_doc",
          description: "Update an existing document.",
          parameters: {
            type: "object",
            properties: {
              docId: { type: "string", description: "Document ID" },
              title: { type: "string" },
              body: { type: "string" },
              status: { type: "string", description: "Status: draft, active, archived" },
              tags: { type: "string" }
            },
            required: ["docId"]
          }
        }
      },
      // Delete tools
      {
        type: "function",
        function: {
          name: "delete_task",
          description: "Delete a task. Use when user wants to remove or delete a task.",
          parameters: {
            type: "object",
            properties: {
              taskId: { type: "string", description: "Task ID to delete" }
            },
            required: ["taskId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_capture",
          description: "Delete a capture/inbox item.",
          parameters: {
            type: "object",
            properties: {
              captureId: { type: "string", description: "Capture ID to delete" }
            },
            required: ["captureId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_shopping_item",
          description: "Delete a shopping list item.",
          parameters: {
            type: "object",
            properties: {
              itemId: { type: "string", description: "Shopping item ID to delete" }
            },
            required: ["itemId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_book",
          description: "Delete a book from the reading list.",
          parameters: {
            type: "object",
            properties: {
              bookId: { type: "string", description: "Book ID to delete" }
            },
            required: ["bookId"]
          }
        }
      }
    ];

    // Tool execution function
    const executeTool = async (name: string, args: any): Promise<string> => {
      try {
        switch (name) {
          case "get_ventures": {
            const ventures = await storage.getVentures();
            return JSON.stringify(ventures.map(v => ({
              id: v.id, name: v.name, status: v.status, domain: v.domain, oneLiner: v.oneLiner
            })));
          }
          case "get_projects": {
            const projects = await storage.getProjects({ ventureId: args.ventureId });
            const filtered = args.status ? projects.filter(p => p.status === args.status) : projects;
            return JSON.stringify(filtered.map(p => ({
              id: p.id, name: p.name, status: p.status, ventureId: p.ventureId, priority: p.priority
            })));
          }
          case "get_tasks": {
            const tasks = await storage.getTasks(args);
            return JSON.stringify(tasks.map((t: any) => ({
              id: t.id, title: t.title, status: t.status, priority: t.priority,
              dueDate: t.dueDate, focusDate: t.focusDate, ventureId: t.ventureId
            })));
          }
          case "get_today_tasks": {
            const tasks = await storage.getTasksForToday(today);
            return JSON.stringify(tasks.map((t: any) => ({
              id: t.id, title: t.title, status: t.status, priority: t.priority, focusSlot: t.focusSlot
            })));
          }
          case "create_task": {
            const task = await storage.createTask(args);
            return JSON.stringify({ success: true, task: { id: task.id, title: task.title } });
          }
          case "update_task": {
            const { taskId, ...updates } = args;
            const task = await storage.updateTask(taskId, updates);
            return JSON.stringify({ success: true, task: task ? { id: task.id, title: task.title, status: task.status } : null });
          }
          case "get_captures": {
            const captures = await storage.getCaptures({ clarified: args.clarified });
            return JSON.stringify(captures.map((c: any) => ({
              id: c.id, title: c.title, type: c.type, clarified: c.clarified
            })));
          }
          case "create_capture": {
            const capture = await storage.createCapture(args);
            return JSON.stringify({ success: true, capture: { id: capture.id, title: capture.title } });
          }
          case "get_health_entries": {
            const entries = await storage.getHealthEntries({ dateGte: args.startDate, dateLte: args.endDate });
            return JSON.stringify(entries.slice(0, args.limit || 10));
          }
          case "get_nutrition_entries": {
            const entries = await storage.getNutritionEntries({ date: args.startDate });
            return JSON.stringify(entries.slice(0, args.limit || 10));
          }
          case "get_docs": {
            const docs = await storage.getDocs({ type: args.type, ventureId: args.ventureId });
            return JSON.stringify(docs.map((d: any) => ({
              id: d.id, title: d.title, type: d.type, status: d.status
            })));
          }
          case "read_doc": {
            const doc = await storage.getDoc(args.docId);
            if (!doc) {
              return JSON.stringify({ error: "Document not found" });
            }
            return JSON.stringify({
              id: doc.id,
              title: doc.title,
              type: doc.type,
              domain: doc.domain,
              body: doc.body,
              content: doc.content,
              summary: doc.summary,
              keyPoints: doc.keyPoints,
              tags: doc.tags,
              status: doc.status,
              ventureId: doc.ventureId,
              projectId: doc.projectId,
            });
          }
          case "search_docs": {
            const docs = await storage.searchDocs(args.query);
            // Filter by type/venture if provided
            let filtered = docs;
            if (args.type) {
              filtered = filtered.filter(d => d.type === args.type);
            }
            if (args.ventureId) {
              filtered = filtered.filter(d => d.ventureId === args.ventureId);
            }
            return JSON.stringify(filtered.slice(0, 20).map((d: any) => ({
              id: d.id,
              title: d.title,
              type: d.type,
              summary: d.summary,
              body: d.body?.substring(0, 500) + (d.body?.length > 500 ? '...' : ''),
            })));
          }
          case "query_knowledge_base": {
            // Use hybrid search for intelligent querying
            const { hybridSearch } = await import("../vector-search");
            const results = await hybridSearch(args.question, {
              ventureId: args.ventureId,
              limit: args.limit || 5,
            });

            if (results.length === 0) {
              // Fallback to simple search
              const docs = await storage.searchDocs(args.question);
              const files = await storage.getKnowledgeFiles({
                ventureId: args.ventureId,
                processingStatus: "completed"
              });

              const docResults = docs.slice(0, 3).map(d => ({
                type: 'doc',
                title: d.title,
                content: d.summary || d.body?.substring(0, 500) || '',
              }));

              const fileResults = files
                .filter(f => f.extractedText?.toLowerCase().includes(args.question.toLowerCase()))
                .slice(0, 3)
                .map(f => ({
                  type: 'file',
                  title: f.name,
                  content: f.aiSummary || f.extractedText?.substring(0, 500) || '',
                }));

              return JSON.stringify({
                answer: "Found some potentially relevant content:",
                results: [...docResults, ...fileResults],
              });
            }

            return JSON.stringify({
              answer: `Found ${results.length} relevant items:`,
              results: results.map(r => ({
                type: r.type,
                title: r.title,
                content: r.content.substring(0, 500),
                relevance: Math.round(r.similarity * 100) + '%',
              })),
            });
          }
          case "get_insights": {
            const days = args.days || 30;
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const insights: any = { area: args.area, period: `${days} days`, insights: [] };

            if (args.area === 'health' || args.area === 'overall') {
              const health = await storage.getHealthEntries({
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0]
              });
              if (health.length > 0) {
                const avgSleep = health.reduce((sum, h) => sum + (h.sleepHours || 0), 0) / health.length;
                const avgEnergy = health.reduce((sum, h) => sum + (h.energyLevel || 0), 0) / health.length;
                const workoutDays = health.filter(h => h.workoutDone).length;
                insights.health = {
                  avgSleepHours: avgSleep.toFixed(1),
                  avgEnergyLevel: avgEnergy.toFixed(1),
                  workoutFrequency: `${workoutDays}/${health.length} days`,
                  trend: avgEnergy >= 3.5 ? 'positive' : avgEnergy >= 2.5 ? 'stable' : 'needs attention',
                };
                insights.insights.push(
                  avgSleep < 7 ? `⚠️ Average sleep (${avgSleep.toFixed(1)}h) is below recommended 7-8h` : `✅ Good sleep average: ${avgSleep.toFixed(1)}h`,
                  avgEnergy < 3 ? `⚠️ Energy levels trending low (${avgEnergy.toFixed(1)}/5)` : `✅ Energy levels healthy: ${avgEnergy.toFixed(1)}/5`
                );
              }
            }

            if (args.area === 'productivity' || args.area === 'tasks' || args.area === 'overall') {
              const tasks = await storage.getTasks({});
              const completed = tasks.filter(t => t.status === 'done');
              const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done');
              const inProgress = tasks.filter(t => t.status === 'in_progress');

              insights.tasks = {
                total: tasks.length,
                completed: completed.length,
                inProgress: inProgress.length,
                overdue: overdue.length,
                completionRate: tasks.length > 0 ? Math.round(completed.length / tasks.length * 100) + '%' : 'N/A',
              };

              if (overdue.length > 0) {
                insights.insights.push(`⚠️ ${overdue.length} overdue tasks need attention`);
              }
              if (inProgress.length > 5) {
                insights.insights.push(`⚠️ ${inProgress.length} tasks in progress - consider focusing on fewer items`);
              }
            }

            if (args.area === 'projects' || args.area === 'overall') {
              const projects = await storage.getProjects({});
              const active = projects.filter(p => p.status === 'in_progress');
              const blocked = projects.filter(p => p.status === 'blocked');

              insights.projects = {
                total: projects.length,
                active: active.length,
                blocked: blocked.length,
              };

              if (blocked.length > 0) {
                insights.insights.push(`🚧 ${blocked.length} blocked projects: ${blocked.map(p => p.name).join(', ')}`);
              }
            }

            if (args.area === 'trading' || args.area === 'overall') {
              const checklists = await storage.getDailyTradingChecklists({});
              if (checklists.length > 0) {
                const withTrades = checklists.filter(c => c.trades && (c.trades as any[]).length > 0);
                const totalPnL = withTrades.reduce((sum, c) => {
                  const trades = c.trades as any[];
                  return sum + trades.reduce((s, t) => s + (t.pnl || 0), 0);
                }, 0);

                insights.trading = {
                  sessionsLogged: checklists.length,
                  sessionsWithTrades: withTrades.length,
                  totalPnL: totalPnL,
                };

                if (totalPnL < 0) {
                  insights.insights.push(`📉 Trading P&L is negative (${totalPnL}) - review strategy`);
                } else if (totalPnL > 0) {
                  insights.insights.push(`📈 Trading P&L is positive (+${totalPnL})`);
                }
              }
            }

            return JSON.stringify(insights);
          }
          case "get_knowledge_files": {
            const files = await storage.getKnowledgeFiles({
              ventureId: args.ventureId,
              category: args.category,
              processingStatus: "completed", // Only return processed files
            });
            return JSON.stringify(files.map((f: any) => {
              const result: any = {
                id: f.id,
                name: f.name,
                category: f.category,
                mimeType: f.mimeType,
                summary: f.aiSummary,
                tags: f.aiTags,
                processingStatus: f.processingStatus,
                ventureId: f.ventureId,
              };
              // Include content if requested (for detailed analysis)
              if (args.includeContent && f.extractedText) {
                // Truncate very long content
                result.extractedText = f.extractedText.length > 5000
                  ? f.extractedText.substring(0, 5000) + "\n[... truncated ...]"
                  : f.extractedText;
              }
              return result;
            }));
          }
          case "read_knowledge_file": {
            const file = await storage.getKnowledgeFile(args.fileId);
            if (!file) {
              return JSON.stringify({ error: "Knowledge file not found" });
            }
            if (file.processingStatus !== "completed") {
              return JSON.stringify({
                error: "File not yet processed",
                status: file.processingStatus
              });
            }
            return JSON.stringify({
              id: file.id,
              name: file.name,
              category: file.category,
              extractedText: file.extractedText,
              summary: file.aiSummary,
              tags: file.aiTags,
              metadata: file.aiMetadata,
            });
          }
          case "get_summary": {
            const [ventures, projects, tasks, captures] = await Promise.all([
              storage.getVentures(),
              storage.getProjects(),
              storage.getTasks({}),
              storage.getCaptures()
            ]);
            const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'on_hold');
            const todayTasks = tasks.filter(t => t.focusDate === today);
            return JSON.stringify({
              ventures: ventures.length,
              activeVentures: ventures.filter(v => v.status === 'active').length,
              projects: projects.length,
              activeProjects: projects.filter(p => p.status === 'in_progress').length,
              totalTasks: tasks.length,
              activeTasks: activeTasks.length,
              todayTasks: todayTasks.length,
              unclarifiedCaptures: captures.filter(c => !c.clarified).length
            });
          }
          // Trading tool handlers
          case "get_trading_strategies": {
            const strategies = await storage.getTradingStrategies();
            const filtered = args.activeOnly ? strategies.filter(s => s.isActive) : strategies;
            return JSON.stringify(filtered.map(s => ({
              id: s.id, name: s.name, description: s.description, isActive: s.isActive, isDefault: s.isDefault
            })));
          }
          case "get_trading_checklist": {
            const checklistDate = args.date || today;
            const checklist = await storage.getDailyTradingChecklistByDate(checklistDate).catch(() => null);
            if (!checklist) {
              return JSON.stringify({ message: `No trading checklist for ${checklistDate}` });
            }
            // Access data from the nested data property
            const data = checklist.data;
            return JSON.stringify({
              id: checklist.id,
              date: checklist.date,
              strategyId: checklist.strategyId,
              instrument: data?.instrument,
              session: data?.session,
              mentalState: data?.mentalState,
              primarySetup: data?.primarySetup,
              highImpactNews: data?.highImpactNews,
              trades: data?.trades,
              endOfSessionReview: data?.endOfSessionReview,
              values: data?.values,
            });
          }
          case "get_trading_journal": {
            const startDate = args.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const endDate = args.endDate || today;
            const limit = args.limit || 30;
            const days = await storage.getDays({ dateGte: startDate, dateLte: endDate });
            const journalEntries = days
              .filter(d => d.tradingJournal && Object.keys(d.tradingJournal as object).length > 0)
              .slice(0, limit)
              .map(d => ({
                date: d.date,
                tradingJournal: d.tradingJournal,
              }));
            return JSON.stringify(journalEntries);
          }
          // Shopping tool handlers
          case "get_shopping_items": {
            const items = await storage.getShoppingItems();
            let filtered = items;
            if (args.status) {
              filtered = filtered.filter(i => i.status === args.status);
            }
            if (args.category) {
              filtered = filtered.filter(i => i.category === args.category);
            }
            return JSON.stringify(filtered.map(i => ({
              id: i.id, title: i.title, quantity: i.quantity, unit: i.unit,
              category: i.category, priority: i.priority, status: i.status, store: i.store
            })));
          }
          case "create_shopping_item": {
            const item = await storage.createShoppingItem({
              title: args.title,
              quantity: args.quantity || 1,
              unit: args.unit || null,
              category: args.category || 'groceries',
              priority: args.priority || 'P2',
              status: 'to_buy',
              store: args.store || null,
              notes: args.notes || null,
            });
            return JSON.stringify({ success: true, item: { id: item.id, title: item.title } });
          }
          case "update_shopping_item": {
            const { itemId, ...updates } = args;
            const item = await storage.updateShoppingItem(itemId, updates);
            return JSON.stringify({ success: true, item: item ? { id: item.id, title: item.title, status: item.status } : null });
          }
          // Books tool handlers
          case "get_books": {
            const books = await storage.getBooks();
            const filtered = args.status ? books.filter(b => b.status === args.status) : books;
            return JSON.stringify(filtered.map(b => ({
              id: b.id, title: b.title, author: b.author, status: b.status,
              platform: b.platform, rating: b.rating
            })));
          }
          case "update_book": {
            const { bookId, ...bookUpdates } = args;
            const book = await storage.updateBook(bookId, bookUpdates);
            return JSON.stringify({ success: true, book: book ? { id: book.id, title: book.title, status: book.status } : null });
          }
          case "create_book": {
            const book = await storage.createBook({
              title: args.title,
              author: args.author || "Unknown",
              status: args.status || "to_read",
              platform: args.platform || null,
              notes: args.notes || null,
            });
            return JSON.stringify({
              success: true,
              message: `Added "${book.title}" to your reading list`,
              book: { id: book.id, title: book.title, author: book.author, status: book.status }
            });
          }
          // Day and Rituals tool handlers
          case "get_day": {
            const dayDate = args.date || today;
            const day = await storage.getDay(dayDate).catch(() => null);
            if (!day) {
              return JSON.stringify({ message: `No day record for ${dayDate}` });
            }
            return JSON.stringify({
              id: day.id,
              date: day.date,
              title: day.title,
              mood: day.mood,
              top3Outcomes: day.top3Outcomes,
              oneThingToShip: day.oneThingToShip,
              reflectionAm: day.reflectionAm,
              reflectionPm: day.reflectionPm,
              primaryVentureFocus: day.primaryVentureFocus,
              morningRituals: day.morningRituals,
              eveningRituals: day.eveningRituals,
              tradingJournal: day.tradingJournal,
            });
          }
          case "update_day": {
            const dayDate = args.date || today;
            let day = await storage.getDay(dayDate).catch(() => null);
            if (!day) {
              // Create the day if it doesn't exist
              day = await storage.createDay({
                id: `day_${dayDate}`,
                date: dayDate,
              });
            }
            const { date: _, ...dayUpdates } = args;
            const updated = await storage.updateDay(day.id, dayUpdates);
            return JSON.stringify({ success: true, day: updated ? { id: updated.id, date: updated.date, mood: updated.mood } : null });
          }
          // Full system overview
          case "get_full_system_overview": {
            const { buildSystemOverview } = await import("../ai-coo-context-builder");
            const overview = await buildSystemOverview();
            return JSON.stringify(overview);
          }
          // === WRITE HANDLERS FOR ALL ENTITIES ===
          // Health handlers
          case "create_health_entry": {
            const entryDate = args.date || today;
            // Ensure day exists
            let day = await storage.getDay(entryDate).catch(() => null);
            if (!day) {
              day = await storage.createDay({ id: `day_${entryDate}`, date: entryDate });
            }
            const entry = await storage.createHealthEntry({
              dayId: day.id,
              date: entryDate,
              sleepHours: args.sleepHours,
              sleepQuality: args.sleepQuality,
              energyLevel: args.energyLevel,
              mood: args.mood,
              steps: args.steps,
              weightKg: args.weightKg,
              stressLevel: args.stressLevel,
              workoutDone: args.workoutDone,
              workoutType: args.workoutType,
              workoutDurationMin: args.workoutDurationMin,
              notes: args.notes,
            });
            return JSON.stringify({
              success: true,
              message: `Logged health entry for ${entryDate}`,
              entry: { id: entry.id, date: entry.date, mood: entry.mood, energyLevel: entry.energyLevel }
            });
          }
          case "update_health_entry": {
            const { entryId, ...healthUpdates } = args;
            const entry = await storage.updateHealthEntry(entryId, healthUpdates);
            return JSON.stringify({ success: true, entry: entry ? { id: entry.id, date: entry.date } : null });
          }
          // Nutrition handler
          case "create_nutrition_entry": {
            // Ensure day exists
            let day = await storage.getDay(today).catch(() => null);
            if (!day) {
              day = await storage.createDay({ id: `day_${today}`, date: today });
            }
            const entry = await storage.createNutritionEntry({
              dayId: day.id,
              datetime: new Date().toISOString(),
              description: args.description,
              mealType: args.mealType || "snack",
              calories: args.calories,
              proteinG: args.proteinG,
              carbsG: args.carbsG,
              fatsG: args.fatsG,
              context: args.context,
              notes: args.notes,
            });
            return JSON.stringify({
              success: true,
              message: `Logged ${args.mealType || "meal"}: ${args.description}`,
              entry: { id: entry.id, description: entry.description, calories: entry.calories, proteinG: entry.proteinG }
            });
          }
          // Project handlers
          case "create_project": {
            const project = await storage.createProject({
              name: args.name,
              ventureId: args.ventureId,
              status: args.status || "not_started",
              category: args.category,
              priority: args.priority || "P2",
              outcome: args.outcome,
              notes: args.notes,
              startDate: args.startDate,
              targetEndDate: args.targetEndDate,
            });
            return JSON.stringify({
              success: true,
              message: `Created project "${project.name}"`,
              project: { id: project.id, name: project.name, status: project.status }
            });
          }
          case "update_project": {
            const { projectId, ...projectUpdates } = args;
            const project = await storage.updateProject(projectId, projectUpdates);
            return JSON.stringify({ success: true, project: project ? { id: project.id, name: project.name, status: project.status } : null });
          }
          // Venture handlers
          case "create_venture": {
            const venture = await storage.createVenture({
              name: args.name,
              domain: args.domain || "other",
              status: args.status || "planning",
              oneLiner: args.oneLiner,
              primaryFocus: args.primaryFocus,
              color: args.color,
              notes: args.notes,
            });
            return JSON.stringify({
              success: true,
              message: `Created venture "${venture.name}"`,
              venture: { id: venture.id, name: venture.name, domain: venture.domain }
            });
          }
          case "update_venture": {
            const { ventureId, ...ventureUpdates } = args;
            const venture = await storage.updateVenture(ventureId, ventureUpdates);
            return JSON.stringify({ success: true, venture: venture ? { id: venture.id, name: venture.name, status: venture.status } : null });
          }
          // Doc handlers
          case "create_doc": {
            const doc = await storage.createDoc({
              title: args.title,
              type: args.type || "page",
              domain: args.domain,
              body: args.body,
              ventureId: args.ventureId,
              projectId: args.projectId,
              tags: args.tags,
              status: "active",
            });
            return JSON.stringify({
              success: true,
              message: `Created document "${doc.title}"`,
              doc: { id: doc.id, title: doc.title, type: doc.type }
            });
          }
          case "update_doc": {
            const { docId, ...docUpdates } = args;
            const doc = await storage.updateDoc(docId, docUpdates);
            return JSON.stringify({ success: true, doc: doc ? { id: doc.id, title: doc.title } : null });
          }
          // Delete handlers
          case "delete_task": {
            await storage.deleteTask(args.taskId);
            return JSON.stringify({ success: true, message: "Task deleted" });
          }
          case "delete_capture": {
            await storage.deleteCaptureItem(args.captureId);
            return JSON.stringify({ success: true, message: "Capture item deleted" });
          }
          case "delete_shopping_item": {
            await storage.deleteShoppingItem(args.itemId);
            return JSON.stringify({ success: true, message: "Shopping item deleted" });
          }
          case "delete_book": {
            await storage.deleteBook(args.bookId);
            return JSON.stringify({ success: true, message: "Book removed from reading list" });
          }
          default:
            return JSON.stringify({ error: "Unknown tool" });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error({ error, errorMessage, tool: name, args }, "Tool execution error");
        return JSON.stringify({ error: `Tool execution failed: ${errorMessage}` });
      }
    };

    // Initial completion with tools
    let messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: message },
    ];

    let completion = await openai.chat.completions.create({
      model: preferredModel,
      messages,
      tools,
      tool_choice: "auto",
      temperature,
      max_tokens: Math.min(maxTokens, 4096), // Cap at 4096 for tool calls
    });

    let responseMessage = completion.choices[0]?.message;

    // Handle tool calls (loop for multiple rounds if needed)
    let iterations = 0;
    while (responseMessage?.tool_calls && iterations < 5) {
      iterations++;
      const toolResults = await Promise.all(
        responseMessage.tool_calls.map(async (toolCall: any) => {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const result = await executeTool(toolCall.function.name, args);
          return {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            content: result,
          };
        })
      );

      messages = [
        ...messages,
        responseMessage,
        ...toolResults,
      ];

      completion = await openai.chat.completions.create({
        model: preferredModel,
        messages,
        tools,
        tool_choice: "auto",
        temperature,
        max_tokens: Math.min(maxTokens, 4096),
      });

      responseMessage = completion.choices[0]?.message;
    }

    const aiResponse = responseMessage?.content || "I'm sorry, I couldn't generate a response.";

    // Save AI response
    const assistantMessage = await storage.createChatMessage({
      userId,
      sessionId: sessionId || null,
      role: "assistant" as const,
      content: aiResponse,
      metadata: {
        model: preferredModel,
        tokensUsed: completion.usage?.total_tokens,
      } as any,
    });

    res.json({
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    logger.error({ error }, "Error processing chat message");
    res.status(500).json({ error: "Failed to process chat message" });
  }
});

// Clear chat history for current user (optionally by session)
router.delete("/chat/history", async (req: Request, res: Response) => {
  try {
    const userId = DEFAULT_USER_ID;
    const sessionId = req.query.sessionId as string | undefined;
    await storage.deleteChatHistory(userId, sessionId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error clearing chat history");
    res.status(500).json({ error: "Failed to clear chat history" });
  }
});

// ============================================================================
// VENTURE AI AGENT
// ============================================================================

// Send a chat message to a venture's AI agent
router.post("/ventures/:ventureId/chat", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Check if OpenRouter API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI service not configured",
        message: "OpenRouter API key is not set. Please configure the OPENROUTER_API_KEY environment variable."
      });
    }

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    // Dynamically import to avoid circular dependencies
    const { createVentureAgent } = await import("../venture-agent");

    // Create and initialize the venture agent
    const agent = await createVentureAgent(ventureId, userId);

    // Process the message
    const result = await agent.chat(message);

    res.json({
      response: result.response,
      actions: result.actions,
      model: result.model,
      tokensUsed: result.tokensUsed,
    });
  } catch (error: any) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error processing venture chat message");

    const errorMessage = error.message || "Failed to process message";

    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return res.status(503).json({
        error: "AI agent database not initialized",
        message: "The venture AI agent tables need to be created. Please run database migrations."
      });
    }

    if (errorMessage.includes('Venture not found')) {
      return res.status(404).json({ error: errorMessage });
    }

    if (errorMessage.includes('All AI models failed') || errorMessage.includes('401') || errorMessage.includes('429')) {
      return res.status(503).json({
        error: "AI Service Unavailable",
        message: "The AI service is currently unavailable or misconfigured. Please check your API key and credits.",
        details: errorMessage
      });
    }

    res.status(500).json({
      error: errorMessage,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      details: "Check server logs for full stack trace"
    });
  }
});

// Get chat history for a venture
router.get("/ventures/:ventureId/chat/history", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const history = await storage.getVentureConversations(ventureId, userId, limit);

    // Return in chronological order
    res.json(history.reverse());
  } catch (error) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error fetching venture chat history (returning empty)");
    res.json([]);
  }
});

// Clear chat history for a venture
router.delete("/ventures/:ventureId/chat/history", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    await storage.deleteVentureConversations(ventureId, userId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error clearing venture chat history (returning success)");
    res.json({ success: true });
  }
});

// Get venture AI agent actions (audit log)
router.get("/ventures/:ventureId/ai/actions", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const actions = await storage.getVentureAgentActions(ventureId, limit);
    res.json(actions);
  } catch (error) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error fetching venture AI actions (returning empty)");
    res.json([]);
  }
});

// Rebuild venture context cache
router.post("/ventures/:ventureId/ai/rebuild-context", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;

    // Invalidate existing cache
    await storage.invalidateVentureContextCache(ventureId);

    // Dynamically import to avoid circular dependencies
    const { getCachedOrBuildContext } = await import("../venture-context-builder");

    // Build fresh context
    const context = await getCachedOrBuildContext(ventureId, 0); // 0 hours = always rebuild

    res.json({
      success: true,
      contextLength: context.length,
      estimatedTokens: Math.ceil(context.length / 4),
    });
  } catch (error) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error rebuilding venture context");
    res.status(500).json({ error: "Failed to rebuild context" });
  }
});

// Get venture context status
router.get("/ventures/:ventureId/ai/context-status", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;

    const cached = await storage.getVentureContextCache(ventureId, "full");

    if (!cached) {
      return res.json({
        hasCachedContext: false,
        isStale: true,
      });
    }

    const isStale = !cached.validUntil || new Date(cached.validUntil) < new Date();

    res.json({
      hasCachedContext: true,
      isStale,
      lastBuiltAt: cached.lastBuiltAt,
      validUntil: cached.validUntil,
      tokenCount: cached.tokenCount,
      metadata: cached.metadata,
    });
  } catch (error) {
    logger.error({ error, ventureId: req.params.ventureId }, "Error fetching venture context status");
    res.status(500).json({ error: "Failed to fetch context status" });
  }
});

// ============================================================================
// TRADING AI AGENT - CHAT SESSIONS
// ============================================================================

// Get all chat sessions for the user
router.get("/trading/chat/sessions", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const sessions = await storage.getTradingChatSessions(userId);
    res.json(sessions);
  } catch (error) {
    logger.error({ error }, "Error fetching trading chat sessions");
    res.json([]);
  }
});

// Create a new chat session
router.post("/trading/chat/sessions", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const { title } = req.body;

    const session = await storage.createTradingChatSession({
      userId,
      title: title || "New Chat",
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error({ error }, "Error creating trading chat session");
    res.status(500).json({ error: "Failed to create chat session" });
  }
});

// Update a chat session (rename)
router.patch("/trading/chat/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;

    const session = await storage.updateTradingChatSession(sessionId, { title });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  } catch (error) {
    logger.error({ error }, "Error updating trading chat session");
    res.status(500).json({ error: "Failed to update chat session" });
  }
});

// Delete a chat session and its messages
router.delete("/trading/chat/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    await storage.deleteTradingChatSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting trading chat session");
    res.status(500).json({ error: "Failed to delete chat session" });
  }
});

// ============================================================================
// TRADING AI AGENT - CHAT MESSAGES
// ============================================================================

// Send a chat message to the trading AI agent
router.post("/trading/chat", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Check if OpenRouter API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI service not configured",
        message: "OpenRouter API key is not set. Please configure the OPENROUTER_API_KEY environment variable."
      });
    }

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    // Dynamically import to avoid circular dependencies
    const { createTradingAgent } = await import("../trading-agent");

    // Create and initialize the trading agent
    const agent = await createTradingAgent(userId);

    // Process the message with session context
    const result = await agent.chat(message, sessionId);

    res.json({
      response: result.response,
      actions: result.actions,
      model: result.model,
      tokensUsed: result.tokensUsed,
    });
  } catch (error: any) {
    logger.error({ error }, "Error processing trading chat message");

    const errorMessage = error.message || "Failed to process message";

    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return res.status(503).json({
        error: "Trading AI agent database not initialized",
        message: "The trading AI agent tables need to be created. Please run database migrations."
      });
    }

    if (errorMessage.includes('All AI models failed') || errorMessage.includes('401') || errorMessage.includes('429')) {
      return res.status(503).json({
        error: "AI Service Unavailable",
        message: "The AI service is currently unavailable or misconfigured. Please check your API key and credits.",
        details: errorMessage
      });
    }

    res.status(500).json({
      error: errorMessage,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      details: "Check server logs for full stack trace"
    });
  }
});

// Get trading chat history for a session
router.get("/trading/chat/history", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const sessionId = req.query.sessionId as string | undefined;

    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const history = await storage.getTradingConversations(userId, limit, sessionId);

    // Return in chronological order
    res.json(history.reverse());
  } catch (error) {
    logger.error({ error }, "Error fetching trading chat history (returning empty)");
    res.json([]);
  }
});

// Clear trading chat history for a session
router.delete("/trading/chat/history", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;
    const sessionId = req.query.sessionId as string | undefined;

    await storage.deleteTradingConversations(userId, sessionId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error clearing trading chat history (returning success)");
    res.json({ success: true });
  }
});

// Get trading agent config
router.get("/trading/agent/config", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const config = await storage.getTradingAgentConfig(userId);

    // Return default config if none exists
    if (!config) {
      return res.json({
        id: null,
        userId,
        systemPrompt: null,
        tradingStyle: null,
        instruments: null,
        timeframes: null,
        riskRules: null,
        tradingHours: null,
        quickActions: [],
        preferredModel: null,
        focusAreas: [],
        createdAt: null,
        updatedAt: null,
      });
    }

    res.json(config);
  } catch (error) {
    logger.error({ error }, "Error fetching trading agent config");
    res.status(500).json({ error: "Failed to fetch trading agent config" });
  }
});

// Update trading agent config
router.put("/trading/agent/config", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const config = await storage.upsertTradingAgentConfig(userId, req.body);
    res.json(config);
  } catch (error) {
    logger.error({ error }, "Error updating trading agent config");
    res.status(500).json({ error: "Failed to update trading agent config" });
  }
});

// ============================================================================
// TRADING KNOWLEDGE DOCUMENTS - Documents for AI agent training/context
// ============================================================================

// Get all trading knowledge documents for the user
router.get("/trading/knowledge-docs", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const { category, includeInContext } = req.query;
    const filters: { category?: string; includeInContext?: boolean } = {};

    if (category) filters.category = category as string;
    if (includeInContext !== undefined) {
      filters.includeInContext = includeInContext === "true";
    }

    const docs = await storage.getTradingKnowledgeDocs(userId, filters);

    // Don't send file data in list response for performance
    const docsWithoutData = docs.map(doc => ({
      ...doc,
      fileData: doc.fileData ? "[BASE64_DATA]" : null,
    }));

    res.json(docsWithoutData);
  } catch (error) {
    logger.error({ error }, "Error fetching trading knowledge docs");
    res.status(500).json({ error: "Failed to fetch trading knowledge docs" });
  }
});

// Get a single trading knowledge document
router.get("/trading/knowledge-docs/:id", async (req: Request, res: Response) => {
  try {
    const doc = await storage.getTradingKnowledgeDoc(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json(doc);
  } catch (error) {
    logger.error({ error }, "Error fetching trading knowledge doc");
    res.status(500).json({ error: "Failed to fetch trading knowledge doc" });
  }
});

// Create a trading knowledge document with file upload
router.post(
  "/trading/knowledge-docs",
  knowledgeDocUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      await ensureDefaultUserExists();
      const userId = DEFAULT_USER_ID;

      const { title, description, category, tags, priority, includeInContext, extractedText } = req.body;

      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      const file = req.file;

      // Prepare document data
      const docData: any = {
        userId,
        title,
        description: description || null,
        category: category || "other",
        tags: tags || null,
        priority: priority ? parseInt(priority) : 0,
        includeInContext: includeInContext !== "false",
        extractedText: extractedText || null,
      };

      // Handle file upload if present
      if (file) {
        docData.fileName = file.originalname;
        docData.fileType = file.mimetype;
        docData.fileSize = file.size;
        docData.storageType = "base64";
        docData.fileData = file.buffer.toString("base64");

        // For text files, extract content automatically
        if (file.mimetype === "text/plain" || file.mimetype === "text/markdown" || file.mimetype === "text/csv") {
          docData.extractedText = file.buffer.toString("utf-8");
        }
      }

      const doc = await storage.createTradingKnowledgeDoc(docData);

      // Don't return file data in response
      res.status(201).json({
        ...doc,
        fileData: doc.fileData ? "[BASE64_DATA]" : null,
      });
    } catch (error) {
      logger.error({ error }, "Error creating trading knowledge doc");
      res.status(500).json({ error: "Failed to create trading knowledge doc" });
    }
  }
);

// Update a trading knowledge document
router.patch("/trading/knowledge-docs/:id", async (req: Request, res: Response) => {
  try {
    const { title, description, category, tags, priority, includeInContext, extractedText, summary } = req.body;

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    if (priority !== undefined) updates.priority = parseInt(priority);
    if (includeInContext !== undefined) updates.includeInContext = includeInContext;
    if (extractedText !== undefined) updates.extractedText = extractedText;
    if (summary !== undefined) updates.summary = summary;

    const doc = await storage.updateTradingKnowledgeDoc(req.params.id, updates);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json({
      ...doc,
      fileData: doc.fileData ? "[BASE64_DATA]" : null,
    });
  } catch (error) {
    logger.error({ error }, "Error updating trading knowledge doc");
    res.status(500).json({ error: "Failed to update trading knowledge doc" });
  }
});

// Delete a trading knowledge document
router.delete("/trading/knowledge-docs/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteTradingKnowledgeDoc(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting trading knowledge doc");
    res.status(500).json({ error: "Failed to delete trading knowledge doc" });
  }
});

// Get documents formatted for AI context (text content only)
router.get("/trading/knowledge-docs/for-context", async (req: Request, res: Response) => {
  try {
    await ensureDefaultUserExists();
    const userId = DEFAULT_USER_ID;

    const docs = await storage.getTradingKnowledgeDocsForContext(userId);

    // Return only text content for AI context
    const contextDocs = docs.map(doc => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      content: doc.extractedText || doc.summary || doc.description || "",
    })).filter(doc => doc.content); // Only return docs with content

    res.json(contextDocs);
  } catch (error) {
    logger.error({ error }, "Error fetching trading knowledge docs for context");
    res.status(500).json({ error: "Failed to fetch trading knowledge docs for context" });
  }
});

// ============================================================================
// PROJECT SCAFFOLDING - AI-powered project plan generation
// ============================================================================

// Get scaffolding options (categories, scopes, venture domains)
router.get("/project-scaffolding/options", async (req: Request, res: Response) => {
  try {
    const { getProjectCategories, getScopeOptions, getVentureDomains } = await import("../project-scaffolding");
    res.json({
      categories: getProjectCategories(),
      scopes: getScopeOptions(),
      ventureDomains: getVentureDomains(),
    });
  } catch (error) {
    logger.error({ error }, "Error fetching scaffolding options");
    res.status(500).json({ error: "Failed to fetch scaffolding options" });
  }
});

// Generate a project plan from intake data (with optional new venture)
router.post("/project-scaffolding/generate", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { ventureId, newVenture, projectName, projectCategory, desiredOutcome, scope, keyConstraints, domainContext } = req.body;

    // Validate required fields
    if (!ventureId && !newVenture) {
      return res.status(400).json({ error: "Either ventureId or newVenture is required" });
    }
    if (!projectName) {
      return res.status(400).json({ error: "projectName is required" });
    }
    if (!desiredOutcome) {
      return res.status(400).json({ error: "desiredOutcome is required" });
    }
    if (!scope || !["small", "medium", "large"].includes(scope)) {
      return res.status(400).json({ error: "scope must be one of: small, medium, large" });
    }

    // If using existing venture, verify it exists
    if (ventureId) {
      const venture = await storage.getVenture(ventureId);
      if (!venture) {
        return res.status(404).json({ error: "Venture not found" });
      }
    }

    // Validate new venture data if provided
    if (newVenture) {
      if (!newVenture.ventureName) {
        return res.status(400).json({ error: "newVenture.ventureName is required" });
      }
      if (!newVenture.ventureDomain) {
        return res.status(400).json({ error: "newVenture.ventureDomain is required" });
      }
      if (!newVenture.ventureOneLiner) {
        return res.status(400).json({ error: "newVenture.ventureOneLiner is required" });
      }
    }

    const { generateProjectPlan } = await import("../project-scaffolding");

    const plan = await generateProjectPlan({
      ventureId,
      newVenture,
      projectName,
      projectCategory: projectCategory || "admin_general",
      desiredOutcome,
      scope,
      keyConstraints,
      domainContext,
    });

    res.json(plan);
  } catch (error: any) {
    logger.error({ error }, "Error generating project plan");

    if (error.message?.includes("All AI models failed")) {
      return res.status(503).json({
        error: "AI service temporarily unavailable",
        message: "Please try again in a moment",
      });
    }

    res.status(500).json({ error: "Failed to generate project plan" });
  }
});

// Commit a generated project plan to the database (creates venture if in plan)
router.post("/project-scaffolding/commit", async (req: Request, res: Response) => {
  try {
    const { ventureId, plan, startDate, targetEndDate } = req.body;

    // Validate required fields
    if (!plan || !plan.project || !plan.phases) {
      return res.status(400).json({ error: "plan with project and phases is required" });
    }

    // Either ventureId must be provided OR plan must include venture
    if (!ventureId && !plan.venture) {
      return res.status(400).json({ error: "Either ventureId or plan.venture is required" });
    }

    // If using existing venture, verify it exists
    if (ventureId && !plan.venture) {
      const venture = await storage.getVenture(ventureId);
      if (!venture) {
        return res.status(404).json({ error: "Venture not found" });
      }
    }

    const { commitProjectPlan } = await import("../project-scaffolding");

    const result = await commitProjectPlan(ventureId || null, plan, {
      startDate,
      targetEndDate,
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error({ error }, "Error committing project plan");
    res.status(500).json({ error: "Failed to commit project plan" });
  }
});

export default router;
