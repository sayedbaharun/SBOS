/**
 * YouTube publisher — Data API v3 (OAuth 2.0)
 * Resumable upload. Shorts inferred from ≤60s + 9:16 aspect.
 */

import type { SocialAccount } from "@shared/schema";
import { logger } from "../logger";

const YT_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

export const YT_TITLE_LIMIT = 100;
export const YT_DESC_LIMIT = 5000;

interface YtPublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

async function refreshYouTubeToken(account: SocialAccount): Promise<string> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not set");
  if (!account.refreshToken) throw new Error("No YouTube refresh token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.access_token as string;
}

export async function publishToYouTube(
  account: SocialAccount,
  copy: string,
  mediaUrls: string[],
  title?: string,
  hashtags?: string[]
): Promise<YtPublishResult> {
  if (mediaUrls.length === 0) throw new Error("YouTube requires a video URL");

  let accessToken = account.accessToken;
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
    logger.info({ handle: account.handle }, "YouTube token expired, refreshing");
    accessToken = await refreshYouTubeToken(account);
  }

  const videoUrl = mediaUrls[0];
  const mediaRes = await fetch(videoUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch video: ${mediaRes.status}`);
  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const contentType = mediaRes.headers.get("content-type") || "video/mp4";
  const totalBytes = buffer.byteLength;

  const safeTitle = (title || copy.substring(0, YT_TITLE_LIMIT)).substring(0, YT_TITLE_LIMIT);
  const description = copy.length > YT_DESC_LIMIT ? `${copy.substring(0, YT_DESC_LIMIT - 1)}…` : copy;
  const tags = hashtags?.map((h) => h.replace(/^#/, "")) ?? [];

  const metadata = {
    snippet: { title: safeTitle, description, tags, defaultLanguage: "en" },
    status: { privacyStatus: "public", madeForKids: false },
  };

  // Initiate resumable upload
  const initRes = await fetch(
    `${YT_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": String(totalBytes),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) throw new Error(`YouTube resumable init failed: ${initRes.status}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube init response missing Location header");

  // Upload video bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(totalBytes) },
    body: buffer,
  });

  if (!uploadRes.ok) throw new Error(`YouTube upload failed: ${uploadRes.status}`);
  const video = (await uploadRes.json()) as any;
  const videoId = video.id as string;

  return {
    platformPostId: videoId,
    platformPostUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
