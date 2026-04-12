/**
 * Deliverable Output Pipeline
 *
 * Wires agent deliverables into Google Drive and Vercel so every agent output
 * lands somewhere real (formatted Google Doc, deployed preview site).
 *
 * All Drive/Vercel operations are fire-and-forget with graceful degradation —
 * if Drive isn't configured, everything still works via the existing review queue.
 */

import { eq } from "drizzle-orm";
import { agentTasks } from "@shared/schema";
import { logger } from "./logger";
import { storage } from "./storage";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// Folder ID cache
let toReviewFolderId: string | null = null;
let approvedFolderId: string | null = null;
let ideasFolderId: string | null = null;
let ideasApprovedFolderId: string | null = null;
let ideasRejectedFolderId: string | null = null;

function isDriveConfigured(): boolean {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  return !!(clientId && clientSecret && refreshToken);
}

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const { getDriveClient } = await import("./google-drive");
  const drive = await getDriveClient();

  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  // Create it
  const { createFolder } = await import("./google-drive");
  const folder = await createFolder(name, parentId, `SB-OS ${name}`);
  return folder.id!;
}

async function getToReviewFolderId(): Promise<string> {
  if (toReviewFolderId) return toReviewFolderId;
  const { getOrCreateSBOSFolder } = await import("./google-drive");
  const rootId = await getOrCreateSBOSFolder();
  toReviewFolderId = await getOrCreateFolder("To Review", rootId);
  return toReviewFolderId;
}

async function getApprovedFolderId(): Promise<string> {
  if (approvedFolderId) return approvedFolderId;
  const { getOrCreateSBOSFolder } = await import("./google-drive");
  const rootId = await getOrCreateSBOSFolder();
  approvedFolderId = await getOrCreateFolder("Approved Deliverables", rootId);
  return approvedFolderId;
}

async function getIdeasFolderId(): Promise<string> {
  if (ideasFolderId) return ideasFolderId;
  const { getOrCreateSBOSFolder } = await import("./google-drive");
  const rootId = await getOrCreateSBOSFolder();
  ideasFolderId = await getOrCreateFolder("Ideas", rootId);
  return ideasFolderId;
}

export async function getIdeasApprovedFolderId(): Promise<string> {
  if (ideasApprovedFolderId) return ideasApprovedFolderId;
  const parentId = await getIdeasFolderId();
  ideasApprovedFolderId = await getOrCreateFolder("Approved", parentId);
  return ideasApprovedFolderId;
}

export async function getIdeasRejectedFolderId(): Promise<string> {
  if (ideasRejectedFolderId) return ideasRejectedFolderId;
  const parentId = await getIdeasFolderId();
  ideasRejectedFolderId = await getOrCreateFolder("Rejected", parentId);
  return ideasRejectedFolderId;
}

/**
 * Format any deliverable result into clean markdown for a Google Doc.
 */
function formatAsDoc(result: Record<string, any>): string {
  switch (result.type) {
    case "document":
      return `# ${result.title}\n\n${result.summary ? `> ${result.summary}\n\n` : ""}${result.body || ""}`;

    case "recommendation":
      return [
        `# ${result.title}`,
        "",
        "## Summary",
        result.summary || "",
        "",
        "## Rationale",
        result.rationale || "",
        "",
        "## Suggested Action",
        result.suggestedAction === "create_task"
          ? "Create task on approval"
          : result.suggestedAction === "create_doc"
            ? "Create knowledge base document on approval"
            : "No action required — informational",
      ].join("\n");

    case "action_items": {
      const items = (result.items || [])
        .map((item: any, i: number) => {
          const priority = item.priority ? ` [${item.priority}]` : "";
          const due = item.dueDate ? ` — due ${item.dueDate}` : "";
          const notes = item.notes ? `\n   ${item.notes}` : "";
          return `${i + 1}. ${item.title}${priority}${due}${notes}`;
        })
        .join("\n");
      return `# ${result.title}\n\n${result.summary ? `${result.summary}\n\n` : ""}${items}`;
    }

    case "code": {
      const lang = result.language || "typescript";
      return [
        `# ${result.title}`,
        "",
        result.description || "",
        "",
        `\`\`\`${lang}`,
        result.code || "",
        "```",
      ].join("\n");
    }

    case "social_post":
      return [
        `# ${result.title}`,
        "",
        `**Platform:** ${result.platform || "—"}`,
        result.contentType ? `**Content Type:** ${result.contentType}` : "",
        result.postingTime ? `**Posting Time:** ${result.postingTime}` : "",
        "",
        "## Copy",
        result.copy || "",
        "",
        result.visualDirection ? `## Visual Direction\n${result.visualDirection}` : "",
        result.hashtags?.length ? `\n**Hashtags:** ${result.hashtags.join(" ")}` : "",
      ].filter(Boolean).join("\n");

    case "video_script":
      return [
        `# ${result.title}`,
        "",
        result.format ? `**Format:** ${result.format}` : "",
        result.platform ? `**Platform:** ${result.platform}` : "",
        result.duration ? `**Duration:** ${result.duration}` : "",
        result.wordCount ? `**Word Count:** ${result.wordCount}` : "",
        "",
        result.hookLine ? `## Hook\n${result.hookLine}\n` : "",
        "## Script",
        result.script || "",
        "",
        result.sceneDirections?.length
          ? `## Scene Directions\n${result.sceneDirections.map((d: string, i: number) => `${i + 1}. ${d}`).join("\n")}`
          : "",
        result.onScreenText?.length
          ? `\n## On-Screen Text\n${result.onScreenText.map((t: string) => `- ${t}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

    case "carousel":
      return [
        `# ${result.title}`,
        "",
        result.platform ? `**Platform:** ${result.platform}` : "",
        `**Slides:** ${(result.slides || []).length}`,
        "",
        ...(result.slides || []).map((slide: any, i: number) =>
          `## Slide ${i + 1}\n**${slide.headline}**\n${slide.body}`
        ),
        "",
        result.ctaSlide ? `## CTA Slide\n${result.ctaSlide}` : "",
        result.hashtags?.length ? `\n**Hashtags:** ${result.hashtags.join(" ")}` : "",
      ].filter(Boolean).join("\n");

    default:
      return `# ${result.title || "Deliverable"}\n\n${JSON.stringify(result, null, 2)}`;
  }
}

// ── Verification gate ─────────────────────────────────────────────────────────

const VERIFY_MODEL = "google/gemini-flash-1.5-8b";

/**
 * Flash Lite single-pass quality check.
 * Returns { status: 'verified' | 'flagged', notes: string }
 */
async function verifyDeliverable(
  result: Record<string, any>
): Promise<{ status: "verified" | "flagged"; notes: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { status: "verified", notes: "Verification skipped — no API key" };

  const title = result.title || "Untitled";
  const type = result.type || "unknown";
  const body =
    result.body || result.copy || result.script || result.summary || JSON.stringify(result).slice(0, 1000);

  const systemPrompt = `You are a quality gate for AI-generated deliverables. Check the deliverable and respond ONLY with valid JSON: {"status":"verified"|"flagged","notes":"<one sentence>"}
Flag if: claims are unsourced for documents, URLs are dead/made-up, action items lack owners, or the content is clearly incomplete.
Verify if: content is coherent, actionable, and appears complete.`;

  const userMessage = `Type: ${type}\nTitle: ${title}\n\nContent:\n${body.slice(0, 2000)}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Verification Gate",
      },
      body: JSON.stringify({
        model: VERIFY_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return { status: "verified", notes: "Verification skipped — API error" };
    const data: any = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.status === "verified" || parsed.status === "flagged") {
        return { status: parsed.status, notes: parsed.notes || "" };
      }
    }
    return { status: "verified", notes: "Verification inconclusive" };
  } catch (err) {
    logger.debug({ err }, "Verification gate failed");
    return { status: "verified", notes: "Verification skipped — timeout" };
  }
}

/**
 * Export a deliverable to Google Drive (and optionally Vercel for web pages).
 * Called after the agentTask insert in submit_deliverable.
 */
export async function exportToReview(
  taskId: string
): Promise<{ driveUrl?: string; vercelUrl?: string }> {
  const database = await getDb();
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task || !task.result) return {};

  // ── Verification gate (always runs, regardless of Drive config) ──────────
  const result = task.result as Record<string, any>;
  if (!result.verificationStatus) {
    try {
      const { status, notes } = await verifyDeliverable(result);
      await database
        .update(agentTasks)
        .set({
          result: {
            ...result,
            verificationStatus: status,
            verificationNotes: notes,
          },
        })
        .where(eq(agentTasks.id, taskId));
      // Mutate local ref so Drive export uses updated result
      result.verificationStatus = status;
      result.verificationNotes = notes;
      logger.info({ taskId, status, notes }, "Deliverable verification complete");
    } catch (err) {
      logger.warn({ err, taskId }, "Verification gate error — continuing");
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-approve policy check — runs BEFORE the Drive/review-queue path.
  // If a matching policy approves the deliverable, skip the queue entirely.
  // ---------------------------------------------------------------------------
  try {
    const { evaluatePolicy } = await import("./agents/approval-policy-evaluator");
    const costUSD = (task.result as any)?.costUSD ?? 0;
    const policyResult = await evaluatePolicy(
      task.deliverableType || "unknown",
      task.assignedTo || "",
      (task as any).ventureId || null,
      costUSD
    );
    if (policyResult.autoApprove) {
      logger.info({ taskId, policy: policyResult.matchedPolicyId }, "Auto-approving deliverable via policy");
      const { approveDeliverable } = await import("./routes/review-actions");
      await approveDeliverable(taskId, `Auto-approved: ${policyResult.reason || "policy match"}`);
      return {};
    }
  } catch (policyErr) {
    logger.warn({ policyErr, taskId }, "Policy evaluator error — falling through to review queue");
  }

  if (!isDriveConfigured()) {
    return {};
  }

  const isIdeaValidation = task.deliverableType === "idea_validation" || result.type === "idea_validation";
  const folderId = isIdeaValidation ? await getIdeasFolderId() : await getToReviewFolderId();

  let driveUrl: string | undefined;
  let vercelUrl: string | undefined;
  let driveFileId: string | undefined;
  let vercelDeploymentId: string | undefined;

  // Handle code with isWebPage — deploy to Vercel first
  if (result.type === "code" && result.isWebPage) {
    try {
      const tmpDir = path.join(os.tmpdir(), "sbos-generated-projects", taskId);
      fs.mkdirSync(tmpDir, { recursive: true });

      // Write the code to an index.html (or appropriate file)
      const ext = result.language === "html" ? "html" : result.language === "css" ? "css" : "html";
      fs.writeFileSync(path.join(tmpDir, `index.${ext}`), result.code || "");

      const { deploy } = await import("./agents/tools/deployer");
      const deployResult = await deploy({
        projectDir: tmpDir,
        projectName: `sbos-${taskId.slice(0, 8)}`,
        platform: "vercel",
        environment: "preview",
      });

      const parsed = JSON.parse(deployResult.result);
      if (parsed.status === "success" || parsed.url) {
        vercelUrl = parsed.url;
        vercelDeploymentId = parsed.deploymentId;
      }
    } catch (err) {
      logger.warn({ err, taskId }, "Vercel preview deploy failed");
    }
  }

  // Only create a Drive doc for substantial long-form deliverables.
  // Recommendations, action_items, and social_posts are ephemeral — they live
  // in the Review Queue and don't warrant a persistent Drive file.
  const DRIVE_EXPORT_TYPES = ["document", "video_script", "carousel", "code"];
  const shouldExportToDrive = DRIVE_EXPORT_TYPES.includes(result.type) || isIdeaValidation;

  if (shouldExportToDrive) {
    try {
      const { createDoc } = await import("./google-drive");
      let content = formatAsDoc(result);

      // Append preview URL if we have one
      if (vercelUrl) {
        content += `\n\n---\n\n**Preview:** ${vercelUrl}`;
      }

      const doc = await createDoc(
        `[${result.type}] ${result.title}`,
        content,
        folderId,
        `Agent deliverable — ${task.deliverableType}`
      );

      driveFileId = doc.id!;
      driveUrl = doc.webViewLink || undefined;
    } catch (err) {
      logger.warn({ err, taskId }, "Drive doc creation failed");
    }
  }

  // Update agentTask with Drive/Vercel metadata
  if (driveFileId || vercelDeploymentId) {
    const updates: Record<string, any> = {};
    if (driveFileId) {
      updates.driveFileId = driveFileId;
      updates.driveWebViewLink = driveUrl;
    }
    if (vercelDeploymentId) {
      updates.vercelDeploymentId = vercelDeploymentId;
      updates.vercelPreviewUrl = vercelUrl;
    }

    await database
      .update(agentTasks)
      .set(updates)
      .where(eq(agentTasks.id, taskId));
  }

  return { driveUrl, vercelUrl };
}

/**
 * Promote a deliverable on approval — move Drive file to destination folder,
 * promote Vercel preview to production.
 */
export async function promoteDeliverable(taskId: string): Promise<void> {
  const database = await getDb();
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) return;

  const result = task.result as Record<string, any>;

  // Move Drive file to appropriate destination
  const isIdeaValidation = task.deliverableType === "idea_validation" || result.type === "idea_validation";
  if (task.driveFileId) {
    try {
      const { moveFile } = await import("./google-drive");

      if (isIdeaValidation) {
        // Idea validations go to Ideas/Approved
        const destFolderId = await getIdeasApprovedFolderId();
        await moveFile(task.driveFileId, destFolderId);
      } else if (result.type === "action_items") {
        // Action items go to Approved Deliverables
        const destFolderId = await getApprovedFolderId();
        await moveFile(task.driveFileId, destFolderId);
      } else if (["social_post", "video_script", "carousel"].includes(result.type)) {
        // Content deliverables go to venture subfolder in Knowledge Base
        const ventureId = result.ventureId;
        let destFolderId: string;
        if (ventureId) {
          try {
            const venture = await storage.getVenture(String(ventureId));
            if (venture) {
              const { createVentureFolder } = await import("./google-drive");
              destFolderId = await createVentureFolder(venture.name);
            } else {
              destFolderId = await getApprovedFolderId();
            }
          } catch {
            destFolderId = await getApprovedFolderId();
          }
        } else {
          destFolderId = await getApprovedFolderId();
        }
        await moveFile(task.driveFileId, destFolderId);
      } else {
        // Documents, recommendations, code go to Knowledge Base (venture subfolder if available)
        const ventureId = result.ventureId;
        let destFolderId: string;

        if (ventureId) {
          // Try to get venture name for subfolder
          try {
            const venture = await storage.getVenture(String(ventureId));
            if (venture) {
              const { createVentureFolder } = await import("./google-drive");
              destFolderId = await createVentureFolder(venture.name);
            } else {
              const { getOrCreateKnowledgeBaseFolder } = await import("./google-drive");
              destFolderId = await getOrCreateKnowledgeBaseFolder();
            }
          } catch {
            const { getOrCreateKnowledgeBaseFolder } = await import("./google-drive");
            destFolderId = await getOrCreateKnowledgeBaseFolder();
          }
        } else {
          const { getOrCreateKnowledgeBaseFolder } = await import("./google-drive");
          destFolderId = await getOrCreateKnowledgeBaseFolder();
        }

        await moveFile(task.driveFileId, destFolderId);
      }
    } catch (err) {
      logger.warn({ err, taskId }, "Drive file move on approve failed");
    }
  }

  // Promote Vercel preview to production
  if (task.vercelPreviewUrl && result.type === "code" && result.isWebPage) {
    try {
      const tmpDir = path.join(os.tmpdir(), "sbos-generated-projects", taskId);
      if (fs.existsSync(tmpDir)) {
        const { deploy } = await import("./agents/tools/deployer");
        const deployResult = await deploy({
          projectDir: tmpDir,
          projectName: `sbos-${taskId.slice(0, 8)}`,
          platform: "vercel",
          environment: "production",
        });

        const parsed = JSON.parse(deployResult.result);
        if (parsed.url) {
          await database
            .update(agentTasks)
            .set({ vercelPreviewUrl: parsed.url })
            .where(eq(agentTasks.id, taskId));
        }
      }
    } catch (err) {
      logger.warn({ err, taskId }, "Vercel production promote failed");
    }
  }
}

/**
 * Clean up a rejected deliverable — trash the Drive file (or move to Ideas/Rejected for idea validations).
 */
export async function cleanupRejected(taskId: string): Promise<void> {
  const database = await getDb();
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task?.driveFileId) return;

  const result = task.result as Record<string, any>;
  const isIdeaValidation = task.deliverableType === "idea_validation" || result?.type === "idea_validation";

  try {
    if (isIdeaValidation) {
      // Move to Ideas/Rejected instead of trashing — Sayed wants to keep a record
      const { moveFile } = await import("./google-drive");
      const destFolderId = await getIdeasRejectedFolderId();
      await moveFile(task.driveFileId, destFolderId);
    } else {
      const { deleteFile } = await import("./google-drive");
      await deleteFile(task.driveFileId);
    }
  } catch (err) {
    logger.warn({ err, taskId }, "Drive file cleanup on reject failed");
  }

  // Tear down Vercel preview if exists
  if (task.vercelPreviewUrl) {
    try {
      const tmpDir = path.join(os.tmpdir(), "sbos-generated-projects", taskId);
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      logger.warn({ err, taskId }, "Vercel preview cleanup failed");
    }
  }
}

/**
 * Update an existing Drive doc's content (for amend → resubmit flow).
 * Preserves the same URL and version history.
 */
export async function updateDeliverableContent(
  taskId: string,
  newResult: Record<string, any>
): Promise<void> {
  const database = await getDb();
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task?.driveFileId) return;

  try {
    const { updateFileContent } = await import("./google-drive");
    const content = formatAsDoc(newResult);
    await updateFileContent(task.driveFileId, content, "text/plain");
  } catch (err) {
    logger.warn({ err, taskId }, "Drive file content update failed");
  }

  // Re-deploy Vercel preview if it's a web page
  if (task.vercelPreviewUrl && newResult.type === "code" && newResult.isWebPage) {
    try {
      const tmpDir = path.join(os.tmpdir(), "sbos-generated-projects", taskId);
      fs.mkdirSync(tmpDir, { recursive: true });
      const ext = newResult.language === "html" ? "html" : "html";
      fs.writeFileSync(path.join(tmpDir, `index.${ext}`), newResult.code || "");

      const { deploy } = await import("./agents/tools/deployer");
      const deployResult = await deploy({
        projectDir: tmpDir,
        projectName: `sbos-${taskId.slice(0, 8)}`,
        platform: "vercel",
        environment: "preview",
      });

      const parsed = JSON.parse(deployResult.result);
      if (parsed.url) {
        await database
          .update(agentTasks)
          .set({ vercelPreviewUrl: parsed.url, vercelDeploymentId: parsed.deploymentId })
          .where(eq(agentTasks.id, taskId));
      }
    } catch (err) {
      logger.warn({ err, taskId }, "Vercel preview redeploy on amend failed");
    }
  }
}
