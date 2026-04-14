/**
 * Telegram Topics Provisioning Script
 *
 * Creates forum topics in the SB-OS supergroup via the Telegram Bot API
 * and seeds the telegram_topic_map table with the returned thread IDs.
 *
 * Prerequisites:
 *   1. Enable "Topics" on your supergroup:
 *      Telegram app → group settings → Topics → enable
 *   2. Ensure TELEGRAM_BOT_TOKEN and AUTHORIZED_TELEGRAM_CHAT_IDS are set
 *
 * Usage:
 *   npx tsx server/scripts/provision-telegram-topics.ts
 *
 * Idempotent: skips topics that already have a row in telegram_topic_map.
 * Safe to re-run if provisioning is interrupted.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and } from "drizzle-orm";
import { telegramTopicMap, ventures } from "../../shared/schema";
import { TELEGRAM_TOPICS, type TopicDefinition } from "../config/telegram-topics";

// ── Config ────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("❌  TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}
if (CHAT_IDS.length === 0) {
  console.error("❌  AUTHORIZED_TELEGRAM_CHAT_IDS is not set");
  process.exit(1);
}

// Use the first chat ID (should be the supergroup)
const CHAT_ID = CHAT_IDS[0];

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function tgPost(method: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!json.ok) {
    throw new Error(`Telegram API error (${method}): ${JSON.stringify(json)}`);
  }
  return json.result;
}

async function createForumTopic(name: string, iconColor?: number): Promise<number> {
  const payload: Record<string, any> = {
    chat_id: CHAT_ID,
    name,
  };
  if (iconColor !== undefined) {
    payload.icon_color = iconColor;
  }
  const result = await tgPost("createForumTopic", payload);
  return result.message_thread_id as number;
}

// ── Venture slug → UUID resolver ──────────────────────────────────────────────

async function resolveVentureId(
  db: ReturnType<typeof drizzle>,
  ventureSlug: string
): Promise<string | null> {
  try {
    // Ventures don't have a "slug" column — match by name (case-insensitive)
    const rows = await (db as any)
      .select({ id: ventures.id, name: ventures.name })
      .from(ventures);

    const normalized = ventureSlug.toLowerCase().replace(/[-_]/g, " ");
    const match = rows.find((r: any) =>
      r.name?.toLowerCase().replace(/[-_]/g, " ").includes(normalized)
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("❌  DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool);

  console.log(`\n🚀  Provisioning Telegram topics for chat ${CHAT_ID}\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const topic of TELEGRAM_TOPICS) {
    try {
      // Check if this topicKey already exists
      const existing = await (db as any)
        .select()
        .from(telegramTopicMap)
        .where(eq(telegramTopicMap.topicKey, topic.topicKey))
        .limit(1);

      if (existing.length > 0) {
        console.log(`  ⏭  ${topic.name} (${topic.topicKey}) — already provisioned (threadId: ${existing[0].threadId})`);
        skipped++;
        continue;
      }

      // Create the topic in Telegram
      console.log(`  ⏳  Creating ${topic.name}...`);
      const threadId = await createForumTopic(topic.name, topic.iconColor);

      // Resolve ventureId if ventureSlug is set
      let ventureId: string | null = null;
      if (topic.ventureSlug) {
        ventureId = await resolveVentureId(db, topic.ventureSlug);
        if (!ventureId) {
          console.warn(`     ⚠  ventureSlug "${topic.ventureSlug}" not found in DB — skipping ventureId link`);
        }
      }

      // Insert into DB
      await (db as any).insert(telegramTopicMap).values({
        chatId: CHAT_ID,
        topicKey: topic.topicKey,
        threadId,
        ventureId: ventureId ?? undefined,
        eventTypes: topic.eventTypes,
        iconColor: topic.iconColor ?? undefined,
        active: true,
      });

      console.log(`  ✅  ${topic.name} created (threadId: ${threadId})`);
      created++;

      // Rate-limit: 1 topic per second to avoid 429s
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err: any) {
      console.error(`  ❌  ${topic.name} — ${err.message}`);
      errors++;
    }
  }

  await pool.end();

  console.log(`\n📊  Summary:`);
  console.log(`   Created : ${created}`);
  console.log(`   Skipped : ${skipped}`);
  console.log(`   Errors  : ${errors}`);

  if (errors > 0) {
    console.log(`\n⚠  Some topics failed. Re-run to retry only the failed ones.`);
    process.exit(1);
  } else {
    console.log(`\n✅  All topics provisioned. Messages will now route to topics automatically.\n`);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
