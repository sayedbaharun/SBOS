/**
 * Content Ingest Route — receives finished content from SBContent factory
 * POST /api/content/ingest   — HMAC-signed webhook from SBContent
 * GET  /api/content/posts    — list scheduled posts
 * GET  /api/content/posts/:id — single post
 * POST /api/content/posts    — manually create a post
 * PATCH /api/content/posts/:id — update post (e.g. reschedule, edit copy)
 * POST /api/content/drain    — force drain due posts (admin)
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../../db/index";
import { scheduledPosts, socialAccounts } from "@shared/schema";
import { eq, lte, inArray, desc } from "drizzle-orm";
import { logger } from "../logger";
import { formatCopyForPlatform, nextPostTime, PILLAR_SCHEDULE, type Platform } from "../config/content-schedule";
import { publishPost } from "../publishers/index";

const router = Router();

const SUPPORTED_PLATFORMS: Platform[] = ["x", "linkedin", "youtube", "tiktok"];

// ── HMAC verification ──────────────────────────────────────────────────────────

function verifyHmac(body: string, signature: string): boolean {
  const secret = process.env.SBOS_INGEST_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ── Telegram review card ───────────────────────────────────────────────────────

async function sendReviewCard(posts: Array<{ id: string; platform: Platform; copy: string }>, meta: {
  pillar?: string;
  hook?: string;
  videoUrl?: string;
  sbcontentVideoId?: string;
}): Promise<void> {
  try {
    const { publishEvent } = await import("../events/bus");
    await publishEvent("content.pending_review", {
      posts,
      pillar: meta.pillar,
      hook: meta.hook,
      videoUrl: meta.videoUrl,
      sbcontentVideoId: meta.sbcontentVideoId,
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "content-ingest: failed to fire pending_review event");
  }
}

// ── POST /api/content/ingest ───────────────────────────────────────────────────

router.post("/ingest", async (req: Request, res: Response) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["x-sbos-signature"] as string;

  if (!verifyHmac(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const {
    videoId,
    finalVideoUrl,
    hook,
    body: postBody,
    cta,
    pillar,
    platforms,
    hashtags = [],
    characterName,
  } = req.body as {
    videoId: string;
    finalVideoUrl: string;
    hook: string;
    body: string;
    cta: string;
    pillar?: string;
    platforms?: Platform[];
    hashtags?: string[];
    characterName?: string;
  };

  const targetPlatforms: Platform[] = platforms?.filter((p) => SUPPORTED_PLATFORMS.includes(p)) ?? SUPPORTED_PLATFORMS;
  const baseCopy = `${hook}\n\n${postBody}\n\n${cta}`.trim();
  const mediaUrls = finalVideoUrl ? [finalVideoUrl] : [];
  const scheduledFor = pillar ? nextPostTime(pillar) : undefined;

  const insertedPosts: Array<{ id: string; platform: Platform; copy: string }> = [];

  for (const platform of targetPlatforms) {
    const copy = formatCopyForPlatform(baseCopy, hashtags, platform);
    const title = platform === "youtube" ? hook.substring(0, 100) : undefined;

    const [inserted] = await db.insert(scheduledPosts).values({
      platform,
      status: "pending_review",
      source: "sbcontent",
      copy,
      title: title ?? null,
      mediaUrls,
      hashtags,
      pillar: pillar ?? null,
      hook,
      scheduledFor: scheduledFor ?? null,
      sbcontentVideoId: videoId ?? null,
    }).returning({ id: scheduledPosts.id });

    insertedPosts.push({ id: inserted.id, platform, copy: copy.substring(0, 120) });
  }

  logger.info({ sbcontentVideoId: videoId, platforms: targetPlatforms, count: insertedPosts.length }, "Content ingested — pending review");

  await sendReviewCard(insertedPosts, { pillar, hook, videoUrl: finalVideoUrl, sbcontentVideoId: videoId });

  res.json({ ok: true, posts: insertedPosts });
});

// ── GET /api/content/posts ─────────────────────────────────────────────────────

router.get("/posts", async (_req: Request, res: Response) => {
  const posts = await db.select().from(scheduledPosts).orderBy(desc(scheduledPosts.createdAt)).limit(100);
  res.json({ posts });
});

router.get("/posts/:id", async (req: Request, res: Response) => {
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, String(req.params.id)));
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json({ post });
});

// ── POST /api/content/posts (manual) ──────────────────────────────────────────

router.post("/posts", async (req: Request, res: Response) => {
  const { platform, copy, mediaUrls, hashtags, pillar, hook, title, scheduledFor, source = "manual" } = req.body;
  if (!platform || !copy) return res.status(400).json({ error: "platform and copy required" });

  const [post] = await db.insert(scheduledPosts).values({
    platform,
    status: "pending_review",
    source,
    copy,
    title: title ?? null,
    mediaUrls: mediaUrls ?? [],
    hashtags: hashtags ?? [],
    pillar: pillar ?? null,
    hook: hook ?? null,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
  }).returning();

  res.json({ post });
});

// ── PATCH /api/content/posts/:id ──────────────────────────────────────────────

router.patch("/posts/:id", async (req: Request, res: Response) => {
  const { status, copy, scheduledFor } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (copy) updates.copy = copy;
  if (scheduledFor) updates.scheduledFor = new Date(scheduledFor);

  const [updated] = await db.update(scheduledPosts).set(updates as any).where(eq(scheduledPosts.id, String(req.params.id))).returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json({ post: updated });
});

// ── POST /api/content/drain (force publish due posts, admin) ───────────────────

router.post("/drain", async (_req: Request, res: Response) => {
  const due = await db.select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.status, "approved" as any));

  const results = await Promise.allSettled(due.map((p) => publishPost(p.id)));
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  res.json({ drained: due.length, succeeded, failed });
});

export default router;
