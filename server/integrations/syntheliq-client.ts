/**
 * Syntheliq API Client
 * Pull-based bridge to query the Syntheliq orchestrator API on demand.
 * No data replication — queries live endpoints.
 */

import { logger } from "../logger";

const SYNTHELIQ_URL = () => process.env.SYNTHELIQ_URL || "";
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

// Simple in-memory TTL cache
const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function syntheliqFetch<T>(path: string, options?: { method?: string; body?: any }): Promise<T> {
  const baseUrl = SYNTHELIQ_URL();
  if (!baseUrl) throw new Error("SYNTHELIQ_URL not configured");

  const cacheKey = `${options?.method || "GET"}:${path}:${JSON.stringify(options?.body || "")}`;

  // Only cache GET requests
  if (!options?.method || options.method === "GET") {
    const cached = getCached<T>(cacheKey);
    if (cached) return cached;
  }

  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: options?.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Syntheliq ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    // Syntheliq wraps responses in { data, _meta, _guidance } envelope
    const data = json.data !== undefined ? json.data : json;

    if (!options?.method || options.method === "GET") {
      setCache(cacheKey, data);
    }

    return data as T;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Syntheliq request timed out (10s)");
    }
    logger.error({ path, error: error.message }, "Syntheliq API error");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Public API ---

export async function getSyntheliqStatus(): Promise<any> {
  return syntheliqFetch("/health");
}

export async function getSyntheliqRuns(hours = 24): Promise<any> {
  return syntheliqFetch(`/api/runs?hours=${hours}`);
}

export async function getSyntheliqEvents(hours = 24): Promise<any> {
  return syntheliqFetch(`/api/events?hours=${hours}`);
}

export async function getSyntheliqLeads(status?: string): Promise<any> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return syntheliqFetch(`/api/leads${qs}`);
}

export async function getSyntheliqPipeline(): Promise<any> {
  return syntheliqFetch("/api/leads/pipeline");
}

export async function getSyntheliqProposals(status?: string): Promise<any> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return syntheliqFetch(`/api/proposals${qs}`);
}

export async function getSyntheliqClients(status?: string): Promise<any> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return syntheliqFetch(`/api/clients${qs}`);
}

export async function getSyntheliqEscalations(): Promise<any> {
  return syntheliqFetch("/api/escalations");
}

export async function getSyntheliqDashboard(): Promise<any> {
  return syntheliqFetch("/api/dashboard");
}

export async function pushSyntheliqEvent(type: string, payload: any): Promise<any> {
  return syntheliqFetch("/api/events", {
    method: "POST",
    body: { type, payload },
  });
}
