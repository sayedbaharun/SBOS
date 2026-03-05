import OpenAI from "openai";
import { storage } from "./storage";
import { logger } from "./logger";
import * as modelManager from "./model-manager";
import { getCachedOrBuildContext } from "./venture-context-builder";
import { hybridSearch } from "./vector-search";
import type { Venture, AiAgentPrompt, VentureConversation, InsertVentureAgentAction, CaptureItem } from "@shared/schema";

// Initialize OpenRouter with OpenAI-compatible API
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
    "X-Title": "SB-OS Venture Agent",
  },
});

/**
 * Venture Agent - AI assistant specialized for a specific venture
 */
export class VentureAgent {
  private ventureId: string;
  private userId: string;
  private venture: Venture | null = null;
  private agentConfig: AiAgentPrompt | null = null;
  private context: string = "";
  private userPreferredModel: string | null = null;
  private isEmptyVenture: boolean = false;

  constructor(ventureId: string, userId: string) {
    this.ventureId = ventureId;
    this.userId = userId;
  }

  /**
   * Initialize the agent with venture data and configuration
   */
  async initialize(): Promise<void> {
    try {
      const [venture, agentConfig, userPrefs] = await Promise.all([
        storage.getVenture(this.ventureId),
        storage.getAiAgentPrompt(this.ventureId),
        storage.getUserPreferences(this.userId),
      ]);

      if (!venture) {
        throw new Error(`Venture not found: ${this.ventureId}`);
      }

      this.venture = venture;
      this.agentConfig = agentConfig || null;
      this.userPreferredModel = userPrefs?.aiModel || null;

      // Check if this is a brand new venture with no projects or tasks
      const [projects, tasks] = await Promise.all([
        storage.getProjects({ ventureId: this.ventureId }),
        storage.getTasks({ ventureId: this.ventureId }),
      ]);
      this.isEmptyVenture = projects.length === 0 && tasks.length === 0;

      // Build or get cached context - this should never throw due to internal error handling
      const refreshHours = agentConfig?.contextRefreshHours || 24;
      this.context = await getCachedOrBuildContext(this.ventureId, refreshHours);
    } catch (error: any) {
      // If venture not found, re-throw to signal 404
      if (error.message?.includes('Venture not found')) {
        throw error;
      }
      // For other errors, log and continue with minimal context
      logger.error({ error, ventureId: this.ventureId }, "Error initializing venture agent");
      // Try to get just the venture info
      const venture = await storage.getVenture(this.ventureId);
      if (!venture) {
        throw new Error(`Venture not found: ${this.ventureId}`);
      }
      this.venture = venture;
      this.agentConfig = null;
      this.userPreferredModel = null;
      this.context = `Venture: ${venture.name}\nStatus: ${venture.status}`;
    }
  }

  /**
   * Build the system prompt for this venture agent
   */
  private buildSystemPrompt(): string {
    const venture = this.venture!;
    const config = this.agentConfig;

    const basePrompt = `You are an AI assistant specialized for the venture "${venture.name}".
${venture.oneLiner ? `\nVenture Description: ${venture.oneLiner}` : ''}
Status: ${venture.status}
${venture.domain ? `Domain: ${venture.domain}` : ''}

Your role is to help manage this venture by:
- Answering questions about projects, tasks, and documents
- Providing insights based on the venture's knowledge base
- Helping create and manage tasks, projects, and documentation
- Offering strategic recommendations based on the venture's context

${config?.systemPrompt ? `\n${config.systemPrompt}` : ''}

${config?.context ? `\nAdditional Context:\n${config.context}` : ''}

VENTURE CONTEXT:
${this.context}

Current date/time: ${new Date().toISOString()}

IMPORTANT INSTRUCTIONS:
1. Always be specific to this venture - don't give generic advice
2. Reference actual projects, tasks, and documents when relevant
3. When creating tasks or documents, ensure they're properly linked to this venture
4. If you're unsure about something, say so rather than guessing
5. Be concise but thorough in your responses`;

    // Inject architect preamble for empty ventures
    if (this.isEmptyVenture) {
      return basePrompt + `

VENTURE ARCHITECT MODE:
This is a brand new venture with no projects, phases, or tasks yet. Before doing anything else, guide the founder through planning this venture using a structured conversation.

Stage 1 — Understand (ask these first):
1. What is this venture about?${venture.oneLiner ? ' (You already know: "' + venture.oneLiner + '")' : ''}
2. Who is the target customer or audience?
3. What does success look like in 90 days?
4. Is this a product, service, content play, or investment?
5. Any existing work, assets, or constraints?

Stage 2 — Define (after understanding):
1. What are the 2-4 major workstreams or areas of focus?
2. What needs to happen first vs. later?
3. Who or what is responsible for each area? (Sayed, an agent, a contractor, automated)
4. What's the budget and time commitment?
5. Any hard deadlines or dependencies?

Stage 3 — Propose:
Present a structured plan with:
- Projects (major workstreams)
- Phases within each project (ordered milestones with target dates)
- Tasks within each phase (concrete, actionable items with priorities)

Format clearly so it's easy to approve or modify. Always ask: "Should I create this structure now, or do you want to adjust anything first?"

Stage 4 — Execute (only after explicit approval):
Once approved, create all projects, phases, and tasks using your tools. Then save a "Venture Plan" summary document to the Knowledge Hub.

RULES:
- Lead with questions, not assumptions
- NEVER create projects, phases, or tasks without explicit approval
- Be concise — no filler, no motivational fluff
- When creating items, confirm what was created: "Created 3 projects, 7 phases, 18 tasks"
- If Sayed says "just do it" or "go ahead" — that's approval, create everything

Start by greeting Sayed and asking Stage 1 questions (skip any you already know from the venture description).`;
    }

    return basePrompt;
  }

  /**
   * Get the tools available to this venture agent
   */
  private getTools(): OpenAI.Chat.ChatCompletionTool[] {
    const permissions = this.agentConfig?.actionPermissions || ['read'];
    const tools: OpenAI.Chat.ChatCompletionTool[] = [];

    // Read tools - always available
    tools.push(
      {
        type: "function",
        function: {
          name: "get_venture_summary",
          description: "Get a comprehensive summary of the venture including status, projects, and key metrics",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "list_projects",
          description: "List all projects in this venture with their status and progress",
          parameters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["not_started", "planning", "in_progress", "blocked", "done", "archived"],
                description: "Filter projects by status",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_project_details",
          description: "Get detailed information about a specific project including phases and tasks",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "The project ID" },
              projectName: { type: "string", description: "Or search by project name" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_tasks",
          description: "List tasks in this venture with optional filters",
          parameters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["todo", "in_progress", "completed", "on_hold"],
                description: "Filter by task status",
              },
              priority: {
                type: "string",
                enum: ["P0", "P1", "P2", "P3"],
                description: "Filter by priority",
              },
              projectId: { type: "string", description: "Filter by project" },
              limit: { type: "number", description: "Maximum number of tasks to return (default 20)" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_knowledge_base",
          description: "Search the venture's knowledge base (docs, SOPs, specs) for relevant information",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              docType: {
                type: "string",
                enum: ["page", "sop", "prompt", "spec", "template", "playbook", "strategy", "tech_doc", "process", "reference", "meeting_notes", "research"],
                description: "Filter by document type",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_document",
          description: "Get the full content of a specific document",
          parameters: {
            type: "object",
            properties: {
              docId: { type: "string", description: "Document ID" },
              docTitle: { type: "string", description: "Or search by document title" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_captures",
          description: "List unclarified capture items (inbox) for this venture",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Maximum items to return" },
            },
          },
        },
      }
    );

    // Write tools - only if permitted
    if (permissions.includes('create_task') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "create_task",
          description: "Create a new task in this venture",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Task title" },
              notes: { type: "string", description: "Task description/notes" },
              priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "Priority level" },
              status: { type: "string", enum: ["todo", "in_progress"], description: "Initial status (default: todo)" },
              projectId: { type: "string", description: "Assign to project (optional)" },
              dueDate: { type: "string", description: "Due date in YYYY-MM-DD format (optional)" },
            },
            required: ["title"],
          },
        },
      });
    }

    if (permissions.includes('update_task') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "update_task_status",
          description: "Update the status of an existing task",
          parameters: {
            type: "object",
            properties: {
              taskId: { type: "string", description: "Task ID" },
              status: { type: "string", enum: ["todo", "in_progress", "completed", "on_hold"] },
            },
            required: ["taskId", "status"],
          },
        },
      });
    }

    if (permissions.includes('create_doc') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "create_document",
          description: "Create a new document in the venture's knowledge base",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Document title" },
              body: { type: "string", description: "Document content (markdown)" },
              type: {
                type: "string",
                enum: ["page", "sop", "prompt", "spec", "template", "playbook", "strategy", "tech_doc", "process", "reference", "meeting_notes", "research"],
                description: "Document type (default: page)",
              },
              projectId: { type: "string", description: "Link to project (optional)" },
              tags: { type: "array", items: { type: "string" }, description: "Tags for the document" },
            },
            required: ["title", "body"],
          },
        },
      });
    }

    if (permissions.includes('create_project') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "create_project",
          description: "Create a new project in this venture",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Project name" },
              outcome: { type: "string", description: "Expected outcome" },
              priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
              category: {
                type: "string",
                enum: ["marketing", "sales_biz_dev", "customer_success", "product", "tech_engineering", "operations", "research_dev", "finance", "people_hr", "legal_compliance", "admin_general", "strategy_leadership"],
              },
              targetEndDate: { type: "string", description: "Target end date YYYY-MM-DD" },
            },
            required: ["name"],
          },
        },
      });
    }

    if (permissions.includes('create_phase') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "create_phase",
          description: "Create a new phase for a project",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "Project ID" },
              name: { type: "string", description: "Phase name" },
              targetDate: { type: "string", description: "Target date YYYY-MM-DD" },
              notes: { type: "string", description: "Phase notes" },
            },
            required: ["projectId", "name"],
          },
        },
      });
    }

    if (permissions.includes('create_capture') || permissions.includes('write')) {
      tools.push({
        type: "function",
        function: {
          name: "create_capture",
          description: "Add an item to the venture's inbox for later processing",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Capture item title" },
              type: { type: "string", enum: ["idea", "task", "note", "link", "question"] },
              notes: { type: "string", description: "Additional notes" },
            },
            required: ["title"],
          },
        },
      });
    }

    return tools;
  }

  /**
   * Execute a tool call and return the result
   */
  private async executeTool(
    toolName: string,
    args: Record<string, any>
  ): Promise<{ result: string; action?: InsertVentureAgentAction }> {
    try {
      switch (toolName) {
        case "get_venture_summary": {
          const projects = await storage.getProjects({ ventureId: this.ventureId });
          const tasks = await storage.getTasks({ ventureId: this.ventureId });
          const docs = await storage.getDocs({ ventureId: this.ventureId });

          const pendingTasks = tasks.filter(t => ['todo', 'in_progress'].includes(t.status));
          const activeProjects = projects.filter(p => p.status === 'in_progress');

          return {
            result: JSON.stringify({
              venture: {
                name: this.venture?.name,
                status: this.venture?.status,
                oneLiner: this.venture?.oneLiner,
              },
              metrics: {
                totalProjects: projects.length,
                activeProjects: activeProjects.length,
                totalTasks: tasks.length,
                pendingTasks: pendingTasks.length,
                completedTasks: tasks.filter(t => t.status === 'completed').length,
                documents: docs.length,
              },
              recentActivity: {
                latestTasks: tasks.slice(0, 5).map(t => ({ title: t.title, status: t.status })),
              },
            }),
          };
        }

        case "list_projects": {
          let projects = await storage.getProjects({ ventureId: this.ventureId });
          if (args.status) {
            projects = projects.filter(p => p.status === args.status);
          }
          return {
            result: JSON.stringify(projects.map(p => ({
              id: p.id,
              name: p.name,
              status: p.status,
              priority: p.priority,
              category: p.category,
              outcome: p.outcome,
              targetEndDate: p.targetEndDate,
            }))),
          };
        }

        case "get_project_details": {
          let project = null;
          if (args.projectId) {
            project = await storage.getProject(args.projectId);
          } else if (args.projectName) {
            const projects = await storage.getProjects({ ventureId: this.ventureId });
            project = projects.find(p =>
              p.name.toLowerCase().includes(args.projectName.toLowerCase())
            );
          }

          if (!project) {
            return { result: "Project not found" };
          }

          const [phases, tasks] = await Promise.all([
            storage.getPhases({ projectId: project.id }),
            storage.getTasks({ projectId: project.id }),
          ]);

          return {
            result: JSON.stringify({
              ...project,
              phases,
              tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
            }),
          };
        }

        case "list_tasks": {
          const filters: any = { ventureId: this.ventureId };
          if (args.status) filters.status = args.status;
          if (args.priority) filters.priority = args.priority;
          if (args.projectId) filters.projectId = args.projectId;

          let tasks = await storage.getTasks(filters);
          tasks = tasks.slice(0, args.limit || 20);

          return {
            result: JSON.stringify(tasks.map(t => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
              notes: t.notes?.slice(0, 100),
            }))),
          };
        }

        case "search_knowledge_base": {
          const searchResults = await hybridSearch(args.query, {
            ventureId: this.ventureId,
            limit: 5,
          });

          let filtered = searchResults;
          if (args.docType) {
            filtered = searchResults.filter(r => r.metadata?.docType === args.docType);
          }

          return {
            result: JSON.stringify(filtered.map(r => ({
              id: r.id,
              title: r.title,
              type: r.type,
              similarity: Math.round(r.similarity * 100) / 100,
              excerpt: r.content?.slice(0, 300),
            }))),
          };
        }

        case "get_document": {
          let doc = null;
          if (args.docId) {
            doc = await storage.getDoc(args.docId);
          } else if (args.docTitle) {
            const docs = await storage.getDocs({ ventureId: this.ventureId });
            doc = docs.find(d =>
              d.title.toLowerCase().includes(args.docTitle.toLowerCase())
            );
          }

          if (!doc) {
            return { result: "Document not found" };
          }

          return {
            result: JSON.stringify({
              id: doc.id,
              title: doc.title,
              type: doc.type,
              status: doc.status,
              body: doc.body,
              tags: doc.tags,
              updatedAt: doc.updatedAt,
            }),
          };
        }

        case "list_captures": {
          const captures = await storage.getCaptures({
            ventureId: this.ventureId,
            clarified: false,
          });
          const limited = captures.slice(0, args.limit || 20);

          return {
            result: JSON.stringify(limited.map((c: CaptureItem) => ({
              id: c.id,
              title: c.title,
              type: c.type,
              source: c.source,
              notes: c.notes,
              createdAt: c.createdAt,
            }))),
          };
        }

        case "create_task": {
          const task = await storage.createTask({
            title: args.title,
            notes: args.notes,
            priority: args.priority,
            status: args.status || 'todo',
            ventureId: this.ventureId,
            projectId: args.projectId,
            dueDate: args.dueDate,
          });

          return {
            result: `Created task: "${task.title}" (ID: ${task.id})`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'create_task',
              entityType: 'task',
              entityId: task.id,
              parameters: args,
              result: 'success',
            },
          };
        }

        case "update_task_status": {
          const task = await storage.updateTask(args.taskId, { status: args.status });

          return {
            result: `Updated task status to "${args.status}"`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'update_task_status',
              entityType: 'task',
              entityId: args.taskId,
              parameters: args,
              result: 'success',
            },
          };
        }

        case "create_document": {
          const { doc, created } = await storage.createDocIfNotExists({
            title: args.title,
            body: args.body,
            type: args.type || 'page',
            ventureId: this.ventureId,
            projectId: args.projectId,
            tags: args.tags || [],
            status: 'active',
          });

          return {
            result: created
              ? `Created document: "${doc.title}" (ID: ${doc.id})`
              : `Document already exists: "${doc.title}" (ID: ${doc.id})`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'create_doc',
              entityType: 'doc',
              entityId: doc.id,
              parameters: { title: args.title, type: args.type },
              result: 'success',
            },
          };
        }

        case "create_project": {
          const project = await storage.createProject({
            name: args.name,
            outcome: args.outcome,
            priority: args.priority,
            category: args.category,
            targetEndDate: args.targetEndDate,
            ventureId: this.ventureId,
            status: 'not_started',
          });

          return {
            result: `Created project: "${project.name}" (ID: ${project.id})`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'create_project',
              entityType: 'project',
              entityId: project.id,
              parameters: args,
              result: 'success',
            },
          };
        }

        case "create_phase": {
          const phase = await storage.createPhase({
            projectId: args.projectId,
            name: args.name,
            targetDate: args.targetDate,
            notes: args.notes,
            status: 'not_started',
          });

          return {
            result: `Created phase: "${phase.name}" (ID: ${phase.id})`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'create_phase',
              entityType: 'phase',
              entityId: phase.id,
              parameters: args,
              result: 'success',
            },
          };
        }

        case "create_capture": {
          const capture = await storage.createCapture({
            title: args.title,
            type: args.type || 'note',
            notes: args.notes,
            ventureId: this.ventureId,
            clarified: false,
          });

          return {
            result: `Added to inbox: "${capture.title}" (ID: ${capture.id})`,
            action: {
              ventureId: this.ventureId,
              userId: this.userId,
              action: 'create_capture',
              entityType: 'capture',
              entityId: capture.id,
              parameters: args,
              result: 'success',
            },
          };
        }

        default:
          return { result: `Unknown tool: ${toolName}` };
      }
    } catch (error: any) {
      logger.error({ toolName, args, error }, "Tool execution failed");
      return {
        result: `Error executing ${toolName}: ${error.message}`,
        action: {
          ventureId: this.ventureId,
          userId: this.userId,
          action: toolName,
          parameters: args,
          result: 'failed',
          errorMessage: error.message,
        },
      };
    }
  }

  /**
   * Process a user message and generate a response
   */
  async chat(userMessage: string): Promise<{
    response: string;
    actions: InsertVentureAgentAction[];
    tokensUsed?: number;
    model?: string;
  }> {
    if (!this.venture) {
      await this.initialize();
    }

    const actions: InsertVentureAgentAction[] = [];

    // Get conversation history
    const history = await storage.getVentureConversations(this.ventureId, this.userId, 10);

    // Build messages for AI
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: this.buildSystemPrompt() },
      ...history.reverse().map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      })),
      { role: "user", content: userMessage },
    ];

    // Save user message
    await storage.createVentureConversation({
      ventureId: this.ventureId,
      userId: this.userId,
      role: "user",
      content: userMessage,
    });

    // Get tools
    const tools = this.getTools();

    // Multi-turn tool calling loop
    let conversationMessages = [...messages];
    let finalResponse = "";
    let tokensUsed = 0;
    let modelUsed = "";
    const maxTurns = 5;

    for (let turn = 0; turn < maxTurns; turn++) {
      // Use preferred model: venture config > user global preference > default
      const preferredModel = this.agentConfig?.preferredModel || this.userPreferredModel || undefined;
      const { response, metrics } = await modelManager.chatCompletion(
        { messages: conversationMessages, tools, temperature: 0.7 },
        "complex",
        preferredModel
      );

      tokensUsed += metrics.tokensUsed || 0;
      modelUsed = metrics.modelUsed;

      const choice = response.choices[0];
      if (!choice?.message) {
        throw new Error("No response from AI");
      }

      // If no tool calls, we have our final response
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalResponse = choice.message.content || "I'm here to help with this venture. How can I assist?";
        break;
      }

      // Add assistant message with tool calls
      conversationMessages.push(choice.message);

      // Process tool calls
      const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;

        const args = JSON.parse(toolCall.function.arguments);
        const { result, action } = await this.executeTool(toolCall.function.name, args);

        if (action) {
          actions.push(action);
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      conversationMessages.push(...toolResults);
    }

    // Save assistant response
    await storage.createVentureConversation({
      ventureId: this.ventureId,
      userId: this.userId,
      role: "assistant",
      content: finalResponse,
      metadata: {
        model: modelUsed,
        tokensUsed,
        actionsTaken: actions.map(a => a.action),
      } as any,
    });

    // Save actions to audit log
    for (const action of actions) {
      await storage.createVentureAgentAction(action);
    }

    // Fire-and-forget: extract learnings from this venture conversation
    try {
      const { extractConversationLearnings } = await import("./agents/learning-extractor");
      // Find the agent record for this venture (if any) to scope learnings
      const { agents: agentsTable } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const db = (storage as any).db;
      const [ventureAgent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.ventureId, this.ventureId))
        .limit(1);

      const agentId = ventureAgent?.id || "00000000-0000-0000-0000-000000000000";
      extractConversationLearnings({
        agentId,
        agentSlug: ventureAgent?.slug || "venture-chat",
        userMessage,
        assistantResponse: finalResponse,
        ventureId: this.ventureId,
      }).catch((err: any) => {
        logger.debug({ error: err.message }, "Venture learning extraction failed (non-critical)");
      });
    } catch {
      // Non-critical — don't block chat response
    }

    return {
      response: finalResponse,
      actions,
      tokensUsed,
      model: modelUsed,
    };
  }
}

/**
 * Factory function to create and initialize a venture agent
 */
export async function createVentureAgent(ventureId: string, userId: string): Promise<VentureAgent> {
  const agent = new VentureAgent(ventureId, userId);
  await agent.initialize();
  return agent;
}
