/**
 * Agent Runtime
 *
 * Core execution loop for every agent in the hierarchy.
 * Modeled after VentureAgent but generalized for any agent type.
 *
 * Flow:
 * 1. Load agent definition from registry
 * 2. Check permissions
 * 3. Resolve context (system prompt, history, memory, delegation)
 * 4. Assemble tool definitions (filtered by agent's available_tools)
 * 5. Stream model response with multi-turn tool execution (max 10 turns)
 * 6. If agent calls "delegate" tool → delegation engine handles handoff
 * 7. Persist conversation + actions to DB
 * 8. Return result
 */

import OpenAI from "openai";
import { eq, desc } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import {
  agents,
  agentConversations,
  agentTasks,
  type Agent,
  type AgentConversation,
} from "@shared/schema";
import { resolveAgentModel } from "./types";
import type {
  AgentChatResult,
  AgentToolDefinition,
  AgentToolContext,
  AgentToolResult,
  DelegationContext,
} from "./types";
import { delegateTask, completeDelegation } from "./delegation-engine";
import { storage } from "../storage";
import { quickSearch, deepResearch, structuredExtraction } from "./tools/web-research";
import { dailyBriefing, weeklySummary, ventureStatus, customReport } from "./tools/report-generator";
import { marketSizing, competitorAnalysis, swotAnalysis, marketValidation } from "./tools/market-analyzer";
import { buildMemoryContext, buildRelevantMemoryContext, storeMemory, searchMemories } from "./agent-memory-manager";
import { extractConversationLearnings, storeTaskOutcomeLearning } from "./learning-extractor";
import { generateProject, generateCode, listGeneratedProjects } from "./tools/code-generator";
import { deploy, getDeploymentHistory, getDeploymentStatus } from "./tools/deployer";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// BUILT-IN TOOLS (available to all agents based on permissions)
// ============================================================================

function buildDelegateToolSchema(): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "delegate",
      description:
        "Delegate a task to one of your specialist sub-agents. Use this when a task requires domain expertise that one of your team members has.",
      parameters: {
        type: "object",
        properties: {
          to_agent: {
            type: "string",
            description: "The slug of the agent to delegate to (must be in your delegates_to list)",
          },
          title: {
            type: "string",
            description: "Clear, actionable title for the delegated task",
          },
          description: {
            type: "string",
            description: "Detailed description of what needs to be done, context, and expected output format",
          },
          priority: {
            type: "number",
            description: "Priority 1-10 (1 = highest). Default 5.",
          },
        },
        required: ["to_agent", "title", "description"],
      },
    },
  };
}

function buildCoreTools(agent: Agent, permissions: string[]): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];
  const availableTools = (agent.availableTools as string[]) || [];

  // Delegate tool — only if agent has delegates
  const canDelegateTo = (agent.canDelegateTo as string[]) || [];
  if (canDelegateTo.length > 0 && (availableTools.includes("delegate") || permissions.includes("delegate"))) {
    tools.push(buildDelegateToolSchema());
  }

  // Search knowledge base
  if (availableTools.includes("search_knowledge_base")) {
    tools.push({
      type: "function",
      function: {
        name: "search_knowledge_base",
        description: "Search the knowledge base for relevant documents, SOPs, and information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    });
  }

  // List tasks
  if (availableTools.includes("list_tasks")) {
    tools.push({
      type: "function",
      function: {
        name: "list_tasks",
        description: "List tasks with optional filters",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["todo", "in_progress", "completed", "on_hold"] },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            ventureId: { type: "string", description: "Filter by venture ID" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
        },
      },
    });
  }

  // List projects
  if (availableTools.includes("list_projects")) {
    tools.push({
      type: "function",
      function: {
        name: "list_projects",
        description: "List projects with optional status filter",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["not_started", "planning", "in_progress", "blocked", "done", "archived"] },
            ventureId: { type: "string", description: "Filter by venture ID" },
          },
        },
      },
    });
  }

  // Get venture summary
  if (availableTools.includes("get_venture_summary")) {
    tools.push({
      type: "function",
      function: {
        name: "get_venture_summary",
        description: "Get a summary of a specific venture including projects, tasks, and metrics",
        parameters: {
          type: "object",
          properties: {
            ventureId: { type: "string", description: "Venture ID (optional — if omitted, summarizes all ventures)" },
          },
        },
      },
    });
  }

  // Create task
  if (availableTools.includes("create_task") && (permissions.includes("create_task") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_task",
        description: "Create a new task",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            notes: { type: "string", description: "Task description/notes" },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            ventureId: { type: "string", description: "Venture to assign to" },
            projectId: { type: "string", description: "Project to assign to" },
            dueDate: { type: "string", description: "Due date YYYY-MM-DD" },
          },
          required: ["title"],
        },
      },
    });
  }

  // Create document
  if (availableTools.includes("create_doc") && (permissions.includes("create_doc") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_doc",
        description: "Create a new document in the knowledge base",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Document title" },
            body: { type: "string", description: "Document content (markdown)" },
            type: { type: "string", enum: ["page", "sop", "spec", "research", "strategy", "playbook"] },
            ventureId: { type: "string", description: "Venture scope" },
          },
          required: ["title", "body"],
        },
      },
    });
  }

  // Create project
  if (availableTools.includes("create_project") && (permissions.includes("create_project") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_project",
        description: "Create a new project",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Project name" },
            ventureId: { type: "string", description: "Venture to assign to" },
            outcome: { type: "string", description: "Expected outcome" },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            category: {
              type: "string",
              enum: ["marketing", "sales_biz_dev", "customer_success", "product", "tech_engineering", "operations", "research_dev"],
            },
          },
          required: ["name"],
        },
      },
    });
  }

  // Create capture
  if (availableTools.includes("create_capture") && (permissions.includes("create_capture") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_capture",
        description: "Add an item to the inbox for later processing",
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

  // Web search (quick)
  if (availableTools.includes("web_search")) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for information. Returns structured search results.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    });
  }

  // Deep research (search + fetch + analyze)
  if (availableTools.includes("deep_research")) {
    tools.push({
      type: "function",
      function: {
        name: "deep_research",
        description: "Conduct deep research on a topic: searches the web, fetches pages, and synthesizes a structured analysis.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Research query" },
            analysis_type: {
              type: "string",
              enum: ["summary", "competitive", "market", "technical", "general"],
              description: "Type of analysis to perform (default: general)",
            },
          },
          required: ["query"],
        },
      },
    });
  }

  // Report generation
  if (availableTools.includes("generate_report")) {
    tools.push({
      type: "function",
      function: {
        name: "generate_report",
        description: "Generate a structured report: daily briefing, weekly summary, venture status, or custom.",
        parameters: {
          type: "object",
          properties: {
            report_type: {
              type: "string",
              enum: ["daily_briefing", "weekly_summary", "venture_status", "custom"],
              description: "Type of report to generate",
            },
            venture_id: { type: "string", description: "Venture ID (required for venture_status)" },
            custom_prompt: { type: "string", description: "Custom prompt for custom report type" },
          },
          required: ["report_type"],
        },
      },
    });
  }

  // Market analysis
  if (availableTools.includes("market_analyze")) {
    tools.push({
      type: "function",
      function: {
        name: "market_analyze",
        description: "Perform market analysis: sizing (TAM/SAM/SOM), competitor analysis, SWOT, or market validation.",
        parameters: {
          type: "object",
          properties: {
            analysis_type: {
              type: "string",
              enum: ["market_sizing", "competitor_analysis", "swot", "market_validation"],
              description: "Type of market analysis",
            },
            subject: { type: "string", description: "Market, product, or idea to analyze" },
            product: { type: "string", description: "Product/service description (for market sizing)" },
            geography: { type: "string", description: "Geographic focus (default: Global)" },
            competitors: {
              type: "array",
              items: { type: "string" },
              description: "Known competitors (for competitor analysis)",
            },
            context: { type: "string", description: "Additional context" },
          },
          required: ["analysis_type", "subject"],
        },
      },
    });
  }

  // Memory management
  if (availableTools.includes("remember")) {
    tools.push({
      type: "function",
      function: {
        name: "remember",
        description: "Store something in your persistent memory for future conversations. Use this to remember important facts, user preferences, and lessons learned.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "What to remember" },
            memory_type: {
              type: "string",
              enum: ["learning", "preference", "context", "relationship"],
              description: "Type of memory",
            },
            importance: { type: "number", description: "Importance 0-1 (default 0.5)" },
          },
          required: ["content", "memory_type"],
        },
      },
    });
  }

  // Memory search
  if (availableTools.includes("search_memory")) {
    tools.push({
      type: "function",
      function: {
        name: "search_memory",
        description: "Search your persistent memory for relevant information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    });
  }

  // Code generation
  if (availableTools.includes("code_generate")) {
    tools.push({
      type: "function",
      function: {
        name: "code_generate",
        description: "Generate a project scaffold or code snippet. Supports Next.js, Express API, landing page, or custom projects. Code is written to a temporary directory.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["generate_project", "generate_code", "list_projects"],
              description: "Action to perform",
            },
            project_name: { type: "string", description: "Project name (for generate_project)" },
            description: { type: "string", description: "What to build" },
            template: {
              type: "string",
              enum: ["nextjs", "express", "landing", "custom"],
              description: "Project template (for generate_project, default: custom)",
            },
            tech_stack: { type: "string", description: "Tech stack preference (for custom template)" },
            language: { type: "string", description: "Programming language (for generate_code)" },
            filename: { type: "string", description: "Output filename (for generate_code)" },
          },
          required: ["action"],
        },
      },
    });
  }

  // Deployment
  if (availableTools.includes("deploy")) {
    tools.push({
      type: "function",
      function: {
        name: "deploy",
        description: "Deploy a generated project to Vercel or Railway. Auto-deploys to preview/staging. Production requires user approval.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["deploy", "history", "status"],
              description: "Action to perform",
            },
            project_dir: { type: "string", description: "Path to the generated project directory (from code_generate output)" },
            project_name: { type: "string", description: "Project name for the deployment" },
            platform: {
              type: "string",
              enum: ["vercel", "railway"],
              description: "Deployment platform (default: vercel)",
            },
            environment: {
              type: "string",
              enum: ["preview", "staging", "production"],
              description: "Target environment (default: preview). Production requires approval.",
            },
          },
          required: ["action"],
        },
      },
    });
  }

  return tools;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

async function executeTool(
  agent: Agent,
  toolName: string,
  args: Record<string, any>,
  delegationContext?: DelegationContext
): Promise<AgentToolResult> {
  try {
    switch (toolName) {
      case "delegate": {
        const { taskId, error } = await delegateTask({
          fromAgentId: agent.id,
          toAgentSlug: args.to_agent,
          title: args.title,
          description: args.description,
          priority: args.priority,
          requiredPermissions: delegationContext?.grantedPermissions,
          requiredTools: delegationContext?.grantedTools,
        });

        if (error) {
          return { result: `Delegation failed: ${error}` };
        }

        // Execute the delegated agent synchronously to get result
        const result = await executeAgentTask(taskId);

        return {
          result: result
            ? `Delegation to "${args.to_agent}" completed.\n\nResult:\n${JSON.stringify(result.response || result, null, 2)}`
            : `Task delegated to "${args.to_agent}" (task ID: ${taskId}). Awaiting completion.`,
          action: {
            actionType: "delegate",
            entityType: "agent_task",
            entityId: taskId,
            parameters: { to: args.to_agent, title: args.title },
            status: "success",
          },
        };
      }

      case "search_knowledge_base": {
        const docs = await storage.getDocs({});
        const query = args.query.toLowerCase();
        const matches = docs
          .filter((d: any) =>
            d.title?.toLowerCase().includes(query) ||
            d.body?.toLowerCase().includes(query) ||
            (d.tags as string[])?.some((t: string) => t.toLowerCase().includes(query))
          )
          .slice(0, 5);

        return {
          result: JSON.stringify(
            matches.map((d: any) => ({
              id: d.id,
              title: d.title,
              type: d.type,
              excerpt: d.body?.slice(0, 200),
            }))
          ),
        };
      }

      case "list_tasks": {
        const filters: any = {};
        if (args.status) filters.status = args.status;
        if (args.priority) filters.priority = args.priority;
        if (args.ventureId) filters.ventureId = args.ventureId;
        else if (agent.ventureId) filters.ventureId = agent.ventureId;

        const tasks = await storage.getTasks(filters);
        const limited = tasks.slice(0, args.limit || 20);

        return {
          result: JSON.stringify(
            limited.map((t: any) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
            }))
          ),
        };
      }

      case "list_projects": {
        const filters: any = {};
        if (args.ventureId) filters.ventureId = args.ventureId;
        else if (agent.ventureId) filters.ventureId = agent.ventureId;

        let projects = await storage.getProjects(filters);
        if (args.status) {
          projects = projects.filter((p: any) => p.status === args.status);
        }

        return {
          result: JSON.stringify(
            projects.map((p: any) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              priority: p.priority,
              category: p.category,
            }))
          ),
        };
      }

      case "get_venture_summary": {
        if (args.ventureId) {
          const venture = await storage.getVenture(args.ventureId);
          if (!venture) return { result: "Venture not found" };

          const [projects, tasks] = await Promise.all([
            storage.getProjects({ ventureId: args.ventureId }),
            storage.getTasks({ ventureId: args.ventureId }),
          ]);

          return {
            result: JSON.stringify({
              name: venture.name,
              status: venture.status,
              domain: venture.domain,
              projects: projects.length,
              activeProjects: projects.filter((p: any) => p.status === "in_progress").length,
              tasks: tasks.length,
              pendingTasks: tasks.filter((t: any) => ["todo", "in_progress"].includes(t.status)).length,
            }),
          };
        }

        // Summarize all ventures
        const ventures = await storage.getVentures();
        return {
          result: JSON.stringify(
            ventures.map((v: any) => ({
              id: v.id,
              name: v.name,
              status: v.status,
              domain: v.domain,
            }))
          ),
        };
      }

      case "create_task": {
        const task = await storage.createTask({
          title: args.title,
          notes: args.notes,
          priority: args.priority,
          status: "todo",
          ventureId: args.ventureId || agent.ventureId,
          projectId: args.projectId,
          dueDate: args.dueDate,
        });

        return {
          result: `Created task: "${task.title}" (ID: ${task.id})`,
          action: {
            actionType: "create_task",
            entityType: "task",
            entityId: task.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "create_doc": {
        const doc = await storage.createDoc({
          title: args.title,
          body: args.body,
          type: args.type || "page",
          ventureId: args.ventureId || agent.ventureId,
          status: "active",
        });

        return {
          result: `Created document: "${doc.title}" (ID: ${doc.id})`,
          action: {
            actionType: "create_doc",
            entityType: "doc",
            entityId: doc.id,
            parameters: { title: args.title, type: args.type },
            status: "success",
          },
        };
      }

      case "create_project": {
        const project = await storage.createProject({
          name: args.name,
          ventureId: args.ventureId || agent.ventureId,
          outcome: args.outcome,
          priority: args.priority,
          category: args.category,
          status: "not_started",
        });

        return {
          result: `Created project: "${project.name}" (ID: ${project.id})`,
          action: {
            actionType: "create_project",
            entityType: "project",
            entityId: project.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "create_capture": {
        const capture = await storage.createCapture({
          title: args.title,
          type: args.type || "note",
          notes: args.notes,
          clarified: false,
        });

        return {
          result: `Added to inbox: "${capture.title}" (ID: ${capture.id})`,
          action: {
            actionType: "create_capture",
            entityType: "capture",
            entityId: capture.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "web_search": {
        return quickSearch(args.query);
      }

      case "deep_research": {
        return deepResearch(args.query, args.analysis_type || "general");
      }

      case "generate_report": {
        switch (args.report_type) {
          case "daily_briefing":
            return dailyBriefing();
          case "weekly_summary":
            return weeklySummary();
          case "venture_status":
            return ventureStatus(args.venture_id || "");
          case "custom":
            return customReport(args.custom_prompt || "Generate a report");
          default:
            return dailyBriefing();
        }
      }

      case "market_analyze": {
        switch (args.analysis_type) {
          case "market_sizing":
            return marketSizing(args.subject, args.product || args.subject, args.geography);
          case "competitor_analysis":
            return competitorAnalysis(args.subject, args.competitors);
          case "swot":
            return swotAnalysis(args.subject, args.context);
          case "market_validation":
            return marketValidation(args.subject, args.context);
          default:
            return swotAnalysis(args.subject, args.context);
        }
      }

      case "remember": {
        const memory = await storeMemory({
          agentId: agent.id,
          memoryType: args.memory_type || "context",
          content: args.content,
          importance: args.importance ?? 0.5,
        });

        return {
          result: `Remembered: "${args.content}" (type: ${args.memory_type}, id: ${memory.id})`,
          action: {
            actionType: "remember",
            entityType: "agent_memory",
            entityId: memory.id,
            status: "success",
          },
        };
      }

      case "search_memory": {
        const memories = await searchMemories(agent.id, args.query, 10);
        return {
          result: memories.length > 0
            ? JSON.stringify(memories.map((m) => ({
                type: m.memoryType,
                content: m.content,
                importance: m.importance,
              })))
            : "No relevant memories found.",
        };
      }

      case "code_generate": {
        switch (args.action) {
          case "generate_project":
            return generateProject({
              projectName: args.project_name || "untitled-project",
              description: args.description || "A new project",
              template: args.template || "custom",
              techStack: args.tech_stack,
            });
          case "generate_code":
            return generateCode({
              description: args.description || "Generate code",
              language: args.language || "typescript",
              filename: args.filename,
            });
          case "list_projects":
            return listGeneratedProjects();
          default:
            return { result: `Unknown code_generate action: ${args.action}` };
        }
      }

      case "deploy": {
        switch (args.action) {
          case "deploy":
            return deploy({
              projectDir: args.project_dir || "",
              projectName: args.project_name || "unnamed",
              platform: args.platform || "vercel",
              environment: args.environment || "preview",
            });
          case "history":
            return getDeploymentHistory();
          case "status":
            return getDeploymentStatus();
          default:
            return { result: `Unknown deploy action: ${args.action}` };
        }
      }

      default:
        return { result: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    logger.error({ toolName, args, error: error.message }, "Agent tool execution failed");
    return {
      result: `Error executing ${toolName}: ${error.message}`,
      action: {
        actionType: toolName,
        parameters: args,
        status: "failed",
        errorMessage: error.message,
      },
    };
  }
}

// ============================================================================
// AGENT EXECUTION
// ============================================================================

/**
 * Build the system prompt for an agent from its soul definition.
 */
function buildSystemPrompt(agent: Agent, delegationContext?: DelegationContext): string {
  // The soul IS the system prompt — the agent's identity
  let prompt = agent.soul;

  // Add delegation context if this is a delegated task
  if (delegationContext) {
    prompt += `\n\n## Current Delegated Task\n`;
    prompt += `You have been delegated a task by ${delegationContext.parentAgent.name}.\n`;
    prompt += `Task: ${delegationContext.task.title}\n`;
    if (delegationContext.task.description) {
      prompt += `Details: ${delegationContext.task.description}\n`;
    }
    prompt += `\nYour permissions for this task: ${delegationContext.grantedPermissions.join(", ")}\n`;
    prompt += `Available tools: ${delegationContext.grantedTools.join(", ")}\n`;
    prompt += `\nComplete the task and provide a clear, structured result.`;
  }

  // Add available delegates info
  const canDelegateTo = (agent.canDelegateTo as string[]) || [];
  if (canDelegateTo.length > 0) {
    prompt += `\n\n## Your Team (agents you can delegate to)\n`;
    prompt += canDelegateTo.map((slug) => `- ${slug}`).join("\n");
    prompt += `\n\nUse the \`delegate\` tool to assign sub-tasks to your team members when their expertise is needed.`;
  }

  prompt += `\n\nCurrent date/time: ${new Date().toISOString()}`;

  // Proactive recall instruction
  prompt += `\n\nWhen you see items in "Relevant Past Context", naturally reference them if pertinent. Example: "Based on our earlier discussion about X..." Only reference them when genuinely relevant — do not force connections.`;

  return prompt;
}

/**
 * Execute a chat turn with an agent.
 * This is the main entry point for direct user→agent conversation.
 */
export async function executeAgentChat(
  agentSlug: string,
  userMessage: string,
  userId: string
): Promise<AgentChatResult> {
  const database = await getDb();

  // Load agent
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.slug, agentSlug));

  if (!agent) {
    throw new Error(`Agent not found: ${agentSlug}`);
  }

  if (!agent.isActive) {
    throw new Error(`Agent "${agentSlug}" is inactive`);
  }

  // Get conversation history (last 10 messages)
  const history = await database
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.agentId, agent.id))
    .orderBy(desc(agentConversations.createdAt))
    .limit(10);

  // Get agent memory — split between static context and relevant context
  const memoryBudget = agent.maxContextTokens || 2000;
  const [staticMemory, relevantMemory] = await Promise.all([
    buildMemoryContext(agent.id, Math.floor(memoryBudget * 0.5)),
    buildRelevantMemoryContext(agent.id, userMessage, Math.floor(memoryBudget * 0.5)),
  ]);

  const memoryContext = [staticMemory, relevantMemory].filter(Boolean).join("\n\n");

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agent) + (memoryContext ? `\n\n${memoryContext}` : "");

  // Build permissions from agent config
  const permissions = (agent.actionPermissions as string[]) || ["read"];

  // Build tools
  const tools = buildCoreTools(agent, permissions);

  // Build message array
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.reverse().map((msg: AgentConversation) => ({
      role: msg.role === "delegation" ? "system" as const : msg.role as "user" | "assistant" | "system",
      content: msg.content,
    })),
    { role: "user", content: userMessage },
  ];

  // Save user message
  await database.insert(agentConversations).values({
    agentId: agent.id,
    role: "user",
    content: userMessage,
  });

  // Multi-turn tool calling loop
  const actions: AgentChatResult["actions"] = [];
  const delegations: AgentChatResult["delegations"] = [];
  let conversationMessages = [...messages];
  let finalResponse = "";
  let tokensUsed = 0;
  let modelUsed = "";
  const maxTurns = 10;

  const preferredModel = resolveAgentModel(agent);

  for (let turn = 0; turn < maxTurns; turn++) {
    const { response, metrics } = await modelManager.chatCompletion(
      {
        messages: conversationMessages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: agent.temperature || 0.7,
        max_tokens: agent.maxTokens || 4096,
      },
      "complex",
      preferredModel
    );

    tokensUsed += metrics.tokensUsed || 0;
    modelUsed = metrics.modelUsed;

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("No response from AI");
    }

    // No tool calls → final response
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      finalResponse = choice.message.content || "I'm ready to help. What would you like me to work on?";
      break;
    }

    // Add assistant message with tool calls
    conversationMessages.push(choice.message);

    // Process tool calls
    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments);
      const toolResult = await executeTool(agent, toolCall.function.name, args);

      if (toolResult.action) {
        actions.push({
          actionType: toolResult.action.actionType,
          entityType: toolResult.action.entityType,
          entityId: toolResult.action.entityId,
          status: toolResult.action.status,
        });

        if (toolResult.action.actionType === "delegate") {
          delegations.push({
            taskId: toolResult.action.entityId || "",
            toAgentSlug: args.to_agent,
            status: toolResult.action.status,
          });
        }
      }

      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult.result,
      });
    }

    conversationMessages.push(...toolResults);
  }

  // Save assistant response
  await database.insert(agentConversations).values({
    agentId: agent.id,
    role: "assistant",
    content: finalResponse,
    metadata: {
      model: modelUsed,
      tokensUsed,
      actionsTaken: actions.map((a) => a.actionType),
      delegations: delegations.map((d) => d.toAgentSlug),
    },
  });

  // Fire-and-forget: extract learnings from this conversation
  extractConversationLearnings({
    agentId: agent.id,
    agentSlug: agent.slug,
    userMessage,
    assistantResponse: finalResponse,
    ventureId: agent.ventureId || undefined,
    actions,
  }).catch(err => logger.debug({ err: err.message }, "Learning extraction failed (non-critical)"));

  logger.info(
    {
      agentSlug,
      model: modelUsed,
      tokensUsed,
      actions: actions.length,
      delegations: delegations.length,
    },
    "Agent chat completed"
  );

  return {
    response: finalResponse,
    agentId: agent.id,
    agentSlug: agent.slug,
    actions,
    delegations,
    tokensUsed,
    model: modelUsed,
  };
}

/**
 * Execute a delegated task for an agent.
 * Called by the delegation engine when a task is assigned.
 */
export async function executeAgentTask(
  taskId: string
): Promise<AgentChatResult | null> {
  const database = await getDb();

  // Load the task
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    logger.error({ taskId }, "Agent task not found");
    return null;
  }

  // Load the assigned agent
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, task.assignedTo));

  if (!agent) {
    logger.error({ taskId, assignedTo: task.assignedTo }, "Assigned agent not found");
    return null;
  }

  // Load the delegating agent (for context)
  let parentAgent: Agent | null = null;
  if (task.assignedBy !== "user") {
    const [parent] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, task.assignedBy));
    parentAgent = parent || null;
  }

  // Mark task as in progress
  await database
    .update(agentTasks)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(agentTasks.id, taskId));

  // Build delegation context
  const delegationContext: DelegationContext | undefined = parentAgent
    ? {
        task,
        parentAgent,
        delegationChain: (task.delegationChain as string[]) || [],
        grantedPermissions: (task.grantedPermissions as string[]) || [],
        grantedTools: (task.grantedTools as string[]) || [],
        depth: task.depth || 0,
      }
    : undefined;

  // Build system prompt with delegation context
  const systemPrompt = buildSystemPrompt(agent, delegationContext);

  // Build tools (filtered by granted tools if delegated)
  const effectivePermissions = delegationContext
    ? delegationContext.grantedPermissions
    : (agent.actionPermissions as string[]) || ["read"];
  const tools = buildCoreTools(agent, effectivePermissions);

  // Build the task message
  const taskMessage = `${task.title}\n\n${task.description || "Please complete this task."}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: taskMessage },
  ];

  // Execute
  const actions: AgentChatResult["actions"] = [];
  const delegations: AgentChatResult["delegations"] = [];
  let conversationMessages = [...messages];
  let finalResponse = "";
  let tokensUsed = 0;
  let modelUsed = "";
  const maxTurns = 10;

  const preferredModel = resolveAgentModel(agent);

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const { response, metrics } = await modelManager.chatCompletion(
        {
          messages: conversationMessages,
          tools: tools.length > 0 ? tools : undefined,
          temperature: agent.temperature || 0.7,
          max_tokens: agent.maxTokens || 4096,
        },
        "complex",
        preferredModel
      );

      tokensUsed += metrics.tokensUsed || 0;
      modelUsed = metrics.modelUsed;

      const choice = response.choices[0];
      if (!choice?.message) break;

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalResponse = choice.message.content || "";
        break;
      }

      conversationMessages.push(choice.message);

      const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const args = JSON.parse(toolCall.function.arguments);
        const toolResult = await executeTool(agent, toolCall.function.name, args, delegationContext);

        if (toolResult.action) {
          actions.push({
            actionType: toolResult.action.actionType,
            entityType: toolResult.action.entityType,
            entityId: toolResult.action.entityId,
            status: toolResult.action.status,
          });
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult.result,
        });
      }

      conversationMessages.push(...toolResults);
    }

    // Mark task completed
    await completeDelegation(taskId, {
      response: finalResponse,
      actions,
      tokensUsed,
      model: modelUsed,
    });

    // Store task outcome learning (fire-and-forget)
    storeTaskOutcomeLearning({
      agentId: agent.id,
      agentSlug: agent.slug,
      taskTitle: task.title,
      taskDescription: task.description || undefined,
      outcome: "completed",
      response: finalResponse,
    }).catch(err => logger.debug({ err: err.message }, "Task outcome learning failed"));

    // Save conversation
    await database.insert(agentConversations).values({
      agentId: agent.id,
      role: "delegation",
      content: `[Delegated Task: ${task.title}]\n\n${finalResponse}`,
      delegationFrom: task.assignedBy !== "user" ? task.assignedBy : undefined,
      delegationTaskId: taskId,
      metadata: { model: modelUsed, tokensUsed },
    });

    return {
      response: finalResponse,
      agentId: agent.id,
      agentSlug: agent.slug,
      actions,
      delegations,
      tokensUsed,
      model: modelUsed,
    };
  } catch (error: any) {
    logger.error({ taskId, agentSlug: agent.slug, error: error.message }, "Agent task execution failed");

    await database
      .update(agentTasks)
      .set({ status: "failed", error: error.message, completedAt: new Date() })
      .where(eq(agentTasks.id, taskId));

    // Store failure learning (fire-and-forget)
    storeTaskOutcomeLearning({
      agentId: agent.id,
      agentSlug: agent.slug,
      taskTitle: task.title,
      taskDescription: task.description || undefined,
      outcome: "failed",
      error: error.message,
    }).catch(() => {});

    return null;
  }
}
