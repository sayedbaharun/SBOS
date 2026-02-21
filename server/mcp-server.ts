/**
 * SB-OS MCP Server
 *
 * Exposes SB-OS data and agent capabilities to Claude Code, Claude Desktop,
 * and any MCP-compatible AI tool via the Model Context Protocol.
 *
 * Run with: npx tsx server/mcp-server.ts
 */
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { storage } from './storage.js';

const server = new McpServer({
  name: 'sbos',
  version: '1.1.0',
});

// ============================================================================
// READ TOOLS — No side effects, information retrieval
// ============================================================================

server.registerTool(
  'get_dashboard',
  {
    title: 'Get Dashboard',
    description:
      'Get a high-level overview of today: current day record, top tasks, urgent items, inbox count, and ventures summary. Use this first to understand the current state.',
    inputSchema: z.object({}),
  },
  async () => {
    const today = new Date().toISOString().split('T')[0];
    const [day, todayTasks, urgentTasks, captures, ventures] = await Promise.all([
      storage.getDayOrCreate(today),
      storage.getTasksForToday(today),
      storage.getUrgentTasks(today, 5),
      storage.getCaptures({ clarified: false, limit: 10 }),
      storage.getVentures(),
    ]);

    const result = {
      date: today,
      day: day
        ? {
            title: day.title,
            mood: day.mood,
            top3Outcomes: day.top3Outcomes,
            oneThingToShip: day.oneThingToShip,
            reflectionAm: day.reflectionAm,
          }
        : null,
      todayTasks: todayTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        venture: t.ventureId,
        focusSlot: t.focusSlot,
      })),
      urgentTasks: urgentTasks.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
      })),
      inboxCount: captures.length,
      ventures: ventures.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status,
        domain: v.domain,
      })),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'list_ventures',
  {
    title: 'List Ventures',
    description: 'List all business ventures with their status, domain, and focus.',
    inputSchema: z.object({}),
  },
  async () => {
    const ventures = await storage.getVentures();
    const result = ventures.map((v) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      status: v.status,
      domain: v.domain,
      oneLiner: v.oneLiner,
      primaryFocus: v.primaryFocus,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'list_tasks',
  {
    title: 'List Tasks',
    description:
      'List tasks with optional filters. Use status filter for specific views (e.g. "in_progress", "next"). Returns up to 50 tasks.',
    inputSchema: z.object({
      ventureId: z.string().optional().describe('Filter by venture ID'),
      projectId: z.string().optional().describe('Filter by project ID'),
      status: z
        .string()
        .optional()
        .describe(
          'Filter by status: idea, next, in_progress, waiting, done, cancelled, backlog'
        ),
      limit: z.number().optional().describe('Max results (default 50)'),
    }),
  },
  async ({ ventureId, projectId, status, limit }) => {
    const tasks = await storage.getTasks({
      ventureId: ventureId ?? undefined,
      projectId: projectId ?? undefined,
      status: status ?? undefined,
      limit: limit ?? 50,
    });
    const result = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      type: t.type,
      ventureId: t.ventureId,
      projectId: t.projectId,
      dueDate: t.dueDate,
      focusDate: t.focusDate,
      focusSlot: t.focusSlot,
      notes: t.notes?.slice(0, 200),
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'list_projects',
  {
    title: 'List Projects',
    description: 'List projects, optionally filtered by venture.',
    inputSchema: z.object({
      ventureId: z.string().optional().describe('Filter by venture ID'),
    }),
  },
  async ({ ventureId }) => {
    const projects = await storage.getProjects({
      ventureId: ventureId ?? undefined,
    });
    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      ventureId: p.ventureId,
      status: p.status,
      category: p.category,
      priority: p.priority,
      outcome: p.outcome,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'search_docs',
  {
    title: 'Search Knowledge Base',
    description:
      'Search SOPs, playbooks, specs, and other documents in the knowledge base by keyword.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
    }),
  },
  async ({ query }) => {
    const docs = await storage.searchDocs(query);
    const result = docs.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      domain: d.domain,
      status: d.status,
      ventureId: d.ventureId,
      body: d.body?.slice(0, 500),
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'get_doc',
  {
    title: 'Get Document',
    description: 'Get full content of a specific knowledge base document by ID.',
    inputSchema: z.object({
      id: z.string().describe('Document ID'),
    }),
  },
  async ({ id }) => {
    const doc = await storage.getDoc(id);
    if (!doc) {
      return { content: [{ type: 'text' as const, text: 'Document not found' }] };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              id: doc.id,
              title: doc.title,
              type: doc.type,
              domain: doc.domain,
              body: doc.body,
              tags: doc.tags,
              ventureId: doc.ventureId,
              projectId: doc.projectId,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  'list_captures',
  {
    title: 'List Inbox Captures',
    description:
      'List items in the inbox (capture items). Shows unclarified items by default.',
    inputSchema: z.object({
      clarified: z
        .boolean()
        .optional()
        .describe('Filter by clarified status (default: false = unclarified)'),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
  },
  async ({ clarified, limit }) => {
    const captures = await storage.getCaptures({
      clarified: clarified ?? false,
      limit: limit ?? 20,
    });
    const result = captures.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      source: c.source,
      domain: c.domain,
      ventureId: c.ventureId,
      notes: c.notes,
      clarified: c.clarified,
      createdAt: c.createdAt,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'get_health_summary',
  {
    title: 'Get Health Summary',
    description: 'Get recent health entries (sleep, energy, mood, workout) for the last 7 days.',
    inputSchema: z.object({}),
  },
  async () => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const entries = await storage.getHealthEntries({
      dateGte: weekAgo.toISOString().split('T')[0],
      dateLte: today.toISOString().split('T')[0],
    });
    const result = entries.map((e) => ({
      date: e.date,
      sleepHours: e.sleepHours,
      sleepQuality: e.sleepQuality,
      energyLevel: e.energyLevel,
      mood: e.mood,
      steps: e.steps,
      workoutDone: e.workoutDone,
      workoutType: e.workoutType,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'list_agents',
  {
    title: 'List Agents',
    description:
      'List all AI agents in the SB-OS agent hierarchy with their roles and capabilities.',
    inputSchema: z.object({}),
  },
  async () => {
    const { db } = await import('../db/index.js');
    const { agents } = await import('../shared/schema.js');
    const { eq } = await import('drizzle-orm');
    const allAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.isActive, true));
    const result = allAgents.map((a) => ({
      slug: a.slug,
      name: a.name,
      role: a.role,
      expertise: a.expertise,
      availableTools: a.availableTools,
      canDelegateTo: a.canDelegateTo,
      modelTier: a.modelTier,
      schedule: a.schedule,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================================
// WRITE TOOLS — Create and modify data
// ============================================================================

server.registerTool(
  'create_task',
  {
    title: 'Create Task',
    description:
      'Create a new task in SB-OS. Can optionally link to a venture and project.',
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      status: z
        .string()
        .optional()
        .describe('Status: idea, next, in_progress, waiting, backlog (default: next)'),
      priority: z.string().optional().describe('Priority: P0, P1, P2, P3 (default: P2)'),
      type: z
        .string()
        .optional()
        .describe(
          'Type: business, deep_work, admin, health, learning, personal (default: business)'
        ),
      ventureId: z.string().optional().describe('Venture ID to link to'),
      projectId: z.string().optional().describe('Project ID to link to'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      focusDate: z.string().optional().describe('Focus date for scheduling (YYYY-MM-DD)'),
      notes: z.string().optional().describe('Additional notes or context'),
    }),
  },
  async ({ title, status, priority, type, ventureId, projectId, dueDate, focusDate, notes }) => {
    const task = await storage.createTask({
      title,
      status: (status as any) ?? 'next',
      priority: (priority as any) ?? 'P2',
      type: (type as any) ?? 'business',
      ventureId: ventureId ?? null,
      projectId: projectId ?? null,
      dueDate: dueDate ?? null,
      focusDate: focusDate ?? null,
      notes: notes ?? null,
    } as any);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Task created: #${task.id} "${task.title}" [${task.status}] [${task.priority}]`,
        },
      ],
    };
  }
);

server.registerTool(
  'update_task',
  {
    title: 'Update Task',
    description: 'Update an existing task (status, priority, notes, etc).',
    inputSchema: z.object({
      id: z.string().describe('Task ID'),
      status: z.string().optional().describe('New status'),
      priority: z.string().optional().describe('New priority'),
      title: z.string().optional().describe('New title'),
      notes: z.string().optional().describe('New or appended notes'),
      focusDate: z.string().optional().describe('New focus date (YYYY-MM-DD)'),
      dueDate: z.string().optional().describe('New due date (YYYY-MM-DD)'),
    }),
  },
  async ({ id, ...updates }) => {
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }
    const task = await storage.updateTask(id, cleanUpdates as any);
    if (!task) {
      return { content: [{ type: 'text' as const, text: `Task ${id} not found` }] };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Task updated: #${task.id} "${task.title}" [${task.status}] [${task.priority}]`,
        },
      ],
    };
  }
);

server.registerTool(
  'create_capture',
  {
    title: 'Create Capture',
    description:
      'Add an item to the SB-OS inbox for later processing. Use for quick ideas, notes, tasks, reminders.',
    inputSchema: z.object({
      title: z.string().describe('Capture text'),
      type: z
        .string()
        .optional()
        .describe('Type: idea, task, note, link, reminder (default: idea)'),
      source: z.string().optional().describe('Source: brain, email, meeting, web (default: brain)'),
      domain: z
        .string()
        .optional()
        .describe('Domain: work, health, finance, learning, personal (default: work)'),
      notes: z.string().optional().describe('Additional context'),
      ventureId: z.string().optional().describe('Link to venture'),
    }),
  },
  async ({ title, type, source, domain, notes, ventureId }) => {
    const capture = await storage.createCapture({
      title,
      type: (type as any) ?? 'idea',
      source: (source as any) ?? 'brain',
      domain: (domain as any) ?? 'work',
      notes: notes ?? null,
      ventureId: ventureId ?? null,
    } as any);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Captured: #${capture.id} "${capture.title}" [${capture.type}] → inbox`,
        },
      ],
    };
  }
);

server.registerTool(
  'create_doc',
  {
    title: 'Create Document',
    description:
      'Create a document in the SB-OS knowledge base (SOP, spec, playbook, etc).',
    inputSchema: z.object({
      title: z.string().describe('Document title'),
      body: z.string().describe('Document content (markdown)'),
      type: z
        .string()
        .optional()
        .describe(
          'Type: page, sop, prompt, spec, template, playbook, strategy, tech_doc, process, reference, meeting_notes, research (default: page)'
        ),
      domain: z
        .string()
        .optional()
        .describe(
          'Domain: venture_ops, marketing, product, sales, tech, trading, finance, legal, hr, personal (default: tech)'
        ),
      ventureId: z.string().optional().describe('Link to venture'),
      tags: z.string().optional().describe('Comma-separated tags'),
    }),
  },
  async ({ title, body, type, domain, ventureId, tags }) => {
    const doc = await storage.createDoc({
      title,
      body,
      type: (type as any) ?? 'page',
      domain: (domain as any) ?? 'tech',
      status: 'active',
      ventureId: ventureId ?? null,
      tags: tags ?? null,
    } as any);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Document created: #${doc.id} "${doc.title}" [${doc.type}] [${doc.domain}]`,
        },
      ],
    };
  }
);

// ============================================================================
// AGENT TOOLS — Interact with the AI agent hierarchy
// ============================================================================

server.registerTool(
  'chat_with_agent',
  {
    title: 'Chat With Agent',
    description:
      'Send a message to an SB-OS agent and get their response. Agents have specialized expertise (CMO for marketing, CTO for tech, Research Analyst for research, etc). Use list_agents to see available agents.',
    inputSchema: z.object({
      agentSlug: z
        .string()
        .describe(
          'Agent slug (e.g. chief-of-staff, cmo, cto, head-of-products, research-analyst, mvp-builder, growth-specialist, seo-specialist, social-media-manager, content-strategist)'
        ),
      message: z.string().describe('Message to send to the agent'),
    }),
  },
  async ({ agentSlug, message }) => {
    try {
      const { executeAgentChat } = await import('./agents/agent-runtime.js');
      const result = await executeAgentChat(agentSlug, message, 'mcp-user');
      return {
        content: [
          {
            type: 'text' as const,
            text: `**${result.agentSlug}**: ${result.response}`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Agent error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'delegate_to_agent',
  {
    title: 'Delegate Task to Agent',
    description:
      'Delegate a task to an agent for autonomous execution. The agent will work on it using their tools (web research, market analysis, code generation, etc). Results are stored in the delegation log.',
    inputSchema: z.object({
      agentSlug: z.string().describe('Agent slug to delegate to'),
      title: z.string().describe('Task title'),
      description: z.string().describe('Detailed task description'),
      priority: z
        .number()
        .optional()
        .describe('Priority 1-10 (1 = highest, default: 5)'),
    }),
  },
  async ({ agentSlug, title, description, priority }) => {
    try {
      const { db } = await import('../db/index.js');
      const { agents } = await import('../shared/schema.js');
      const { eq } = await import('drizzle-orm');
      const { delegateFromUser } = await import('./agents/delegation-engine.js');

      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.slug, agentSlug));

      if (!agent) {
        return {
          content: [{ type: 'text' as const, text: `Agent not found: ${agentSlug}` }],
          isError: true,
        };
      }

      const result = await delegateFromUser(
        agent.slug,
        title,
        description,
        priority ?? 5
      );

      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Delegation failed: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Task delegated to ${agent.name}: "${title}" (task ID: ${result.taskId})`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Delegation error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// MEMORY INSPECTION TOOLS
// ============================================================================

server.registerTool(
  'get_agent_memories',
  {
    title: 'Get Agent Memories',
    description:
      'Inspect what an agent has learned. Shows memories stored by the learning pipeline, including shared cross-agent knowledge. Use this to verify agent learning and debug memory issues.',
    inputSchema: z.object({
      agentSlug: z
        .string()
        .optional()
        .describe(
          'Agent slug to inspect (e.g. "cmo", "cto"). Omit to see shared memories.'
        ),
      memoryType: z
        .string()
        .optional()
        .describe(
          'Filter by type: learning, preference, context, decision, relationship'
        ),
      limit: z.number().optional().describe('Max results (default 30)'),
      minImportance: z.number().optional().describe('Min importance 0-1 (default 0)'),
    }),
  },
  async ({ agentSlug, memoryType, limit, minImportance }) => {
    try {
      const { getMemories } = await import('./agents/agent-memory-manager.js');
      const SHARED_MEMORY_AGENT_ID = '00000000-0000-0000-0000-000000000000';

      let agentId = SHARED_MEMORY_AGENT_ID;

      if (agentSlug) {
        const { db } = await import('../db/index.js');
        const { agents } = await import('../shared/schema.js');
        const { eq } = await import('drizzle-orm');
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.slug, agentSlug));

        if (!agent) {
          return {
            content: [{ type: 'text' as const, text: `Agent not found: ${agentSlug}` }],
            isError: true,
          };
        }
        agentId = agent.id;
      }

      const memories = await getMemories(agentId, {
        memoryType: memoryType ?? undefined,
        limit: limit ?? 30,
        minImportance: minImportance ?? 0,
      });

      const result = memories.map((m: any) => ({
        id: m.id,
        type: m.memoryType,
        content: m.content,
        importance: m.importance,
        scope: m.scope,
        tags: m.tags,
        createdAt: m.createdAt,
        accessCount: m.accessCount,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: `${agentSlug ? `Memories for ${agentSlug}` : 'Shared memories'} (${result.length} found):\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Memory query error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// CLAUDE CODE PERSISTENT MEMORY TOOLS
// ============================================================================

const CLAUDE_CODE_AGENT_ID = "11111111-1111-1111-1111-111111111111";

let claudeCodeAgentEnsured = false;
async function ensureClaudeCodeAgent(): Promise<void> {
  if (claudeCodeAgentEnsured) return;
  const { db } = await import('../db/index.js');
  const { agents } = await import('../shared/schema.js');
  const { eq } = await import('drizzle-orm');

  const [existing] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, CLAUDE_CODE_AGENT_ID));

  if (!existing) {
    await db.insert(agents).values({
      id: CLAUDE_CODE_AGENT_ID,
      name: "Claude Code",
      slug: "_claude-code",
      role: "specialist",
      soul: "Sentinel agent for Claude Code persistent memory. Not an actual agent.",
      isActive: false,
    });
  }
  claudeCodeAgentEnsured = true;
}

server.registerTool(
  'store_claude_memory',
  {
    title: 'Store Claude Code Memory',
    description:
      'Store a persistent memory for Claude Code. Use this when discovering project-specific constraints, patterns, user preferences, or decisions worth remembering across sessions.',
    inputSchema: z.object({
      content: z.string().describe('The memory content to store'),
      memoryType: z
        .string()
        .optional()
        .describe('Type: learning, preference, context, decision, relationship (default: learning)'),
      importance: z
        .number()
        .optional()
        .describe('Importance 0-1 (0.3=minor, 0.5=useful, 0.7=important, 0.9=critical; default: 0.6)'),
      tags: z
        .string()
        .optional()
        .describe('Comma-separated tags for categorization'),
      scope: z
        .string()
        .optional()
        .describe('Scope: "agent" (Claude Code only) or "shared" (visible to all agents too). Default: agent'),
    }),
  },
  async ({ content, memoryType, importance, tags, scope }) => {
    try {
      await ensureClaudeCodeAgent();
      const { storeMemory } = await import('./agents/agent-memory-manager.js');
      const SHARED_MEMORY_AGENT_ID = '00000000-0000-0000-0000-000000000000';

      const targetAgentId = scope === 'shared' ? SHARED_MEMORY_AGENT_ID : CLAUDE_CODE_AGENT_ID;
      const parsedTags = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

      const memory = await storeMemory({
        agentId: targetAgentId,
        memoryType: (memoryType as any) ?? 'learning',
        content,
        importance: importance ?? 0.6,
        scope: (scope as any) ?? 'agent',
        tags: parsedTags,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Memory stored (id: ${memory.id}, scope: ${scope ?? 'agent'}, importance: ${memory.importance})`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Memory store error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'search_claude_memory',
  {
    title: 'Search Claude Code Memory',
    description:
      'Search Claude Code persistent memories using hybrid semantic + keyword search. Includes shared agent memories by default.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      includeShared: z
        .boolean()
        .optional()
        .describe('Include shared cross-agent memories (default: true)'),
      limit: z.number().optional().describe('Max results (default: 15)'),
    }),
  },
  async ({ query, includeShared, limit }) => {
    try {
      await ensureClaudeCodeAgent();
      const { searchMemories } = await import('./agents/agent-memory-manager.js');

      const results = await searchMemories(CLAUDE_CODE_AGENT_ID, query, limit ?? 15);

      const SHARED_MEMORY_AGENT_ID = '00000000-0000-0000-0000-000000000000';
      const filtered =
        includeShared === false
          ? results.filter((m: any) => m.agentId === CLAUDE_CODE_AGENT_ID)
          : results;

      const formatted = filtered.map((m: any) => {
        const age = getTimeAgo(m.createdAt);
        return {
          id: m.id,
          type: m.memoryType,
          content: m.content,
          importance: m.importance,
          scope: m.agentId === SHARED_MEMORY_AGENT_ID ? 'shared' : 'agent',
          tags: m.tags,
          age,
        };
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${formatted.length} memories:\n\n${JSON.stringify(formatted, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Memory search error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'get_claude_session_context',
  {
    title: 'Get Claude Code Session Context',
    description:
      'Load accumulated memory context for the current session. Call this at the start of complex or multi-session work to recall past learnings, preferences, and decisions.',
    inputSchema: z.object({
      topic: z
        .string()
        .optional()
        .describe('Optional topic to focus context retrieval on'),
    }),
  },
  async ({ topic }) => {
    try {
      await ensureClaudeCodeAgent();
      const { buildMemoryContext, buildRelevantMemoryContext } = await import(
        './agents/agent-memory-manager.js'
      );

      const generalContext = await buildMemoryContext(CLAUDE_CODE_AGENT_ID, 3000);

      let topicContext = '';
      if (topic) {
        topicContext = await buildRelevantMemoryContext(CLAUDE_CODE_AGENT_ID, topic, 1500);
      }

      const combined = [generalContext, topicContext].filter(Boolean).join('\n\n');

      if (!combined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No memories found yet. Use store_claude_memory to build persistent context.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `# Claude Code Session Context\n\n${combined}`,
          },
        ],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Session context error: ${errMsg}` }],
        isError: true,
      };
    }
  }
);

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// ============================================================================
// Start the MCP server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP Server failed to start:', err);
  process.exit(1);
});
