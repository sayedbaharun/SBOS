/**
 * BM25 Search Engine
 *
 * Replaces simple keyword matching with proper BM25 scoring.
 * Field boosts: title 3x, summary 2x, body 1x.
 * Debounced rebuild (max every 30s) on doc mutations.
 */

import { logger } from "./logger";

// BM25 parameters
const K1 = 1.5;
const B = 0.75;

// Field boost weights
const FIELD_WEIGHTS = {
  title: 3.0,
  summary: 2.0,
  keyPoints: 1.5,
  tags: 1.5,
  body: 1.0,
};

interface BM25Document {
  id: string;
  title: string;
  fields: {
    title: string[];
    summary: string[];
    keyPoints: string[];
    tags: string[];
    body: string[];
  };
  totalTokens: number;
}

interface BM25Index {
  documents: BM25Document[];
  docFrequencies: Map<string, number>; // term → number of docs containing it
  avgDocLength: number;
  totalDocs: number;
  builtAt: number;
}

let currentIndex: BM25Index | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_REBUILD_INTERVAL_MS = 30000; // 30 seconds

// Stop words
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "under",
  "again", "further", "then", "once", "here", "there", "when", "where",
  "why", "how", "all", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "and", "but", "if", "or", "because", "until", "while",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "i", "me", "my", "you", "your", "he", "she", "it", "we", "they",
  "help", "want", "need", "please", "tell",
]);

/**
 * Tokenize text into stemmed terms
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Build BM25 index from document data
 */
export function buildBM25Index(
  docs: Array<{
    id: string;
    title: string;
    summary?: string | null;
    keyPoints?: string[] | null;
    tags?: string[] | null;
    body?: string | null;
  }>
): BM25Index {
  const documents: BM25Document[] = [];
  const docFrequencies = new Map<string, number>();
  let totalTokens = 0;

  for (const doc of docs) {
    const titleTokens = tokenize(doc.title);
    const summaryTokens = tokenize(doc.summary || "");
    const keyPointsTokens = tokenize((doc.keyPoints || []).join(" "));
    const tagsTokens = tokenize((doc.tags || []).join(" "));
    const bodyTokens = tokenize(doc.body || "");

    const allTokens = [
      ...titleTokens,
      ...summaryTokens,
      ...keyPointsTokens,
      ...tagsTokens,
      ...bodyTokens,
    ];

    const bm25Doc: BM25Document = {
      id: doc.id,
      title: doc.title,
      fields: {
        title: titleTokens,
        summary: summaryTokens,
        keyPoints: keyPointsTokens,
        tags: tagsTokens,
        body: bodyTokens,
      },
      totalTokens: allTokens.length,
    };

    documents.push(bm25Doc);
    totalTokens += allTokens.length;

    // Count unique terms per document for IDF
    const uniqueTerms = new Set(allTokens);
    for (const term of Array.from(uniqueTerms)) {
      docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
    }
  }

  const index: BM25Index = {
    documents,
    docFrequencies,
    avgDocLength: documents.length > 0 ? totalTokens / documents.length : 0,
    totalDocs: documents.length,
    builtAt: Date.now(),
  };

  currentIndex = index;
  logger.info({ docCount: documents.length }, "BM25 index built");
  return index;
}

/**
 * Calculate BM25 score for a single field
 */
function fieldBM25Score(
  queryTerms: string[],
  fieldTokens: string[],
  docLength: number,
  index: BM25Index
): number {
  let score = 0;

  // Count term frequencies in field
  const termFreqs = new Map<string, number>();
  for (const token of fieldTokens) {
    termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
  }

  for (const term of queryTerms) {
    const tf = termFreqs.get(term) || 0;
    if (tf === 0) continue;

    const df = index.docFrequencies.get(term) || 0;
    // IDF with smoothing
    const idf = Math.log(
      (index.totalDocs - df + 0.5) / (df + 0.5) + 1
    );

    // BM25 TF normalization
    const tfNorm =
      (tf * (K1 + 1)) /
      (tf + K1 * (1 - B + B * (docLength / index.avgDocLength)));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * Search documents using BM25 scoring with field boosts
 */
export function searchBM25(
  query: string,
  index?: BM25Index | null
): Array<{ id: string; title: string; score: number }> {
  const idx = index || currentIndex;
  if (!idx || idx.totalDocs === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: Array<{ id: string; title: string; score: number }> = [];

  for (const doc of idx.documents) {
    let totalScore = 0;

    // Score each field with its boost
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const fieldTokens = doc.fields[field as keyof typeof doc.fields];
      if (fieldTokens.length === 0) continue;

      const fieldScore = fieldBM25Score(
        queryTerms,
        fieldTokens,
        doc.totalTokens,
        idx
      );
      totalScore += fieldScore * weight;
    }

    if (totalScore > 0) {
      results.push({ id: doc.id, title: doc.title, score: totalScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Request a debounced index rebuild
 */
export function requestIndexRebuild(): void {
  if (rebuildTimer) return; // Already scheduled

  const timeSinceLastBuild = currentIndex
    ? Date.now() - currentIndex.builtAt
    : Infinity;

  if (timeSinceLastBuild < MIN_REBUILD_INTERVAL_MS) {
    rebuildTimer = setTimeout(async () => {
      rebuildTimer = null;
      await rebuildFromStorage();
    }, MIN_REBUILD_INTERVAL_MS - timeSinceLastBuild);
  } else {
    rebuildFromStorage().catch((err) =>
      logger.warn({ error: err.message }, "BM25 index rebuild failed")
    );
  }
}

/**
 * Rebuild index from storage
 */
async function rebuildFromStorage(): Promise<void> {
  try {
    const { storage } = await import("./storage");
    const { extractTextFromBlocks } = await import("./chunking");

    const docs = await storage.getDocs({ status: "active" });
    const indexDocs = docs.map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      keyPoints: doc.keyPoints as string[] | null,
      tags: doc.tags as string[] | null,
      body:
        doc.body ||
        (doc.content ? extractTextFromBlocks(doc.content) : ""),
    }));

    buildBM25Index(indexDocs);
  } catch (error: any) {
    logger.warn({ error: error.message }, "BM25 rebuild from storage failed");
  }
}

/**
 * Get current index (or build if none exists)
 */
export async function getOrBuildIndex(): Promise<BM25Index> {
  if (currentIndex) return currentIndex;
  await rebuildFromStorage();
  return currentIndex!;
}

/**
 * Lightweight reranker — zero-latency score adjustments.
 * Generic to accept any object with id, title, content, similarity.
 */
export function rerank<T extends { id: string; title: string; content: string; similarity: number }>(
  results: T[],
  query: string
): T[] {
  const queryLower = query.toLowerCase();
  const queryTerms = tokenize(query);

  for (const result of results) {
    let boost = 0;
    const titleLower = result.title.toLowerCase();
    const contentLower = result.content.toLowerCase();

    // Exact phrase match in title → +0.15
    if (titleLower.includes(queryLower)) {
      boost += 0.15;
    }

    // All query terms present in content → +0.10
    if (queryTerms.length > 0 && queryTerms.every((t) => contentLower.includes(t))) {
      boost += 0.10;
    }

    // Term proximity: all terms within 100 chars → +0.08
    if (queryTerms.length > 1) {
      const positions = queryTerms.map((t) => contentLower.indexOf(t)).filter((p) => p >= 0);
      if (positions.length === queryTerms.length) {
        const span = Math.max(...positions) - Math.min(...positions);
        if (span < 100) {
          boost += 0.08;
        }
      }
    }

    result.similarity += boost;
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}
