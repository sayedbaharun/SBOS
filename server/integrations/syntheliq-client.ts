/**
 * Syntheliq API Client
 * Pull-based bridge to query the Syntheliq orchestrator API on demand.
 * No data replication — queries live endpoints.
 *
 * Includes:
 * - Circuit breaker (3 failures → 5min open → half-open probe)
 * - Response normalization (snake_case → camelCase for consistent consumption)
 * - Composed dashboard (no single /api/dashboard endpoint on Syntheliq)
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

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

const CB_FAILURE_THRESHOLD = 3;
const CB_OPEN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

let cbState: "closed" | "open" | "half-open" = "closed";
let cbFailures = 0;
let cbOpenedAt = 0;

function cbRecordSuccess(): void {
  cbFailures = 0;
  cbState = "closed";
}

function cbRecordFailure(): void {
  cbFailures++;
  if (cbFailures >= CB_FAILURE_THRESHOLD) {
    cbState = "open";
    cbOpenedAt = Date.now();
    logger.warn({ failures: cbFailures }, "Syntheliq circuit breaker OPEN — skipping calls for 5min");
  }
}

function cbShouldAllow(): boolean {
  if (cbState === "closed") return true;
  if (cbState === "open") {
    if (Date.now() - cbOpenedAt >= CB_OPEN_DURATION_MS) {
      cbState = "half-open";
      logger.info("Syntheliq circuit breaker HALF-OPEN — allowing probe request");
      return true;
    }
    return false;
  }
  // half-open: allow one probe
  return true;
}

// ============================================================================
// FETCH WITH CIRCUIT BREAKER
// ============================================================================

async function syntheliqFetch<T>(path: string, options?: { method?: string; body?: any }): Promise<T> {
  const baseUrl = SYNTHELIQ_URL();
  if (!baseUrl) throw new Error("SYNTHELIQ_URL not configured");

  // Circuit breaker gate
  if (!cbShouldAllow()) {
    throw new Error("Syntheliq temporarily unavailable (circuit breaker open)");
  }

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

    cbRecordSuccess();
    return data as T;
  } catch (error: any) {
    cbRecordFailure();
    if (error.name === "AbortError") {
      throw new Error("Syntheliq request timed out (10s)");
    }
    logger.error({ path, error: error.message }, "Syntheliq API error");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// RESPONSE NORMALIZATION
// ============================================================================

function normalizeRun(r: any): any {
  if (!r || typeof r !== "object") return r;
  return {
    ...r,
    agentName: r.agentName || r.agent_name || r.agent || "Agent",
    startedAt: r.startedAt || r.started_at || null,
    completedAt: r.completedAt || r.completed_at || null,
    summary: r.summary || r.output_data?.summary || (typeof r.output_data === "string" ? r.output_data?.slice(0, 120) : "") || "",
  };
}

function normalizeRuns(runs: any): any[] {
  if (!Array.isArray(runs)) return [];
  return runs.map(normalizeRun);
}

function normalizeLead(l: any): any {
  if (!l || typeof l !== "object") return l;
  return {
    ...l,
    company: l.company || l.company_name || l.name || "Unknown",
    score: l.score ?? l.match_score ?? null,
    contactName: l.contactName || l.contact_name || null,
  };
}

function normalizeLeads(leads: any): any[] {
  if (!Array.isArray(leads)) return [];
  return leads.map(normalizeLead);
}

function normalizeProposal(p: any): any {
  if (!p || typeof p !== "object") return p;
  return {
    ...p,
    company: p.company || p.company_name || p.contact_name || p.leadName || "Unknown",
    value: p.value ?? p.monthly_rate ?? null,
  };
}

function normalizeProposals(proposals: any): any[] {
  if (!Array.isArray(proposals)) return [];
  return proposals.map(normalizeProposal);
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function getSyntheliqStatus(): Promise<any> {
  return syntheliqFetch("/health");
}

export async function getSyntheliqRuns(hours = 24): Promise<any[]> {
  const raw = await syntheliqFetch<any>(`/api/runs?hours=${hours}`);
  return normalizeRuns(raw);
}

export async function getSyntheliqEvents(hours = 24): Promise<any> {
  return syntheliqFetch(`/api/events?hours=${hours}`);
}

export async function getSyntheliqLeads(status?: string): Promise<any[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const raw = await syntheliqFetch<any>(`/api/leads${qs}`);
  return normalizeLeads(raw);
}

export async function getSyntheliqPipeline(): Promise<any> {
  return syntheliqFetch("/api/leads/pipeline");
}

export async function getSyntheliqProposals(status?: string): Promise<any[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const raw = await syntheliqFetch<any>(`/api/proposals${qs}`);
  return normalizeProposals(raw);
}

export async function getSyntheliqClients(status?: string): Promise<any> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return syntheliqFetch(`/api/clients${qs}`);
}

export async function getSyntheliqEscalations(): Promise<any> {
  return syntheliqFetch("/api/escalations");
}

/**
 * Composed dashboard — no single /api/dashboard endpoint on Syntheliq.
 * Fetches health + pipeline + recent runs in parallel and normalizes.
 */
export async function getSyntheliqDashboard(): Promise<any> {
  const [health, pipeline, runs] = await Promise.all([
    getSyntheliqStatus().catch(() => null),
    getSyntheliqPipeline().catch(() => null),
    getSyntheliqRuns(24).catch(() => []),
  ]);
  return { health, pipeline, runs };
}

export async function pushSyntheliqEvent(type: string, payload: any): Promise<any> {
  return syntheliqFetch("/api/events", {
    method: "POST",
    body: { type, payload },
  });
}

/**
 * Circuit breaker status — for observability.
 */
export function getSyntheliqCircuitState(): { state: string; failures: number } {
  return { state: cbState, failures: cbFailures };
}
