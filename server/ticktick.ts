/**
 * TickTick Integration Module
 *
 * Syncs tasks from a designated TickTick inbox list to SB-OS capture items.
 * Uses TickTick Open API v1 with OAuth Bearer token authentication.
 *
 * API Docs: https://developer.ticktick.com/api#/openapi
 */

import { retryWithBackoff, isRetryableError } from './retry-utils';
import { logger } from './logger';

// TickTick API Configuration
const TICKTICK_API_BASE = 'https://api.ticktick.com/open/v1';

// TickTick task priority mapping
export const TICKTICK_PRIORITY = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 3,
  HIGH: 5,
} as const;

// TickTick task status
export const TICKTICK_STATUS = {
  NORMAL: 0,      // Active/incomplete
  COMPLETED: 2,   // Completed
} as const;

// Types for TickTick API responses
export interface TickTickProject {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number;
  closed?: boolean;
  groupId?: string;
  viewMode?: string;
  permission?: string;
  kind?: string;
}

export interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  startDate?: string;
  dueDate?: string;
  priority: number;
  status: number;
  completedTime?: string;
  createdTime?: string;
  modifiedTime?: string;
  tags?: string[];
  timeZone?: string;
  isAllDay?: boolean;
  sortOrder?: number;
}

export interface TickTickSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
  items: Array<{
    tickTickId: string;
    title: string;
    captureId?: string;
  }>;
}

/**
 * Get the TickTick access token from environment
 */
function getAccessToken(): string {
  const token = process.env.TICKTICK_ACCESS_TOKEN;
  if (!token) {
    throw new Error('TICKTICK_ACCESS_TOKEN not configured');
  }
  return token;
}

/**
 * Make an authenticated request to the TickTick API
 */
async function tickTickRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAccessToken();
  const url = `${TICKTICK_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const error = new Error(`TickTick API error: ${response.status} - ${errorText}`);
    (error as any).response = { status: response.status };
    throw error;
  }

  return response.json();
}

/**
 * Retry wrapper for TickTick API calls
 */
export async function retryTickTickAPI<T>(fn: () => Promise<T>): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 8000,
    backoffMultiplier: 2,
    shouldRetry: isRetryableError,
  });
}

/**
 * Get all projects (lists) from TickTick
 */
export async function getProjects(): Promise<TickTickProject[]> {
  return retryTickTickAPI(async () => {
    const projects = await tickTickRequest<TickTickProject[]>('/project');
    logger.debug({ count: projects.length }, 'Retrieved TickTick projects');
    return projects;
  });
}

/**
 * Get a specific project by ID
 */
export async function getProject(projectId: string): Promise<TickTickProject> {
  return retryTickTickAPI(async () => {
    const project = await tickTickRequest<TickTickProject>(`/project/${projectId}`);
    logger.debug({ projectId, name: project.name }, 'Retrieved TickTick project');
    return project;
  });
}

/**
 * Get all tasks from a specific project
 */
export async function getProjectTasks(projectId: string): Promise<TickTickTask[]> {
  return retryTickTickAPI(async () => {
    const data = await tickTickRequest<{ tasks: TickTickTask[] }>(
      `/project/${projectId}/data`
    );
    logger.debug({ projectId, count: data.tasks?.length || 0 }, 'Retrieved TickTick tasks');
    return data.tasks || [];
  });
}

/**
 * Get a specific task by project ID and task ID
 */
export async function getTask(projectId: string, taskId: string): Promise<TickTickTask> {
  return retryTickTickAPI(async () => {
    const task = await tickTickRequest<TickTickTask>(`/project/${projectId}/task/${taskId}`);
    logger.debug({ projectId, taskId, title: task.title }, 'Retrieved TickTick task');
    return task;
  });
}

/**
 * Create a new task in TickTick
 */
export async function createTask(task: {
  title: string;
  projectId: string;
  content?: string;
  dueDate?: string;
  priority?: number;
  tags?: string[];
}): Promise<TickTickTask> {
  return retryTickTickAPI(async () => {
    const newTask = await tickTickRequest<TickTickTask>('/task', {
      method: 'POST',
      body: JSON.stringify({
        title: task.title,
        projectId: task.projectId,
        content: task.content,
        dueDate: task.dueDate,
        priority: task.priority ?? TICKTICK_PRIORITY.NONE,
        tags: task.tags,
      }),
    });
    logger.info({ taskId: newTask.id, title: newTask.title }, 'Created TickTick task');
    return newTask;
  });
}

/**
 * Update an existing task in TickTick
 */
export async function updateTask(
  taskId: string,
  projectId: string,
  updates: Partial<{
    title: string;
    content: string;
    dueDate: string;
    priority: number;
    status: number;
    tags: string[];
  }>
): Promise<TickTickTask> {
  return retryTickTickAPI(async () => {
    const updatedTask = await tickTickRequest<TickTickTask>(`/task/${taskId}`, {
      method: 'POST',
      body: JSON.stringify({
        id: taskId,
        projectId,
        ...updates,
      }),
    });
    logger.info({ taskId, updates: Object.keys(updates) }, 'Updated TickTick task');
    return updatedTask;
  });
}

/**
 * Complete a task in TickTick
 */
export async function completeTask(projectId: string, taskId: string): Promise<void> {
  return retryTickTickAPI(async () => {
    await tickTickRequest(`/project/${projectId}/task/${taskId}/complete`, {
      method: 'POST',
    });
    logger.info({ projectId, taskId }, 'Completed TickTick task');
  });
}

/**
 * Delete a task from TickTick
 */
export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  return retryTickTickAPI(async () => {
    await tickTickRequest(`/project/${projectId}/task/${taskId}`, {
      method: 'DELETE',
    });
    logger.info({ projectId, taskId }, 'Deleted TickTick task');
  });
}

/**
 * Find a project by name (case-insensitive)
 */
export async function findProjectByName(name: string): Promise<TickTickProject | null> {
  const projects = await getProjects();
  const normalizedName = name.toLowerCase().trim();
  return projects.find(p => p.name.toLowerCase().trim() === normalizedName) || null;
}

/**
 * Get or create the SB-OS Inbox project in TickTick
 */
export async function getOrCreateInboxProject(inboxName: string = 'SB-OS Inbox'): Promise<TickTickProject> {
  // First try to find existing project
  const existing = await findProjectByName(inboxName);
  if (existing) {
    logger.debug({ projectId: existing.id, name: existing.name }, 'Found existing TickTick inbox');
    return existing;
  }

  // Create new inbox project
  return retryTickTickAPI(async () => {
    const project = await tickTickRequest<TickTickProject>('/project', {
      method: 'POST',
      body: JSON.stringify({
        name: inboxName,
        color: '#4A90D9', // Blue color
        viewMode: 'list',
        kind: 'TASK',
      }),
    });
    logger.info({ projectId: project.id, name: project.name }, 'Created TickTick inbox project');
    return project;
  });
}

/**
 * Map TickTick priority to SB-OS capture type
 */
function mapPriorityToType(priority: number): 'task' | 'idea' {
  // High priority items are likely tasks, others could be ideas
  return priority >= TICKTICK_PRIORITY.MEDIUM ? 'task' : 'idea';
}

/**
 * Extract tags from TickTick task title (format: #tag)
 */
export function extractTagsFromTitle(title: string): { cleanTitle: string; tags: string[] } {
  const tagRegex = /#(\w+)/g;
  const tags: string[] = [];
  let match;

  while ((match = tagRegex.exec(title)) !== null) {
    tags.push(match[1]);
  }

  const cleanTitle = title.replace(tagRegex, '').trim();
  return { cleanTitle, tags };
}

/**
 * Convert a TickTick task to SB-OS capture item format
 */
export function tickTickTaskToCaptureItem(task: TickTickTask): {
  title: string;
  type: 'task' | 'idea' | 'note' | 'link' | 'question';
  source: 'ticktick';
  notes: string | null;
  externalId: string;
} {
  const { cleanTitle, tags } = extractTagsFromTitle(task.title);

  // Build notes from content, description, and tags
  const notesParts: string[] = [];
  if (task.content) notesParts.push(task.content);
  if (task.desc) notesParts.push(task.desc);
  if (tags.length > 0) notesParts.push(`Tags: ${tags.join(', ')}`);
  if (task.dueDate) notesParts.push(`Due: ${task.dueDate}`);

  return {
    title: cleanTitle || task.title,
    type: mapPriorityToType(task.priority),
    source: 'ticktick',
    notes: notesParts.length > 0 ? notesParts.join('\n\n') : null,
    externalId: `ticktick:${task.id}`,
  };
}

/**
 * Check if TickTick connection is working
 */
export async function checkConnection(): Promise<{
  connected: boolean;
  error?: string;
  projectCount?: number;
}> {
  try {
    const projects = await getProjects();
    return {
      connected: true,
      projectCount: projects.length,
    };
  } catch (error: any) {
    return {
      connected: false,
      error: error.message || 'Connection failed',
    };
  }
}

/**
 * Get inbox project ID from environment or find by name
 */
export async function getInboxProjectId(): Promise<string | null> {
  // Check if specific inbox project ID is configured
  const configuredId = process.env.TICKTICK_INBOX_PROJECT_ID;
  if (configuredId) {
    return configuredId;
  }

  // Try to find the SB-OS Inbox project
  const inboxName = process.env.TICKTICK_INBOX_NAME || 'SB-OS Inbox';
  const project = await findProjectByName(inboxName);
  return project?.id || null;
}
