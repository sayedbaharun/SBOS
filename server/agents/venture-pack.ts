/**
 * Venture Pack — Staging & Approval Pipeline
 *
 * Flow:
 *   1. stageVenturePack() — generates 4–5 Google Docs in SB-OS/Staging/{VentureName}/
 *   2. User reviews/edits in Drive
 *   3. approveVenturePack() — reads staged docs, creates venture goals + projects + tasks in DB
 *
 * The pack includes:
 *   01-Venture-One-Pager.gdoc     — mission, market, model, strategic edge
 *   02-Goals-and-Key-Results.gdoc — monthly/quarterly goals with measurable KRs
 *   03-Project-Plan.gdoc          — projects → phases → tasks with priorities & dates
 *   04-Ops-Vault.gdoc             — domain, tech stack, tools, subscriptions, quick links
 *   05-Content-Strategy.gdoc      — only for media/content ventures
 */

import { logger } from "../logger";
import { storage } from "../storage";
import {
  getOrCreateSBOSFolder,
  createFolder,
  createDoc,
  getDriveClient,
} from "../google-drive";
import type { Venture, VentureGoal, KeyResult, Project } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface VenturePackContext {
  venture: Venture;
  questionnaire: {
    oneLiner?: string;
    customerDescription?: string;
    ninetyDaySuccess?: string;
    ventureType: "saas" | "content_media" | "services" | "real_estate" | "trading" | "other";
    existingAssets?: string;
    revenueModel?: string;
    budget?: string;
    constraints?: string;
    vision?: string;
    mission?: string;
  };
}

export interface StagedPack {
  folderId: string;
  folderUrl: string;
  docs: {
    onePager?: { id: string; url: string };
    goalsKRs?: { id: string; url: string };
    projectPlan?: { id: string; url: string };
    opsVault?: { id: string; url: string };
    contentStrategy?: { id: string; url: string };
  };
  createdAt: string;
}

// ============================================================================
// Stage: generate docs into SB-OS/Staging/{VentureName}/
// ============================================================================

export async function stageVenturePack(ctx: VenturePackContext): Promise<StagedPack> {
  const { venture, questionnaire } = ctx;
  logger.info({ ventureId: venture.id, ventureName: venture.name }, "Staging venture pack");

  // Get/create root staging folder: SB-OS/Staging/
  const sbosFolderId = await getOrCreateSBOSFolder();
  const drive = await getDriveClient();

  // Find or create SB-OS/Staging/
  let stagingParentId: string;
  const stagingSearch = await drive.files.list({
    q: `name='Staging' and mimeType='application/vnd.google-apps.folder' and '${sbosFolderId}' in parents and trashed=false`,
    fields: "files(id, name)",
  });
  if (stagingSearch.data.files?.length) {
    stagingParentId = stagingSearch.data.files[0].id!;
  } else {
    const stagingFolder = await createFolder("Staging", sbosFolderId, "Venture pack staging area");
    stagingParentId = stagingFolder.id!;
  }

  // Create SB-OS/Staging/{VentureName}/ (unique name with timestamp if exists)
  const folderName = `${venture.name} — ${new Date().toISOString().split("T")[0]}`;
  const packFolder = await createFolder(folderName, stagingParentId, `Venture pack for ${venture.name}. Review and edit, then approve from SB-OS.`);
  const folderId = packFolder.id!;
  const folderUrl = packFolder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

  // Generate document contents
  const onePagerContent = generateOnePager(venture, questionnaire);
  const goalsContent = generateGoalsDoc(venture, questionnaire);
  const projectPlanContent = generateProjectPlan(venture, questionnaire);
  const opsVaultContent = generateOpsVault(venture, questionnaire);

  // Create docs in parallel
  const [onePagerDoc, goalsDoc, projectPlanDoc, opsVaultDoc] = await Promise.all([
    createDoc(`01 — ${venture.name} One-Pager`, onePagerContent, folderId, "Strategic overview"),
    createDoc(`02 — ${venture.name} Goals & Key Results`, goalsContent, folderId, "Monthly/quarterly goals with measurable outcomes"),
    createDoc(`03 — ${venture.name} Project Plan`, projectPlanContent, folderId, "Projects, phases, and tasks"),
    createDoc(`04 — ${venture.name} Ops Vault`, opsVaultContent, folderId, "Operational infrastructure reference"),
  ]);

  const docs: StagedPack["docs"] = {
    onePager: { id: onePagerDoc.id!, url: onePagerDoc.webViewLink || "" },
    goalsKRs: { id: goalsDoc.id!, url: goalsDoc.webViewLink || "" },
    projectPlan: { id: projectPlanDoc.id!, url: projectPlanDoc.webViewLink || "" },
    opsVault: { id: opsVaultDoc.id!, url: opsVaultDoc.webViewLink || "" },
  };

  // Content strategy doc only for media/content ventures
  if (questionnaire.ventureType === "content_media") {
    const contentStrategyContent = generateContentStrategy(venture, questionnaire);
    const contentDoc = await createDoc(`05 — ${venture.name} Content Strategy`, contentStrategyContent, folderId, "Brand identity, content pillars, posting schedule");
    docs.contentStrategy = { id: contentDoc.id!, url: contentDoc.webViewLink || "" };
  }

  const pack: StagedPack = { folderId, folderUrl, docs, createdAt: new Date().toISOString() };

  // Persist staging folder ID on the venture (using notes field as a lightweight store)
  // The proper way is via stagingFolderId on ventureGoals but here we use currentGoalId flow
  logger.info({ ventureId: venture.id, folderId, docCount: Object.keys(docs).length }, "Venture pack staged");

  return pack;
}

// ============================================================================
// Approve: create DB records from the approved staging pack
// ============================================================================

export interface ApprovePackOptions {
  ventureId: string;
  // Parsed from the reviewed docs (or from the questionnaire if Drive parsing is skipped)
  goals: Array<{
    period: "monthly" | "quarterly" | "annual";
    periodStart: string;
    periodEnd: string;
    targetStatement: string;
    keyResults: Array<{ title: string; targetValue: number; unit: string }>;
  }>;
  projects: Array<{
    name: string;
    category?: string;
    priority?: "P0" | "P1" | "P2" | "P3";
    outcome?: string;
    targetEndDate?: string;
    phases?: Array<{
      name: string;
      targetDate?: string;
      tasks?: Array<{ title: string; priority?: "P0" | "P1" | "P2" | "P3"; dueDate?: string; notes?: string }>;
    }>;
  }>;
  vision?: string;
  mission?: string;
}

export async function approveVenturePack(opts: ApprovePackOptions): Promise<{
  venture: Venture;
  goals: VentureGoal[];
  projects: Project[];
  taskCount: number;
}> {
  const { ventureId, goals, projects: projectPlans, vision, mission } = opts;
  logger.info({ ventureId }, "Approving venture pack");

  // Update venture with vision/mission
  const venture = await storage.updateVenture(ventureId, { vision, mission } as any);
  if (!venture) throw new Error(`Venture ${ventureId} not found`);

  // Create goals + key results
  const createdGoals: VentureGoal[] = [];
  for (const goalData of goals) {
    const goal = await storage.createVentureGoal({
      ventureId,
      period: goalData.period,
      periodStart: goalData.periodStart,
      periodEnd: goalData.periodEnd,
      targetStatement: goalData.targetStatement,
    });
    // Create key results
    for (const krData of goalData.keyResults) {
      await storage.createKeyResult({ goalId: goal.id, ...krData, currentValue: 0 });
    }
    createdGoals.push(goal);
  }

  // Set the first active goal as currentGoalId
  if (createdGoals.length > 0) {
    await storage.updateVenture(ventureId, { currentGoalId: createdGoals[0].id } as any);
  }

  // Create projects, phases, tasks
  const createdProjects: Project[] = [];
  let totalTasks = 0;
  for (const projectData of projectPlans) {
    const project = await storage.createProject({
      name: projectData.name,
      ventureId,
      category: (projectData.category as any) || "product",
      priority: projectData.priority || "P1",
      outcome: projectData.outcome,
      targetEndDate: projectData.targetEndDate,
    });
    createdProjects.push(project);

    for (const phaseData of (projectData.phases || [])) {
      const phase = await storage.createPhase({
        name: phaseData.name,
        projectId: project.id,
        targetDate: phaseData.targetDate,
      });
      for (const taskData of (phaseData.tasks || [])) {
        await storage.createTask({
          title: taskData.title,
          ventureId,
          projectId: project.id,
          phaseId: phase.id,
          priority: taskData.priority || "P1",
          dueDate: taskData.dueDate,
          notes: taskData.notes,
          status: "todo",
        } as any);
        totalTasks++;
      }
    }
  }

  logger.info({ ventureId, goalsCreated: createdGoals.length, projectsCreated: createdProjects.length, tasksCreated: totalTasks }, "Venture pack approved and committed to DB");

  return { venture, goals: createdGoals, projects: createdProjects, taskCount: totalTasks };
}

// ============================================================================
// Document generators
// ============================================================================

function generateOnePager(venture: Venture, q: VenturePackContext["questionnaire"]): string {
  const today = new Date().toISOString().split("T")[0];
  return `${venture.name} — Strategic One-Pager
Generated: ${today}
================================================================

OVERVIEW
${venture.name} | ${venture.status} | ${venture.oneLiner || ""}

${q.mission ? `MISSION\n${q.mission}\n` : "MISSION\n[Define your mission statement here]\n"}

${q.vision ? `VISION\n${q.vision}\n` : "VISION\n[Define your long-term vision here]\n"}

CUSTOMER
${q.customerDescription || "[Who is the primary customer? What is their pain point?]"}

MARKET OPPORTUNITY
[Define the market size, opportunity, and why now]

STRATEGIC EDGE
[What makes ${venture.name} defensible? What moat will you build?]

REVENUE MODEL
${q.revenueModel || "[How does this venture make money?]"}

BUSINESS MODEL
[Describe the core business model — subscription, commission, licensing, etc.]

CURRENT STATUS
Status: ${venture.status}
${q.existingAssets ? `Existing Assets: ${q.existingAssets}` : "Existing Assets: [What do you already have — tech, customers, partnerships?]"}

CONSTRAINTS & BUDGET
${q.constraints || "[Any constraints — time, team, regulation?]"}
Budget: ${q.budget || "[Available budget]"}

90-DAY SUCCESS LOOKS LIKE
${q.ninetyDaySuccess || "[What does winning look like in 90 days?]"}

NEXT MILESTONES
Q1: [Define quarterly milestone]
Q2: [Define quarterly milestone]
12 months: [Define annual goal]

NOTES
[Add any additional strategic context here]
`;
}

function generateGoalsDoc(venture: Venture, q: VenturePackContext["questionnaire"]): string {
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split("T")[0];
  const quarterEnd = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 0).toISOString().split("T")[0];

  return `${venture.name} — Goals & Key Results
================================================================

HOW TO USE THIS DOC
Edit the goals and key results below, then approve from SB-OS.
Each Key Result needs: what to measure, target number, and unit.
Delete sections you don't need. Add rows as needed.

----------------------------------------------------------------
MONTHLY GOAL (${monthStart} → ${monthEnd})
----------------------------------------------------------------

Target Statement:
${q.ninetyDaySuccess ? `By end of this month, ${q.ninetyDaySuccess}` : `[Write a clear outcome statement: "By ${monthEnd}, we will have..."]`}

Key Results:
KR1: [Measurable outcome] | Target: [number] [unit]
KR2: [Measurable outcome] | Target: [number] [unit]
KR3: [Measurable outcome] | Target: [number] [unit]

Examples:
- "Close 3 paying clients" | Target: 3 clients
- "Reach AED 15,000 in MRR" | Target: 15000 AED
- "Ship MVP with 5 core features" | Target: 5 features
- "Publish 8 pieces of content" | Target: 8 posts

----------------------------------------------------------------
QUARTERLY GOAL (${monthStart} → ${quarterEnd})
----------------------------------------------------------------

Target Statement:
[Write a clear quarterly outcome: "By end of Q, we will have..."]

Key Results:
KR1: [Measurable outcome] | Target: [number] [unit]
KR2: [Measurable outcome] | Target: [number] [unit]
KR3: [Measurable outcome] | Target: [number] [unit]

----------------------------------------------------------------
ANNUAL VISION
----------------------------------------------------------------

[What does ${venture.name} look like in 12 months?]
Revenue target: [AED amount]
Team size: [number]
Key milestones: [list]

NOTES
[Any additional context on goals and priorities]
`;
}

function generateProjectPlan(venture: Venture, q: VenturePackContext["questionnaire"]): string {
  return `${venture.name} — Project Plan
================================================================

HOW TO USE THIS DOC
Define the projects, phases, and tasks that will achieve your goals.
Format:
  PROJECT: [name] | Category: [product/marketing/tech/sales/ops] | Priority: [P0/P1/P2/P3]
  Outcome: [what success looks like for this project]
  Target: [YYYY-MM-DD]

  Phase 1: [name] | Target: [YYYY-MM-DD]
    Task: [title] | Priority: [P0/P1/P2/P3] | Due: [YYYY-MM-DD]
    Task: [title] | Priority: [P0/P1/P2/P3] | Due: [YYYY-MM-DD]

Categories: product, tech_engineering, marketing, sales_biz_dev, customer_success,
            operations, research_dev, finance, strategy_leadership

----------------------------------------------------------------
PROJECT 1: [Name] | Category: product | Priority: P0
Outcome: [What does done look like?]
Target: [YYYY-MM-DD]

  Phase 1: [Name] | Target: [YYYY-MM-DD]
    Task: [Title] | Priority: P0 | Due: [YYYY-MM-DD]
    Task: [Title] | Priority: P1 | Due: [YYYY-MM-DD]
    Task: [Title] | Priority: P1 | Due: [YYYY-MM-DD]

  Phase 2: [Name] | Target: [YYYY-MM-DD]
    Task: [Title] | Priority: P1 | Due: [YYYY-MM-DD]
    Task: [Title] | Priority: P2 | Due: [YYYY-MM-DD]

----------------------------------------------------------------
PROJECT 2: [Name] | Category: marketing | Priority: P1
Outcome: [What does done look like?]
Target: [YYYY-MM-DD]

  Phase 1: [Name] | Target: [YYYY-MM-DD]
    Task: [Title] | Priority: P1 | Due: [YYYY-MM-DD]
    Task: [Title] | Priority: P2 | Due: [YYYY-MM-DD]

----------------------------------------------------------------
PROJECT 3: [Name] | Category: sales_biz_dev | Priority: P1
Outcome: [What does done look like?]
Target: [YYYY-MM-DD]

  Phase 1: Launch | Target: [YYYY-MM-DD]
    Task: [Title] | Priority: P1 | Due: [YYYY-MM-DD]

NOTES
[Any additional context on the plan or sequencing decisions]
`;
}

function generateOpsVault(venture: Venture, q: VenturePackContext["questionnaire"]): string {
  return `${venture.name} — Ops Vault
================================================================
Quick Reference: All critical operational information for this venture.
Update regularly. NEVER store actual credentials here — use 1Password.
================================================================

DOMAIN & HOSTING
Domain: [domain.com]
Registrar: [e.g., Namecheap, Cloudflare]
Renewal Date: [YYYY-MM-DD]
DNS Management: [Link to DNS panel]
Hosting Provider: [Vercel / Railway / AWS / etc.]
Hosting Account: [Email used]
Hosting Plan: [Plan name / tier]

----------------------------------------------------------------
EMAIL ACCOUNTS
Email | Purpose | Provider
[admin@domain.com] | Operations | [Google Workspace]
[support@domain.com] | Customer Support | [Google Workspace]
Passwords: Stored in 1Password > ${venture.name}

----------------------------------------------------------------
SOCIAL MEDIA
Platform | Handle | Login Email
Instagram | @[handle] | [email]
X (Twitter) | @[handle] | [email]
LinkedIn | [page name] | [email]
YouTube | [channel name] | [email]
TikTok | @[handle] | [email]

----------------------------------------------------------------
TECH STACK
Frontend: [React / Next.js / etc.]
Backend: [Node.js / Python / etc.]
Database: [PostgreSQL / Supabase / etc.]
Hosting: [Vercel / Railway / etc.]
Auth: [Clerk / Auth0 / etc.]
Payments: [Stripe / etc.]
Analytics: [GA4 / Mixpanel / etc.]

----------------------------------------------------------------
ACTIVE SUBSCRIPTIONS
Tool | Purpose | Monthly Cost (AED) | Renewal Date
[Tool] | [Purpose] | [AED X] | [YYYY-MM-DD]
[Tool] | [Purpose] | [AED X] | [YYYY-MM-DD]

Total Monthly Subscriptions: AED [X]

----------------------------------------------------------------
API KEYS & INTEGRATIONS
Service | Key Location | Notes
[Stripe] | 1Password > ${venture.name} > Stripe | Test/Live keys
[OpenAI] | 1Password > ${venture.name} > OpenAI | GPT-4 usage
[Other] | 1Password > ${venture.name} > [Service] | [Notes]

----------------------------------------------------------------
QUICK ACCESS LINKS
Website Dashboard: [URL]
Analytics Dashboard: [URL]
Payment Dashboard: [URL]
Email Admin Panel: [URL]
Domain Registrar: [URL]
Hosting Control Panel: [URL]
Repository: [GitHub URL]

----------------------------------------------------------------
NOTES
[Add any important context, setup notes, or things to remember]
`;
}

function generateContentStrategy(venture: Venture, q: VenturePackContext["questionnaire"]): string {
  return `${venture.name} — Content Strategy
================================================================

BRAND IDENTITY
Tagline: [1-2 sentence core message]
Mission: [Why does this content exist? What impact do you want?]

Target Audience:
  Primary: [Age, location, interests, pain points]
  Secondary: [Alternative audience segment]

Content Pillars:
  Pillar 1: [Main theme/topic — e.g., "AI in business"]
  Pillar 2: [Secondary theme — e.g., "Founder journey"]
  Pillar 3: [Tertiary theme — e.g., "Dubai/MENA market insights"]
  Pillar 4: [Optional]

Tone & Voice:
  Personality: [Casual, professional, educational, entertaining?]
  Do's: [What characterizes your voice]
  Don'ts: [What to avoid]

----------------------------------------------------------------
POSTING SCHEDULE
Platform | Frequency | Day/Time (Dubai)
YouTube | [Weekly / Biweekly] | [Day, Time]
Instagram | [Daily / 3x week] | [Day, Time]
TikTok | [Daily / 3x week] | [Day, Time]
X (Twitter) | [Daily] | [Time]
LinkedIn | [2x week] | [Day, Time]
Newsletter | [Weekly / Biweekly] | [Day]

----------------------------------------------------------------
SOCIAL MEDIA CHANNELS
Platform | Handle / URL | Status | Followers
YouTube | [URL] | [Active/Planned] | [X]
Instagram | @[handle] | [Active/Planned] | [X]
TikTok | @[handle] | [Active/Planned] | [X]
X | @[handle] | [Active/Planned] | [X]
LinkedIn | [URL] | [Active/Planned] | [X]
Newsletter | [Platform + URL] | [Active/Planned] | [X subscribers]

----------------------------------------------------------------
PRODUCTION WORKFLOW
1. Ideation → [Tool/process]
2. Scripting → [Tool/process]
3. Recording → [Equipment/setup]
4. Editing → [Tool/person]
5. Review → [Process]
6. Publishing → [Platforms]
7. Analytics review → [Frequency]

----------------------------------------------------------------
ANALYTICS & GROWTH GOALS
Metric | Current | 30-day Target | 90-day Target
YouTube Subscribers | [X] | [X] | [X]
Instagram Followers | [X] | [X] | [X]
Newsletter Subscribers | [X] | [X] | [X]
Monthly Revenue | [AED X] | [AED X] | [AED X]

----------------------------------------------------------------
MONETIZATION
[ ] Ad revenue (YouTube, podcast)
[ ] Sponsorships / Brand deals (Rate: AED [X] per post)
[ ] Affiliate marketing
[ ] Digital products (price: AED [X])
[ ] Memberships / Community
[ ] Consulting / Services

Media Kit: [Link when ready]

----------------------------------------------------------------
TOOLS & TECH STACK
Camera/Recording: [Equipment]
Editing: [Tool]
Graphic Design: [Canva / Figma / etc.]
Scheduling: [Buffer / Later / etc.]
Analytics: [Native + GA4]
Email Marketing: [Platform]

----------------------------------------------------------------
NOTES
[Add any strategic context, partnership opportunities, or content ideas]
`;
}
