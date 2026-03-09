/**
 * Agent System Type Definitions
 *
 * Core interfaces for the hierarchical multi-agent architecture.
 * Agents have personalities, tools, permissions, memory scopes,
 * reporting chains, and schedules.
 */

import type OpenAI from "openai";
import type { Agent, AgentTask, AgentConversation } from "@shared/schema";

// ============================================================================
// AGENT DEFINITION (parsed from soul frontmatter)
// ============================================================================

export interface AgentSoulFrontmatter {
  name: string;
  slug: string;
  role: "executive" | "manager" | "specialist" | "worker";
  parent: string; // slug of parent agent or "user"
  venture: string | null;
  expertise: string[];
  tools: string[];
  permissions: string[];
  delegates_to: string[];
  max_delegation_depth: number;
  model_tier: "auto" | "top" | "mid" | "fast" | "local";
  temperature: number;
  schedule?: Record<string, string>; // { "task_name": "cron_expression" }
  memory_scope: "isolated" | "shared" | "inherit_parent";
}

// ============================================================================
// AGENT RUNTIME CONTEXT
// ============================================================================

/** Context assembled for a single agent execution */
export interface AgentExecutionContext {
  agent: Agent;
  systemPrompt: string;
  conversationHistory: AgentConversation[];
  memoryContext: string;
  delegationContext?: DelegationContext;
  ventureContext?: string;
  tools: OpenAI.Chat.ChatCompletionTool[];
}

/** Context for a delegated task execution */
export interface DelegationContext {
  task: AgentTask;
  parentAgent: Agent;
  delegationChain: string[];
  grantedPermissions: string[];
  grantedTools: string[];
  depth: number;
}

// ============================================================================
// AGENT TOOLS
// ============================================================================

/** Tool definition for agent tool registry */
export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermissions: string[];
  execute: (args: Record<string, any>, context: AgentToolContext) => Promise<AgentToolResult>;
}

/** Context provided to a tool during execution */
export interface AgentToolContext {
  agentId: string;
  agentSlug: string;
  ventureId?: string;
  permissions: string[];
  userId: string;
}

/** Result from a tool execution */
export interface AgentToolResult {
  result: string;
  action?: {
    actionType: string;
    entityType?: string;
    entityId?: string;
    parameters?: Record<string, any>;
    status: "success" | "failed";
    errorMessage?: string;
  };
}

// ============================================================================
// INTER-AGENT MESSAGING
// ============================================================================

/** Message types for the agent message bus */
export type AgentMessageType =
  | "agent:message"
  | "agent:delegation"
  | "agent:result"
  | "agent:broadcast"
  | "agent:escalation"
  | "agent:schedule";

/** A message passed between agents via the message bus */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  fromAgentId: string; // agent UUID or "user"
  toAgentId: string;   // agent UUID or "broadcast"
  content: string;
  metadata?: Record<string, unknown>;
  taskId?: string;     // linked agent_task if delegation
  timestamp: Date;
}

// ============================================================================
// DELEGATION
// ============================================================================

/** Request to delegate a task from one agent to another */
export interface DelegationRequest {
  fromAgentId: string;
  toAgentSlug: string;
  title: string;
  description: string;
  priority?: number;
  deadline?: Date;
  requiredPermissions?: string[];
  requiredTools?: string[];
}

/** Result returned from a completed delegation */
export interface DelegationResult {
  taskId: string;
  status: "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  tokensUsed?: number;
  model?: string;
}

// ============================================================================
// AGENT EXECUTION RESULTS
// ============================================================================

/** Result from an agent chat execution */
export interface AgentChatResult {
  response: string;
  agentId: string;
  agentSlug: string;
  actions: Array<{
    actionType: string;
    entityType?: string;
    entityId?: string;
    status: string;
  }>;
  delegations: Array<{
    taskId: string;
    toAgentSlug: string;
    status: string;
  }>;
  tokensUsed: number;
  model: string;
}

// ============================================================================
// MODEL TIER MAPPING
// ============================================================================

/** Default model selection based on agent role */
export const MODEL_TIER_DEFAULTS: Record<string, string> = {
  top: "anthropic/claude-opus-4",
  mid: "anthropic/claude-sonnet-4",
  fast: "google/gemini-2.5-flash-lite",
  local: "local/auto",
};

export const ROLE_TO_MODEL_TIER: Record<string, string> = {
  executive: "top",
  manager: "mid",
  specialist: "fast",
  worker: "fast",
};

/** Resolve the model for an agent based on its config */
export function resolveAgentModel(agent: Agent): string {
  if (agent.preferredModel) return agent.preferredModel;
  const tier = agent.modelTier === "auto"
    ? ROLE_TO_MODEL_TIER[agent.role] || "fast"
    : agent.modelTier || "fast";
  return MODEL_TIER_DEFAULTS[tier] || MODEL_TIER_DEFAULTS.fast;
}

// ============================================================================
// SCHEDULE
// ============================================================================

/** A scheduled job for an agent */
export interface AgentScheduledJob {
  agentId: string;
  agentSlug: string;
  jobName: string;
  cronExpression: string;
  lastRun?: Date;
  nextRun?: Date;
}
