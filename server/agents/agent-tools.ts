/**
 * Agent Tool Schema Definitions
 *
 * Builds the OpenAI-compatible tool definitions for each agent
 * based on their available_tools and permissions configuration.
 */

import OpenAI from "openai";
import type { Agent } from "@shared/schema";

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

export function buildCoreTools(agent: Agent, permissions: string[]): OpenAI.Chat.ChatCompletionTool[] {
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

  // Update task
  if (availableTools.includes("update_task")) {
    tools.push({
      type: "function",
      function: {
        name: "update_task",
        description: "Update a task's status, priority, notes, or other fields. Use to mark tasks done, change priority, add notes, etc.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID to update" },
            status: { type: "string", enum: ["todo", "in_progress", "completed", "on_hold", "cancelled"], description: "New status" },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "New priority" },
            notes: { type: "string", description: "Append to or replace task notes" },
            title: { type: "string", description: "Update task title" },
            tags: { type: "array", items: { type: "string" }, description: "Set tags on the task (replaces existing tags)" },
          },
          required: ["task_id"],
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

  // Get day record
  if (availableTools.includes("update_day")) {
    tools.push({
      type: "function",
      function: {
        name: "get_day",
        description: "Get a day record to see current outcomes, reflections, rituals, and mood. Returns the full day object.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
          },
        },
      },
    });
  }

  // Update day record
  if (availableTools.includes("update_day")) {
    tools.push({
      type: "function",
      function: {
        name: "update_day",
        description: "Update today's day record with outcomes, reflections, mood, one thing to ship, or ritual tracking. Only pass the fields you want to update.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
            title: { type: "string", description: "Day theme or title" },
            mood: { type: "string", enum: ["low", "medium", "high", "peak"], description: "Overall mood" },
            top3Outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Outcome description" },
                  completed: { type: "boolean", description: "Whether completed" },
                },
                required: ["text"],
              },
              description: "Top 3 priority outcomes for the day",
            },
            oneThingToShip: { type: "string", description: "Single most leveraged deliverable" },
            reflectionAm: { type: "string", description: "Morning intention or reflection" },
            reflectionPm: { type: "string", description: "Evening review or reflection" },
            morningRituals: {
              type: "object",
              properties: {
                pressUps: { type: "object", properties: { done: { type: "boolean" }, reps: { type: "number" } } },
                squats: { type: "object", properties: { done: { type: "boolean" }, reps: { type: "number" } } },
                supplements: { type: "object", properties: { done: { type: "boolean" } } },
                water: { type: "object", properties: { done: { type: "boolean" } } },
                completedAt: { type: "string", description: "ISO timestamp when completed" },
              },
              description: "Morning ritual tracking",
            },
            eveningRituals: {
              type: "object",
              properties: {
                reviewCompleted: { type: "boolean" },
                journalEntry: { type: "string" },
                gratitude: { type: "array", items: { type: "string" } },
                tomorrowPriorities: { type: "array", items: { type: "string" } },
                fastingHours: { type: "number" },
                deepWorkHours: { type: "number" },
                completedAt: { type: "string", description: "ISO timestamp when completed" },
              },
              description: "Evening ritual and reflection tracking",
            },
          },
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

  // Update existing document
  if (availableTools.includes("update_doc") && (permissions.includes("create_doc") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "update_doc",
        description: "Update an existing knowledge base document. Use search_knowledge_base first to get the docId. Provide either body (full replacement) or appendText (appends to existing content).",
        parameters: {
          type: "object",
          properties: {
            docId: { type: "string", description: "ID of the document to update (get this from search_knowledge_base)" },
            body: { type: "string", description: "Full replacement content (markdown). Use this to rewrite the document." },
            appendText: { type: "string", description: "Text to append to the existing document body. Use this to add a new line/entry without rewriting everything." },
            title: { type: "string", description: "Optional new title" },
          },
          required: ["docId"],
        },
      },
    });
  }

  // Submit deliverable (for review before going live)
  if (availableTools.includes("submit_deliverable") && (permissions.includes("create_doc") || permissions.includes("write"))) {
    tools.push({
      type: "function",
      function: {
        name: "submit_deliverable",
        description:
          "Submit a structured deliverable (document, recommendation, action items, or code) for Sayed's review before it goes live. Use this instead of create_doc when the output needs human approval.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["document", "recommendation", "action_items", "code"],
              description: "Type of deliverable",
            },
            title: { type: "string", description: "Clear title for the deliverable" },
            // Document fields
            body: { type: "string", description: "Document content (markdown). Required for type=document" },
            docType: {
              type: "string",
              enum: ["page", "sop", "spec", "research", "strategy", "playbook", "tech_doc", "process", "reference"],
              description: "Document type (for type=document)",
            },
            domain: {
              type: "string",
              enum: ["venture_ops", "marketing", "product", "sales", "tech", "trading", "finance", "legal", "hr", "personal"],
              description: "Domain scope",
            },
            ventureId: { type: "string", description: "Venture scope" },
            // Recommendation fields
            summary: { type: "string", description: "Summary of the deliverable" },
            rationale: { type: "string", description: "Reasoning behind the recommendation (for type=recommendation)" },
            suggestedAction: {
              type: "string",
              enum: ["create_task", "create_doc", "no_action"],
              description: "What should happen on approval (for type=recommendation)",
            },
            // Action items fields
            items: {
              type: "array",
              description: "List of action items (for type=action_items)",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  notes: { type: "string" },
                  priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
                  dueDate: { type: "string", description: "YYYY-MM-DD" },
                },
                required: ["title"],
              },
            },
            // Code fields
            language: { type: "string", description: "Programming language (for type=code)" },
            code: { type: "string", description: "Code content (for type=code)" },
            description: { type: "string", description: "Description of what the code does (for type=code)" },
            isWebPage: { type: "boolean", description: "Set true if this code is a complete deployable web page/site (for type=code)" },
          },
          required: ["type", "title"],
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

  // Clip URL to knowledge base
  if (availableTools.includes("clip_to_knowledge_base") || availableTools.includes("search_knowledge_base")) {
    tools.push({
      type: "function",
      function: {
        name: "clip_to_knowledge_base",
        description: "Save a web article/URL to the knowledge base for future reference. Extracts readable content, creates a doc, and triggers embedding for semantic search.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to clip" },
            tags: { type: "array", items: { type: "string" }, description: "Optional tags for the doc" },
            type: { type: "string", enum: ["reference", "research", "page"], description: "Doc type (default: reference)" },
          },
          required: ["url"],
        },
      },
    });
  }

  // Life context
  if (availableTools.includes("get_life_context") || availableTools.includes("search_knowledge_base")) {
    tools.push({
      type: "function",
      function: {
        name: "get_life_context",
        description: "Get current life data: today's health (sleep, energy, mood, workout), nutrition totals, day record (top 3 outcomes, primary venture), and recent task completion rate.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    });
  }

  // Knowledge graph exploration
  if (availableTools.includes("explore_knowledge_graph") || availableTools.includes("search_knowledge_base")) {
    tools.push({
      type: "function",
      function: {
        name: "explore_knowledge_graph",
        description: "Explore entity relationships in the knowledge graph. Find how people, projects, organizations, and concepts are connected.",
        parameters: {
          type: "object",
          properties: {
            entity_name: {
              type: "string",
              description: "Name of the entity to explore (e.g., 'Sayed', 'SB-OS', 'Railway')",
            },
            max_hops: {
              type: "number",
              description: "How many relationship hops to traverse (1-3, default 1)",
            },
          },
          required: ["entity_name"],
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

  // Calendar read — list events, check availability, find free slots, search
  if (availableTools.includes("calendar_read")) {
    tools.push({
      type: "function",
      function: {
        name: "calendar_read",
        description: "Read from Google Calendar: list events for a date range, check availability, find free slots, or search events by keyword.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list_events", "check_availability", "find_free_slots", "search_events"],
              description: "What to do with the calendar",
            },
            start_date: {
              type: "string",
              description: "Start date/time in ISO format or YYYY-MM-DD (defaults to today)",
            },
            end_date: {
              type: "string",
              description: "End date/time in ISO format or YYYY-MM-DD (defaults to end of start_date)",
            },
            query: {
              type: "string",
              description: "Search query (for search_events action)",
            },
            duration_minutes: {
              type: "number",
              description: "Slot duration in minutes (for find_free_slots, default: 60)",
            },
            max_results: {
              type: "number",
              description: "Maximum events to return (for list_events, default: 10)",
            },
          },
          required: ["action"],
        },
      },
    });
  }

  // Calendar write — create events, update events, delete events, create focus blocks
  if (availableTools.includes("calendar_write")) {
    tools.push({
      type: "function",
      function: {
        name: "calendar_write",
        description: "Write to Google Calendar: create events (with Google Meet), update existing events, delete events, or create focus time blocks with auto-decline.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create_event", "update_event", "delete_event", "create_focus_block"],
              description: "Calendar write action",
            },
            event_id: {
              type: "string",
              description: "Event ID (for update_event and delete_event)",
            },
            summary: {
              type: "string",
              description: "Event title/summary",
            },
            start_time: {
              type: "string",
              description: "Start time in ISO format (e.g., 2026-03-06T09:00:00)",
            },
            end_time: {
              type: "string",
              description: "End time in ISO format (e.g., 2026-03-06T10:00:00)",
            },
            description: {
              type: "string",
              description: "Event description/notes",
            },
            attendee_emails: {
              type: "array",
              items: { type: "string" },
              description: "Email addresses of attendees to invite",
            },
          },
          required: ["action"],
        },
      },
    });
  }

  // Browser automation
  if (availableTools.includes("browser_action")) {
    tools.push({
      type: "function",
      function: {
        name: "browser_action",
        description: "Automate web browser actions: navigate pages, extract text, click elements, fill forms. Use for competitive research, lead verification, price monitoring.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["navigate", "screenshot", "extract_text", "click", "fill", "evaluate"],
              description: "The browser action to perform",
            },
            url: { type: "string", description: "URL to navigate to (for 'navigate' action)" },
            selector: { type: "string", description: "CSS selector for element interaction (for click, fill, extract_text)" },
            value: { type: "string", description: "Value to fill (for 'fill' action)" },
            script: { type: "string", description: "JavaScript to evaluate (for 'evaluate' action, max 2000 chars)" },
            sessionId: { type: "string", description: "Reuse an existing browser session by ID" },
            waitForSelector: { type: "string", description: "CSS selector to wait for after navigation" },
          },
          required: ["action"],
        },
      },
    });
  }

  // Syntheliq status — cross-system bridge
  if (availableTools.includes("syntheliq_status")) {
    tools.push({
      type: "function",
      function: {
        name: "syntheliq_status",
        description: "Query Syntheliq (Hikma Digital's AI agency orchestrator) for agent runs, leads, proposals, clients, and escalations",
        parameters: {
          type: "object",
          properties: {
            query_type: {
              type: "string",
              enum: ["status", "runs", "leads", "pipeline", "proposals", "clients", "escalations"],
              description: "What to query from Syntheliq",
            },
            status_filter: {
              type: "string",
              description: "Optional status filter for leads, proposals, or clients",
            },
            hours: {
              type: "number",
              description: "Hours lookback for runs and events (default 24)",
            },
          },
          required: ["query_type"],
        },
      },
    });
  }

  // Create venture goal
  if (availableTools.includes("create_venture_goal") && (permissions.includes("write") || permissions.includes("create_project"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_venture_goal",
        description: "Create a monthly or quarterly goal for a venture with a target statement. Always propose goals to the user before creating them.",
        parameters: {
          type: "object",
          properties: {
            ventureId: { type: "string", description: "The venture UUID to set the goal for" },
            period: { type: "string", enum: ["monthly", "quarterly", "annual"], description: "Goal time period" },
            periodStart: { type: "string", description: "Start date YYYY-MM-DD (e.g., first day of the month/quarter)" },
            periodEnd: { type: "string", description: "End date YYYY-MM-DD (e.g., last day of the month/quarter)" },
            targetStatement: { type: "string", description: "Clear statement of what success looks like by the end of the period. Be specific and outcome-focused." },
            keyResults: {
              type: "array",
              description: "2-4 measurable key results that prove the goal is achieved",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Measurable outcome (e.g., 'Close 3 client contracts')" },
                  targetValue: { type: "number", description: "Numeric target" },
                  unit: { type: "string", description: "Unit of measurement (e.g., clients, AED, features, %)" },
                  projectId: { type: "string", description: "Optional: link to an existing project" },
                },
                required: ["title", "targetValue", "unit"],
              },
            },
          },
          required: ["ventureId", "period", "periodStart", "periodEnd", "targetStatement"],
        },
      },
    });
  }

  // Create key result
  if (availableTools.includes("create_key_result") && (permissions.includes("write") || permissions.includes("create_project"))) {
    tools.push({
      type: "function",
      function: {
        name: "create_key_result",
        description: "Add a key result to an existing venture goal",
        parameters: {
          type: "object",
          properties: {
            goalId: { type: "string", description: "The venture goal UUID" },
            title: { type: "string", description: "Measurable outcome statement" },
            targetValue: { type: "number", description: "Numeric target value" },
            unit: { type: "string", description: "Unit of measurement (clients, AED, features, %, etc.)" },
            projectId: { type: "string", description: "Optional: link to an existing project UUID" },
          },
          required: ["goalId", "title", "targetValue", "unit"],
        },
      },
    });
  }

  // Update key result progress
  if (availableTools.includes("update_key_result_progress") && (permissions.includes("write") || permissions.includes("create_task"))) {
    tools.push({
      type: "function",
      function: {
        name: "update_key_result_progress",
        description: "Update the current progress value of a key result",
        parameters: {
          type: "object",
          properties: {
            keyResultId: { type: "string", description: "The key result UUID" },
            currentValue: { type: "number", description: "The updated current value (e.g., 2 if 2 out of 3 clients are closed)" },
          },
          required: ["keyResultId", "currentValue"],
        },
      },
    });
  }

  return tools;
}
