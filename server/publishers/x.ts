/**
 * X (Twitter) publisher — OAuth 2.0 User Context
 * v2 /tweets for text, v1.1 media/upload (chunked) for video/images
 */

import type { SocialAccount } from "@shared/schema";
import { logger } from "../logger";

const V2_BASE = "https://api.twitter.com/2";
const V1_MEDIA = "https://upload.twitter.com/1.1/media/upload.json";

// X/Twitter character limit for tweet copy
export const X_COPY_LIMIT = 280;

interface XPublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

async function refreshXToken(account: SocialAccount): Promise<string> {
  if (!account.refreshToken) throw new Error("No refresh token available for X account");
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("X_CLIENT_ID / X_CLIENT_SECRET not set");

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) throw new Error(`X token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.access_token as string;
}

async function uploadMedia(accessToken: string, mediaUrl: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch media: ${mediaRes.status}`);
  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const contentType = mediaRes.headers.get("content-type") || "video/mp4";
  const isVideo = contentType.startsWith("video/");
  const mediaCategory = isVideo ? "tweet_video" : "tweet_image";
  const totalBytes = buffer.byteLength;

  // INIT
  const initParams = new URLSearchParams({
    command: "INIT",
    total_bytes: String(totalBytes),
    media_type: contentType,
    media_category: mediaCategory,
  });
  const initRes = await fetch(`${V1_MEDIA}?${initParams}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!initRes.ok) throw new Error(`X media INIT failed: ${initRes.status} ${await initRes.text()}`);
  const { media_id_string } = (await initRes.json()) as any;

  // APPEND (5MB chunks)
  const chunkSize = 5 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const chunk = buffer.subarray(offset, offset + chunkSize);
    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", media_id_string);
    form.append("segment_index", String(segmentIndex++));
    form.append("media", new Blob([chunk], { type: contentType }));
    const appendRes = await fetch(V1_MEDIA, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!appendRes.ok) throw new Error(`X media APPEND failed: ${appendRes.status}`);
  }

  // FINALIZE
  const finalizeParams = new URLSearchParams({ command: "FINALIZE", media_id: media_id_string });
  const finalizeRes = await fetch(`${V1_MEDIA}?${finalizeParams}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!finalizeRes.ok) throw new Error(`X media FINALIZE failed: ${finalizeRes.status}`);

  // Poll processing status for video
  if (isVideo) {
    let retries = 0;
    while (retries < 20) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(`${V1_MEDIA}?command=STATUS&media_id=${media_id_string}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const status = (await statusRes.json()) as any;
      const state = status?.processing_info?.state;
      if (state === "succeeded") break;
      if (state === "failed") throw new Error("X video processing failed");
      retries++;
    }
  }

  return media_id_string;
}

export async function publishToX(
  account: SocialAccount,
  copy: string,
  mediaUrls: string[]
): Promise<XPublishResult> {
  let accessToken = account.accessToken;

  // Check token expiry and refresh if needed
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
    logger.info({ handle: account.handle }, "X token expired, refreshing");
    accessToken = await refreshXToken(account);
  }

  // Upload media if present
  const mediaIds: string[] = [];
  for (const url of mediaUrls.slice(0, 4)) {
    const mediaId = await uploadMedia(accessToken, url);
    mediaIds.push(mediaId);
  }

  // Truncate copy to 280 chars
  const tweetText = copy.length > X_COPY_LIMIT ? `${copy.substring(0, X_COPY_LIMIT - 1)}…` : copy;

  const body: Record<string, unknown> = { text: tweetText };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };

  const res = await fetch(`${V2_BASE}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`X publish failed (${res.status}): ${errText}`);
  }

  const { data } = (await res.json()) as any;
  const postId = data.id as string;

  // Resolve author username for URL
  const meRes = await fetch(`${V2_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = meRes.ok ? ((await meRes.json()) as any) : null;
  const username = me?.data?.username ?? account.handle.replace("@", "");

  return {
    platformPostId: postId,
    platformPostUrl: `https://x.com/${username}/status/${postId}`,
  };
}
