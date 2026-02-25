/**
 * Vector Search Service
 *
 * Provides semantic search capabilities using embeddings.
 * Supports both pure vector search and hybrid (keyword + vector) search.
 */

import { storage } from "./storage";
import { logger } from "./logger";
import { generateEmbedding, cosineSimilarity, parseEmbedding } from "./embeddings";
import { extractTextFromBlocks } from "./chunking";
import { getOrBuildIndex, searchBM25, rerank } from "./bm25";
import type { Doc } from "@shared/schema";

/**
 * Search result structure
 */
export interface VectorSearchResult {
  type: 'doc' | 'chunk' | 'task';
  id: string;
  title: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Search options
 */
export interface VectorSearchOptions {
  ventureId?: string;
  projectId?: string;
  limit?: number;
  minSimilarity?: number;
  includeChunks?: boolean;
}

/**
 * Hybrid search options
 */
export interface HybridSearchOptions extends VectorSearchOptions {
  vectorWeight?: number; // 0-1, weight given to vector search (1 - this = keyword weight)
}

// Stop words for keyword extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they',
  'help', 'want', 'need', 'please', 'can', 'could', 'would', 'tell',
]);

/**
 * Extract keywords from text for scoring
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Calculate keyword match score
 */
function keywordScore(queryTerms: string[], text: string): number {
  const textLower = text.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) {
      score += 1;
    }
  }
  return queryTerms.length > 0 ? score / queryTerms.length : 0;
}

/**
 * Vector search on documents — uses Qdrant ANN index when available,
 * falls back to JS cosine loop for backwards compatibility.
 */
export async function vectorSearchDocs(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    ventureId,
    limit = 10,
    minSimilarity = 0.3,
    includeChunks = true,
  } = options;

  try {
    // Try Qdrant-backed search first (O(log n) ANN instead of O(n) JS loop)
    try {
      const { searchKB, getKBCollectionCount } = await import("./memory/kb-qdrant");
      const count = await getKBCollectionCount();

      if (count > 0) {
        const qdrantResults = await searchKB(query, {
          limit: limit * 2,
          minScore: minSimilarity,
          ventureId: ventureId ? String(ventureId) : undefined,
        });

        const results: VectorSearchResult[] = qdrantResults.map((r) => ({
          type: 'doc' as const,
          id: r.id,
          title: r.title,
          content: r.excerpt,
          similarity: r.score,
          metadata: {
            docType: r.payload.docType,
            keyPoints: r.payload.keyPoints,
            aiReady: r.payload.aiReady,
          },
        }));

        // Still include chunk search for granularity
        if (includeChunks) {
          const queryResult = await generateEmbedding(query);
          const chunkResults = await vectorSearchChunks(query, queryResult.embedding, {
            ventureId,
            minSimilarity,
            limit: limit * 2,
          });
          results.push(...chunkResults);
        }

        return deduplicateResults(results).slice(0, limit);
      }
    } catch (qdrantErr) {
      logger.debug({ error: qdrantErr }, "Qdrant KB search unavailable, falling back to JS loop");
    }

    // Fallback: JS cosine loop (O(n) — works but doesn't scale)
    const results: VectorSearchResult[] = [];
    const queryResult = await generateEmbedding(query);
    const queryEmbedding = queryResult.embedding;

    const docsFilter: { ventureId?: string; status?: string } = { status: 'active' };
    if (ventureId) docsFilter.ventureId = ventureId;

    const docs = await storage.getDocs(docsFilter);
    const docsWithEmbeddings = docs.filter(d => d.embedding);

    for (const doc of docsWithEmbeddings) {
      const docEmbedding = parseEmbedding(doc.embedding as string);
      if (!docEmbedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, docEmbedding);
      if (similarity < minSimilarity) continue;

      const summary = doc.summary || '';
      const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');
      const excerpt = summary || bodyText.slice(0, 300);

      results.push({
        type: 'doc',
        id: doc.id,
        title: doc.title,
        content: excerpt,
        similarity,
        metadata: {
          docType: doc.type,
          keyPoints: doc.keyPoints,
          applicableWhen: doc.applicableWhen,
          aiReady: doc.aiReady,
        },
      });
    }

    if (includeChunks) {
      const chunkResults = await vectorSearchChunks(query, queryEmbedding, {
        ventureId,
        minSimilarity,
        limit: limit * 2,
      });
      results.push(...chunkResults);
    }

    return deduplicateResults(results).slice(0, limit);
  } catch (error) {
    logger.error({ error, query }, 'Vector search failed');
    throw error;
  }
}

/**
 * Deduplicate search results, keeping highest-scoring per doc
 */
function deduplicateResults(results: VectorSearchResult[]): VectorSearchResult[] {
  results.sort((a, b) => b.similarity - a.similarity);

  const seen = new Map<string, VectorSearchResult>();
  const deduped: VectorSearchResult[] = [];

  for (const result of results) {
    const docId = result.type === 'chunk'
      ? (result.metadata?.docId as string)
      : result.id;

    if (!seen.has(docId)) {
      seen.set(docId, result);
      deduped.push(result);
    } else {
      const existing = seen.get(docId)!;
      if (result.similarity > existing.similarity) {
        const idx = deduped.indexOf(existing);
        if (idx >= 0) {
          deduped[idx] = result;
          seen.set(docId, result);
        }
      }
    }
  }

  return deduped;
}

/**
 * Vector search on document chunks
 */
async function vectorSearchChunks(
  query: string,
  queryEmbedding: number[],
  options: {
    ventureId?: string;
    minSimilarity?: number;
    limit?: number;
  }
): Promise<VectorSearchResult[]> {
  const { minSimilarity = 0.3, limit = 10 } = options;
  const results: VectorSearchResult[] = [];

  try {
    // Get all chunks with embeddings
    const chunks = await storage.getDocChunksWithEmbeddings(options.ventureId);

    for (const chunk of chunks) {
      if (!chunk.embedding) continue;

      const chunkEmbedding = parseEmbedding(chunk.embedding);
      if (!chunkEmbedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
      if (similarity < minSimilarity) continue;

      results.push({
        type: 'chunk',
        id: chunk.id,
        title: chunk.docTitle || `Chunk from ${chunk.docId}`,
        content: chunk.content,
        similarity,
        metadata: {
          docId: chunk.docId,
          chunkIndex: chunk.chunkIndex,
          section: chunk.metadata?.section,
          headings: chunk.metadata?.headings,
        },
      });
    }

    // Sort by similarity and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  } catch (error) {
    logger.warn({ error }, 'Chunk search failed');
    return [];
  }
}

/**
 * Keyword search on documents using BM25 scoring
 */
export async function keywordSearchDocs(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const { ventureId, limit = 10 } = options;

  try {
    const index = await getOrBuildIndex();
    const bm25Results = searchBM25(query, index);

    if (bm25Results.length === 0) return [];

    // Normalize BM25 scores to 0-1 range
    const maxScore = bm25Results[0].score;
    const normalizedResults = bm25Results.map((r) => ({
      ...r,
      score: maxScore > 0 ? r.score / maxScore : 0,
    }));

    // Fetch doc details for top results
    const docsFilter: { ventureId?: string; status?: string } = { status: 'active' };
    if (ventureId) docsFilter.ventureId = ventureId;
    const docs = await storage.getDocs(docsFilter);
    const docMap = new Map(docs.map((d) => [d.id, d]));

    // Filter by venture if needed
    const ventureFilteredIds = ventureId
      ? new Set(docs.filter((d) => String(d.ventureId) === ventureId).map((d) => d.id))
      : null;

    const results: VectorSearchResult[] = [];
    for (const bm25Result of normalizedResults) {
      if (ventureFilteredIds && !ventureFilteredIds.has(bm25Result.id)) continue;

      const doc = docMap.get(bm25Result.id);
      if (!doc) continue;

      const summary = doc.summary || '';
      const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');
      const excerpt = summary || bodyText.slice(0, 300);

      results.push({
        type: 'doc',
        id: doc.id,
        title: doc.title,
        content: excerpt,
        similarity: bm25Result.score,
        metadata: {
          docType: doc.type,
          keyPoints: doc.keyPoints,
          applicableWhen: (doc as any).applicableWhen,
        },
      });

      if (results.length >= limit) break;
    }

    return results;
  } catch (error) {
    logger.error({ error, query }, 'BM25 keyword search failed');
    throw error;
  }
}

/**
 * Hybrid search combining vector and keyword approaches
 * Uses reciprocal rank fusion for combining results
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    vectorWeight = 0.7,
    limit = 10,
    ...searchOptions
  } = options;

  const keywordWeight = 1 - vectorWeight;

  try {
    // Run both searches in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      vectorSearchDocs(query, { ...searchOptions, limit: limit * 2 }).catch(() => []),
      keywordSearchDocs(query, { ...searchOptions, limit: limit * 2 }).catch(() => []),
    ]);

    // If one search fails completely, return the other
    if (vectorResults.length === 0 && keywordResults.length === 0) {
      return [];
    }
    if (vectorResults.length === 0) {
      return keywordResults.slice(0, limit);
    }
    if (keywordResults.length === 0) {
      return vectorResults.slice(0, limit);
    }

    // Combine using reciprocal rank fusion
    const scoreMap = new Map<string, {
      result: VectorSearchResult;
      vectorRank: number;
      keywordRank: number;
      combinedScore: number;
    }>();

    // Process vector results
    vectorResults.forEach((result, index) => {
      const key = result.type === 'chunk'
        ? `chunk:${result.id}`
        : `${result.type}:${result.id}`;

      scoreMap.set(key, {
        result,
        vectorRank: index + 1,
        keywordRank: Infinity,
        combinedScore: 0,
      });
    });

    // Process keyword results
    keywordResults.forEach((result, index) => {
      const key = result.type === 'chunk'
        ? `chunk:${result.id}`
        : `${result.type}:${result.id}`;

      if (scoreMap.has(key)) {
        scoreMap.get(key)!.keywordRank = index + 1;
      } else {
        scoreMap.set(key, {
          result,
          vectorRank: Infinity,
          keywordRank: index + 1,
          combinedScore: 0,
        });
      }
    });

    // Calculate combined scores using RRF formula
    const k = 60; // RRF constant
    for (const entry of Array.from(scoreMap.values())) {
      const vectorScore = entry.vectorRank === Infinity
        ? 0
        : vectorWeight / (k + entry.vectorRank);
      const keywordScore = entry.keywordRank === Infinity
        ? 0
        : keywordWeight / (k + entry.keywordRank);

      entry.combinedScore = vectorScore + keywordScore;

      // Update similarity to reflect combined score
      entry.result.similarity = entry.combinedScore;
    }

    // Sort by combined score and return
    const sorted = Array.from(scoreMap.values())
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .map(entry => entry.result)
      .slice(0, limit);

    // Normalize similarity scores to 0-1 range
    if (sorted.length > 0) {
      const maxScore = sorted[0].similarity;
      if (maxScore > 0) {
        for (const result of sorted) {
          result.similarity = result.similarity / maxScore;
        }
      }
    }

    // Apply lightweight reranking (zero-latency adjustments)
    return rerank(sorted, query);
  } catch (error) {
    logger.error({ error, query }, 'Hybrid search failed');
    throw error;
  }
}

/**
 * Search for similar documents given a document ID
 */
export async function findSimilarDocs(
  docId: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const { limit = 5, minSimilarity = 0.5 } = options;

  try {
    // Get the source document
    const sourceDoc = await storage.getDoc(docId);
    if (!sourceDoc) {
      throw new Error(`Document not found: ${docId}`);
    }

    // Check if doc has embedding
    if (!sourceDoc.embedding) {
      // Fall back to keyword search using title and summary
      const searchText = `${sourceDoc.title} ${sourceDoc.summary || ''}`;
      return keywordSearchDocs(searchText, { ...options, limit });
    }

    const sourceEmbedding = parseEmbedding(sourceDoc.embedding as string);
    if (!sourceEmbedding) {
      throw new Error('Invalid embedding for source document');
    }

    // Get all other docs with embeddings
    const docs = await storage.getDocs({ status: 'active' });
    const results: VectorSearchResult[] = [];

    for (const doc of docs) {
      if (doc.id === docId) continue; // Skip self
      if (!doc.embedding) continue;

      const docEmbedding = parseEmbedding(doc.embedding as string);
      if (!docEmbedding) continue;

      const similarity = cosineSimilarity(sourceEmbedding, docEmbedding);
      if (similarity < minSimilarity) continue;

      const summary = doc.summary || '';
      const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');
      const excerpt = summary || bodyText.slice(0, 300);

      results.push({
        type: 'doc',
        id: doc.id,
        title: doc.title,
        content: excerpt,
        similarity,
        metadata: {
          docType: doc.type,
          keyPoints: doc.keyPoints,
        },
      });
    }

    // Sort by similarity and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  } catch (error) {
    logger.error({ error, docId }, 'Find similar docs failed');
    throw error;
  }
}

/**
 * Check if vector search is available (embeddings exist)
 */
export async function isVectorSearchAvailable(): Promise<{
  available: boolean;
  embeddedDocsCount: number;
  totalDocsCount: number;
}> {
  try {
    const docs = await storage.getDocs({ status: 'active' });
    const embeddedCount = docs.filter(d => d.embedding).length;

    return {
      available: embeddedCount > 0,
      embeddedDocsCount: embeddedCount,
      totalDocsCount: docs.length,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to check vector search availability');
    return {
      available: false,
      embeddedDocsCount: 0,
      totalDocsCount: 0,
    };
  }
}

// Re-export extractTextFromBlocks for use in context-memory
export { extractTextFromBlocks } from "./chunking";
