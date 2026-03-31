import { google, drive_v3 } from 'googleapis';
import { retryGoogleAPI } from './retry-utils';
import { logger } from './logger';
import { Readable } from 'stream';

// OAuth2 client with refresh token (uses same credentials as Calendar if available)
function createOAuth2Client() {
  // Try Drive-specific credentials first, then fall back to Calendar credentials
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive OAuth credentials not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN (or use existing GOOGLE_CALENDAR_* credentials with Drive scope)');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const oauth2Client = createOAuth2Client();
  return google.drive({ version: 'v3', auth: oauth2Client });
}

// SB-OS folder name in Drive
const SBOS_ROOT_FOLDER = 'SB-OS';
const KNOWLEDGE_BASE_FOLDER = 'Knowledge Base';

// Cache for folder IDs
let sbosFolderId: string | null = null;
let knowledgeBaseFolderId: string | null = null;

/**
 * Find or create the SB-OS root folder in Drive
 */
export async function getOrCreateSBOSFolder(): Promise<string> {
  if (sbosFolderId) return sbosFolderId;

  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    // Search for existing folder
    const searchResponse = await drive.files.list({
      q: `name='${SBOS_ROOT_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      sbosFolderId = searchResponse.data.files[0].id!;
      logger.info({ folderId: sbosFolderId }, 'Found existing SB-OS folder');
      return sbosFolderId;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: SBOS_ROOT_FOLDER,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'SB-OS - Personal Operating System',
      },
      fields: 'id',
    });

    sbosFolderId = createResponse.data.id!;
    logger.info({ folderId: sbosFolderId }, 'Created SB-OS folder');
    return sbosFolderId;
  });
}

/**
 * Find or create the Knowledge Base folder inside SB-OS
 */
export async function getOrCreateKnowledgeBaseFolder(): Promise<string> {
  if (knowledgeBaseFolderId) return knowledgeBaseFolderId;

  const parentId = await getOrCreateSBOSFolder();

  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    // Search for existing folder
    const searchResponse = await drive.files.list({
      q: `name='${KNOWLEDGE_BASE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      knowledgeBaseFolderId = searchResponse.data.files[0].id!;
      logger.info({ folderId: knowledgeBaseFolderId }, 'Found existing Knowledge Base folder');
      return knowledgeBaseFolderId;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: KNOWLEDGE_BASE_FOLDER,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
        description: 'SB-OS Knowledge Base - SOPs, Playbooks, and Documentation',
      },
      fields: 'id',
    });

    knowledgeBaseFolderId = createResponse.data.id!;
    logger.info({ folderId: knowledgeBaseFolderId }, 'Created Knowledge Base folder');
    return knowledgeBaseFolderId;
  });
}

// Maps doc type → Drive sub-folder name
export const DOC_TYPE_TO_FOLDER: Record<string, string> = {
  spec: 'Specs',
  tech_doc: 'Specs',
  sop: 'SOPs',
  process: 'SOPs',
  playbook: 'Playbooks',
  strategy: 'Playbooks',
  research: 'Research',
  meeting_notes: 'Research',
  reference: 'Reference',
  template: 'Templates',
  page: 'Reference',
};

// Cache for _Global folder ID
let globalFolderId: string | null = null;

/**
 * Find or create the _Global folder inside Knowledge Base (for venture-agnostic docs)
 */
export async function getOrCreateGlobalFolder(): Promise<string> {
  if (globalFolderId) return globalFolderId;

  const parentId = await getOrCreateKnowledgeBaseFolder();

  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const searchResponse = await drive.files.list({
      q: `name='_Global' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      globalFolderId = searchResponse.data.files[0].id!;
      return globalFolderId;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name: '_Global',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
        description: 'Venture-agnostic docs: agent templates, SOPs, reference',
      },
      fields: 'id',
    });

    globalFolderId = createResponse.data.id!;
    logger.info({ folderId: globalFolderId }, 'Created _Global folder');
    return globalFolderId;
  });
}

/**
 * Find or create a type sub-folder inside a parent folder (e.g. Specs, SOPs, Uploads)
 */
export async function getOrCreateSubFolder(parentFolderId: string, subFolderName: string): Promise<string> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const searchResponse = await drive.files.list({
      q: `name='${subFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id!;
    }

    const createResponse = await drive.files.create({
      requestBody: {
        name: subFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
    });

    logger.info({ subFolderName, parentFolderId, folderId: createResponse.data.id }, 'Created sub-folder');
    return createResponse.data.id!;
  });
}

/**
 * Resolve the target Drive folder for a doc: {Venture}/Uploads/ or _Global/Uploads/
 */
export async function getOrCreateUploadsFolder(ventureName?: string): Promise<string> {
  const parentFolderId = ventureName
    ? await createVentureFolder(ventureName)
    : await getOrCreateGlobalFolder();
  return getOrCreateSubFolder(parentFolderId, 'Uploads');
}

/**
 * Resolve the target Drive folder for a doc by type: {Venture}/{TypeFolder}/ or _Global/{TypeFolder}/
 */
export async function getOrCreateDocTypeFolder(ventureName: string | null, docType: string): Promise<string> {
  const folderName = DOC_TYPE_TO_FOLDER[docType] || 'Reference';
  const parentFolderId = ventureName
    ? await createVentureFolder(ventureName)
    : await getOrCreateGlobalFolder();
  return getOrCreateSubFolder(parentFolderId, folderName);
}

/**
 * Create a venture folder inside Knowledge Base
 */
export async function createVentureFolder(ventureName: string): Promise<string> {
  const parentId = await getOrCreateKnowledgeBaseFolder();

  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    // Check if folder already exists
    const searchResponse = await drive.files.list({
      q: `name='${ventureName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id!;
    }

    // Create new folder
    const createResponse = await drive.files.create({
      requestBody: {
        name: ventureName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });

    logger.info({ ventureName, folderId: createResponse.data.id }, 'Created venture folder');
    return createResponse.data.id!;
  });
}

/**
 * List files in a folder
 */
export async function listFiles(
  folderId?: string,
  options: {
    mimeType?: string;
    orderBy?: string;
    pageSize?: number;
    pageToken?: string;
    searchQuery?: string;
  } = {}
): Promise<{
  files: drive_v3.Schema$File[];
  nextPageToken?: string;
}> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();
    const targetFolderId = folderId || await getOrCreateKnowledgeBaseFolder();

    let query = `'${targetFolderId}' in parents and trashed=false`;

    if (options.mimeType) {
      query += ` and mimeType='${options.mimeType}'`;
    }

    if (options.searchQuery) {
      query += ` and fullText contains '${options.searchQuery}'`;
    }

    const response = await drive.files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, iconLink, thumbnailLink, parents, description)',
      orderBy: options.orderBy || 'modifiedTime desc',
      pageSize: options.pageSize || 50,
      pageToken: options.pageToken,
      spaces: 'drive',
    });

    logger.debug({ folderId: targetFolderId, count: response.data.files?.length || 0 }, 'Listed Drive files');
    return {
      files: response.data.files || [],
      nextPageToken: response.data.nextPageToken || undefined,
    };
  });
}

/**
 * Get file metadata
 */
export async function getFile(fileId: string): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, description, starred',
    });

    return response.data;
  });
}

/**
 * Create a Google Doc from markdown content
 */
export async function createDoc(
  name: string,
  content: string,
  parentFolderId?: string,
  description?: string
): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();
    const folderId = parentFolderId || await getOrCreateKnowledgeBaseFolder();

    // Create a Google Doc
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
        description,
      },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
      fields: 'id, name, mimeType, webViewLink, createdTime, modifiedTime',
    });

    logger.info({ name, fileId: response.data.id }, 'Created Google Doc');
    return response.data;
  });
}

/**
 * Create a folder in Drive
 */
export async function createFolder(
  name: string,
  parentFolderId?: string,
  description?: string
): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();
    const folderId = parentFolderId || await getOrCreateKnowledgeBaseFolder();

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [folderId],
        description,
      },
      fields: 'id, name, mimeType, webViewLink, createdTime, modifiedTime',
    });

    logger.info({ name, folderId: response.data.id }, 'Created folder');
    return response.data;
  });
}

/**
 * Upload a file to Drive
 */
export async function uploadFile(
  name: string,
  content: Buffer | string | Readable,
  mimeType: string,
  parentFolderId?: string,
  description?: string
): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();
    const folderId = parentFolderId || await getOrCreateKnowledgeBaseFolder();

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType,
        parents: [folderId],
        description,
      },
      media: {
        mimeType,
        body: content instanceof Buffer ? Readable.from(content) : content,
      },
      fields: 'id, name, mimeType, size, webViewLink, webContentLink, createdTime, modifiedTime, thumbnailLink',
    });

    logger.info({ name, fileId: response.data.id, mimeType }, 'Uploaded file');
    return response.data;
  });
}

/**
 * Update file content
 */
export async function updateFileContent(
  fileId: string,
  content: Buffer | string | Readable,
  mimeType: string
): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.update({
      fileId,
      media: {
        mimeType,
        body: content instanceof Buffer ? Readable.from(content) : content,
      },
      fields: 'id, name, mimeType, size, webViewLink, modifiedTime',
    });

    logger.info({ fileId }, 'Updated file content');
    return response.data;
  });
}

/**
 * Update file metadata (name, description, etc.)
 */
export async function updateFileMetadata(
  fileId: string,
  updates: {
    name?: string;
    description?: string;
    starred?: boolean;
  }
): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.update({
      fileId,
      requestBody: updates,
      fields: 'id, name, mimeType, webViewLink, modifiedTime, description, starred',
    });

    logger.info({ fileId, updates: Object.keys(updates) }, 'Updated file metadata');
    return response.data;
  });
}

/**
 * Move file to a different folder
 */
export async function moveFile(fileId: string, newParentId: string): Promise<drive_v3.Schema$File> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    // Get current parents
    const file = await drive.files.get({
      fileId,
      fields: 'parents',
    });

    const previousParents = file.data.parents?.join(',') || '';

    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents,
      fields: 'id, name, parents, webViewLink',
    });

    logger.info({ fileId, newParentId }, 'Moved file');
    return response.data;
  });
}

/**
 * Delete a file (move to trash)
 */
export async function deleteFile(fileId: string): Promise<void> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    await drive.files.update({
      fileId,
      requestBody: {
        trashed: true,
      },
    });

    logger.info({ fileId }, 'Trashed file');
  });
}

/**
 * Permanently delete a file
 */
export async function permanentlyDeleteFile(fileId: string): Promise<void> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    await drive.files.delete({
      fileId,
    });

    logger.info({ fileId }, 'Permanently deleted file');
  });
}

/**
 * Download file content
 */
export async function downloadFile(fileId: string): Promise<Buffer> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.get({
      fileId,
      alt: 'media',
    }, {
      responseType: 'arraybuffer',
    });

    logger.debug({ fileId }, 'Downloaded file');
    return Buffer.from(response.data as ArrayBuffer);
  });
}

/**
 * Export a Google Doc as a specific format
 */
export async function exportDoc(
  fileId: string,
  mimeType: 'text/plain' | 'text/html' | 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
): Promise<Buffer> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.export({
      fileId,
      mimeType,
    }, {
      responseType: 'arraybuffer',
    });

    logger.debug({ fileId, mimeType }, 'Exported Google Doc');
    return Buffer.from(response.data as ArrayBuffer);
  });
}

/**
 * Search across all files in Drive
 */
export async function searchFiles(
  query: string,
  options: {
    pageSize?: number;
    pageToken?: string;
  } = {}
): Promise<{
  files: drive_v3.Schema$File[];
  nextPageToken?: string;
}> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.files.list({
      q: `fullText contains '${query}' and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, iconLink, thumbnailLink, parents)',
      orderBy: 'modifiedTime desc',
      pageSize: options.pageSize || 20,
      pageToken: options.pageToken,
      spaces: 'drive',
    });

    logger.debug({ query, count: response.data.files?.length || 0 }, 'Searched Drive files');
    return {
      files: response.data.files || [],
      nextPageToken: response.data.nextPageToken || undefined,
    };
  });
}

/**
 * Get storage quota info
 */
export async function getStorageQuota(): Promise<{
  limit: number;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}> {
  return retryGoogleAPI(async () => {
    const drive = await getDriveClient();

    const response = await drive.about.get({
      fields: 'storageQuota',
    });

    const quota = response.data.storageQuota || {};
    return {
      limit: parseInt(quota.limit || '0', 10),
      usage: parseInt(quota.usage || '0', 10),
      usageInDrive: parseInt(quota.usageInDrive || '0', 10),
      usageInDriveTrash: parseInt(quota.usageInDriveTrash || '0', 10),
    };
  });
}

/**
 * Check if Drive is configured and accessible
 */
export async function checkDriveConnection(): Promise<{
  configured: boolean;
  connected: boolean;
  error?: string;
}> {
  try {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return { configured: false, connected: false };
    }

    // Try to get quota to verify connection
    await getStorageQuota();
    return { configured: true, connected: true };
  } catch (error: any) {
    logger.error({ error }, 'Drive connection check failed');
    return {
      configured: true,
      connected: false,
      error: error.message,
    };
  }
}
