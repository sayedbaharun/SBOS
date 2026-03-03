/**
 * RAG (Retrieval Augmented Generation) Routes
 *
 * Endpoints for managing embeddings, vector search, and RAG status.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import {
  scheduleEmbeddingJobs,
  getJobStatus,
  processAllPending,
  processDocumentNow,
  triggerBatch,
} from "../embedding-jobs";
import {
  vectorSearchDocs,
  keywordSearchDocs,
  hybridSearch,
  findSimilarDocs,
  isVectorSearchAvailable,
} from "../vector-search";
import { getContextSources } from "../context-memory";

const router = Router();

// ============================================================================
// STATUS & CONFIGURATION
// ============================================================================

/**
 * GET /api/rag/status
 * Get RAG system status including embedding coverage and job status
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const vectorStatus = await isVectorSearchAvailable();
    const jobStatus = getJobStatus();

    res.json({
      vectorSearch: vectorStatus,
      embeddingJob: jobStatus,
      isReady: vectorStatus.available && vectorStatus.embeddedDocsCount > 0,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get RAG status");
    res.status(500).json({ error: "Failed to get RAG status" });
  }
});

// ============================================================================
// EMBEDDING MANAGEMENT
// ============================================================================

/**
 * POST /api/rag/embeddings/trigger
 * Trigger immediate processing of pending documents
 */
router.post("/embeddings/trigger", async (req: Request, res: Response) => {
  try {
    const result = await triggerBatch();
    res.json({
      success: true,
      ...result,
      message: `Processed ${result.processed} documents, ${result.errors} errors, ${result.chunksCreated} chunks created`,
    });
  } catch (error) {
    logger.error({ error }, "Failed to trigger embedding batch");
    res.status(500).json({ error: "Failed to trigger embedding batch" });
  }
});

/**
 * POST /api/rag/embeddings/process-all
 * Process all pending documents (may take a while)
 */
router.post("/embeddings/process-all", async (req: Request, res: Response) => {
  try {
    const result = await processAllPending();
    res.json({
      success: true,
      ...result,
      message: `Processed ${result.processed} documents, ${result.errors} errors, ${result.chunksCreated} chunks created`,
    });
  } catch (error) {
    logger.error({ error }, "Failed to process all embeddings");
    res.status(500).json({ error: "Failed to process all embeddings" });
  }
});

/**
 * POST /api/rag/embeddings/doc/:docId
 * Process a specific document immediately
 */
router.post("/embeddings/doc/:docId", async (req: Request, res: Response) => {
  try {
    const { docId } = req.params;
    const result = await processDocumentNow(docId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      chunksCreated: result.chunksCreated,
    });
  } catch (error) {
    logger.error({ error, docId: req.params.docId }, "Failed to process document");
    res.status(500).json({ error: "Failed to process document" });
  }
});

/**
 * GET /api/rag/embeddings/pending
 * Get list of documents that need embedding
 */
router.get("/embeddings/pending", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const docs = await storage.getDocsNeedingEmbedding(limit);

    res.json({
      count: docs.length,
      docs: docs.map(d => ({
        id: d.id,
        title: d.title,
        type: d.type,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get pending documents");
    res.status(500).json({ error: "Failed to get pending documents" });
  }
});

// ============================================================================
// SEARCH
// ============================================================================

/**
 * POST /api/rag/search
 * Perform hybrid search (vector + keyword)
 */
router.post("/search", async (req: Request, res: Response) => {
  try {
    const { query, ventureId, limit = 10, vectorWeight = 0.7 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    const results = await hybridSearch(query, {
      ventureId,
      limit,
      vectorWeight,
    });

    res.json({
      query,
      results,
      count: results.length,
      _search_meta: {
        method: 'hybrid',
        vector_weight: vectorWeight,
        keyword_weight: Number((1 - vectorWeight).toFixed(2)),
        result_count: results.length,
        top_relevance: results.length > 0 ? (results[0] as unknown as Record<string, unknown>).score ?? null : null,
      },
    });
  } catch (error) {
    logger.error({ error }, "Hybrid search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * POST /api/rag/search/vector
 * Perform pure vector search
 */
router.post("/search/vector", async (req: Request, res: Response) => {
  try {
    const { query, ventureId, limit = 10, minSimilarity = 0.3 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    const results = await vectorSearchDocs(query, {
      ventureId,
      limit,
      minSimilarity,
    });

    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    logger.error({ error }, "Vector search failed");
    res.status(500).json({ error: "Vector search failed" });
  }
});

/**
 * POST /api/rag/search/keyword
 * Perform pure keyword search
 */
router.post("/search/keyword", async (req: Request, res: Response) => {
  try {
    const { query, ventureId, limit = 10 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    const results = await keywordSearchDocs(query, {
      ventureId,
      limit,
    });

    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    logger.error({ error }, "Keyword search failed");
    res.status(500).json({ error: "Keyword search failed" });
  }
});

/**
 * GET /api/rag/similar/:docId
 * Find documents similar to a given document
 */
router.get("/similar/:docId", async (req: Request, res: Response) => {
  try {
    const { docId } = req.params;
    const limit = parseInt(req.query.limit as string) || 5;

    const results = await findSimilarDocs(docId, { limit });

    res.json({
      docId,
      results,
      count: results.length,
    });
  } catch (error) {
    logger.error({ error, docId: req.params.docId }, "Find similar failed");
    res.status(500).json({ error: "Find similar failed" });
  }
});

// ============================================================================
// CONTEXT (for testing/debugging)
// ============================================================================

/**
 * POST /api/rag/context/preview
 * Preview what context would be injected for a given query
 */
router.post("/context/preview", async (req: Request, res: Response) => {
  try {
    const { query, ventureId, projectId, includeTasks = true } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }

    const sources = await getContextSources(query, {
      ventureId,
      projectId,
      includeTasks,
    });

    res.json({
      query,
      sources,
      count: sources.length,
    });
  } catch (error) {
    logger.error({ error }, "Context preview failed");
    res.status(500).json({ error: "Context preview failed" });
  }
});

export default router;
