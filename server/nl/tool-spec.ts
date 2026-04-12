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
];
