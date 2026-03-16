/**
 * Credential Proxy
 *
 * Injects API keys at the tool-execution boundary so they never
 * appear in agent context windows. Agents reference services by name
 * (e.g. "brave_search"), and the proxy resolves the real key at call time.
 *
 * This is a security boundary: agent prompts, conversation history,
 * and LLM calls never see raw API keys.
 *
 * Used by both SB-OS agent tools and SyntheLIQ container runner.
 */

import { logger } from "../logger";

// ============================================================================
// SERVICE REGISTRY
// ============================================================================

export interface ServiceCredential {
  /** Environment variable name that holds the key */
  envVar: string;
  /** Human-readable service name */
  label: string;
  /** Whether this service is required (vs. optional fallback) */
  required?: boolean;
}

/**
 * Registry of all external services and their credential mappings.
 * Add new services here — agents never reference env vars directly.
 */
const SERVICE_REGISTRY: Record<string, ServiceCredential> = {
  openrouter: {
    envVar: "OPENROUTER_API_KEY",
    label: "OpenRouter LLM Gateway",
    required: true,
  },
  kilo: {
    envVar: "KILOCODE_API_KEY",
    label: "Kilo Code Gateway",
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    label: "OpenAI Direct API",
  },
  brave_search: {
    envVar: "BRAVE_SEARCH_API_KEY",
    label: "Brave Search",
  },
  telegram: {
    envVar: "TELEGRAM_BOT_TOKEN",
    label: "Telegram Bot",
  },
  vercel: {
    envVar: "VERCEL_TOKEN",
    label: "Vercel Deployment",
  },
  railway: {
    envVar: "RAILWAY_TOKEN",
    label: "Railway Deployment",
  },
  google_client_id: {
    envVar: "GOOGLE_CLIENT_ID",
    label: "Google OAuth Client ID",
  },
  google_client_secret: {
    envVar: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
  },
  resend: {
    envVar: "RESEND_API_KEY",
    label: "Resend Email",
  },
  whatsapp: {
    envVar: "WHATSAPP_ACCESS_TOKEN",
    label: "WhatsApp Business API",
  },
  whatsapp_phone_id: {
    envVar: "WHATSAPP_PHONE_NUMBER_ID",
    label: "WhatsApp Phone Number ID",
  },
};

// ============================================================================
// CREDENTIAL ACCESS
// ============================================================================

/**
 * Get a credential by service name at execution time.
 * Returns null if the service is not configured (optional services).
 * Throws if a required service is not configured.
 */
export function getCredential(serviceName: string): string | null {
  const entry = SERVICE_REGISTRY[serviceName];
  if (!entry) {
    logger.warn({ serviceName }, "Unknown service requested from credential proxy");
    return null;
  }

  const value = process.env[entry.envVar];
  if (!value) {
    if (entry.required) {
      throw new Error(`Required service "${entry.label}" is not configured (${entry.envVar})`);
    }
    return null;
  }

  return value;
}

/**
 * Check if a service is configured (has a credential).
 */
export function isServiceConfigured(serviceName: string): boolean {
  const entry = SERVICE_REGISTRY[serviceName];
  if (!entry) return false;
  return !!process.env[entry.envVar];
}

/**
 * Get the status of all registered services.
 * Returns configured/missing status without exposing actual keys.
 */
export function getServiceStatus(): Array<{
  name: string;
  label: string;
  configured: boolean;
  required: boolean;
}> {
  return Object.entries(SERVICE_REGISTRY).map(([name, entry]) => ({
    name,
    label: entry.label,
    configured: !!process.env[entry.envVar],
    required: entry.required || false,
  }));
}

/**
 * Build a sanitized environment for a container/subprocess.
 * Only includes credentials for the specified service names.
 * Keys are injected as generic names (e.g. API_KEY_BRAVE_SEARCH)
 * so the container code uses those instead of raw env var names.
 */
export function buildContainerEnv(
  allowedServices: string[]
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const serviceName of allowedServices) {
    const value = getCredential(serviceName);
    if (value) {
      // Inject as generic name pattern — container code references these
      const envKey = `API_KEY_${serviceName.toUpperCase()}`;
      env[envKey] = value;
    }
  }

  return env;
}

/**
 * Scrub known credential patterns from a string.
 * Use this before logging or storing agent outputs.
 */
export function scrubCredentials(text: string): string {
  let scrubbed = text;

  for (const [, entry] of Object.entries(SERVICE_REGISTRY)) {
    const value = process.env[entry.envVar];
    if (value && value.length > 8) {
      // Replace full key with redacted version
      scrubbed = scrubbed.replaceAll(value, `[REDACTED:${entry.label}]`);
    }
  }

  // Also scrub common key patterns (sk-*, xoxb-*, ghp_*, etc.)
  scrubbed = scrubbed.replace(
    /\b(sk-[a-zA-Z0-9]{20,}|xoxb-[a-zA-Z0-9-]+|ghp_[a-zA-Z0-9]{36,}|ghu_[a-zA-Z0-9]{36,}|Bearer\s+[a-zA-Z0-9._-]{20,})\b/g,
    "[REDACTED:detected_key]"
  );

  return scrubbed;
}
