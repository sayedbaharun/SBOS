/**
 * Agent Prompt Builder
 *
 * Constructs the system prompt for agent execution from the agent's soul
 * definition, delegation context, and persistent context memory.
 */

import type { Agent } from "@shared/schema";
import type { DelegationContext } from "./types";

/**
 * Build the system prompt for an agent from its soul definition.
 */
export function buildSystemPrompt(agent: Agent, delegationContext?: DelegationContext): string {
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

  // Inject persistent context memory if set (per-agent CLAUDE.md equivalent)
  if (agent.contextMemory) {
    prompt += `\n\n## Persistent Context\n${agent.contextMemory}`;
  }

  prompt += `\n\nCurrent date/time: ${new Date().toISOString()}`;

  // Proactive recall instruction
  prompt += `\n\nWhen you see items in "Relevant Past Context", naturally reference them if pertinent. Example: "Based on our earlier discussion about X..." Only reference them when genuinely relevant — do not force connections.`;

  return prompt;
}
