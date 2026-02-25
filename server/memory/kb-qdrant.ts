/**
 * Knowledge Base Qdrant Collection
 *
 * Moves KB vector search from O(n) JS cosine loop to Qdrant ANN index.
 * Collection: knowledge_base (1536-dim, cosine distance)
 *
 * Payload indexes: ventureId (keyword), docType (keyword), status (keyword)
 *
 * Sync strategy:
 * - On doc create/update with embedding → upsert to Qdrant
 * - On doc delete → delete from Qdrant
 * - Startup: bulk sync all docs with embeddings
 */

import { logger } from "../logger";
import { generateEmbedding, parseEmbedding } from "../embeddings";
import { extractTextFromBlocks } from "../chunking";
import { LOCAL_EMBEDDING_DIMS } from "./schemas";

const COLLECTION = "knowledge_base";

// Lazy client (reuse the same Qdrant client)
async function getClient() {
  const { QdrantClient } = await import("@qdrant/js-client-rest");
  const url = process.env.QDRANT_URL || "http://localhost:6333";
  const apiKey = process.env.QDRANT_API_KEY;
  const opts: any = { url };
  if (apiKey) opts.apiKey = apiKey;
  return new QdrantClient(opts);
}

let clientInstance: any = null;
async function client() {
  if (!clientInstance) clientInstance = await getClient();
  return clientInstance;
}

// ============================================================================
// COLLECTION INIT
// ============================================================================

export async function initKBCollection(): Promise<void> {
  const qdrant = await client();

  try {
    const exists = await qdrant.collectionExists(COLLECTION);
    if (exists.exists) {
      logger.debug("KB Qdrant collection already exists");
      return;
    }

    await qdrant.createCollection(COLLECTION, {
      vectors: { size: LOCAL_EMBEDDING_DIMS, distance: "Cosine" },
    });

    // Payload indexes for pre-filtering
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "ventureId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "docType",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "status",
      field_schema: "keyword",
    });

    logger.info("Created KB Qdrant collection with indexes");
  } catch (error) {
    logger.error({ error }, "Failed to init KB Qdrant collection");
  }
}

// ============================================================================
// SYNC: DOC → QDRANT
// ============================================================================

export async function upsertDocToQdrant(doc: {
  id: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  content?: any;
  embedding?: string | null;
  ventureId?: string | null;
  type?: string | null;
  status?: string | null;
  keyPoints?: string[] | null;
  tags?: string[] | null;
  aiReady?: boolean | null;
  qualityScore?: number | null;
}): Promise<void> {
  if (!doc.embedding) return; // No embedding, nothing to index

  const vector = parseEmbedding(doc.embedding);
  if (!vector || vector.length !== LOCAL_EMBEDDING_DIMS) return;

  const qdrant = await client();
  const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : "");
  const excerpt = doc.summary || bodyText.slice(0, 500);

  await qdrant.upsert(COLLECTION, {
    wait: false, // Non-blocking
    points: [
      {
        id: doc.id,
        vector,
        payload: {
          title: doc.title,
          excerpt,
          ventureId: doc.ventureId || "none",
          docType: doc.type || "page",
          status: doc.status || "active",
          keyPoints: doc.keyPoints || [],
          tags: doc.tags || [],
          aiReady: doc.aiReady || false,
          qualityScore: doc.qualityScore || 0,
        },
      },
    ],
  });
}

export async function removeDocFromQdrant(docId: string): Promise<void> {
  try {
    const qdrant = await client();
    await qdrant.delete(COLLECTION, { points: [docId] });
  } catch (error) {
    logger.debug({ error, docId }, "Failed to remove doc from Qdrant KB (may not exist)");
  }
}

// ============================================================================
// SEARCH
// ============================================================================

export interface KBSearchResult {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  payload: Record<string, unknown>;
}

export async function searchKB(
  query: string,
  options: {
    limit?: number;
    minScore?: number;
    ventureId?: string;
  } = {}
): Promise<KBSearchResult[]> {
  const { limit = 10, minScore = 0.3, ventureId } = options;

  const queryEmb = await generateEmbedding(query);

  // Build filter
  const conditions: Array<Record<string, unknown>> = [];
  conditions.push({ key: "status", match: { value: "active" } });
  if (ventureId) {
    conditions.push({ key: "ventureId", match: { value: ventureId } });
  }

  const filter = conditions.length > 0 ? { must: conditions } : undefined;

  const qdrant = await client();
  const results = await qdrant.search(COLLECTION, {
    vector: queryEmb.embedding,
    limit,
    score_threshold: minScore,
    filter: filter as any,
    with_payload: true,
  });

  return results.map((r: any) => ({
    id: r.id as string,
    title: (r.payload?.title as string) || "",
    excerpt: (r.payload?.excerpt as string) || "",
    score: r.score,
    payload: r.payload as Record<string, unknown>,
  }));
}

// ============================================================================
// BULK SYNC (startup + on-demand)
// ============================================================================

export async function bulkSyncDocsToQdrant(): Promise<{ synced: number; skipped: number }> {
  try {
    const { storage } = await import("../storage");
    const docs = await storage.getDocs({ status: "active" });

    let synced = 0;
    let skipped = 0;

    // Batch in groups of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];

      for (const doc of batch) {
        if (!doc.embedding) {
          skipped++;
          continue;
        }

        const vector = parseEmbedding(doc.embedding as string);
        if (!vector || vector.length !== LOCAL_EMBEDDING_DIMS) {
          skipped++;
          continue;
        }

        const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : "");
        const excerpt = doc.summary || bodyText.slice(0, 500);

        points.push({
          id: doc.id,
          vector,
          payload: {
            title: doc.title,
            excerpt,
            ventureId: doc.ventureId || "none",
            docType: doc.type || "page",
            status: doc.status || "active",
            keyPoints: doc.keyPoints || [],
            tags: doc.tags || [],
            aiReady: doc.aiReady || false,
            qualityScore: doc.qualityScore || 0,
          },
        });
      }

      if (points.length > 0) {
        const qdrant = await client();
        await qdrant.upsert(COLLECTION, { wait: true, points });
        synced += points.length;
      }
    }

    logger.info({ synced, skipped }, "Bulk synced docs to Qdrant KB");
    return { synced, skipped };
  } catch (error) {
    logger.error({ error }, "Bulk sync to Qdrant KB failed");
    return { synced: 0, skipped: 0 };
  }
}

/**
 * Check if KB collection has data (for deciding whether to use Qdrant or fallback)
 */
export async function getKBCollectionCount(): Promise<number> {
  try {
    const qdrant = await client();
    const info = await qdrant.getCollection(COLLECTION);
    return info.points_count || 0;
  } catch {
    return 0;
  }
}
