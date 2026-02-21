/**
 * Agent Registry
 *
 * Loads, caches, and resolves agent definitions from the PostgreSQL database.
 * Agents are the core of the SB-OS hierarchical multi-agent system.
 *
 * Responsibilities:
 * - Parse soul templates (YAML frontmatter + markdown body)
 * - Load and cache agents from the DB by slug or in bulk
 * - Traverse the agent hierarchy (parent chain, children)
 * - Seed agents from markdown template files on disk
 * - Route incoming messages to the appropriate agent
 */

import fs from "fs";
import path from "path";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { agents, type Agent } from "@shared/schema";
import type { AgentSoulFrontmatter } from "./types";

// ============================================================================
// LAZY DB INITIALIZATION
// ============================================================================

let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

const agentCache = new Map<string, Agent>(); // keyed by slug

// ============================================================================
// SOUL TEMPLATE PARSING
// ============================================================================

/**
 * Parse YAML frontmatter and body from a markdown soul template.
 *
 * Expected format:
 * ```
 * ---
 * name: Chief of Staff
 * slug: chief-of-staff
 * role: executive
 * expertise: [strategy, operations]
 * ...
 * ---
 * Body text here...
 * ```
 */
export function parseSoulTemplate(markdown: string): {
  frontmatter: AgentSoulFrontmatter;
  body: string;
} {
  const DELIMITER = "---";

  const trimmed = markdown.trim();
  if (!trimmed.startsWith(DELIMITER)) {
    throw new Error("Soul template must begin with a '---' frontmatter block");
  }

  // Find the closing delimiter (skip the opening one at index 0)
  const closingIndex = trimmed.indexOf(DELIMITER, DELIMITER.length);
  if (closingIndex === -1) {
    throw new Error("Soul template frontmatter is missing closing '---'");
  }

  const yamlBlock = trimmed.slice(DELIMITER.length, closingIndex).trim();
  const body = trimmed.slice(closingIndex + DELIMITER.length).trim();

  const raw: Record<string, unknown> = {};

  const lines = yamlBlock.split("\n");
  let currentNestedKey: string | null = null;
  let nestedObj: Record<string, string> = {};

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Check if this is an indented line (part of a nested object)
    if (currentNestedKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      const trimmedLine = line.trim();
      const colonIdx = trimmedLine.indexOf(":");
      if (colonIdx === -1) continue;
      const subKey = trimmedLine.slice(0, colonIdx).trim();
      let subVal = trimmedLine.slice(colonIdx + 1).trim();
      // Strip surrounding quotes
      if ((subVal.startsWith('"') && subVal.endsWith('"')) || (subVal.startsWith("'") && subVal.endsWith("'"))) {
        subVal = subVal.slice(1, -1);
      }
      nestedObj[subKey] = subVal;
      continue;
    }

    // Flush any pending nested object
    if (currentNestedKey) {
      raw[currentNestedKey] = Object.keys(nestedObj).length > 0 ? nestedObj : null;
      currentNestedKey = null;
      nestedObj = {};
    }

    const trimmedLine = line.trim();
    const colonIdx = trimmedLine.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmedLine.slice(0, colonIdx).trim();
    let valuePart = trimmedLine.slice(colonIdx + 1).trim();

    // Strip surrounding quotes from values
    if ((valuePart.startsWith('"') && valuePart.endsWith('"')) || (valuePart.startsWith("'") && valuePart.endsWith("'"))) {
      valuePart = valuePart.slice(1, -1);
    }

    if (valuePart === "") {
      // Empty value — next indented lines form a nested object
      currentNestedKey = key;
      nestedObj = {};
    } else if (valuePart.startsWith("[") && valuePart.endsWith("]")) {
      // Inline array: [item1, item2, item3]
      const inner = valuePart.slice(1, -1).trim();
      if (inner.length === 0) {
        raw[key] = [];
      } else {
        raw[key] = inner.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else if (valuePart === "null" || valuePart === "~") {
      raw[key] = null;
    } else if (valuePart === "true") {
      raw[key] = true;
    } else if (valuePart === "false") {
      raw[key] = false;
    } else if (!isNaN(Number(valuePart)) && valuePart !== "") {
      raw[key] = Number(valuePart);
    } else {
      raw[key] = valuePart;
    }
  }

  // Flush any trailing nested object
  if (currentNestedKey) {
    raw[currentNestedKey] = Object.keys(nestedObj).length > 0 ? nestedObj : null;
  }

  // Build typed frontmatter with safe defaults
  const frontmatter: AgentSoulFrontmatter = {
    name: String(raw.name ?? ""),
    slug: String(raw.slug ?? ""),
    role: (raw.role as AgentSoulFrontmatter["role"]) ?? "worker",
    parent: String(raw.parent ?? "user"),
    venture: raw.venture != null ? String(raw.venture) : null,
    expertise: Array.isArray(raw.expertise) ? (raw.expertise as string[]) : [],
    tools: Array.isArray(raw.tools) ? (raw.tools as string[]) : [],
    permissions: Array.isArray(raw.permissions) ? (raw.permissions as string[]) : ["read"],
    delegates_to: Array.isArray(raw.delegates_to) ? (raw.delegates_to as string[]) : [],
    max_delegation_depth: typeof raw.max_delegation_depth === "number" ? raw.max_delegation_depth : 2,
    model_tier: (raw.model_tier as AgentSoulFrontmatter["model_tier"]) ?? "auto",
    temperature: typeof raw.temperature === "number" ? raw.temperature : 0.7,
    memory_scope: (raw.memory_scope as AgentSoulFrontmatter["memory_scope"]) ?? "isolated",
    schedule: raw.schedule != null && typeof raw.schedule === "object" && !Array.isArray(raw.schedule)
      ? (raw.schedule as Record<string, string>)
      : undefined,
  };

  return { frontmatter, body };
}

// ============================================================================
// LOAD SINGLE AGENT
// ============================================================================

/**
 * Load an agent by slug from the DB (with in-memory caching).
 * Returns null if the agent does not exist or is inactive.
 */
export async function loadAgent(slug: string): Promise<Agent | null> {
  const cached = agentCache.get(slug);
  if (cached) return cached;

  const database = await getDb();

  const [agent] = await database
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.isActive, true)))
    .limit(1);

  if (!agent) {
    logger.debug({ slug }, "Agent not found or inactive");
    return null;
  }

  agentCache.set(slug, agent);
  logger.debug({ slug, agentId: agent.id }, "Agent loaded and cached");
  return agent;
}

// ============================================================================
// LOAD ALL AGENTS
// ============================================================================

const ROLE_ORDER: Record<string, number> = {
  executive: 0,
  manager: 1,
  specialist: 2,
  worker: 3,
};

/**
 * Load all active agents from the DB, cache them, and return sorted by role.
 * Ordering: executive → manager → specialist → worker.
 */
export async function loadAllAgents(): Promise<Agent[]> {
  const database = await getDb();

  const all: Agent[] = await database
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  // Populate cache
  for (const agent of all) {
    agentCache.set(agent.slug, agent);
  }

  all.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    return ra - rb;
  });

  logger.debug({ count: all.length }, "All active agents loaded");
  return all;
}

// ============================================================================
// HIERARCHY TRAVERSAL
// ============================================================================

/**
 * Return the reporting chain from an agent up to the root.
 * The first element is the agent itself; the last is the root (no parent).
 */
export async function getAgentHierarchy(agentId: string): Promise<Agent[]> {
  const database = await getDb();
  const chain: Agent[] = [];

  let currentId: string | null = agentId;

  // Guard against circular references (depth limit)
  const maxDepth = 20;
  let depth = 0;

  while (currentId && depth < maxDepth) {
    const [agent]: Agent[] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, currentId))
      .limit(1);

    if (!agent) break;

    chain.push(agent);
    currentId = agent.parentId ?? null;
    depth++;
  }

  logger.debug({ agentId, chainLength: chain.length }, "Agent hierarchy resolved");
  return chain;
}

/**
 * Return direct children of a given agent.
 */
export async function getAgentChildren(agentId: string): Promise<Agent[]> {
  const database = await getDb();

  const children: Agent[] = await database
    .select()
    .from(agents)
    .where(and(eq(agents.parentId, agentId), eq(agents.isActive, true)));

  logger.debug({ agentId, childCount: children.length }, "Agent children fetched");
  return children;
}

// ============================================================================
// SEED FROM TEMPLATES
// ============================================================================

/**
 * Read all .md files from templateDir, parse them as soul templates, and
 * insert each into the agents table if an agent with that slug does not already
 * exist. Resolves parentId by looking up the parent's slug.
 *
 * Returns counts of seeded vs skipped agents.
 */
export async function seedFromTemplates(
  templateDir: string
): Promise<{ seeded: number; skipped: number }> {
  const database = await getDb();

  let seeded = 0;
  let skipped = 0;

  const files = fs.readdirSync(templateDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    logger.warn({ templateDir }, "No .md template files found in directory");
    return { seeded, skipped };
  }

  logger.info({ templateDir, fileCount: files.length }, "Seeding agents from templates");

  for (const file of files) {
    const filePath = path.join(templateDir, file);
    const markdown = fs.readFileSync(filePath, "utf-8");

    let frontmatter: AgentSoulFrontmatter;
    let body: string;

    try {
      ({ frontmatter, body } = parseSoulTemplate(markdown));
    } catch (err) {
      logger.error({ file, err }, "Failed to parse soul template — skipping");
      skipped++;
      continue;
    }

    if (!frontmatter.slug) {
      logger.warn({ file }, "Template has no slug — skipping");
      skipped++;
      continue;
    }

    // Check if agent already exists
    const [existing] = await database
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.slug, frontmatter.slug))
      .limit(1);

    if (existing) {
      // Update existing agent's soul, schedule, tools, etc. from template
      const soul = `---\n${buildYamlBlock(frontmatter)}\n---\n\n${body}`.trim();
      try {
        await database
          .update(agents)
          .set({
            soul,
            expertise: frontmatter.expertise,
            availableTools: frontmatter.tools,
            actionPermissions: frontmatter.permissions,
            canDelegateTo: frontmatter.delegates_to,
            maxDelegationDepth: frontmatter.max_delegation_depth,
            modelTier: frontmatter.model_tier,
            temperature: frontmatter.temperature,
            memoryScope: frontmatter.memory_scope,
            schedule: frontmatter.schedule ?? null,
          })
          .where(eq(agents.id, existing.id));
        logger.info({ slug: frontmatter.slug }, "Agent updated from template");
        seeded++;
      } catch (err) {
        logger.error({ slug: frontmatter.slug, err: err instanceof Error ? err.message : String(err) }, "Failed to update agent");
        skipped++;
      }
      continue;
    }

    // Resolve parentId from parent slug
    let parentId: string | null = null;
    if (frontmatter.parent && frontmatter.parent !== "user") {
      const [parentRow] = await database
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.slug, frontmatter.parent))
        .limit(1);

      if (parentRow) {
        parentId = parentRow.id;
      } else {
        logger.warn(
          { slug: frontmatter.slug, parentSlug: frontmatter.parent },
          "Parent agent not found — inserting without parent"
        );
      }
    }

    // Resolve ventureId: for now, venture is stored as a slug/name reference
    // but the schema uses a UUID foreign key. We skip auto-resolution here
    // and leave it null unless a ventureId is supplied directly.
    // Callers can update the agent's ventureId after seeding if needed.

    const soul = `---\n${buildYamlBlock(frontmatter)}\n---\n\n${body}`.trim();

    try {
      await database.insert(agents).values({
        name: frontmatter.name,
        slug: frontmatter.slug,
        role: frontmatter.role,
        parentId,
        soul,
        expertise: frontmatter.expertise,
        availableTools: frontmatter.tools,
        actionPermissions: frontmatter.permissions,
        canDelegateTo: frontmatter.delegates_to,
        maxDelegationDepth: frontmatter.max_delegation_depth,
        modelTier: frontmatter.model_tier,
        temperature: frontmatter.temperature,
        memoryScope: frontmatter.memory_scope,
        schedule: frontmatter.schedule ?? null,
        isActive: true,
      });

      logger.info({ slug: frontmatter.slug, file }, "Agent seeded from template");
      seeded++;
    } catch (err) {
      logger.error({ slug: frontmatter.slug, file, err: err instanceof Error ? err.message : String(err) }, "Failed to insert agent — skipping");
      skipped++;
    }
  }

  logger.info({ seeded, skipped }, "Agent seeding complete");
  return { seeded, skipped };
}

/** Reconstruct a minimal YAML block from frontmatter (for storing the soul). */
function buildYamlBlock(fm: AgentSoulFrontmatter): string {
  const lines: string[] = [
    `name: ${fm.name}`,
    `slug: ${fm.slug}`,
    `role: ${fm.role}`,
    `parent: ${fm.parent}`,
    `venture: ${fm.venture ?? "null"}`,
    `expertise: [${fm.expertise.join(", ")}]`,
    `tools: [${fm.tools.join(", ")}]`,
    `permissions: [${fm.permissions.join(", ")}]`,
    `delegates_to: [${fm.delegates_to.join(", ")}]`,
    `max_delegation_depth: ${fm.max_delegation_depth}`,
    `model_tier: ${fm.model_tier}`,
    `temperature: ${fm.temperature}`,
    `memory_scope: ${fm.memory_scope}`,
  ];
  if (fm.schedule && Object.keys(fm.schedule).length > 0) {
    lines.push("schedule:");
    for (const [k, v] of Object.entries(fm.schedule)) {
      lines.push(`  ${k}: "${v}"`);
    }
  }
  return lines.join("\n");
}

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the in-memory cache for a specific agent slug, or clear the
 * entire cache if no slug is provided.
 */
export function invalidateCache(slug?: string): void {
  if (slug) {
    agentCache.delete(slug);
    logger.debug({ slug }, "Agent cache entry invalidated");
  } else {
    agentCache.clear();
    logger.debug("Entire agent cache cleared");
  }
}

// ============================================================================
// MESSAGE ROUTING
// ============================================================================

const CHIEF_OF_STAFF_SLUG = "chief-of-staff";

/**
 * Resolve the best agent to handle an incoming message.
 *
 * Routing logic:
 * 1. If a ventureId is provided, prefer agents scoped to that venture.
 * 2. Otherwise, return the Chief of Staff agent as the default router.
 *
 * This is a basic implementation — enhance with NLP/intent detection later.
 */
export async function resolveAgentForMessage(
  message: string,
  ventureId?: string
): Promise<Agent | null> {
  const database = await getDb();

  if (ventureId) {
    // Find an active agent scoped to this venture, preferring executive/manager roles
    const ventureAgents: Agent[] = await database
      .select()
      .from(agents)
      .where(and(eq(agents.ventureId, ventureId), eq(agents.isActive, true)));

    if (ventureAgents.length > 0) {
      // Prefer by role: executive first, then manager, specialist, worker
      ventureAgents.sort((a, b) => {
        const ra = ROLE_ORDER[a.role] ?? 99;
        const rb = ROLE_ORDER[b.role] ?? 99;
        return ra - rb;
      });

      const chosen = ventureAgents[0];
      logger.debug(
        { ventureId, agentSlug: chosen.slug, messageSnippet: message.slice(0, 60) },
        "Resolved venture-scoped agent for message"
      );
      return chosen;
    }

    logger.debug(
      { ventureId },
      "No active agents for venture — falling back to Chief of Staff"
    );
  }

  // Default: Chief of Staff
  const chiefOfStaff = await loadAgent(CHIEF_OF_STAFF_SLUG);

  if (!chiefOfStaff) {
    logger.warn(
      { slug: CHIEF_OF_STAFF_SLUG },
      "Chief of Staff agent not found — cannot route message"
    );
    return null;
  }

  logger.debug(
    { agentSlug: chiefOfStaff.slug, messageSnippet: message.slice(0, 60) },
    "Resolved Chief of Staff as default agent for message"
  );

  return chiefOfStaff;
}
