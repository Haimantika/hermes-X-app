#!/usr/bin/env node
/**
 * Weekly "your slop score this week" re-test.
 *
 * Reads the leaderboard/memory, finds handles not re-scored in the last week,
 * re-runs the pipeline, and reports the delta vs. their previous score. If the
 * Telegram bot token is present and a requester is known, it DMs the update.
 *
 * Run manually (`npm run cron`) or wire to a scheduler / Convex cron.
 */

import { getStore } from "./store/index.js";
import { scoreHandle } from "./pipeline.js";
import { config, live } from "./config.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function notify(userId: string, text: string) {
  if (!live.telegram || !/^\d+$/.test(userId)) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: userId, text }),
    });
  } catch (err) {
    console.warn(`[cron] notify failed for ${userId}:`, (err as Error).message);
  }
}

async function main() {
  const olderThan = Number(process.argv[2]) || WEEK_MS;
  const store = await getStore();
  const due = await store.stale(olderThan, 25);

  console.log(`[cron] ${due.length} handle(s) due for a weekly re-test`);

  for (const row of due) {
    const prev = row.slopScore;
    const result = await scoreHandle(row.handle, { requestedBy: row.requestedBy });
    const now = result.report.slopScore;
    const delta = now - prev;
    const arrow = delta > 0 ? `📈 +${delta}` : delta < 0 ? `📉 ${delta}` : "➡️ 0";
    const msg =
      `🗓️ Your SlopScore this week: @${row.handle}\n` +
      `${now}/100 (${arrow} since last week) — ${result.report.verdict}\n` +
      `${result.report.tips[0] ?? ""}`;
    console.log(msg.replace(/\n/g, " | "));
    if (row.requestedBy) await notify(row.requestedBy, msg);
  }

  if (due.length === 0) console.log("[cron] nothing to do. everyone's fresh.");
}

main().catch((err) => {
  console.error("cron error:", err);
  process.exit(1);
});
