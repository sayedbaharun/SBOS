/**
 * Publisher dispatcher — routes a scheduled post to the correct platform module.
 * Handles retries, status updates, and Telegram failure alerts.
 */

import { db } from "../../db/index.js";
import { scheduledPosts, socialAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { publishToX } from "./x";
import { publishToLinkedIn } from "./linkedin";
import { publishToYouTube } from "./youtube";
import { publishToTikTok } from "./tiktok";

const MAX_RETRIES = 3;

export async function publishPost(postId: string): Promise<void> {
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId));
  if (!post) throw new Error(`Scheduled post not found: ${postId}`);
  if (post.status === "published") return;

  // Mark as publishing
  await db.update(scheduledPosts).set({ status: "publishing", updatedAt: new Date() }).where(eq(scheduledPosts.id, postId));

  try {
    // Resolve account
    const account = post.socialAccountId
      ? (await db.select().from(socialAccounts).where(eq(socialAccounts.id, post.socialAccountId)))[0]
      : (await db.select().from(socialAccounts).where(eq(socialAccounts.platform, post.platform)))[0];

    if (!account) throw new Error(`No connected ${post.platform} account found`);
    if (account.status === "revoked") throw new Error(`${post.platform} account ${account.handle} is revoked`);

    const mediaUrls = (post.mediaUrls ?? []) as string[];
    const hashtags = (post.hashtags ?? []) as string[];
    let platformPostId: string;
    let platformPostUrl: string;

    switch (post.platform) {
      case "x": {
        const result = await publishToX(account, post.copy, mediaUrls);
        platformPostId = result.platformPostId;
        platformPostUrl = result.platformPostUrl;
        break;
      }
      case "linkedin": {
        const result = await publishToLinkedIn(account, post.copy, mediaUrls);
        platformPostId = result.platformPostId;
        platformPostUrl = result.platformPostUrl;
        break;
      }
      case "youtube": {
        const result = await publishToYouTube(account, post.copy, mediaUrls, post.title ?? undefined, hashtags);
        platformPostId = result.platformPostId;
        platformPostUrl = result.platformPostUrl;
        break;
      }
      case "tiktok": {
        const result = await publishToTikTok(account, post.copy, mediaUrls);
        platformPostId = result.platformPostId;
        platformPostUrl = result.platformPostUrl;
        break;
      }
      default:
        throw new Error(`Unsupported platform: ${post.platform}`);
    }

    await db
      .update(scheduledPosts)
      .set({
        status: "published",
        platformPostId,
        platformPostUrl,
        postedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, postId));

    logger.info({ postId, platform: post.platform, platformPostId }, "Post published successfully");

    // Emit event for Telegram notification
    try {
      const { publishEvent } = await import("../events/bus");
      await publishEvent("content.published", {
        postId,
        platform: post.platform,
        url: platformPostUrl,
        copy: post.copy.substring(0, 100),
      });
    } catch (err: any) {
      logger.debug({ err: err.message }, "publishPost: event bus emit failed (non-critical)");
    }
  } catch (err: any) {
    const errorMsg = err.message ?? String(err);
    const newRetryCount = (post.retryCount ?? 0) + 1;
    const shouldFail = newRetryCount >= MAX_RETRIES;

    logger.error({ postId, platform: post.platform, error: errorMsg, retryCount: newRetryCount }, "Publish failed");

    await db
      .update(scheduledPosts)
      .set({
        status: shouldFail ? "failed" : "approved",
        error: errorMsg,
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, postId));

    if (shouldFail) {
      try {
        const { publishEvent } = await import("../events/bus");
        await publishEvent("content.failed", {
          postId,
          platform: post.platform,
          error: errorMsg,
        });
      } catch { /* non-critical */ }
    }

    throw err;
  }
}
