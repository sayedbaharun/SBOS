/**
 * Knowledge Files Routes
 * File uploads with AI reading capability, linked to ventures
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertKnowledgeFileSchema } from "@shared/schema";
import { z } from "zod";
import {
  extractFromFile,
  reanalyzeFile,
  isSupportedMimeType,
  getMaxFileSize,
  SUPPORTED_MIME_TYPES,
} from "../file-extraction";

const router = Router();

// Configure multer for memory storage (we'll upload to Drive)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    if (isSupportedMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Supported types: ${SUPPORTED_MIME_TYPES.join(", ")}`));
    }
  },
});

// Check if Google Drive is configured
function isDriveConfigured(): boolean {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  return !!(clientId && clientSecret && refreshToken);
}

// GET /supported-types - List supported file types
router.get("/supported-types", (req: Request, res: Response) => {
  res.json({
    mimeTypes: SUPPORTED_MIME_TYPES,
    categories: [
      { value: "document", label: "Document" },
      { value: "strategy", label: "Strategy" },
      { value: "playbook", label: "Playbook" },
      { value: "notes", label: "Notes" },
      { value: "research", label: "Research" },
      { value: "reference", label: "Reference" },
      { value: "template", label: "Template" },
      { value: "image", label: "Image" },
      { value: "spreadsheet", label: "Spreadsheet" },
      { value: "presentation", label: "Presentation" },
      { value: "other", label: "Other" },
    ],
  });
});

// GET / - List knowledge files
router.get("/", async (req: Request, res: Response) => {
  try {
    const { ventureId, projectId, taskId, docId, category, processingStatus, includeInAiContext, limit } = req.query;

    const files = await storage.getKnowledgeFiles({
      ventureId: ventureId as string | undefined,
      projectId: projectId as string | undefined,
      taskId: taskId as string | undefined,
      docId: docId as string | undefined,
      category: category as string | undefined,
      processingStatus: processingStatus as string | undefined,
      includeInAiContext: includeInAiContext === "true" ? true : includeInAiContext === "false" ? false : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json(files);
  } catch (error) {
    logger.error({ error }, "Error listing knowledge files");
    res.status(500).json({ error: "Failed to list knowledge files" });
  }
});

// GET /:id - Get single knowledge file
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }
    res.json(file);
  } catch (error) {
    logger.error({ error }, "Error fetching knowledge file");
    res.status(500).json({ error: "Failed to fetch knowledge file" });
  }
});

// GET /:id/content - Get raw file content for viewing/embedding
router.get("/:id/content", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    // If we have base64 data, serve it directly
    if (file.base64Data) {
      const buffer = Buffer.from(file.base64Data, "base64");
      res.set({
        "Content-Type": file.mimeType,
        "Content-Length": buffer.length,
        "Content-Disposition": `inline; filename="${file.originalFileName}"`,
        "Cache-Control": "private, max-age=3600",
      });
      return res.send(buffer);
    }

    // If stored in Google Drive, fetch and serve
    if (file.storageType === "google_drive" && file.googleDriveFileId) {
      try {
        const { downloadFile } = await import("../google-drive");
        const buffer = await downloadFile(file.googleDriveFileId);

        res.set({
          "Content-Type": file.mimeType,
          "Content-Length": buffer.length,
          "Content-Disposition": `inline; filename="${file.originalFileName}"`,
          "Cache-Control": "private, max-age=3600",
        });
        return res.send(buffer);
      } catch (driveError) {
        logger.error({ driveError, fileId: file.id }, "Failed to fetch from Drive");
        return res.status(500).json({ error: "Failed to fetch file from Google Drive" });
      }
    }

    return res.status(404).json({ error: "File content not available" });
  } catch (error) {
    logger.error({ error }, "Error fetching knowledge file content");
    res.status(500).json({ error: "Failed to fetch knowledge file content" });
  }
});

// GET /:id/preview - Get preview URL or embedded content
router.get("/:id/preview", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    const isImage = file.mimeType.startsWith("image/");
    const isPdf = file.mimeType === "application/pdf";
    const isText = file.mimeType.startsWith("text/") ||
                   file.mimeType === "application/json";

    // For images, return base64 data URL
    if (isImage && file.base64Data) {
      return res.json({
        type: "image",
        dataUrl: `data:${file.mimeType};base64,${file.base64Data}`,
        mimeType: file.mimeType,
      });
    }

    // For text files, return the content
    if (isText && file.base64Data) {
      const content = Buffer.from(file.base64Data, "base64").toString("utf-8");
      return res.json({
        type: "text",
        content,
        mimeType: file.mimeType,
      });
    }

    // For PDFs and other files, return URLs for embedding
    return res.json({
      type: isPdf ? "pdf" : "other",
      contentUrl: `/api/knowledge-files/${file.id}/content`,
      googleDriveUrl: file.googleDriveUrl,
      mimeType: file.mimeType,
      canEmbed: isImage || isPdf,
    });
  } catch (error) {
    logger.error({ error }, "Error generating preview");
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// POST / - Upload a new knowledge file
router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const {
      name,
      description,
      category,
      ventureId,
      projectId,
      taskId,
      docId,
      tags,
      notes,
      includeInAiContext,
      aiContextPriority,
      skipAiExtraction,
    } = req.body;

    // Validate ventureId is provided
    if (!ventureId) {
      return res.status(400).json({ error: "ventureId is required" });
    }

    const file = req.file;
    const fileName = name || file.originalname;

    logger.info({
      fileName,
      mimeType: file.mimetype,
      size: file.size,
      ventureId,
    }, "Uploading knowledge file");

    // STEP 1: Store file immediately as base64 (fast, reliable)
    const base64Data = file.buffer.toString("base64");

    // STEP 2: Create database record immediately
    const knowledgeFile = await storage.createKnowledgeFile({
      name: fileName,
      description,
      category: category || "document",
      ventureId,
      projectId: projectId || null,
      taskId: taskId || null,
      docId: docId || null,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageType: "base64",
      base64Data,
      processingStatus: skipAiExtraction === "true" ? "completed" : "pending",
      includeInAiContext: includeInAiContext !== "false",
      aiContextPriority: aiContextPriority ? parseInt(aiContextPriority) : 0,
      tags,
      notes,
    });

    logger.info({ fileId: knowledgeFile.id, fileName }, "Knowledge file saved");

    // STEP 3: Return success immediately
    res.status(201).json(knowledgeFile);

    // STEP 4: Background tasks (after response sent)
    // - Upload to Google Drive if configured
    // - AI extraction if not skipped
    if (skipAiExtraction !== "true") {
      processFileAsync(knowledgeFile.id, file.buffer, file.mimetype);
    }

    // Try Google Drive upload in background
    if (isDriveConfigured()) {
      uploadToDriveAsync(knowledgeFile.id, file.originalname, file.buffer, file.mimetype, ventureId, description);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, errorMessage, ventureId: req.body?.ventureId }, "Error uploading knowledge file");
    if (error instanceof Error && error.message.includes("Unsupported file type")) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to upload knowledge file", details: errorMessage });
    }
  }
});

// Background file processing
async function processFileAsync(fileId: string, buffer: Buffer, mimeType: string) {
  try {
    // Mark as processing
    await storage.updateKnowledgeFile(fileId, {
      processingStatus: "processing",
    });

    logger.info({ fileId, mimeType }, "Starting file extraction");

    // Check if OpenRouter API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      logger.warn({ fileId }, "OPENROUTER_API_KEY not set, skipping AI extraction");
      await storage.updateKnowledgeFile(fileId, {
        processingStatus: "completed",
        extractedText: "[AI extraction skipped - API key not configured]",
        processedAt: new Date(),
      });
      return;
    }

    // Extract text and metadata
    const result = await extractFromFile(buffer, mimeType, { generateSummary: true });

    // Update with extracted data
    await storage.updateKnowledgeFile(fileId, {
      processingStatus: "completed",
      extractedText: result.extractedText,
      aiSummary: result.summary,
      aiTags: result.tags || [],
      aiMetadata: result.metadata as any,
      processedAt: new Date(),
    });

    logger.info({ fileId, textLength: result.extractedText.length }, "File extraction completed");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error, errorMessage, fileId }, "File extraction failed");

    try {
      // Mark as failed
      await storage.updateKnowledgeFile(fileId, {
        processingStatus: "failed",
        aiMetadata: {
          errorMessage,
        } as any,
      });
    } catch (updateError) {
      logger.error({ updateError, fileId }, "Failed to update file status to failed");
    }
  }
}

// Background Google Drive upload
async function uploadToDriveAsync(
  fileId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
  ventureId: string,
  description?: string
) {
  try {
    const {
      uploadFile,
      getOrCreateUploadsFolder,
    } = await import("../google-drive");

    // Place file in {Venture}/Uploads/ or _Global/Uploads/
    const venture = await storage.getVenture(ventureId);
    const parentFolderId = await getOrCreateUploadsFolder(venture?.name);

    // Upload to Google Drive
    const driveFile = await uploadFile(
      fileName,
      buffer,
      mimeType,
      parentFolderId,
      description
    );

    // Update record with Drive info
    await storage.updateKnowledgeFile(fileId, {
      storageType: "google_drive",
      googleDriveFileId: driveFile.id || undefined,
      googleDriveUrl: driveFile.webViewLink || undefined,
      // Clear base64 data to save space now that it's in Drive
      base64Data: null,
    });

    logger.info({ fileId, driveFileId: driveFile.id }, "File uploaded to Google Drive");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error, errorMessage, fileId }, "Background Drive upload failed - file remains in base64 storage");
    // Don't fail - file is still accessible via base64
  }
}

// POST /:id/reprocess - Reprocess a file (re-extract text and metadata)
router.post("/:id/reprocess", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    // Get the file content
    let buffer: Buffer;

    if (file.storageType === "base64" && file.base64Data) {
      buffer = Buffer.from(file.base64Data, "base64");
    } else if (file.storageType === "google_drive" && file.googleDriveFileId) {
      if (!isDriveConfigured()) {
        return res.status(503).json({ error: "Google Drive not configured" });
      }
      const { downloadFile } = await import("../google-drive");
      buffer = await downloadFile(file.googleDriveFileId);
    } else {
      return res.status(400).json({ error: "No file content available for reprocessing" });
    }

    // Reset status
    await storage.updateKnowledgeFile(file.id, {
      processingStatus: "pending",
    });

    // Process in background
    processFileAsync(file.id, buffer, file.mimeType);

    res.json({ message: "Reprocessing started", fileId: file.id });
  } catch (error) {
    logger.error({ error }, "Error reprocessing knowledge file");
    res.status(500).json({ error: "Failed to reprocess knowledge file" });
  }
});

// POST /:id/analyze - On-demand AI analysis
router.post("/:id/analyze", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    if (!file.extractedText) {
      return res.status(400).json({ error: "File has not been processed yet. No extracted text available." });
    }

    const { prompt, detailed } = req.body;

    logger.info({ fileId: file.id, prompt, detailed }, "Starting on-demand file analysis");

    // Run AI analysis
    const analysis = await reanalyzeFile(file.extractedText, {
      prompt,
      detailed: detailed === true,
    });

    // Update the file with new analysis
    await storage.updateKnowledgeFile(file.id, {
      aiSummary: analysis.summary,
      aiTags: analysis.tags,
      aiMetadata: {
        ...file.aiMetadata,
        ...analysis.metadata,
        lastAnalyzedAt: new Date().toISOString(),
        analysisPrompt: prompt,
      } as any,
    });

    res.json({
      fileId: file.id,
      summary: analysis.summary,
      tags: analysis.tags,
      analysis: analysis.analysis,
      metadata: analysis.metadata,
    });
  } catch (error) {
    logger.error({ error }, "Error analyzing knowledge file");
    res.status(500).json({ error: "Failed to analyze knowledge file" });
  }
});

// PATCH /:id - Update knowledge file metadata
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    const {
      name,
      description,
      category,
      tags,
      notes,
      includeInAiContext,
      aiContextPriority,
    } = req.body;

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = tags;
    if (notes !== undefined) updates.notes = notes;
    if (includeInAiContext !== undefined) updates.includeInAiContext = includeInAiContext;
    if (aiContextPriority !== undefined) updates.aiContextPriority = aiContextPriority;

    const updated = await storage.updateKnowledgeFile(req.params.id, updates);
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error updating knowledge file");
    res.status(500).json({ error: "Failed to update knowledge file" });
  }
});

// DELETE /:id - Delete knowledge file
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    // Delete from Google Drive if applicable
    if (file.storageType === "google_drive" && file.googleDriveFileId && isDriveConfigured()) {
      try {
        const { deleteFile } = await import("../google-drive");
        await deleteFile(file.googleDriveFileId);
        logger.info({ driveFileId: file.googleDriveFileId }, "Deleted file from Google Drive");
      } catch (driveError) {
        logger.warn({ error: driveError }, "Failed to delete file from Google Drive");
        // Continue with database deletion
      }
    }

    await storage.deleteKnowledgeFile(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting knowledge file");
    res.status(500).json({ error: "Failed to delete knowledge file" });
  }
});

// GET /:id/content - Get file content (extracted text)
router.get("/:id/content", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    if (file.processingStatus !== "completed") {
      return res.status(400).json({
        error: "File not yet processed",
        status: file.processingStatus,
      });
    }

    res.json({
      id: file.id,
      name: file.name,
      extractedText: file.extractedText,
      summary: file.aiSummary,
      tags: file.aiTags,
      metadata: file.aiMetadata,
    });
  } catch (error) {
    logger.error({ error }, "Error getting knowledge file content");
    res.status(500).json({ error: "Failed to get knowledge file content" });
  }
});

// GET /:id/download - Download original file
router.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const file = await storage.getKnowledgeFile(req.params.id);
    if (!file) {
      return res.status(404).json({ error: "Knowledge file not found" });
    }

    let buffer: Buffer;

    if (file.storageType === "base64" && file.base64Data) {
      buffer = Buffer.from(file.base64Data, "base64");
    } else if (file.storageType === "google_drive" && file.googleDriveFileId) {
      if (!isDriveConfigured()) {
        return res.status(503).json({ error: "Google Drive not configured" });
      }
      const { downloadFile } = await import("../google-drive");
      buffer = await downloadFile(file.googleDriveFileId);
    } else {
      return res.status(404).json({ error: "File content not available" });
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.originalFileName}"`);
    res.send(buffer);
  } catch (error) {
    logger.error({ error }, "Error downloading knowledge file");
    res.status(500).json({ error: "Failed to download knowledge file" });
  }
});

// GET /venture/:ventureId/context - Get files for AI context
router.get("/venture/:ventureId/context", async (req: Request, res: Response) => {
  try {
    const { ventureId } = req.params;
    const { limit } = req.query;

    const files = await storage.getKnowledgeFilesForAiContext(ventureId, {
      limit: limit ? parseInt(limit as string) : undefined,
    });

    // Return condensed data suitable for AI context
    const context = files.map(file => ({
      id: file.id,
      name: file.name,
      category: file.category,
      summary: file.aiSummary,
      extractedText: file.extractedText,
      tags: file.aiTags,
      keyTopics: file.aiMetadata?.keyTopics,
    }));

    res.json(context);
  } catch (error) {
    logger.error({ error }, "Error getting knowledge files for AI context");
    res.status(500).json({ error: "Failed to get knowledge files for AI context" });
  }
});

export default router;
