/**
 * Graph Routes
 *
 * Exposes FalkorDB entity graph data for visualization.
 * Falls back to Postgres entity_relations if FalkorDB unavailable.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { db } from "../../db";
import { entityRelations } from "@shared/schema";
import { or, eq, desc, sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/graph/nodes
 * Returns all entity nodes for the knowledge graph visualization.
 */
router.get("/nodes", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "200")), 500);

    const { getFullGraph, isGraphAvailable } = await import("../memory/graph-store");

    if (await isGraphAvailable()) {
      const graph = await getFullGraph(limit);
      return res.json(graph.nodes);
    }

    // Fallback: build nodes from Postgres entity_relations
    const rows = await db
      .select({
        name: entityRelations.sourceName,
        type: entityRelations.sourceType,
        mentionCount: sql<number>`sum(${entityRelations.mentionCount})`,
      })
      .from(entityRelations)
      .groupBy(entityRelations.sourceName, entityRelations.sourceType)
      .orderBy(desc(sql<number>`sum(${entityRelations.mentionCount})`))
      .limit(limit);

    const nodes = rows.map((r) => ({
      id: r.name,
      label: r.name,
      type: r.type ?? "concept",
      description: "",
      mentionCount: Number(r.mentionCount) || 1,
    }));

    res.json(nodes);
  } catch (error) {
    logger.error({ error }, "Failed to get graph nodes");
    res.status(500).json({ error: "Failed to get graph nodes" });
  }
});

/**
 * GET /api/graph/edges
 * Returns all entity relationships for visualization.
 */
router.get("/edges", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "400")), 1000);

    const { getFullGraph, isGraphAvailable } = await import("../memory/graph-store");

    if (await isGraphAvailable()) {
      const graph = await getFullGraph(Math.floor(limit / 2));
      return res.json(graph.edges);
    }

    // Fallback: Postgres entity_relations
    const rows = await db
      .select({
        source: entityRelations.sourceName,
        target: entityRelations.targetName,
        relationship: entityRelations.relationType,
        strength: entityRelations.strength,
      })
      .from(entityRelations)
      .orderBy(desc(entityRelations.strength))
      .limit(limit);

    res.json(rows);
  } catch (error) {
    logger.error({ error }, "Failed to get graph edges");
    res.status(500).json({ error: "Failed to get graph edges" });
  }
});

/**
 * GET /api/graph/entity/:name
 * Returns the immediate neighborhood of a specific entity.
 */
router.get("/entity/:name", async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const { getEntityNeighborhood, isGraphAvailable } = await import("../memory/graph-store");

    if (await isGraphAvailable()) {
      const neighborhood = await getEntityNeighborhood(name);
      return res.json(neighborhood);
    }

    // Fallback: Postgres entity_relations for this entity
    const rows = await db
      .select()
      .from(entityRelations)
      .where(or(eq(entityRelations.sourceName, name), eq(entityRelations.targetName, name)))
      .limit(50);

    const nodeMap = new Map<string, { id: string; label: string; type: string; mentionCount: number }>();
    nodeMap.set(name, { id: name, label: name, type: "concept", mentionCount: 1 });

    for (const r of rows) {
      if (!nodeMap.has(r.sourceName)) {
        nodeMap.set(r.sourceName, {
          id: r.sourceName,
          label: r.sourceName,
          type: r.sourceType ?? "concept",
          mentionCount: r.mentionCount ?? 1,
        });
      }
      if (!nodeMap.has(r.targetName)) {
        nodeMap.set(r.targetName, {
          id: r.targetName,
          label: r.targetName,
          type: r.targetType ?? "concept",
          mentionCount: r.mentionCount ?? 1,
        });
      }
    }

    res.json({
      nodes: Array.from(nodeMap.values()),
      edges: rows.map((r) => ({
        source: r.sourceName,
        target: r.targetName,
        relationship: r.relationType,
        strength: r.strength ?? 0.5,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get entity neighborhood");
    res.status(500).json({ error: "Failed to get entity neighborhood" });
  }
});

/**
 * GET /api/graph/status
 * Returns graph availability and entity counts.
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const { isGraphAvailable } = await import("../memory/graph-store");
    const available = await isGraphAvailable();

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(entityRelations);

    res.json({
      available,
      source: available ? "falkordb" : "postgres_fallback",
      postgresEntityRelations: Number(countResult?.count ?? 0),
    });
  } catch (error) {
    res.status(500).json({ error: "Graph status check failed" });
  }
});

export default router;
