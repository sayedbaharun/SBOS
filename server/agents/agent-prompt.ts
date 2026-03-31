/**
 * Agent Prompt Builder
 *
 * Constructs the system prompt for agent execution from the agent's soul
 * definition, delegation context, and persistent context memory.
 */

import type { Agent } from "@shared/schema";
import type { DelegationContext } from "./types";

// Tools that perform write/mutative actions — used to compute "what you cannot do"
const WRITE_TOOLS: Record<string, string> = {
  calendar_write: "create, update, or delete calendar events",
  create_task: "create tasks",
  update_task: "update tasks",
  create_doc: "create knowledge base documents",
  create_project: "create projects",
  create_capture: "create capture items",
  submit_deliverable: "submit deliverables for review",
  deploy: "deploy to Vercel or Railway",
  browser_action: "control a browser",
  clip_to_knowledge_base: "clip web pages to the knowledge base",
  remember: "store memories",
  update_day: "update day records",
  delegate: "delegate tasks to sub-agents",
};

/**
 * Build a capability boundary section for the system prompt.
 * Tells the agent what it cannot do — prevents "people-pleaser" hallucinations
 * where the LLM claims to have completed an action it has no tool to perform.
 */
function buildCapabilityBoundary(agent: Agent): string {
  const availableTools = (agent.availableTools as string[]) || [];

  // Compute which write tools this agent is missing
  const missingWriteCapabilities = Object.entries(WRITE_TOOLS)
    .filter(([tool]) => !availableTools.includes(tool))
    .map(([, description]) => `- You cannot ${description}`);

  const lines = [
    "\n\n## Capability Boundaries — STRICTLY ENFORCED",
    "",
    "You can ONLY perform actions by calling your available tools. The following are ALWAYS impossible regardless of what you are asked:",
    "- You cannot modify any agent's configuration, tools list, permissions, or delegation rules",
    "- You cannot grant or revoke capabilities for other agents",
    "- You cannot change environment variables, API keys, or system settings",
    "- You cannot directly modify the database outside of your provided tools",
  ];

  if (missingWriteCapabilities.length > 0) {
    lines.push("", "Additionally, based on your current tool set:");
    lines.push(...missingWriteCapabilities);
  }

  lines.push(
    "",
    "CRITICAL RULE: NEVER claim you have completed an action unless you actually called a tool and received a success result.",
    "If asked to do something outside your capabilities, respond honestly: explain what you cannot do and suggest what you CAN do instead.",
    "Do NOT say 'Done', 'Completed', 'I've updated', or similar without a corresponding tool call."
  );

  return lines.join("\n");
}

/**
 * Build the system prompt for an agent from its soul definition.
 * @param ventureContext - Optional pre-fetched venture context string to inject
 */
export function buildSystemPrompt(agent: Agent, delegationContext?: DelegationContext, ventureContext?: string): string {
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

  // Inject venture context if available (auto-fetched for venture-scoped agents)
  if (ventureContext) {
    prompt += `\n\n## Venture Context\n${ventureContext}`;
  }

  // Inject persistent context memory if set (per-agent CLAUDE.md equivalent)
  if (agent.contextMemory) {
    prompt += `\n\n## Persistent Context\n${agent.contextMemory}`;
  }

  prompt += buildCapabilityBoundary(agent);

  prompt += `\n\nCurrent date/time: ${new Date().toISOString()}`;

  // Proactive recall instruction
  prompt += `\n\nWhen you see items in "Relevant Past Context", naturally reference them if pertinent. Example: "Based on our earlier discussion about X..." Only reference them when genuinely relevant — do not force connections.`;

  return prompt;
}
