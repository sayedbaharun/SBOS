/**
 * Context Memory Module - RAG Implementation
 *
 * This module provides RAG context injection and interaction tracking
 * for the AI assistant. Supports both keyword-based (Level 1) and
 * vector-based (Level 2) context retrieval.
 */

import type OpenAI from "openai";
import { storage } from "./storage";
import { logger } from "./logger";
import { searchVentureKnowledge, getCachedOrBuildContext } from "./venture-context-builder";
import type { Doc, Task } from "@shared/schema";

// Stop words to filter from queries
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
 * Context source types for RAG
 */
export interface ContextSource {
  type: 'doc' | 'task' | 'project' | 'teaching' | 'pattern' | 'venture';
  id: string;
  title: string;
  content: string;
  relevance: number;
  metadata?: Record<string, unknown>;
}

/**
 * Options for context injection
 */
export interface InjectContextOptions {
  ventureId?: string;
  projectId?: string;
  maxTokens?: number;
  includeHistory?: boolean;
  includeTeachings?: boolean;
  includeTasks?: boolean;
  useVectorSearch?: boolean;
  useMemorySystem?: boolean;
}

/**
 * Extract query terms from user message
 */
function extractQueryTerms(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Extract query text from the last user message
 */
function extractQueryFromMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): string {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];

  if (!lastUserMessage?.content) return '';

  if (typeof lastUserMessage.content === 'string') {
    return lastUserMessage.content;
  }

  // Handle array content (multimodal)
  return lastUserMessage.content
    .map(c => (c.type === 'text' ? c.text : ''))
    .join(' ');
}

/**
 * Search docs with enhanced relevance scoring
 */
async function searchDocsEnhanced(
  query: string,
  options: { ventureId?: string; limit?: number }
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  const queryTerms = extractQueryTerms(query);

  if (queryTerms.length === 0) return sources;

  try {
    // Get docs - filter by venture if provided — paginated to avoid holding full result set in memory
    const PAGE = 100;
    const allDocs: Awaited<ReturnType<typeof storage.getDocs>> = [];
    const baseFilter: Record<string, unknown> = { status: 'active' };
    if (options.ventureId) baseFilter.ventureId = options.ventureId;
    for (let offset = 0; ; offset += PAGE) {
      const batch = await storage.getDocs({ ...baseFilter, limit: PAGE, offset } as any);
      if (batch.length === 0) break;
      allDocs.push(...batch);
      if (batch.length < PAGE) break;
    }

    // Score each doc
    const scoredDocs = allDocs.map(doc => {
      let score = 0;
      const titleLower = doc.title.toLowerCase();
      const summaryLower = (doc.summary || '').toLowerCase();
      const keyPointsLower = ((doc.keyPoints as string[]) || []).join(' ').toLowerCase();
      const applicableWhenLower = (doc.applicableWhen || '').toLowerCase();
      const tagsLower = ((doc.tags as string[]) || []).join(' ').toLowerCase();
      const bodyLower = (doc.body || '').toLowerCase();

      for (const term of queryTerms) {
        // Weighted scoring
        if (titleLower.includes(term)) score += 5;
        if (summaryLower.includes(term)) score += 4;
        if (keyPointsLower.includes(term)) score += 3;
        if (applicableWhenLower.includes(term)) score += 3;
        if (tagsLower.includes(term)) score += 2;
        if (bodyLower.includes(term)) score += 1;
      }

      // Boost for AI-ready docs
      if (doc.aiReady) score *= 1.5;

      // Boost for high quality
      if (doc.qualityScore && doc.qualityScore > 80) score *= 1.2;

      return { doc, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 5);

    // Convert to ContextSource
    for (const { doc, score } of scoredDocs) {
      // Generate smart excerpt
      let excerpt = doc.summary || '';
      if (!excerpt && doc.body) {
        // Find context around first match
        const bodyLower = doc.body.toLowerCase();
        for (const term of queryTerms) {
          const idx = bodyLower.indexOf(term);
          if (idx >= 0) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(doc.body.length, idx + 300);
            excerpt = (start > 0 ? '...' : '') +
                     doc.body.slice(start, end) +
                     (end < doc.body.length ? '...' : '');
            break;
          }
        }
      }
      if (!excerpt) excerpt = doc.body?.slice(0, 300) || '';

      sources.push({
        type: 'doc',
        id: doc.id,
        title: doc.title,
        content: excerpt,
        relevance: score / 10, // Normalize to 0-1 range
        metadata: {
          docType: doc.type,
          keyPoints: doc.keyPoints,
          applicableWhen: doc.applicableWhen,
        },
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to search docs for context');
  }

  return sources;
}

/**
 * Search tasks with relevance scoring
 */
async function searchTasksEnhanced(
  query: string,
  options: { ventureId?: string; projectId?: string; limit?: number }
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];
  const queryTerms = extractQueryTerms(query);

  if (queryTerms.length === 0) return sources;

  try {
    // Get tasks
    const allTasks = await storage.getTasks({
      ventureId: options.ventureId,
      projectId: options.projectId,
    });

    // Score each task
    const scoredTasks = allTasks.map(task => {
      let score = 0;
      const titleLower = task.title.toLowerCase();
      const notesLower = (task.notes || '').toLowerCase();
      const tagsLower = (task.tags || '').toLowerCase();

      for (const term of queryTerms) {
        if (titleLower.includes(term)) score += 3;
        if (notesLower.includes(term)) score += 1;
        if (tagsLower.includes(term)) score += 2;
      }

      // Boost for high priority
      if (task.priority === 'P0') score *= 1.5;
      if (task.priority === 'P1') score *= 1.2;

      return { task, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 5);

    // Convert to ContextSource
    for (const { task, score } of scoredTasks) {
      sources.push({
        type: 'task',
        id: task.id,
        title: task.title,
        content: task.notes || '',
        relevance: score / 10,
        metadata: {
          status: task.status,
          priority: task.priority,
          type: task.type,
        },
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to search tasks for context');
  }

  return sources;
}

/**
 * Get AI teachings relevant to context
 */
async function getRelevantTeachings(
  options: { ventureId?: string; limit?: number }
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];

  try {
    // Get active teachings
    const teachings = await storage.getDocAiTeachings({
      ventureId: options.ventureId,
      isActive: true,
    });

    for (const teaching of teachings.slice(0, options.limit || 3)) {
      sources.push({
        type: 'teaching',
        id: teaching.id,
        title: `AI Teaching: ${teaching.teachingType}`,
        content: teaching.content,
        relevance: 0.8, // Teachings are always relevant
        metadata: {
          teachingType: teaching.teachingType,
          fieldName: teaching.fieldName,
        },
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to get AI teachings for context');
  }

  return sources;
}

/**
 * Build context string from sources, respecting token budget
 */
function buildContextString(
  sources: ContextSource[],
  maxTokens: number
): string {
  const maxChars = maxTokens * 4; // Rough approximation
  const lines: string[] = [];
  let charCount = 0;

  // Sort by relevance (highest first)
  const sortedSources = [...sources].sort((a, b) => b.relevance - a.relevance);

  for (const source of sortedSources) {
    const sourceHeader = `### ${source.type.toUpperCase()}: ${source.title}`;
    let sourceContent = source.content;

    // Truncate content if too long
    if (sourceContent.length > 500) {
      sourceContent = sourceContent.slice(0, 500) + '...';
    }

    // Add metadata if present
    let metadataStr = '';
    if (source.metadata) {
      if (source.type === 'doc' && source.metadata.keyPoints) {
        const keyPoints = source.metadata.keyPoints as string[];
        if (keyPoints.length > 0) {
          metadataStr = `\nKey points: ${keyPoints.slice(0, 3).join('; ')}`;
        }
      }
      if (source.type === 'task') {
        metadataStr = `\nStatus: ${source.metadata.status}, Priority: ${source.metadata.priority}`;
      }
    }

    const fullEntry = `${sourceHeader}\n${sourceContent}${metadataStr}\n`;

    // Check if adding this would exceed budget
    if (charCount + fullEntry.length > maxChars) {
      // Try to add at least the header
      if (charCount + sourceHeader.length + 50 < maxChars) {
        lines.push(`${sourceHeader}\n[Content truncated due to length]\n`);
      }
      break;
    }

    lines.push(fullEntry);
    charCount += fullEntry.length;
  }

  if (lines.length === 0) {
    return '';
  }

  return `The following context may be relevant to the user's question:\n\n${lines.join('\n')}`;
}

/**
 * Inject RAG context from user history into messages
 * This is the main entry point for context injection
 */
export async function injectContext(
  chatId: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: InjectContextOptions = {}
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const {
    ventureId,
    projectId,
    maxTokens = 4000,
    includeTeachings = true,
    includeTasks = true,
    useVectorSearch = true,
  } = options;

  // Extract query from last user message
  const query = extractQueryFromMessages(messages);
  if (!query) return messages;

  const sources: ContextSource[] = [];

  try {
    // Check for hybrid memory system (Qdrant + Pinecone)
    if (options.useMemorySystem) {
      try {
        const { retrieveAsContext } = await import('./memory/hybrid-retriever');
        const memoryContext = await retrieveAsContext(query, {
          limit: 5,
          min_score: 0.25,
          include_compacted: true,
          include_entities: true,
        });

        if (memoryContext) {
          sources.push({
            type: 'doc',
            id: 'memory-system',
            title: 'Memory System Context',
            content: memoryContext,
            relevance: 0.9,
          });
        }
      } catch (error) {
        logger.warn({ error }, 'Memory system retrieval failed, falling back');
      }
    }

    // Check for vector search (Level 2)
    if (useVectorSearch) {
      try {
        const { hybridSearch } = await import('./vector-search');
        const vectorResults = await hybridSearch(query, {
          ventureId,
          limit: 5,
          vectorWeight: 0.7,
        });

        for (const result of vectorResults) {
          sources.push({
            type: result.type === 'chunk' ? 'doc' : result.type,
            id: result.id,
            title: result.title,
            content: result.content,
            relevance: result.similarity,
            metadata: result.metadata,
          });
        }
      } catch (error) {
        // Fall back to keyword search if vector search fails
        logger.warn({ error }, 'Vector search failed, falling back to keyword search');
      }
    }

    // If no vector results or not using vector search, use keyword search
    if (sources.length === 0) {
      // Search docs
      const docSources = await searchDocsEnhanced(query, {
        ventureId,
        limit: 5,
      });
      sources.push(...docSources);

      // Search tasks if enabled
      if (includeTasks) {
        const taskSources = await searchTasksEnhanced(query, {
          ventureId,
          projectId,
          limit: 3,
        });
        sources.push(...taskSources);
      }
    }

    // Get AI teachings if enabled
    if (includeTeachings) {
      const teachingSources = await getRelevantTeachings({
        ventureId,
        limit: 3,
      });
      sources.push(...teachingSources);
    }

    // If we have a venture but no relevant sources, add venture context
    if (ventureId && sources.length === 0) {
      try {
        const ventureContext = await getCachedOrBuildContext(ventureId);
        if (ventureContext) {
          sources.push({
            type: 'venture',
            id: ventureId,
            title: 'Venture Context',
            content: ventureContext.slice(0, 2000),
            relevance: 0.5,
          });
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to get venture context');
      }
    }

    // Build context string
    const contextString = buildContextString(sources, maxTokens);

    if (!contextString) {
      return messages;
    }

    // Find or create system message to inject context
    const messagesCopy = [...messages];
    const systemMessageIndex = messagesCopy.findIndex(m => m.role === 'system');

    if (systemMessageIndex >= 0) {
      const systemMessage = messagesCopy[systemMessageIndex];
      if (typeof systemMessage.content === 'string') {
        messagesCopy[systemMessageIndex] = {
          ...systemMessage,
          content: `${systemMessage.content}\n\n## RELEVANT CONTEXT\n${contextString}`,
        };
      }
    } else {
      // Insert context as first message
      messagesCopy.unshift({
        role: 'system',
        content: `## RELEVANT CONTEXT\n${contextString}`,
      });
    }

    logger.debug({
      chatId,
      sourcesCount: sources.length,
      contextLength: contextString.length,
    }, 'Injected RAG context');

    return messagesCopy;
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to inject context');
    return messages;
  }
}

/**
 * Track interaction for pattern learning
 */
export async function trackInteraction(
  chatId: string,
  interactionType: string,
  actionType: string,
  userInput: string | null,
  aiResponse: string | null,
  metadata: Record<string, unknown>,
  success: boolean,
  modelUsed: string,
  tokensUsed: number
): Promise<void> {
  try {
    // Store as a system tracking message
    await storage.createChatMessage({
      role: 'system',
      content: JSON.stringify({
        type: 'interaction_tracking',
        interactionType,
        actionType,
        success,
        tokensUsed,
        timestamp: new Date().toISOString(),
      }),
      metadata: {
        model: modelUsed,
        tokensUsed,
        userInputLength: userInput?.length || 0,
        aiResponseLength: aiResponse?.length || 0,
        ...metadata,
      },
    });

    // Invalidate venture context cache if action modifies data
    if (metadata.ventureId && (
      actionType.includes('create') ||
      actionType.includes('update') ||
      actionType.includes('delete')
    )) {
      await storage.invalidateVentureContextCache(metadata.ventureId as string);
    }

    logger.debug({
      chatId,
      interactionType,
      actionType,
      success,
    }, 'Tracked interaction');
  } catch (error) {
    // Non-critical - just log
    logger.warn({ error, chatId }, 'Failed to track interaction');
  }
}

/**
 * Get context sources for debugging/display
 */
export async function getContextSources(
  query: string,
  options: InjectContextOptions = {}
): Promise<ContextSource[]> {
  const sources: ContextSource[] = [];

  // Search docs
  const docSources = await searchDocsEnhanced(query, {
    ventureId: options.ventureId,
    limit: 5,
  });
  sources.push(...docSources);

  // Search tasks
  if (options.includeTasks !== false) {
    const taskSources = await searchTasksEnhanced(query, {
      ventureId: options.ventureId,
      projectId: options.projectId,
      limit: 3,
    });
    sources.push(...taskSources);
  }

  return sources.sort((a, b) => b.relevance - a.relevance);
}
