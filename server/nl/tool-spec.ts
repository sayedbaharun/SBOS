/**
 * OpenAI function tool definitions for the Natural Language Query endpoint.
 * Used by POST /api/nl/query to interpret and respond to plain-English questions
 * about the SB-OS operating state or to trigger actions.
 */

export interface NlTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const NL_TOOLS: NlTool[] = [
  {
    type: "function",
    function: {
      name: "get_world_state",
      description:
        "Get a summary of the current operating state — active tasks, goals, health metrics, and priorities. Use when the user asks about what's happening, what's on the agenda, or the current status of anything.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Create a new task in the system. Use when the user clearly wants to add, create, or schedule a task.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the task to create",
          },
          priority: {
            type: "string",
            enum: ["P0", "P1", "P2", "P3"],
            description:
              "Task priority. P0 = critical/urgent, P1 = high, P2 = medium, P3 = low. Default to P2 if not specified.",
          },
          ventureId: {
            type: "string",
            description:
              "Optional UUID of the venture this task belongs to. Omit if not specified by the user.",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "answer_question",
      description:
        "Answer a direct question about the OS state using the provided context. Use when the user asks a question that can be answered from the current world state data.",
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            description:
              "A clear, concise answer to the user's question. Be specific and reference actual data when available.",
          },
        },
        required: ["answer"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_task",
      description:
        "Delegate an existing task to an AI agent. Use when the user wants to assign, delegate, or hand off a task to an agent. Requires the task ID and agent slug.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "UUID of the task to delegate" },
          agentSlug: {
            type: "string",
            description:
              "Slug of the agent to delegate to (e.g. 'chief-of-staff', 'cmo', 'cto')",
          },
        },
        required: ["taskId", "agentSlug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_kr_progress",
      description:
        "Update the current progress value of a key result. Use when the user says they completed X, achieved Y, or wants to update progress on a goal metric.",
      parameters: {
        type: "object",
        properties: {
          keyResultId: {
            type: "string",
            description: "UUID of the key result to update",
          },
          currentValue: {
            type: "number",
            description:
              "The new current value (not a delta — the absolute new value)",
          },
        },
        required: ["keyResultId", "currentValue"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_venture_goal",
      description:
        "Create a new goal (OKR) for a venture with optional key results. Use when the user wants to set a goal, target, or OKR for one of their ventures.",
      parameters: {
        type: "object",
        properties: {
          ventureId: {
            type: "string",
            description: "UUID of the venture this goal belongs to",
          },
          period: {
            type: "string",
            enum: ["monthly", "quarterly", "annual"],
            description: "Goal period",
          },
          periodStart: {
            type: "string",
            description: "ISO date string for period start (YYYY-MM-DD)",
          },
          periodEnd: {
            type: "string",
            description: "ISO date string for period end (YYYY-MM-DD)",
          },
          targetStatement: {
            type: "string",
            description:
              "What does success look like? E.g. 'Close 3 enterprise clients'",
          },
          keyResults: {
            type: "array",
            description:
              "Optional list of key results to create alongside the goal",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                targetValue: { type: "number" },
                unit: {
                  type: "string",
                  description: "e.g. 'clients', 'AED', 'features', '%'",
                },
              },
              required: ["title", "targetValue", "unit"],
            },
          },
        },
        required: [
          "ventureId",
          "period",
          "periodStart",
          "periodEnd",
          "targetStatement",
        ],
      },
    },
  },
];
