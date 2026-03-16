/**
 * Agent Runtime — Barrel Module
 *
 * Core execution loop for every agent in the hierarchy.
 * This file re-exports the modular pieces for backwards compatibility.
 *
 * Modules:
 * - agent-prompt.ts    — buildSystemPrompt()
 * - agent-tools.ts     — buildCoreTools() tool schema definitions
 * - agent-tool-handlers.ts — executeTool() switch/routing
 * - agent-chat.ts      — executeAgentChat() multi-turn loop
 * - agent-task.ts      — executeAgentTask() delegated task loop
 */

export { executeAgentChat } from "./agent-chat";
export { executeAgentTask } from "./agent-task";
