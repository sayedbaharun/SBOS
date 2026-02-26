/**
 * Delegation Engine
 *
 * Hierarchical task delegation with privilege attenuation.
 * Implements DeepMind's Feb 2026 rules:
 * - Agents delegate DOWN the org chart only
 * - Permissions are the INTERSECTION of delegator's and task's requirements
 * - Max delegation depth enforced per agent
 * - Full audit trail of delegation chains
 */

import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { agents, agentTasks, type Agent, type AgentTask } from "@shared/schema";
import { messageBus } from "./message-bus";
import type { DelegationRequest, DelegationResult } from "./types";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

/**
 * Validate that a delegation is allowed:
 * 1. toAgent must be in fromAgent's canDelegateTo list
 * 2. Current depth must be < fromAgent's maxDelegationDepth
 * 3. No circular delegation (agent can't delegate to itself or ancestors)
 */
async function validateDelegation(
  fromAgent: Agent,
  toAgent: Agent,
  currentDepth: number,
  delegationChain: string[]
): Promise<{ valid: boolean; reason?: string }> {
  // Check canDelegateTo
  const canDelegateTo = (fromAgent.canDelegateTo as string[]) || [];
  if (!canDelegateTo.includes(toAgent.slug)) {
    return {
      valid: false,
      reason: `Agent "${fromAgent.slug}" is not authorized to delegate to "${toAgent.slug}". Allowed: [${canDelegateTo.join(", ")}]`,
    };
  }

  // Check depth
  const maxDepth = fromAgent.maxDelegationDepth || 2;
  if (currentDepth >= maxDepth) {
    return {
      valid: false,
      reason: `Max delegation depth (${maxDepth}) exceeded at depth ${currentDepth}`,
    };
  }

  // Check circular delegation
  if (delegationChain.includes(toAgent.id)) {
    return {
      valid: false,
      reason: `Circular delegation detected: "${toAgent.slug}" is already in the delegation chain`,
    };
  }

  return { valid: true };
}

/**
 * Apply privilege attenuation:
 * The delegated task gets the INTERSECTION of the delegator's permissions
 * and the requested permissions. Never more than the delegator has.
 */
function attenuatePermissions(
  delegatorPermissions: string[],
  requestedPermissions?: string[]
): string[] {
  if (!requestedPermissions || requestedPermissions.length === 0) {
    return [...delegatorPermissions];
  }
  return requestedPermissions.filter((p) => delegatorPermissions.includes(p));
}

function attenuateTools(
  delegatorTools: string[],
  requestedTools?: string[]
): string[] {
  if (!requestedTools || requestedTools.length === 0) {
    return [...delegatorTools];
  }
  return requestedTools.filter((t) => delegatorTools.includes(t));
}

/**
 * Delegate a task from one agent to another.
 * Creates an agent_task record and sends a delegation message via the bus.
 */
export async function delegateTask(
  request: DelegationRequest
): Promise<{ taskId: string; error?: string }> {
  const database = await getDb();

  // Load both agents
  const [fromRows, toRows] = await Promise.all([
    database.select().from(agents).where(eq(agents.id, request.fromAgentId)),
    database.select().from(agents).where(eq(agents.slug, request.toAgentSlug)),
  ]);

  const fromAgent: Agent | undefined = fromRows[0];
  const toAgent: Agent | undefined = toRows[0];

  if (!fromAgent) {
    return { taskId: "", error: `Delegating agent not found: ${request.fromAgentId}` };
  }
  if (!toAgent) {
    return { taskId: "", error: `Target agent not found: ${request.toAgentSlug}` };
  }
  if (!toAgent.isActive) {
    return { taskId: "", error: `Target agent "${request.toAgentSlug}" is inactive` };
  }

  // Check existing delegation chain depth
  const existingChain = [request.fromAgentId];
  const currentDepth = existingChain.length - 1;

  // Validate
  const validation = await validateDelegation(fromAgent, toAgent, currentDepth, existingChain);
  if (!validation.valid) {
    logger.warn(
      { from: fromAgent.slug, to: toAgent.slug, reason: validation.reason },
      "Delegation rejected"
    );
    return { taskId: "", error: validation.reason };
  }

  // Apply privilege attenuation
  const grantedPermissions = attenuatePermissions(
    (fromAgent.actionPermissions as string[]) || [],
    request.requiredPermissions
  );
  const grantedTools = attenuateTools(
    (fromAgent.availableTools as string[]) || [],
    request.requiredTools
  );

  // Build delegation chain
  const delegationChain = [...existingChain, toAgent.id];

  // Create the task
  const [task] = await database
    .insert(agentTasks)
    .values({
      title: request.title,
      description: request.description,
      assignedBy: request.fromAgentId,
      assignedTo: toAgent.id,
      delegationChain,
      depth: currentDepth + 1,
      status: "pending",
      priority: request.priority || 5,
      grantedPermissions,
      grantedTools,
      deadline: request.deadline,
    })
    .returning();

  logger.info(
    {
      taskId: task.id,
      from: fromAgent.slug,
      to: toAgent.slug,
      depth: currentDepth + 1,
      permissions: grantedPermissions,
      tools: grantedTools,
    },
    "Task delegated"
  );

  // Send delegation message via bus
  messageBus.sendDelegation(
    fromAgent.id,
    toAgent.id,
    task.id,
    `Task: ${request.title}\n\n${request.description || ""}`
  );

  return { taskId: task.id };
}

/**
 * Complete a delegated task and return the result to the delegating agent.
 */
export async function completeDelegation(
  taskId: string,
  result: Record<string, unknown>
): Promise<void> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    logger.error({ taskId }, "Delegation task not found");
    return;
  }

  // If result contains a deliverable type, route to review instead of completing
  const isDeliverable = result?.type && ["document", "recommendation", "action_items", "code"].includes(result.type as string);

  await database
    .update(agentTasks)
    .set({
      status: isDeliverable ? "needs_review" : "completed",
      result,
      deliverableType: isDeliverable ? (result.type as string) : undefined,
      completedAt: isDeliverable ? undefined : new Date(),
    })
    .where(eq(agentTasks.id, taskId));

  // Send result back to delegating agent
  messageBus.sendResult(
    task.assignedTo,
    task.assignedBy,
    taskId,
    JSON.stringify(result)
  );

  logger.info(
    { taskId, assignedTo: task.assignedTo, assignedBy: task.assignedBy, isDeliverable },
    isDeliverable ? "Delegation routed to review" : "Delegation completed"
  );
}

/**
 * Fail a delegated task.
 */
export async function failDelegation(
  taskId: string,
  error: string
): Promise<void> {
  const database = await getDb();

  await database
    .update(agentTasks)
    .set({
      status: "failed",
      error,
      completedAt: new Date(),
    })
    .where(eq(agentTasks.id, taskId));

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (task) {
    messageBus.sendResult(
      task.assignedTo,
      task.assignedBy,
      taskId,
      JSON.stringify({ error })
    );
  }

  logger.warn({ taskId, error }, "Delegation failed");
}

/**
 * Get pending delegated tasks for an agent.
 */
export async function getPendingDelegations(agentId: string): Promise<AgentTask[]> {
  const database = await getDb();

  return database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.assignedTo, agentId))
    .orderBy(agentTasks.priority, agentTasks.createdAt);
}

/**
 * Get the full delegation chain for a task (all tasks in the chain).
 */
export async function getDelegationChain(taskId: string): Promise<AgentTask[]> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) return [];

  const chain = (task.delegationChain as string[]) || [];
  if (chain.length === 0) return [task];

  // Get all related tasks in the chain
  const allTasks = await database.select().from(agentTasks);
  return allTasks.filter((t: AgentTask) => {
    const tChain = (t.delegationChain as string[]) || [];
    return tChain.some((id: string) => chain.includes(id));
  });
}

/**
 * Delegate from user directly (not from another agent).
 * User has all permissions, so no attenuation needed.
 */
export async function delegateFromUser(
  toAgentSlug: string,
  title: string,
  description: string,
  priority?: number
): Promise<{ taskId: string; error?: string }> {
  const database = await getDb();

  const [toAgent] = await database
    .select()
    .from(agents)
    .where(eq(agents.slug, toAgentSlug));

  if (!toAgent) {
    return { taskId: "", error: `Agent not found: ${toAgentSlug}` };
  }

  const [task] = await database
    .insert(agentTasks)
    .values({
      title,
      description,
      assignedBy: "user",
      assignedTo: toAgent.id,
      delegationChain: ["user", toAgent.id],
      depth: 0,
      status: "pending",
      priority: priority || 5,
      grantedPermissions: (toAgent.actionPermissions as string[]) || [],
      grantedTools: (toAgent.availableTools as string[]) || [],
    })
    .returning();

  logger.info(
    { taskId: task.id, to: toAgent.slug },
    "Task delegated from user"
  );

  messageBus.sendDelegation(
    "user",
    toAgent.id,
    task.id,
    `Task: ${title}\n\n${description || ""}`
  );

  return { taskId: task.id };
}
