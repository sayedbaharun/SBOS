/**
 * Browser Action Tool
 *
 * Playwright-based browser automation for agents.
 * Agents can navigate, screenshot, extract text, click, fill forms, and evaluate JS.
 * Used for competitive research, lead verification, price monitoring.
 *
 * Playwright is loaded dynamically — if not installed, the tool returns a helpful error.
 */

import { logger } from "../../logger";

// Session pool — reuse browser instances
const MAX_SESSIONS = 3;
const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 min

interface BrowserSession {
  browser: any; // playwright Browser
  context: any; // playwright BrowserContext
  page: any;    // playwright Page
  lastUsed: number;
  id: string;
}

const sessions = new Map<string, BrowserSession>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// Blocked internal IP patterns
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
];

function isUrlSafe(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return !BLOCKED_PATTERNS.some((p) => p.test(url));
}

/** Dynamically load Playwright (may not be installed) */
let _playwright: any = null;
async function getPlaywright(): Promise<any> {
  if (_playwright) return _playwright;
  try {
    // Dynamic require to avoid TS module resolution errors
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _playwright = require("playwright");
    return _playwright;
  } catch {
    throw new Error(
      "Playwright is not installed. Run `npm install playwright` to enable browser automation."
    );
  }
}

async function getOrCreateSession(sessionId?: string): Promise<BrowserSession> {
  const id = sessionId || `session-${Date.now()}`;

  if (sessions.has(id)) {
    const session = sessions.get(id)!;
    session.lastUsed = Date.now();
    return session;
  }

  if (sessions.size >= MAX_SESSIONS) {
    // Close oldest session
    let oldest: BrowserSession | null = null;
    const entries = Array.from(sessions.values());
    for (const s of entries) {
      if (!oldest || s.lastUsed < oldest.lastUsed) oldest = s;
    }
    if (oldest) {
      await oldest.browser.close().catch(() => {});
      sessions.delete(oldest.id);
    }
  }

  const pw = await getPlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Block tracking/ads for speed
  await page.route(/\.(analytics|ads|tracking|pixel)/, (route: any) => route.abort());

  const session: BrowserSession = { browser, context, page, lastUsed: Date.now(), id };
  sessions.set(id, session);

  // Start cleanup if not running
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupIdleSessions, 30_000);
  }

  return session;
}

async function cleanupIdleSessions(): Promise<void> {
  const now = Date.now();
  const entries = Array.from(sessions.entries());
  for (const [id, session] of entries) {
    if (now - session.lastUsed > SESSION_IDLE_TIMEOUT_MS) {
      await session.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
  if (sessions.size === 0 && cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export type BrowserActionType =
  | "navigate"
  | "screenshot"
  | "extract_text"
  | "click"
  | "fill"
  | "evaluate";

export interface BrowserActionArgs {
  action: BrowserActionType;
  url?: string;
  selector?: string;
  value?: string;
  script?: string;
  sessionId?: string;
  waitForSelector?: string;
  timeout?: number;
}

export interface BrowserActionResult {
  success: boolean;
  action: string;
  data?: string;
  error?: string;
  url?: string;
  title?: string;
}

/**
 * Execute a browser action. This is the main entry point for the agent tool.
 */
export async function executeBrowserAction(
  args: BrowserActionArgs
): Promise<BrowserActionResult> {
  const timeout = Math.min(args.timeout || 15000, 30000); // Max 30s

  try {
    const session = await getOrCreateSession(args.sessionId);
    const page = session.page;

    switch (args.action) {
      case "navigate": {
        if (!args.url) return { success: false, action: "navigate", error: "url is required" };
        if (!isUrlSafe(args.url))
          return { success: false, action: "navigate", error: "URL blocked (internal/non-HTTP)" };

        await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
        if (args.waitForSelector) {
          await page.waitForSelector(args.waitForSelector, { timeout: 5000 }).catch(() => {});
        }

        return {
          success: true,
          action: "navigate",
          url: page.url(),
          title: await page.title(),
        };
      }

      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 50, fullPage: false });
        return {
          success: true,
          action: "screenshot",
          data: `[Screenshot captured: ${buffer.length} bytes, page: ${page.url()}]`,
          url: page.url(),
          title: await page.title(),
        };
      }

      case "extract_text": {
        const selector = args.selector || "body";
        const text = await page.locator(selector).first().innerText({ timeout });
        const truncated = text.slice(0, 8000);
        return {
          success: true,
          action: "extract_text",
          data: truncated + (text.length > 8000 ? "\n...[truncated]" : ""),
          url: page.url(),
        };
      }

      case "click": {
        if (!args.selector) return { success: false, action: "click", error: "selector is required" };
        await page.locator(args.selector).first().click({ timeout });
        await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
        return {
          success: true,
          action: "click",
          url: page.url(),
          title: await page.title(),
        };
      }

      case "fill": {
        if (!args.selector || args.value === undefined) {
          return { success: false, action: "fill", error: "selector and value are required" };
        }
        await page.locator(args.selector).first().fill(args.value, { timeout });
        return { success: true, action: "fill" };
      }

      case "evaluate": {
        if (!args.script) return { success: false, action: "evaluate", error: "script is required" };
        if (args.script.length > 2000) {
          return { success: false, action: "evaluate", error: "Script too long (max 2000 chars)" };
        }
        const result = await page.evaluate(args.script);
        const serialized = typeof result === "string" ? result : JSON.stringify(result);
        return {
          success: true,
          action: "evaluate",
          data: (serialized || "").slice(0, 4000),
        };
      }

      default:
        return { success: false, action: args.action, error: `Unknown action: ${args.action}` };
    }
  } catch (err: any) {
    logger.warn({ action: args.action, error: err.message }, "Browser action failed");
    return {
      success: false,
      action: args.action,
      error: err.message,
    };
  }
}

/**
 * Close all browser sessions. Call on server shutdown.
 */
export async function closeAllSessions(): Promise<void> {
  const entries = Array.from(sessions.values());
  for (const session of entries) {
    await session.browser.close().catch(() => {});
  }
  sessions.clear();
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
