/**
 * LinkedIn publisher — UGC Posts API (OAuth 2.0)
 * Text + image/video via registerUpload → upload bytes → post
 */

import type { SocialAccount } from "@shared/schema";
import { logger } from "../logger";

const LI_BASE = "https://api.linkedin.com/v2";

export const LI_COPY_LIMIT = 3000;

interface LiPublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

async function refreshLinkedInToken(account: SocialAccount): Promise<string> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not set");
  if (!account.refreshToken) throw new Error("No LinkedIn refresh token");

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.access_token as string;
}

async function getLinkedInUserId(accessToken: string): Promise<string> {
  const res = await fetch(`${LI_BASE}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.sub as string;
}

async function uploadLinkedInVideo(accessToken: string, authorUrn: string, videoUrl: string): Promise<string> {
  const mediaRes = await fetch(videoUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch video: ${mediaRes.status}`);
  const buffer = Buffer.from(await mediaRes.arrayBuffer());

  const initRes = await fetch(`${LI_BASE}/assets?action=registerUpload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
        owner: authorUrn,
        serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
        supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      },
    }),
  });

  if (!initRes.ok) throw new Error(`LinkedIn upload init failed: ${initRes.status}`);
  const initData = (await initRes.json()) as any;
  const uploadUrl = initData.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
  const assetUrn = initData.value?.asset;

  if (!uploadUrl || !assetUrn) throw new Error("LinkedIn upload init missing url/asset");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`LinkedIn video upload failed: ${uploadRes.status}`);

  return assetUrn as string;
}

export async function publishToLinkedIn(
  account: SocialAccount,
  copy: string,
  mediaUrls: string[]
): Promise<LiPublishResult> {
  let accessToken = account.accessToken;
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
    logger.info({ handle: account.handle }, "LinkedIn token expired, refreshing");
    accessToken = await refreshLinkedInToken(account);
  }

  const userId = account.platformUserId || (await getLinkedInUserId(accessToken));
  const authorUrn = `urn:li:person:${userId}`;
  const truncatedCopy = copy.length > LI_COPY_LIMIT ? `${copy.substring(0, LI_COPY_LIMIT - 1)}…` : copy;

  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: truncatedCopy },
    shareMediaCategory: "NONE",
  };

  if (mediaUrls.length > 0) {
    const firstMedia = mediaUrls[0];
    const isVideo = firstMedia.includes(".mp4") || firstMedia.includes("video");
    if (isVideo) {
      const assetUrn = await uploadLinkedInVideo(accessToken, authorUrn, firstMedia);
      shareContent.shareMediaCategory = "VIDEO";
      shareContent.media = [{ status: "READY", media: assetUrn }];
    } else {
      shareContent.shareMediaCategory = "IMAGE";
      shareContent.media = [{ status: "READY", originalUrl: firstMedia }];
    }
  }

  const postBody = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch(`${LI_BASE}/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(postBody),
  });

  if (!res.ok) throw new Error(`LinkedIn publish failed (${res.status}): ${await res.text()}`);

  const postId = res.headers.get("x-restli-id") || "";
  const encodedId = encodeURIComponent(postId);

  return {
    platformPostId: postId,
    platformPostUrl: `https://www.linkedin.com/feed/update/${encodedId}/`,
  };
}
