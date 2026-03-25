/**
 * Integration status checks for Settings page
 * Verifies connectivity without exposing API keys
 */

export type IntegrationStatus = "connected" | "error" | "not_configured";

export interface IntegrationInfo {
  name: string;
  status: IntegrationStatus;
  description: string;
  lastChecked: string;
  errorMessage?: string;
}

/**
 * Check OpenRouter API connection
 */
async function checkOpenRouter(): Promise<IntegrationInfo> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      name: "OpenRouter",
      status: "not_configured",
      description: "AI-powered task analysis and suggestions",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return {
        name: "OpenRouter",
        status: "connected",
        description: "AI-powered task analysis and suggestions",
        lastChecked: new Date().toISOString(),
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return {
        name: "OpenRouter",
        status: "error",
        description: "AI-powered task analysis and suggestions",
        lastChecked: new Date().toISOString(),
        errorMessage: errorData.error?.message || `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      name: "OpenRouter",
      status: "error",
      description: "AI-powered task analysis and suggestions",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check Google Calendar OAuth credentials
 */
async function checkGoogleCalendar(): Promise<IntegrationInfo> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      name: "Google Calendar",
      status: "not_configured",
      description: "Calendar sync and meeting management",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    // Try to refresh the access token to verify credentials
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (response.ok) {
      return {
        name: "Google Calendar",
        status: "connected",
        description: "Calendar sync and meeting management",
        lastChecked: new Date().toISOString(),
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return {
        name: "Google Calendar",
        status: "error",
        description: "Calendar sync and meeting management",
        lastChecked: new Date().toISOString(),
        errorMessage: errorData.error_description || `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      name: "Google Calendar",
      status: "error",
      description: "Calendar sync and meeting management",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check Gmail OAuth credentials
 */
async function checkGmail(): Promise<IntegrationInfo> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      name: "Gmail",
      status: "not_configured",
      description: "Email integration and inbox management",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    // Try to refresh the access token to verify credentials
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (response.ok) {
      return {
        name: "Gmail",
        status: "connected",
        description: "Email integration and inbox management",
        lastChecked: new Date().toISOString(),
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return {
        name: "Gmail",
        status: "error",
        description: "Email integration and inbox management",
        lastChecked: new Date().toISOString(),
        errorMessage: errorData.error_description || `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      name: "Gmail",
      status: "error",
      description: "Email integration and inbox management",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check Google Drive OAuth credentials (uses Calendar creds if not set)
 */
async function checkGoogleDrive(): Promise<IntegrationInfo> {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      name: "Google Drive",
      status: "not_configured",
      description: "Knowledge Base sync and file storage",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    // Try to refresh the access token to verify credentials
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (response.ok) {
      return {
        name: "Google Drive",
        status: "connected",
        description: "Knowledge Base sync and file storage",
        lastChecked: new Date().toISOString(),
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return {
        name: "Google Drive",
        status: "error",
        description: "Knowledge Base sync and file storage",
        lastChecked: new Date().toISOString(),
        errorMessage: errorData.error_description || `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      name: "Google Drive",
      status: "error",
      description: "Knowledge Base sync and file storage",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check TickTick API connection
 */
async function checkTickTick(): Promise<IntegrationInfo> {
  const accessToken = process.env.TICKTICK_ACCESS_TOKEN;

  if (!accessToken) {
    return {
      name: "TickTick",
      status: "not_configured",
      description: "Mobile task capture and sync",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch("https://api.ticktick.com/open/v1/project", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      const projects = await response.json();
      return {
        name: "TickTick",
        status: "connected",
        description: `Mobile task capture (${projects.length} projects)`,
        lastChecked: new Date().toISOString(),
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return {
        name: "TickTick",
        status: "error",
        description: "Mobile task capture and sync",
        lastChecked: new Date().toISOString(),
        errorMessage: errorData.error?.message || `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      name: "TickTick",
      status: "error",
      description: "Mobile task capture and sync",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check Telegram Bot connection
 */
async function checkTelegram(): Promise<IntegrationInfo> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return {
      name: "Telegram",
      status: "not_configured",
      description: "Quick capture and notifications via Telegram bot",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);

    if (response.ok) {
      const data = await response.json();
      if (data.ok) {
        return {
          name: "Telegram",
          status: "connected",
          description: `Connected as @${data.result.username}`,
          lastChecked: new Date().toISOString(),
        };
      }
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      name: "Telegram",
      status: "error",
      description: "Quick capture and notifications via Telegram bot",
      lastChecked: new Date().toISOString(),
      errorMessage: errorData.description || `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      name: "Telegram",
      status: "error",
      description: "Quick capture and notifications via Telegram bot",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection failed",
    };
  }
}

/**
 * Check WHOOP connection
 */
async function checkWhoop(): Promise<IntegrationInfo> {
  const clientId = process.env.WHOOP_CLIENT_ID;

  if (!clientId) {
    return {
      name: "WHOOP",
      status: "not_configured",
      description: "Health & recovery data from WHOOP band",
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    // Dynamic import to avoid circular deps
    const { isWhoopConnected } = await import("./integrations/whoop");
    const connected = await isWhoopConnected();

    return {
      name: "WHOOP",
      status: connected ? "connected" : "not_configured",
      description: "Health & recovery data from WHOOP band",
      lastChecked: new Date().toISOString(),
      errorMessage: connected ? undefined : "OAuth not completed — visit /api/whoop/authorize",
    };
  } catch (error: any) {
    return {
      name: "WHOOP",
      status: "error",
      description: "Health & recovery data from WHOOP band",
      lastChecked: new Date().toISOString(),
      errorMessage: error.message || "Connection check failed",
    };
  }
}

/**
 * Get status of all integrations
 */
export async function getAllIntegrationStatuses(): Promise<IntegrationInfo[]> {
  const results = await Promise.all([
    checkOpenRouter(),
    checkGoogleCalendar(),
    checkGoogleDrive(),
    checkGmail(),
    checkTelegram(),
    checkTickTick(),
    checkWhoop(),
  ]);

  return results;
}

/**
 * Get status of a specific integration
 */
export async function getIntegrationStatus(name: string): Promise<IntegrationInfo | null> {
  const checks: Record<string, () => Promise<IntegrationInfo>> = {
    openrouter: checkOpenRouter,
    "google-calendar": checkGoogleCalendar,
    "google-drive": checkGoogleDrive,
    gmail: checkGmail,
    telegram: checkTelegram,
    ticktick: checkTickTick,
    whoop: checkWhoop,
  };

  const checkFn = checks[name.toLowerCase()];
  if (!checkFn) {
    return null;
  }

  return await checkFn();
}
