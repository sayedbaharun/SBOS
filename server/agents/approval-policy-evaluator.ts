/**
 * Approval Policy Evaluator
 *
 * Evaluates whether an agent deliverable should be auto-approved based on
 * configured approval policies. Policies are ranked by specificity; first
 * match wins. Returns { autoApprove: false } by default (no match) and on
 * any DB error — never blocks the pipeline.
 */

import { storage } from "../storage";
import { approvalPolicies } from "@shared/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { logger } from "../logger";

// Lazy DB handle — avoids import-time side-effects and simplifies testing.
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

export interface PolicyResult {
  autoApprove: boolean;
  matchedPolicyId?: string;
  reason?: string;
}

/**
 * Specificity score for a policy row.
 *
 * Higher score = more specific = takes priority.
 *
 * Bits (MSB → LSB):
 *   bit 2 (4) — ventureId matches
 *   bit 1 (2) — agentSlug matches
 *   bit 0 (1) — deliverableType matches
 *
 * Score 7 (111) = exact three-way match — most specific
 * Score 0 (000) = global catch-all (all nulls)
 */
function specificityScore(
  policy: any,
  deliverableType: string,
  agentSlug: string,
  ventureId: string | null,
): number {
  let score = 0;
  if (policy.ventureId !== null && policy.ventureId === ventureId) score += 4;
  if (policy.agentSlug !== null && policy.agentSlug === agentSlug) score += 2;
  if (policy.deliverableType !== null && policy.deliverableType === deliverableType) score += 1;
  return score;
}

/**
 * Returns true if the policy row is a candidate match for the given inputs.
 *
 * A policy column that is NULL is treated as a wildcard (matches anything).
 * A policy column that is non-NULL must match the supplied value exactly.
 */
function isCandidate(
  policy: any,
  deliverableType: string,
  agentSlug: string,
  ventureId: string | null,
): boolean {
  if (policy.ventureId !== null && policy.ventureId !== ventureId) return false;
  if (policy.agentSlug !== null && policy.agentSlug !== agentSlug) return false;
  if (policy.deliverableType !== null && policy.deliverableType !== deliverableType) return false;
  return true;
}

/**
 * Evaluate approval policies for a deliverable.
 *
 * @param deliverableType  The type string of the deliverable (e.g. "social_post")
 * @param agentSlug        Slug of the agent that produced it (e.g. "smm-syntheliq")
 * @param ventureId        Venture UUID, or null for venture-agnostic deliverables
 * @param costUSD          Estimated cost of the deliverable in USD
 */
export async function evaluatePolicy(
  deliverableType: string,
  agentSlug: string,
  ventureId: string | null,
  costUSD: number,
): Promise<PolicyResult> {
  try {
    const database = await getDb();

    // Pull all active policies in a single query; filter + rank in JS.
    // The table is expected to be small (< 1000 rows) so this is fine.
    const rows: any[] = await database
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.active, true));

    if (!rows || rows.length === 0) {
      return { autoApprove: false };
    }

    // Filter to candidate rows, then sort by descending specificity.
    const candidates = rows
      .filter((p) => isCandidate(p, deliverableType, agentSlug, ventureId))
      .map((p) => ({
        policy: p,
        score: specificityScore(p, deliverableType, agentSlug, ventureId),
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { autoApprove: false };
    }

    const { policy } = candidates[0];

    // Respect the per-policy cost ceiling.
    if (
      policy.maxCostUSD !== null &&
      policy.maxCostUSD !== undefined &&
      costUSD > policy.maxCostUSD
    ) {
      logger.debug(
        { policyId: policy.id, costUSD, maxCostUSD: policy.maxCostUSD },
        "Policy matched but cost exceeds maxCostUSD — not auto-approving",
      );
      return { autoApprove: false, matchedPolicyId: policy.id };
    }

    return {
      autoApprove: policy.autoApprove,
      matchedPolicyId: policy.id,
      reason: policy.reason ?? undefined,
    };
  } catch (err) {
    logger.warn({ err }, "approval-policy-evaluator: DB error — defaulting to manual review");
    return { autoApprove: false };
  }
}
