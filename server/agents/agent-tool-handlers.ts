/**
 * Agent Tool Execution Handlers
 *
 * Routes tool calls to the appropriate handler and returns structured results.
 * Each case in the switch corresponds to a tool defined in agent-tools.ts.
 */

import { logger } from "../logger";
import {
  agentTasks,
  type Agent,
} from "@shared/schema";
import type {
  AgentToolResult,
  DelegationContext,
} from "./types";
import { delegateTask } from "./delegation-engine";
import { storage } from "../storage";
import { quickSearch, deepResearch } from "./tools/web-research";
import { dailyBriefing, weeklySummary, ventureStatus, customReport } from "./tools/report-generator";
import { marketSizing, competitorAnalysis, swotAnalysis, marketValidation } from "./tools/market-analyzer";
import { storeMemory, searchMemories } from "./agent-memory-manager";
import { generateProject, generateCode, listGeneratedProjects } from "./tools/code-generator";
import { deploy, getDeploymentHistory, getDeploymentStatus } from "./tools/deployer";
import { hybridSearch } from "../vector-search";
import { buildLifeContext } from "./tools/life-context";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// executeAgentTask is imported lazily to avoid circular dependency
// (agent-runtime.ts imports this file, and this file needs executeAgentTask for delegation)
let _executeAgentTask: ((taskId: string) => Promise<any>) | null = null;
async function getExecuteAgentTask() {
  if (!_executeAgentTask) {
    const mod = await import("./agent-task");
    _executeAgentTask = mod.executeAgentTask;
  }
  return _executeAgentTask;
}

export async function executeTool(
  agent: Agent,
  toolName: string,
  args: Record<string, any>,
  delegationContext?: DelegationContext
): Promise<AgentToolResult> {
  try {
    switch (toolName) {
      case "delegate": {
        const { taskId, error } = await delegateTask({
          fromAgentId: agent.id,
          toAgentSlug: args.to_agent,
          title: args.title,
          description: args.description,
          priority: args.priority,
          requiredPermissions: delegationContext?.grantedPermissions,
          requiredTools: delegationContext?.grantedTools,
        });

        if (error) {
          return { result: `Delegation failed: ${error}` };
        }

        // Execute the delegated agent synchronously to get result
        const executeAgentTask = await getExecuteAgentTask();
        const result = await executeAgentTask(taskId);

        return {
          result: result
            ? `Delegation to "${args.to_agent}" completed.\n\nResult:\n${JSON.stringify(result.response || result, null, 2)}`
            : `Task delegated to "${args.to_agent}" (task ID: ${taskId}). Awaiting completion.`,
          action: {
            actionType: "delegate",
            entityType: "agent_task",
            entityId: taskId,
            parameters: { to: args.to_agent, title: args.title },
            status: "success",
          },
        };
      }

      case "search_knowledge_base": {
        const searchResults = await hybridSearch(args.query, {
          ventureId: agent.ventureId || undefined,
          limit: 5,
        });

        return {
          result: JSON.stringify(
            searchResults.map((r) => ({
              id: r.id,
              title: r.title,
              type: r.type,
              excerpt: r.content?.slice(0, 300),
              similarity: Math.round(r.similarity * 100) / 100,
              source: r.metadata?.docId || r.id,
            }))
          ),
        };
      }

      case "list_tasks": {
        const filters: any = {};
        if (args.status) filters.status = args.status;
        if (args.priority) filters.priority = args.priority;
        if (args.ventureId) filters.ventureId = args.ventureId;
        else if (agent.ventureId) filters.ventureId = agent.ventureId;

        const tasks = await storage.getTasks(filters);
        const limited = tasks.slice(0, args.limit || 20);

        return {
          result: JSON.stringify(
            limited.map((t: any) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
            }))
          ),
        };
      }

      case "list_projects": {
        const filters: any = {};
        if (args.ventureId) filters.ventureId = args.ventureId;
        else if (agent.ventureId) filters.ventureId = agent.ventureId;

        let projects = await storage.getProjects(filters);
        if (args.status) {
          projects = projects.filter((p: any) => p.status === args.status);
        }

        return {
          result: JSON.stringify(
            projects.map((p: any) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              priority: p.priority,
              category: p.category,
            }))
          ),
        };
      }

      case "get_venture_summary": {
        if (args.ventureId) {
          const venture = await storage.getVenture(args.ventureId);
          if (!venture) return { result: "Venture not found" };

          const [projects, tasks] = await Promise.all([
            storage.getProjects({ ventureId: args.ventureId }),
            storage.getTasks({ ventureId: args.ventureId }),
          ]);

          return {
            result: JSON.stringify({
              name: venture.name,
              status: venture.status,
              domain: venture.domain,
              projects: projects.length,
              activeProjects: projects.filter((p: any) => p.status === "in_progress").length,
              tasks: tasks.length,
              pendingTasks: tasks.filter((t: any) => ["todo", "in_progress"].includes(t.status)).length,
            }),
          };
        }

        // Summarize all ventures
        const ventures = await storage.getVentures();
        return {
          result: JSON.stringify(
            ventures.map((v: any) => ({
              id: v.id,
              name: v.name,
              status: v.status,
              domain: v.domain,
            }))
          ),
        };
      }

      case "create_task": {
        const task = await storage.createTask({
          title: args.title,
          notes: args.notes,
          priority: args.priority,
          status: "todo",
          ventureId: args.ventureId || agent.ventureId,
          projectId: args.projectId,
          dueDate: args.dueDate,
          createdByAgentId: agent.id,
        } as any);

        return {
          result: `Created task: "${task.title}" (ID: ${task.id})`,
          action: {
            actionType: "create_task",
            entityType: "task",
            entityId: task.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "update_task": {
        const updates: Record<string, any> = {};
        if (args.status) updates.status = args.status;
        if (args.priority) updates.priority = args.priority;
        if (args.title) updates.title = args.title;
        if (args.notes) updates.notes = args.notes;
        if (args.tags) updates.tags = args.tags;
        if (args.status === "completed") updates.completedAt = new Date();

        const updated = await storage.updateTask(args.task_id, updates as any);
        if (!updated) {
          return { result: `Task ${args.task_id} not found` };
        }

        return {
          result: `Updated task "${updated.title}" (ID: ${updated.id}) — status: ${updated.status}${args.priority ? `, priority: ${args.priority}` : ""}`,
          action: {
            actionType: "update_task",
            entityType: "task",
            entityId: updated.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "get_day": {
        const date = args.date || new Date().toISOString().split("T")[0];
        const day = await storage.getDayOrCreate(date);
        return {
          result: JSON.stringify({
            date: day.date,
            title: day.title,
            mood: day.mood,
            top3Outcomes: day.top3Outcomes,
            oneThingToShip: day.oneThingToShip,
            reflectionAm: day.reflectionAm,
            reflectionPm: day.reflectionPm,
            morningRituals: day.morningRituals,
            eveningRituals: day.eveningRituals,
          }, null, 2),
        };
      }

      case "update_day": {
        const date = args.date || new Date().toISOString().split("T")[0];

        // Ensure day exists first
        await storage.getDayOrCreate(date);

        // Build partial update — only include fields that were passed
        const updates: Record<string, unknown> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.mood !== undefined) updates.mood = args.mood;
        if (args.top3Outcomes !== undefined) updates.top3Outcomes = args.top3Outcomes;
        if (args.oneThingToShip !== undefined) updates.oneThingToShip = args.oneThingToShip;
        if (args.reflectionAm !== undefined) updates.reflectionAm = args.reflectionAm;
        if (args.reflectionPm !== undefined) updates.reflectionPm = args.reflectionPm;
        if (args.morningRituals !== undefined) updates.morningRituals = args.morningRituals;
        if (args.eveningRituals !== undefined) updates.eveningRituals = args.eveningRituals;

        if (Object.keys(updates).length === 0) {
          return { result: "No fields provided to update." };
        }

        const day = await storage.updateDay(date, updates);

        return {
          result: `Updated day ${date}: ${Object.keys(updates).join(", ")}`,
          action: {
            actionType: "update_day",
            entityType: "day",
            entityId: day?.id || `day_${date}`,
            parameters: { date, ...updates },
            status: "success",
          },
        };
      }

      case "create_doc": {
        const { doc, created } = await storage.createDocIfNotExists({
          title: args.title,
          body: args.body,
          type: args.type || "page",
          ventureId: args.ventureId || agent.ventureId,
          status: "active",
        });

        return {
          result: created
            ? `Created document: "${doc.title}" (ID: ${doc.id})`
            : `Document already exists: "${doc.title}" (ID: ${doc.id})`,
          action: {
            actionType: "create_doc",
            entityType: "doc",
            entityId: doc.id,
            parameters: { title: args.title, type: args.type },
            status: "success",
          },
        };
      }

      case "submit_deliverable": {
        const database = await getDb();
        // Build structured result based on type
        const deliverableResult: Record<string, any> = { type: args.type, title: args.title };

        switch (args.type) {
          case "document":
            deliverableResult.body = args.body;
            deliverableResult.docType = args.docType;
            deliverableResult.domain = args.domain;
            deliverableResult.ventureId = args.ventureId || agent.ventureId;
            deliverableResult.summary = args.summary;
            break;
          case "recommendation":
            deliverableResult.summary = args.summary;
            deliverableResult.rationale = args.rationale;
            deliverableResult.suggestedAction = args.suggestedAction || "no_action";
            deliverableResult.actionDetails = args.actionDetails;
            break;
          case "action_items":
            deliverableResult.summary = args.summary;
            deliverableResult.items = args.items || [];
            break;
          case "code":
            deliverableResult.language = args.language;
            deliverableResult.code = args.code;
            deliverableResult.description = args.description;
            deliverableResult.ventureId = args.ventureId || agent.ventureId;
            deliverableResult.isWebPage = args.isWebPage || false;
            break;
          case "social_post":
            deliverableResult.platform = args.platform;
            deliverableResult.copy = args.copy;
            deliverableResult.visualDirection = args.visualDirection;
            deliverableResult.hashtags = args.hashtags || [];
            deliverableResult.postingTime = args.postingTime;
            deliverableResult.contentType = args.contentType;
            deliverableResult.ventureId = args.ventureId || agent.ventureId;
            break;
          case "video_script":
            deliverableResult.format = args.format;
            deliverableResult.platform = args.platform;
            deliverableResult.script = args.script;
            deliverableResult.sceneDirections = args.sceneDirections || [];
            deliverableResult.duration = args.duration;
            deliverableResult.wordCount = args.wordCount;
            deliverableResult.onScreenText = args.onScreenText || [];
            deliverableResult.hookLine = args.hookLine;
            deliverableResult.ventureId = args.ventureId || agent.ventureId;
            break;
          case "carousel":
            deliverableResult.platform = args.platform;
            deliverableResult.slides = args.slides || [];
            deliverableResult.ctaSlide = args.ctaSlide;
            deliverableResult.hashtags = args.hashtags || [];
            deliverableResult.ventureId = args.ventureId || agent.ventureId;
            break;
        }

        // Create agentTask with status needs_review
        const [deliverableTask] = await database
          .insert(agentTasks)
          .values({
            title: args.title,
            description: args.summary || args.description || `${args.type} deliverable from ${agent.name}`,
            assignedBy: agent.id,
            assignedTo: agent.id,
            status: "needs_review",
            deliverableType: args.type,
            result: deliverableResult,
            priority: 3,
          })
          .returning();

        // Export to Google Drive / Vercel (fire-and-forget)
        let driveUrl: string | undefined;
        let vercelUrl: string | undefined;
        try {
          const { exportToReview } = await import("../deliverable-pipeline");
          const exported = await exportToReview(deliverableTask.id);
          driveUrl = exported.driveUrl;
          vercelUrl = exported.vercelUrl;
        } catch (err) {
          logger.warn({ err, taskId: deliverableTask.id }, "Drive export failed");
        }

        // Fire-and-forget Telegram notification
        try {
          const { notifyDeliverableSubmitted } = await import("../channels/adapters/telegram-adapter");
          notifyDeliverableSubmitted(deliverableTask.id, args.title, args.type, agent.name, driveUrl, vercelUrl).catch(() => {});
        } catch { /* non-critical */ }

        return {
          result: `Deliverable submitted for review: "${args.title}" (ID: ${deliverableTask.id}).${driveUrl ? ` View in Drive: ${driveUrl}` : ""} Sayed will review it in the Review Queue.`,
          action: {
            actionType: "submit_deliverable",
            entityType: "agent_task",
            entityId: deliverableTask.id,
            parameters: { title: args.title, type: args.type },
            status: "success",
          },
        };
      }

      case "create_project": {
        const project = await storage.createProject({
          name: args.name,
          ventureId: args.ventureId || agent.ventureId,
          outcome: args.outcome,
          priority: args.priority,
          category: args.category,
          status: "not_started",
        });

        return {
          result: `Created project: "${project.name}" (ID: ${project.id})`,
          action: {
            actionType: "create_project",
            entityType: "project",
            entityId: project.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "create_capture": {
        const capture = await storage.createCapture({
          title: args.title,
          type: args.type || "note",
          notes: args.notes,
          clarified: false,
        });

        return {
          result: `Added to inbox: "${capture.title}" (ID: ${capture.id})`,
          action: {
            actionType: "create_capture",
            entityType: "capture",
            entityId: capture.id,
            parameters: args,
            status: "success",
          },
        };
      }

      case "browser_action": {
        const { executeBrowserAction } = await import("./tools/browser-action");
        const result = await executeBrowserAction(args as any);
        return {
          result: JSON.stringify(result),
          action: {
            actionType: "browser_action",
            parameters: { action: args.action, url: args.url },
            status: result.success ? "success" : "failed",
          },
        };
      }

      case "web_search": {
        return quickSearch(args.query);
      }

      case "deep_research": {
        return deepResearch(args.query, args.analysis_type || "general");
      }

      case "generate_report": {
        switch (args.report_type) {
          case "daily_briefing":
            return dailyBriefing();
          case "weekly_summary":
            return weeklySummary();
          case "venture_status":
            return ventureStatus(args.venture_id || "");
          case "custom":
            return customReport(args.custom_prompt || "Generate a report");
          default:
            return dailyBriefing();
        }
      }

      case "market_analyze": {
        switch (args.analysis_type) {
          case "market_sizing":
            return marketSizing(args.subject, args.product || args.subject, args.geography);
          case "competitor_analysis":
            return competitorAnalysis(args.subject, args.competitors);
          case "swot":
            return swotAnalysis(args.subject, args.context);
          case "market_validation":
            return marketValidation(args.subject, args.context);
          default:
            return swotAnalysis(args.subject, args.context);
        }
      }

      case "remember": {
        const memory = await storeMemory({
          agentId: agent.id,
          memoryType: args.memory_type || "context",
          content: args.content,
          importance: args.importance ?? 0.5,
        });

        return {
          result: `Remembered: "${args.content}" (type: ${args.memory_type}, id: ${memory.id})`,
          action: {
            actionType: "remember",
            entityType: "agent_memory",
            entityId: memory.id,
            status: "success",
          },
        };
      }

      case "search_memory": {
        const memories = await searchMemories(agent.id, args.query, 10);
        return {
          result: memories.length > 0
            ? JSON.stringify(memories.map((m) => ({
                type: m.memoryType,
                content: m.content,
                importance: m.importance,
              })))
            : "No relevant memories found.",
        };
      }

      case "code_generate": {
        switch (args.action) {
          case "generate_project":
            return generateProject({
              projectName: args.project_name || "untitled-project",
              description: args.description || "A new project",
              template: args.template || "custom",
              techStack: args.tech_stack,
            });
          case "generate_code":
            return generateCode({
              description: args.description || "Generate code",
              language: args.language || "typescript",
              filename: args.filename,
            });
          case "list_projects":
            return listGeneratedProjects();
          default:
            return { result: `Unknown code_generate action: ${args.action}` };
        }
      }

      case "clip_to_knowledge_base": {
        const { clipUrl } = await import("../web-clipper");
        const clipped = await clipUrl(args.url);

        const { doc, created } = await storage.createDocIfNotExists({
          title: clipped.title,
          body: clipped.body,
          type: args.type || "reference",
          domain: "personal",
          ventureId: agent.ventureId,
          status: "active",
          tags: args.tags || [],
          metadata: clipped.metadata,
        });

        // Trigger embedding in background (only for new docs)
        if (created) {
          const { processDocumentNow } = await import("../embedding-jobs");
          processDocumentNow(doc.id).catch((err: any) =>
            logger.debug({ err: err.message }, "Background embedding failed (non-critical)")
          );
        }

        return {
          result: `Clipped "${clipped.title}" to knowledge base (doc ID: ${doc.id}). Embedding will be generated shortly.`,
          action: {
            actionType: "clip_to_knowledge_base",
            entityType: "doc",
            entityId: doc.id,
            parameters: { url: args.url, title: clipped.title },
            status: "success",
          },
        };
      }

      case "get_life_context": {
        const context = await buildLifeContext();
        return { result: context };
      }

      case "explore_knowledge_graph": {
        const { getRelatedEntities, getEntityNeighborhood } = await import("../memory/entity-linker");
        const entityName = args.entity_name as string;
        const maxHops = Math.min(Math.max(args.max_hops || 1, 1), 3);

        if (maxHops === 1) {
          const related = await getRelatedEntities(entityName);
          if (related.length === 0) {
            return { result: `No known relationships found for "${entityName}".` };
          }
          const lines = related.map(r =>
            `${r.direction === "outgoing" ? "→" : "←"} ${r.relation}: ${r.name} (${r.type || "unknown"}) [strength: ${r.strength?.toFixed(2)}, mentions: ${r.mentionCount}]`
          );
          return { result: `Entity: ${entityName}\nRelationships:\n${lines.join("\n")}` };
        } else {
          const neighborhood = await getEntityNeighborhood(entityName, maxHops);
          if (neighborhood.length === 0) {
            return { result: `No known relationships found for "${entityName}".` };
          }
          const lines = neighborhood.map(n =>
            `[hop ${n.hop}] ${n.name} (${n.type || "unknown"}) — ${n.relation}${n.via ? ` via ${n.via}` : ""}`
          );
          return { result: `Entity neighborhood for "${entityName}" (${maxHops} hops):\n${lines.join("\n")}` };
        }
      }

      case "deploy": {
        switch (args.action) {
          case "deploy":
            return deploy({
              projectDir: args.project_dir || "",
              projectName: args.project_name || "unnamed",
              platform: args.platform || "vercel",
              environment: args.environment || "preview",
            });
          case "history":
            return getDeploymentHistory();
          case "status":
            return getDeploymentStatus();
          default:
            return { result: `Unknown deploy action: ${args.action}` };
        }
      }

      case "calendar_read": {
        const { listEvents, checkAvailability, findFreeSlots, searchEvents } = await import("../google-calendar");
        const now = new Date();
        const startDate = args.start_date ? new Date(args.start_date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endDate = args.end_date ? new Date(args.end_date) : new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

        switch (args.action) {
          case "list_events": {
            const events = await listEvents(startDate, endDate, args.max_results || 10);
            const formatted = events.map((e: any) => ({
              id: e.id,
              summary: e.summary,
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
              location: e.location,
              attendees: e.attendees?.map((a: any) => a.email),
              meetLink: e.hangoutLink,
            }));
            return { result: JSON.stringify({ action: "list_events", events: formatted, count: formatted.length }, null, 2) };
          }
          case "check_availability": {
            const available = await checkAvailability(startDate, endDate);
            return { result: JSON.stringify({ action: "check_availability", start: startDate.toISOString(), end: endDate.toISOString(), available }) };
          }
          case "find_free_slots": {
            const slots = await findFreeSlots(startDate, endDate, args.duration_minutes || 60);
            return { result: JSON.stringify({ action: "find_free_slots", slots: slots.slice(0, 10), count: slots.length }, null, 2) };
          }
          case "search_events": {
            const results = await searchEvents(args.query || "", startDate, endDate);
            const formatted = results.map((e: any) => ({
              id: e.id,
              summary: e.summary,
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
            }));
            return { result: JSON.stringify({ action: "search_events", query: args.query, events: formatted }, null, 2) };
          }
          default:
            return { result: `Unknown calendar_read action: ${args.action}. Use list_events, check_availability, find_free_slots, or search_events.` };
        }
      }

      case "calendar_write": {
        const gcal = await import("../google-calendar");

        switch (args.action) {
          case "create_event": {
            const event = await gcal.createEvent(
              args.summary || "Untitled Event",
              new Date(args.start_time),
              new Date(args.end_time),
              args.description,
              args.attendee_emails,
            );
            return {
              result: JSON.stringify({ action: "create_event", eventId: event.id, summary: event.summary, meetLink: event.hangoutLink, htmlLink: event.htmlLink }),
              action: { actionType: "create_event", entityType: "calendar_event", entityId: event.id || "", status: "success" },
            };
          }
          case "update_event": {
            const updated = await gcal.updateEvent(args.event_id, {
              summary: args.summary,
              startTime: args.start_time ? new Date(args.start_time) : undefined,
              endTime: args.end_time ? new Date(args.end_time) : undefined,
              description: args.description,
              attendeeEmails: args.attendee_emails,
            });
            return {
              result: JSON.stringify({ action: "update_event", eventId: updated.id, summary: updated.summary }),
              action: { actionType: "update_event", entityType: "calendar_event", entityId: args.event_id, status: "success" },
            };
          }
          case "delete_event": {
            await gcal.deleteEvent(args.event_id);
            return {
              result: JSON.stringify({ action: "delete_event", eventId: args.event_id, deleted: true }),
              action: { actionType: "delete_event", entityType: "calendar_event", entityId: args.event_id, status: "success" },
            };
          }
          case "create_focus_block": {
            const block = await gcal.createFocusTimeBlock(
              args.summary || "Focus Time",
              new Date(args.start_time),
              new Date(args.end_time),
              args.description,
            );
            return {
              result: JSON.stringify({ action: "create_focus_block", eventId: block.id, summary: block.summary, autoDecline: true }),
              action: { actionType: "create_focus_block", entityType: "calendar_event", entityId: block.id || "", status: "success" },
            };
          }
          default:
            return { result: `Unknown calendar_write action: ${args.action}. Use create_event, update_event, delete_event, or create_focus_block.` };
        }
      }

      case "syntheliq_status": {
        const {
          getSyntheliqDashboard,
          getSyntheliqRuns,
          getSyntheliqLeads,
          getSyntheliqPipeline,
          getSyntheliqProposals,
          getSyntheliqClients,
          getSyntheliqEscalations,
        } = await import("../integrations/syntheliq-client.js");

        const queryType = args.query_type || "status";
        switch (queryType) {
          case "status":
            return { result: JSON.stringify(await getSyntheliqDashboard(), null, 2) };
          case "runs":
            return { result: JSON.stringify(await getSyntheliqRuns(args.hours || 24), null, 2) };
          case "leads":
            return { result: JSON.stringify(await getSyntheliqLeads(args.status_filter), null, 2) };
          case "pipeline":
            return { result: JSON.stringify(await getSyntheliqPipeline(), null, 2) };
          case "proposals":
            return { result: JSON.stringify(await getSyntheliqProposals(args.status_filter), null, 2) };
          case "clients":
            return { result: JSON.stringify(await getSyntheliqClients(args.status_filter), null, 2) };
          case "escalations":
            return { result: JSON.stringify(await getSyntheliqEscalations(), null, 2) };
          default:
            return { result: `Unknown syntheliq query type: ${queryType}` };
        }
      }

      default:
        return { result: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    logger.error({ toolName, args, error: error.message }, "Agent tool execution failed");
    return {
      result: `Error executing ${toolName}: ${error.message}`,
      action: {
        actionType: toolName,
        parameters: args,
        status: "failed",
        errorMessage: error.message,
      },
    };
  }
}
