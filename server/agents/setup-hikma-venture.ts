/**
 * One-time setup: Create Hikma Digital venture with projects, phases, and tasks.
 *
 * Run via: POST /api/agents/admin/setup-hikma
 * Idempotent — checks if venture already exists before creating.
 */

import { logger } from "../logger";

export async function setupHikmaDigitalVenture(): Promise<{
  created: boolean;
  ventureId?: string;
  projectId?: string;
  phases?: number;
  tasks?: number;
  message: string;
}> {
  const { storage } = await import("../storage");

  // Check if venture already exists
  const existingVentures = await storage.getVentures();
  const existing = existingVentures.find(
    (v: any) => v.name === "Hikma Digital" || v.name?.toLowerCase().includes("hikma")
  );

  if (existing) {
    return {
      created: false,
      ventureId: existing.id,
      message: `Hikma Digital venture already exists (ID: ${existing.id})`,
    };
  }

  // 1. Create Venture
  const venture = await storage.createVenture({
    name: "Hikma Digital",
    domain: "saas",
    status: "ongoing",
    oneLiner: "AI automation & consulting agency — 10 agents, quiz funnel, proposal system",
    primaryFocus: "Launch AI agency services, build client pipeline, automate delivery",
  } as any);

  logger.info({ ventureId: venture.id }, "Created Hikma Digital venture");

  // 2. Create Project
  const project = await storage.createProject({
    name: "Agency Platform (hikmadigital.com)",
    ventureId: venture.id,
    status: "in_progress",
    category: "product",
    priority: "P0",
    outcome: "Live website with quiz funnel, proposal system, and agent showcase",
  } as any);

  logger.info({ projectId: project.id }, "Created Agency Platform project");

  // 3. Create Phases
  const phase1 = await storage.createPhase({
    name: "Phase 1: Foundation",
    projectId: project.id,
    status: "done",
    order: 1,
    notes: "Website, quiz funnel — completed",
  } as any);

  const phase2 = await storage.createPhase({
    name: "Phase 2: Agent System",
    projectId: project.id,
    status: "done",
    order: 2,
    notes: "HikmaClaw orchestrator, 10 agents — completed",
  } as any);

  const phase3 = await storage.createPhase({
    name: "Phase 3: Launch & Distribution",
    projectId: project.id,
    status: "in_progress",
    order: 3,
    notes: "SEO, social, ads, case studies, analytics — in progress",
  } as any);

  logger.info("Created 3 phases for Agency Platform");

  // 4. Create Completed Tasks (Phase 1)
  const completedTasks = [
    { title: "Set up hikmadigital.com on Railway", phaseId: phase1.id },
    { title: "Build quiz funnel for lead capture", phaseId: phase1.id },
    { title: "Create proposal generation system", phaseId: phase1.id },
  ];

  // Completed Tasks (Phase 2)
  const phase2Tasks = [
    { title: "Build HikmaClaw orchestrator (10 agents)", phaseId: phase2.id },
    { title: "Deploy HikmaClaw on Railway (hikma-engine repo)", phaseId: phase2.id },
    { title: "Set up Telegram formatting layer", phaseId: phase2.id },
    { title: "Implement message dedup for Telegram", phaseId: phase2.id },
    { title: "Build webhook mode for Telegram bot", phaseId: phase2.id },
  ];

  let taskCount = 0;

  for (const task of [...completedTasks, ...phase2Tasks]) {
    await storage.createTask({
      title: task.title,
      status: "completed",
      priority: "P1",
      type: "business",
      ventureId: venture.id,
      projectId: project.id,
      phaseId: task.phaseId,
      completedAt: new Date("2026-03-01T12:00:00Z"),
    } as any);
    taskCount++;
  }

  // 5. Create Upcoming Tasks (Phase 3)
  const upcomingTasks = [
    { title: "Set up distribution channels (SEO, social, ads)", priority: "P1" },
    { title: "Create case studies / portfolio content", priority: "P1" },
    { title: "Set up analytics and conversion tracking", priority: "P1" },
    { title: "Build client onboarding flow", priority: "P2" },
    { title: "Create service packages and pricing page", priority: "P1" },
    { title: "Set up email marketing / nurture sequence", priority: "P2" },
  ];

  for (const task of upcomingTasks) {
    await storage.createTask({
      title: task.title,
      status: "todo",
      priority: task.priority,
      type: "business",
      ventureId: venture.id,
      projectId: project.id,
      phaseId: phase3.id,
    } as any);
    taskCount++;
  }

  logger.info(
    { ventureId: venture.id, projectId: project.id, tasks: taskCount },
    "Hikma Digital venture setup complete"
  );

  return {
    created: true,
    ventureId: venture.id,
    projectId: project.id,
    phases: 3,
    tasks: taskCount,
    message: `Created Hikma Digital venture with 1 project, 3 phases, ${taskCount} tasks`,
  };
}
