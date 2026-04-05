/**
 * Document Chunking Service
 *
 * Splits long documents into smaller chunks for embedding.
 * Uses semantic boundaries (paragraphs, headers) when possible.
 */

import type { Doc } from "@shared/schema";

export interface Chunk {
  content: string;
  startOffset: number;
  endOffset: number;
  metadata: {
    section?: string;
    headings?: string[];
    isCodeBlock?: boolean;
  };
}

// Chunking configuration
const CHUNK_SIZE = 2500; // Target tokens (~10 000 chars) per chunk — Atomic pattern
const CHUNK_OVERLAP = 200; // Overlap characters for context continuity
const MIN_CHUNK_SIZE = 100; // Minimum chunk size (chars)
const MAX_CHUNK_SIZE = 10000; // Maximum chunk size (chars) — never exceed

/**
 * Split text into semantic blocks respecting markdown structure.
 * Blocks are: code fences (kept whole), headers, and paragraphs.
 * Code blocks are NEVER split even if large.
 */
function splitIntoBlocks(text: string): string[] {
  const blocks: string[] = [];
  const lines = text.split('\n');
  let currentBlock: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const isCodeFenceLine = /^```/.test(line);

    if (isCodeFenceLine && !inCodeFence) {
      // Flush current block before starting code fence
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      inCodeFence = true;
      currentBlock.push(line);
      continue;
    }

    if (isCodeFenceLine && inCodeFence) {
      // End of code fence — flush as single block
      currentBlock.push(line);
      blocks.push(currentBlock.join('\n'));
      currentBlock = [];
      inCodeFence = false;
      continue;
    }

    if (inCodeFence) {
      currentBlock.push(line);
      continue;
    }

    // Outside code fence: split on blank lines (paragraph boundaries)
    if (line.trim() === '') {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks.filter(b => b.trim().length > 0);
}

/**
 * Chunk a document into smaller pieces for embedding.
 * Respects markdown boundaries: headers, paragraphs, and code fences.
 * Code blocks are never split mid-fence (Atomic pattern).
 */
export function chunkDocument(doc: Doc): Chunk[] {
  const text = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');

  if (!text || text.length < MIN_CHUNK_SIZE) {
    return [{
      content: text || '',
      startOffset: 0,
      endOffset: text?.length || 0,
      metadata: {},
    }];
  }

  const blocks = splitIntoBlocks(text);
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStart = 0;
  let currentHeadings: string[] = [];
  let currentSection = '';
  let offset = 0;

  for (const block of blocks) {
    const headerMatch = block.match(/^(#{1,6})\s+(.+)$/m);
    if (headerMatch) {
      currentSection = headerMatch[2];
      currentHeadings = [headerMatch[2]];
    }

    const isCodeBlock = block.startsWith('```');
    const blockChars = block.length + 2; // +2 for \n\n separator
    const potentialLength = currentChunk.length + blockChars;

    // Never break a code block — always keep it atomic
    const mustKeepTogether = isCodeBlock;

    if (potentialLength > MAX_CHUNK_SIZE && !mustKeepTogether && currentChunk.length > MIN_CHUNK_SIZE) {
      // Force flush before this block
      chunks.push({
        content: currentChunk.trim(),
        startOffset: currentStart,
        endOffset: offset,
        metadata: {
          section: currentSection || undefined,
          headings: currentHeadings.length > 0 ? [...currentHeadings] : undefined,
        },
      });
      currentChunk = block;
      currentStart = offset;
    } else if (potentialLength > CHUNK_SIZE && !mustKeepTogether && currentChunk.length > MIN_CHUNK_SIZE) {
      // Soft target exceeded — flush and start new with overlap
      chunks.push({
        content: currentChunk.trim(),
        startOffset: currentStart,
        endOffset: offset,
        metadata: {
          section: currentSection || undefined,
          headings: currentHeadings.length > 0 ? [...currentHeadings] : undefined,
        },
      });
      // Carry overlap from end of flushed chunk
      const overlapText = currentChunk.length > CHUNK_OVERLAP
        ? currentChunk.slice(-CHUNK_OVERLAP)
        : currentChunk;
      currentChunk = overlapText + '\n\n' + block;
      currentStart = Math.max(0, offset - CHUNK_OVERLAP);
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + block;
    }

    offset += blockChars;
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      startOffset: currentStart,
      endOffset: offset,
      metadata: {
        section: currentSection || undefined,
        headings: currentHeadings.length > 0 ? [...currentHeadings] : undefined,
      },
    });
  }

  return chunks;
}

/**
 * Extract text from BlockNote JSON content
 */
export function extractTextFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';

  const texts: string[] = [];

  function processBlock(block: unknown): void {
    if (typeof block !== 'object' || block === null) return;

    const b = block as Record<string, unknown>;

    // Extract text from content array
    if (Array.isArray(b.content)) {
      for (const item of b.content) {
        if (typeof item === 'object' && item !== null) {
          const i = item as Record<string, unknown>;
          if (i.type === 'text' && typeof i.text === 'string') {
            texts.push(i.text);
          }
        }
      }
    }

    // Handle block type for formatting
    if (b.type === 'heading') {
      const level = (b.props as Record<string, unknown>)?.level || 1;
      texts.push('\n' + '#'.repeat(level as number) + ' ');
    } else if (b.type === 'paragraph') {
      texts.push('\n\n');
    } else if (b.type === 'bulletListItem') {
      texts.push('\n- ');
    } else if (b.type === 'numberedListItem') {
      texts.push('\n1. ');
    } else if (b.type === 'codeBlock') {
      texts.push('\n```\n');
    }

    // Handle nested children
    if (Array.isArray(b.children)) {
      for (const child of b.children) {
        processBlock(child);
      }
    }
  }

  for (const block of content) {
    processBlock(block);
  }

  return texts.join('').trim();
}

/**
 * Get the text that should be used for embedding a document
 * Prioritizes structured fields over raw content
 */
export function getDocEmbeddingText(doc: Doc): string {
  const parts: string[] = [];

  // Title is always included
  parts.push(doc.title);

  // Structured fields (highest priority for embeddings)
  if (doc.summary) {
    parts.push(doc.summary);
  }

  if (doc.keyPoints && Array.isArray(doc.keyPoints) && doc.keyPoints.length > 0) {
    parts.push('Key points: ' + (doc.keyPoints as string[]).join('. '));
  }

  if (doc.applicableWhen) {
    parts.push('Applicable when: ' + doc.applicableWhen);
  }

  // Tags
  if (doc.tags && Array.isArray(doc.tags) && doc.tags.length > 0) {
    parts.push('Tags: ' + (doc.tags as string[]).join(', '));
  }

  // Body content (truncated if too long)
  const bodyText = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');
  if (bodyText) {
    // Limit body to ~3000 chars to stay within embedding limits
    const truncatedBody = bodyText.length > 3000 ? bodyText.slice(0, 3000) + '...' : bodyText;
    parts.push(truncatedBody);
  }

  return parts.join('\n\n');
}

/**
 * Estimate token count for text (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Check if a document needs chunking
 */
export function needsChunking(doc: Doc): boolean {
  const text = doc.body || (doc.content ? extractTextFromBlocks(doc.content) : '');
  return text.length > CHUNK_SIZE * 1.5;
}
