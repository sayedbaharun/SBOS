/**
 * TikTok publisher — Content Posting API v2 (OAuth 2.0)
 * PULL_FROM_URL mode: provide a publicly accessible video URL.
 * Requires TikTok for Developers app with video.publish + video.upload scopes.
 */

import type { SocialAccount } from "@shared/schema";
import { logger } from "../logger";

const TT_BASE = "https://open.tiktokapis.com/v2";

export const TT_CAPTION_LIMIT = 2200;

interface TtPublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

async function refreshTikTokToken(account: SocialAccount): Promise<string> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set");
  if (!account.refreshToken) throw new Error("No TikTok refresh token");

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`TikTok token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.data?.access_token as string;
}

export async function publishToTikTok(
  account: SocialAccount,
  copy: string,
  mediaUrls: string[]
): Promise<TtPublishResult> {
  if (mediaUrls.length === 0) throw new Error("TikTok requires a video URL");

  let accessToken = account.accessToken;
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
    logger.info({ handle: account.handle }, "TikTok token expired, refreshing");
    accessToken = await refreshTikTokToken(account);
  }

  const caption = copy.length > TT_CAPTION_LIMIT ? `${copy.substring(0, TT_CAPTION_LIMIT - 1)}…` : copy;
  const videoUrl = mediaUrls[0];

  // Init post — PULL_FROM_URL
  const initRes = await fetch(`${TT_BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    }),
  });

  if (!initRes.ok) throw new Error(`TikTok publish init failed (${initRes.status}): ${await initRes.text()}`);
  const initData = (await initRes.json()) as any;
  const publishId = initData.data?.publish_id as string;
  if (!publishId) throw new Error("TikTok init response missing publish_id");

  // Poll publish status
  let retries = 0;
  while (retries < 30) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${TT_BASE}/post/publish/status/fetch/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    if (!statusRes.ok) {
      retries++;
      continue;
    }

    const statusData = (await statusRes.json()) as any;
    const status = statusData.data?.status as string;
    const videoId = statusData.data?.publicaly_available_post_id?.[0] as string | undefined;

    logger.debug({ publishId, status }, "TikTok publish status poll");

    if (status === "PUBLISH_COMPLETE" && videoId) {
      return {
        platformPostId: videoId,
        platformPostUrl: `https://www.tiktok.com/@${account.handle.replace("@", "")}/video/${videoId}`,
      };
    }

    if (status === "FAILED") throw new Error(`TikTok publish failed: ${JSON.stringify(statusData.data)}`);
    retries++;
  }

  throw new Error(`TikTok publish timed out after ${retries * 5}s (publishId: ${publishId})`);
}
