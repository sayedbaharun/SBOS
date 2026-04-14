/**
 * pin-critical-topics.ts
 *
 * Pins the 3 critical Telegram topics so they float to the top of the topics list.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx server/scripts/pin-critical-topics.ts
 */

import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || "").split(",")[0]?.trim();
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN || !CHAT_ID || !DATABASE_URL) {
  console.error("❌  TELEGRAM_BOT_TOKEN, AUTHORIZED_TELEGRAM_CHAT_IDS, and DATABASE_URL must be set");
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgPost(method: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(`Telegram API error (${method}): ${JSON.stringify(json)}`);
  return json.result;
}

// Topics to pin, in order. LAST item pinned = TOP of list.
// So list here in reverse priority: bottom-most first, top-most last.
const TOPICS_TO_PIN = [
  { key: "morning-loop",  label: "☀️ Morning Loop"  },
  { key: "review-queue",  label: "✅ Review Queue"   },
  { key: "on-fire",       label: "🔥 On Fire"        },
];

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log(`\n📌  Pinning critical topics for chat ${CHAT_ID}\n`);

  for (const topic of TOPICS_TO_PIN) {
    try {
      const rows = await pool.query(
        "SELECT thread_id FROM telegram_topic_map WHERE topic_key = $1 AND active = true LIMIT 1",
        [topic.key]
      );
      if (!rows.rows[0]) {
        console.log(`  ⚠️  ${topic.label} (${topic.key}) — not found in DB, skipping`);
        continue;
      }
      const threadId = rows.rows[0].thread_id as number;

      // Send a silent marker message into the topic
      const msg = await tgPost("sendMessage", {
        chat_id: CHAT_ID,
        message_thread_id: threadId,
        text: `📌 ${topic.label}`,
        disable_notification: true,
      });

      // Pin it
      await tgPost("pinChatMessage", {
        chat_id: CHAT_ID,
        message_id: msg.message_id,
        disable_notification: true,
      });

      console.log(`  ✅  ${topic.label} — pinned (threadId: ${threadId}, msgId: ${msg.message_id})`);

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      console.log(`  ❌  ${topic.label} — ${err.message}`);
    }
  }

  await pool.end();
  console.log("\n✅  Done. Critical topics should now float to the top.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
