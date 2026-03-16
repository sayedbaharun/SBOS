/**
 * Conversation Manager
 *
 * Manages agent conversations: threading, delegation context assembly,
 * conversation windowing, and history retrieval.
 *
 * Handles the complexity of multi-agent conversations where messages
 * can come from users, other agents (delegation), or system events.
 */

import { eq, desc, and, inArray } from "drizzle-orm";
import { logger } from "../logger";
import {
  agentConversations,
  agentTasks,
  agents,
  type AgentConversation,
  type Agent,
} from "@shared/schema";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// CONVERSATION RETRIEVAL
// ============================================================================

/**
 * Get recent conversation history for an agent, respecting token budget.
 * Returns messages in chronological order (oldest first).
 *
 * When sessionId is provided, only returns messages from that session,
 * preventing context leakage between concurrent conversations.
 */
export async function getConversationHistory(
  agentId: string,
  options: {
    limit?: number;
    maxTokens?: number;
    includeDelegation?: boolean;
    sessionId?: string;
  } = {}
): Promise<AgentConversation[]> {
  const { limit = 20, maxTokens = 8000, includeDelegation = true, sessionId } = options;
  const database = await getDb();

  // Fetch recent messages — scoped by session if provided
  const whereClause = sessionId
    ? and(eq(agentConversations.agentId, agentId), eq(agentConversations.sessionId, sessionId))
    : eq(agentConversations.agentId, agentId);

  const messages = await database
    .select()
    .from(agentConversations)
    .where(whereClause)
    .orderBy(desc(agentConversations.createdAt))
    .limit(limit);

  // Filter out delegation messages if not wanted
  let filtered = includeDelegation
    ? messages
    : messages.filter((m: AgentConversation) => m.role !== "delegation");

  // Window by token budget (approximate: 1 token ≈ 4 chars)
  const tokenBudget = maxTokens * 4; // convert to char budget
  let totalChars = 0;
  const windowed: AgentConversation[] = [];

  for (const msg of filtered) {
    totalChars += msg.content.length;
    if (totalChars > tokenBudget) break;
    windowed.push(msg);
  }

  // Return in chronological order
  return windowed.reverse();
}

/**
 * Get the full conversation thread for a delegation task.
 * Follows the delegation chain to collect all related messages.
 */
export async function getDelegationThread(
  taskId: string
): Promise<AgentConversation[]> {
  const database = await getDb();

  const messages = await database
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.delegationTaskId, taskId))
    .orderBy(agentConversations.createdAt);

  return messages;
}

// ============================================================================
// CONVERSATION PERSISTENCE
// ============================================================================

/**
 * Save a message to an agent's conversation history.
 */
export async function saveMessage(params: {
  agentId: string;
  role: "user" | "assistant" | "system" | "delegation";
  content: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  parentMessageId?: string;
  delegationFrom?: string;
  delegationTaskId?: string;
}): Promise<AgentConversation> {
  const database = await getDb();

  const [message] = await database
    .insert(agentConversations)
    .values({
      agentId: params.agentId,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      metadata: params.metadata,
      parentMessageId: params.parentMessageId,
      delegationFrom: params.delegationFrom,
      delegationTaskId: params.delegationTaskId,
    })
    .returning();

  return message;
}

/**
 * Clear conversation history for an agent.
 * Optionally preserve delegation messages (they're part of the audit trail).
 */
export async function clearConversation(
  agentId: string,
  options: { preserveDelegation?: boolean } = {}
): Promise<{ deleted: number }> {
  const database = await getDb();
  const { preserveDelegation = true } = options;

  if (preserveDelegation) {
    // Only delete user/assistant messages, keep delegation history
    const all = await database
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.agentId, agentId));

    const toDelete = all.filter(
      (m: AgentConversation) => m.role !== "delegation"
    );

    if (toDelete.length > 0) {
      const ids = toDelete.map((m: AgentConversation) => m.id);
      await database
        .delete(agentConversations)
        .where(inArray(agentConversations.id, ids));
    }

    return { deleted: toDelete.length };
  }

  // Delete everything
  const all = await database
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.agentId, agentId));

  await database
    .delete(agentConversations)
    .where(eq(agentConversations.agentId, agentId));

  return { deleted: all.length };
}

// ============================================================================
// DELEGATION CONTEXT ASSEMBLY
// ============================================================================

/**
 * Build delegation context for an agent executing a delegated task.
 * Includes the task description, parent agent info, and any prior
 * conversation context from the delegating agent.
 */
export async function buildDelegationContext(
  taskId: string
): Promise<{
  taskDescription: string;
  parentAgentContext: string;
  priorMessages: AgentConversation[];
} | null> {
  const database = await getDb();

  // Load the task
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) return null;

  // Build task description
  let taskDescription = `# Delegated Task: ${task.title}\n\n`;
  if (task.description) {
    taskDescription += `${task.description}\n\n`;
  }
  taskDescription += `Priority: ${task.priority}/10\n`;
  taskDescription += `Granted permissions: ${((task.grantedPermissions as string[]) || []).join(", ")}\n`;
  taskDescription += `Granted tools: ${((task.grantedTools as string[]) || []).join(", ")}\n`;

  // Get parent agent info
  let parentAgentContext = "";
  if (task.assignedBy !== "user") {
    const [parentAgent] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, task.assignedBy));

    if (parentAgent) {
      parentAgentContext = `Delegated by: ${parentAgent.name} (${parentAgent.role})\n`;

      // Get recent messages from parent's conversation for context
      const parentMessages = await database
        .select()
        .from(agentConversations)
        .where(eq(agentConversations.agentId, parentAgent.id))
        .orderBy(desc(agentConversations.createdAt))
        .limit(5);

      if (parentMessages.length > 0) {
        parentAgentContext += "\n## Recent context from delegating agent:\n";
        for (const msg of parentMessages.reverse()) {
          parentAgentContext += `[${msg.role}]: ${msg.content.slice(0, 300)}\n`;
        }
      }
    }
  } else {
    parentAgentContext = "Delegated directly by the user (Sayed).\n";
  }

  // Get any prior messages on this delegation thread
  const priorMessages = await getDelegationThread(taskId);

  return {
    taskDescription,
    parentAgentContext,
    priorMessages,
  };
}

// ============================================================================
// CONVERSATION ANALYTICS
// ============================================================================

/**
 * Get conversation statistics for an agent.
 */
export async function getConversationStats(agentId: string): Promise<{
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  delegationMessages: number;
  lastActivity: string | null;
}> {
  const database = await getDb();

  const messages = await database
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.agentId, agentId));

  const lastMsg = messages.length > 0
    ? messages.sort(
        (a: AgentConversation, b: AgentConversation) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]
    : null;

  return {
    totalMessages: messages.length,
    userMessages: messages.filter((m: AgentConversation) => m.role === "user").length,
    assistantMessages: messages.filter((m: AgentConversation) => m.role === "assistant").length,
    delegationMessages: messages.filter((m: AgentConversation) => m.role === "delegation").length,
    lastActivity: lastMsg ? lastMsg.createdAt.toISOString() : null,
  };
}

/**
 * Get a summary of all agent conversation activity.
 * Useful for the Chief of Staff's daily briefing.
 */
export async function getAllAgentActivity(
  sinceHours: number = 24
): Promise<
  Array<{
    agentId: string;
    agentName: string;
    agentSlug: string;
    messageCount: number;
    lastMessage: string;
    lastActivity: string;
  }>
> {
  const database = await getDb();

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  // Get all agents
  const allAgents = await database
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  // Get all recent conversations
  const recentMessages = await database
    .select()
    .from(agentConversations)
    .orderBy(desc(agentConversations.createdAt));

  const activity: Array<{
    agentId: string;
    agentName: string;
    agentSlug: string;
    messageCount: number;
    lastMessage: string;
    lastActivity: string;
  }> = [];

  for (const agent of allAgents) {
    const agentMessages = recentMessages.filter(
      (m: AgentConversation) =>
        m.agentId === agent.id &&
        new Date(m.createdAt).getTime() > since.getTime()
    );

    if (agentMessages.length > 0) {
      const lastMsg = agentMessages[0]; // already desc ordered
      activity.push({
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
        messageCount: agentMessages.length,
        lastMessage: lastMsg.content.slice(0, 200),
        lastActivity: lastMsg.createdAt.toISOString(),
      });
    }
  }

  return activity.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}
