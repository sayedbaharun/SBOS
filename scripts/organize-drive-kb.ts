/**
 * One-time script: Organize Google Drive Knowledge Base folder
 *
 * What it does:
 * 1. Lists and deletes all loose docs + test folder at KB root
 * 2. Creates venture folders + type sub-folders
 * 3. Moves Health folder under Life Admin/
 * 4. Re-syncs all 43 DB docs to Drive in the correct location
 * 5. Updates external_id on each doc record
 *
 * Run with: npx tsx scripts/organize-drive-kb.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import pkg from "pg";
const { Pool } = pkg;

import {
  getDriveClient,
  getOrCreateKnowledgeBaseFolder,
  createVentureFolder,
  getOrCreateGlobalFolder,
  getOrCreateSubFolder,
  DOC_TYPE_TO_FOLDER,
} from "../server/google-drive";

// ─── Config ────────────────────────────────────────────────────────────────────

const HEALTH_FOLDER_ID = "1Oh8r-HygmAi8BrLSNsXUDvklsCyLLAW3";

// Venture sub-folder lists
const VENTURE_SUB_FOLDERS: Record<string, string[]> = {
  "SyntheLIQ AI": ["Specs", "SOPs", "Research", "Uploads"],
  "Trading": ["Playbooks", "Research", "Uploads"],
  "Operations": ["Specs", "SOPs", "Reference", "Templates", "Uploads"],
  "Life Admin": ["Personal", "Uploads"],   // Health sub-folder is the moved folder
  "Content Intelligence": ["Specs", "Research", "Uploads"],
};

const GLOBAL_SUB_FOLDERS = ["Specs", "SOPs", "Playbooks", "Reference", "Research", "Templates", "Uploads"];

// ─── DB ────────────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function getDocsWithVentures(): Promise<Array<{
  id: string;
  title: string;
  type: string;
  body: string | null;
  venture_name: string | null;
  external_id: string | null;
}>> {
  const result = await pool.query(`
    SELECT d.id, d.title, d.type, d.body, v.name as venture_name, d.external_id
    FROM docs d
    LEFT JOIN ventures v ON d.venture_id = v.id
    ORDER BY d.created_at
  `);
  return result.rows;
}

async function updateDocExternalId(docId: string, externalId: string) {
  await pool.query("UPDATE docs SET external_id = $1 WHERE id = $2", [externalId, docId]);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function deleteFile(fileId: string, name: string) {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId });
  console.log(`  🗑  Deleted: ${name}`);
}

async function trashFile(fileId: string, name: string) {
  const drive = await getDriveClient();
  await drive.files.update({ fileId, requestBody: { trashed: true } });
  console.log(`  🗑  Trashed: ${name}`);
}

async function listKBRootContents(kbFolderId: string) {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${kbFolderId}' in parents and trashed=false`,
    fields: "files(id, name, mimeType)",
    spaces: "drive",
    pageSize: 100,
  });
  return res.data.files || [];
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🗂  Organizing SB-OS Knowledge Base on Google Drive\n");

  const kbFolderId = await getOrCreateKnowledgeBaseFolder();
  console.log(`📁 Knowledge Base folder: ${kbFolderId}\n`);

  // ── Step 1: Delete loose files + test folder ────────────────────────────────
  console.log("── Step 1: Cleaning up KB root ──────────────────────────────");
  const rootItems = await listKBRootContents(kbFolderId);
  console.log(`  Found ${rootItems.length} items at KB root`);

  for (const item of rootItems) {
    if (item.id === HEALTH_FOLDER_ID) {
      console.log(`  ⏭  Skipping Health folder (will move later)`);
      continue;
    }
    if (item.name === "Revolv Group" && item.mimeType === "application/vnd.google-apps.folder") {
      // Check if empty
      const drive = await getDriveClient();
      const check = await drive.files.list({
        q: `'${item.id}' in parents and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });
      if ((check.data.files?.length || 0) === 0) {
        await trashFile(item.id!, item.name!);
      } else {
        console.log(`  ⏭  Keeping Revolv Group folder (has contents)`);
      }
      continue;
    }
    // Delete everything else (loose docs + test folder)
    await trashFile(item.id!, item.name!);
  }

  // ── Step 2: Create venture folders + type sub-folders ──────────────────────
  console.log("\n── Step 2: Creating folder structure ────────────────────────");

  const ventureFolderIds: Record<string, string> = {};

  for (const [ventureName, subFolders] of Object.entries(VENTURE_SUB_FOLDERS)) {
    const ventureId = await createVentureFolder(ventureName);
    ventureFolderIds[ventureName] = ventureId;
    console.log(`  📁 ${ventureName}/`);

    for (const sub of subFolders) {
      await getOrCreateSubFolder(ventureId, sub);
      console.log(`      📁 ${sub}/`);
    }
  }

  // Create _Global folder + sub-folders
  const globalId = await getOrCreateGlobalFolder();
  ventureFolderIds["_Global"] = globalId;
  console.log(`  📁 _Global/`);
  for (const sub of GLOBAL_SUB_FOLDERS) {
    await getOrCreateSubFolder(globalId, sub);
    console.log(`      📁 ${sub}/`);
  }

  // ── Step 3: Move Health folder under Life Admin ────────────────────────────
  console.log("\n── Step 3: Moving Health → Life Admin/ ──────────────────────");
  const lifeAdminId = ventureFolderIds["Life Admin"];

  const drive = await getDriveClient();
  const healthFile = await drive.files.get({ fileId: HEALTH_FOLDER_ID, fields: "parents" });
  const prevParents = healthFile.data.parents?.join(",") || kbFolderId;

  await drive.files.update({
    fileId: HEALTH_FOLDER_ID,
    addParents: lifeAdminId,
    removeParents: prevParents,
    fields: "id, name, parents",
  });
  console.log(`  ✅ Health folder moved under Life Admin/`);

  // ── Step 4: Re-sync all docs to Drive ─────────────────────────────────────
  console.log("\n── Step 4: Syncing docs to Drive ────────────────────────────");
  const docs = await getDocsWithVentures();
  console.log(`  ${docs.length} docs to sync\n`);

  for (const doc of docs) {
    const ventureName = doc.venture_name;
    const folderName = DOC_TYPE_TO_FOLDER[doc.type] || "Reference";

    // Get parent folder ID
    const parentVentureFolderId = ventureName
      ? ventureFolderIds[ventureName] || await createVentureFolder(ventureName)
      : globalId;
    const targetFolderId = await getOrCreateSubFolder(parentVentureFolderId, folderName);

    // Create Google Doc
    const content = doc.body || `# ${doc.title}\n\n(No content yet)`;
    const driveFile = await drive.files.create({
      requestBody: {
        name: doc.title,
        mimeType: "application/vnd.google-apps.document",
        parents: [targetFolderId],
        description: `SB-OS doc: ${doc.type}`,
      },
      media: {
        mimeType: "text/plain",
        body: content,
      },
      fields: "id, name, webViewLink",
    });

    await updateDocExternalId(doc.id, driveFile.data.id!);

    const location = ventureName ? `${ventureName}/${folderName}` : `_Global/${folderName}`;
    console.log(`  ✅ [${location}] ${doc.title}`);
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  console.log("\n✅ Knowledge Base organized successfully!");
  console.log(`   ${docs.length} docs synced to Drive`);
  console.log("   Health folder moved under Life Admin/");
  console.log("   All venture + type sub-folders created\n");

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  pool.end();
  process.exit(1);
});
