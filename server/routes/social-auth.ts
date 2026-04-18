/**
 * Social Auth Routes — OAuth 2.0 connect/callback for X, LinkedIn, YouTube, TikTok
 * Tokens are encrypted at rest using AES-256-GCM.
 * GET  /api/social/accounts         — list connected accounts
 * GET  /api/social/connect/:platform — initiate OAuth
 * GET  /api/social/callback/:platform — exchange code, store token
 * POST /api/social/disconnect/:id    — revoke and delete account
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../../db/index";
import { socialAccounts, insertSocialAccountSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

const router = Router();

// ── Encryption helpers ─────────────────────────────────────────────────────────

function getEncKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY env var not set");
  return Buffer.from(key.padEnd(32, "0").substring(0, 32));
}

function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, authTagHex, encHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

// ── OAuth configs per platform ─────────────────────────────────────────────────

function getOAuthConfig(platform: string) {
  const baseUrl = process.env.SBOS_BASE_URL || "https://sbaura.up.railway.app";
  const redirectUri = `${baseUrl}/api/social/callback/${platform}`;

  switch (platform) {
    case "x":
      return {
        authUrl: "https://twitter.com/i/oauth2/authorize",
        tokenUrl: "https://api.twitter.com/2/oauth2/token",
        clientId: process.env.X_CLIENT_ID!,
        clientSecret: process.env.X_CLIENT_SECRET!,
        scopes: "tweet.read tweet.write users.read offline.access media.write",
        redirectUri,
        pkce: true,
      };
    case "linkedin":
      return {
        authUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        clientId: process.env.LINKEDIN_CLIENT_ID!,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
        scopes: "w_member_social r_liteprofile",
        redirectUri,
        pkce: false,
      };
    case "youtube":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId: process.env.YOUTUBE_CLIENT_ID!,
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET!,
        scopes: "https://www.googleapis.com/auth/youtube.upload",
        redirectUri,
        pkce: false,
      };
    case "tiktok":
      return {
        authUrl: "https://www.tiktok.com/v2/auth/authorize/",
        tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
        clientId: process.env.TIKTOK_CLIENT_KEY!,
        clientSecret: process.env.TIKTOK_CLIENT_SECRET!,
        scopes: "user.info.basic,video.publish,video.upload",
        redirectUri,
        pkce: true,
      };
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// ── In-memory PKCE + state store (per-process, single user) ───────────────────

const pendingOAuth: Map<string, { codeVerifier: string; platform: string }> = new Map();

// ── Routes ─────────────────────────────────────────────────────────────────────

router.get("/accounts", async (_req: Request, res: Response) => {
  const accounts = await db.select({
    id: socialAccounts.id,
    platform: socialAccounts.platform,
    handle: socialAccounts.handle,
    status: socialAccounts.status,
    tokenExpiresAt: socialAccounts.tokenExpiresAt,
    createdAt: socialAccounts.createdAt,
  }).from(socialAccounts);
  res.json({ accounts });
});

router.get("/connect/:platform", (req: Request, res: Response) => {
  const platform = String(req.params.platform);
  try {
    const cfg = getOAuthConfig(platform);
    const state = crypto.randomBytes(16).toString("hex");
    const params: Record<string, string> = {
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: cfg.scopes,
      response_type: "code",
      state,
    };

    if (cfg.pkce) {
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      params.code_challenge = codeChallenge;
      params.code_challenge_method = "S256";
      pendingOAuth.set(state, { codeVerifier, platform });
    } else {
      pendingOAuth.set(state, { codeVerifier: "", platform });
    }

    // TikTok uses client_key instead of client_id
    if (platform === "tiktok") {
      params.client_key = cfg.clientId;
      delete params.client_id;
    }

    const url = `${cfg.authUrl}?${new URLSearchParams(params)}`;
    res.redirect(url);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/callback/:platform", async (req: Request, res: Response) => {
  const platform = String(req.params.platform);
  const { code, state, error: oauthError } = req.query as Record<string, string>;

  if (oauthError) {
    return res.status(400).send(`OAuth error: ${oauthError}`);
  }

  const pending = pendingOAuth.get(state);
  if (!pending || pending.platform !== platform) {
    return res.status(400).send("Invalid OAuth state — try connecting again");
  }
  pendingOAuth.delete(state);

  try {
    const cfg = getOAuthConfig(platform);

    const body: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
    };

    if (cfg.pkce && pending.codeVerifier) {
      body.code_verifier = pending.codeVerifier;
    }

    let tokenRes: Response;
    if (platform === "x") {
      // X requires Basic auth + client_id in body
      tokenRes = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams(body),
      }) as any;
    } else if (platform === "tiktok") {
      body.client_key = cfg.clientId;
      body.client_secret = cfg.clientSecret;
      delete body.client_id;
      tokenRes = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }) as any;
    } else {
      body.client_secret = cfg.clientSecret;
      tokenRes = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }) as any;
    }

    const tokenData = await (tokenRes as any).json() as any;
    if (!tokenData.access_token && !tokenData.data?.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    const accessToken = tokenData.access_token ?? tokenData.data?.access_token;
    const refreshToken = tokenData.refresh_token ?? tokenData.data?.refresh_token ?? null;
    const expiresIn = tokenData.expires_in ?? tokenData.data?.expires_in ?? null;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    // Resolve handle + userId per platform
    let handle = "";
    let platformUserId = "";

    if (platform === "x") {
      const meRes = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json() as any;
      handle = `@${me.data?.username ?? "unknown"}`;
      platformUserId = me.data?.id ?? "";
    } else if (platform === "linkedin") {
      const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json() as any;
      handle = me.name ?? me.email ?? "unknown";
      platformUserId = me.sub ?? "";
    } else if (platform === "youtube") {
      const meRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json() as any;
      const channel = me.items?.[0];
      handle = channel?.snippet?.title ?? "unknown";
      platformUserId = channel?.id ?? "";
    } else if (platform === "tiktok") {
      const meRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json() as any;
      handle = me.data?.user?.display_name ?? "unknown";
      platformUserId = me.data?.user?.open_id ?? "";
    }

    // Upsert account (one active account per platform)
    const existing = await db.select().from(socialAccounts)
      .where(eq(socialAccounts.platform, platform as any));

    if (existing.length > 0) {
      await db.update(socialAccounts).set({
        handle,
        platformUserId,
        accessToken: encryptToken(accessToken),
        refreshToken: refreshToken ? encryptToken(refreshToken) : null,
        tokenExpiresAt: expiresAt,
        status: "active",
        updatedAt: new Date(),
      }).where(eq(socialAccounts.platform, platform as any));
    } else {
      await db.insert(socialAccounts).values({
        platform: platform as any,
        handle,
        platformUserId,
        accessToken: encryptToken(accessToken),
        refreshToken: refreshToken ? encryptToken(refreshToken) : null,
        tokenExpiresAt: expiresAt,
        scopes: cfg.scopes,
        status: "active",
      });
    }

    logger.info({ platform, handle }, "Social account connected");
    res.send(`<html><body><h2>✅ ${platform} connected as ${handle}</h2><p>You can close this tab.</p></body></html>`);
  } catch (err: any) {
    logger.error({ platform, error: err.message }, "OAuth callback failed");
    res.status(500).send(`Connection failed: ${err.message}`);
  }
});

router.post("/disconnect/:id", async (req: Request, res: Response) => {
  await db.update(socialAccounts)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(socialAccounts.id, String(req.params.id)));
  res.json({ ok: true });
});

export default router;
