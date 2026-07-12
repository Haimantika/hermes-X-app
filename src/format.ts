/**
 * Shared human-readable formatting for the CLI and the Telegram bot.
 */

import type { SlopReport } from "./engine/types.js";
import type { LeaderRow } from "./store/index.js";
import { config } from "./config.js";

export function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Full text verdict (used by CLI and as the bot caption fallback). */
export function formatReport(report: SlopReport): string {
  const lines: string[] = [];
  lines.push(`🧪 SlopScore for @${report.handle}`);
  lines.push(`${report.slopScore}/100  ${scoreBar(report.slopScore)}`);
  lines.push(`Verdict: ${report.verdict} — ${report.tagline}`);
  lines.push(`Sampled ${report.sampleSize} posts`);
  lines.push("");
  lines.push("📋 The receipts:");

  const fired = report.tells.filter((t) => t.hits > 0);
  for (const t of fired) {
    const quote = t.receipts[0]?.quote;
    lines.push(`• ${t.label} — ${t.hits}×${quote ? `  “${quote}”` : ""}`);
  }

  lines.push("");
  lines.push("🗣️ The roast:");
  lines.push(report.roast);

  lines.push("");
  lines.push("🧑 How to sound human again:");
  for (const tip of report.tips) lines.push(`• ${tip}`);

  lines.push("");
  lines.push(`share your score → ${config.publicUrl}`);
  return lines.join("\n");
}

export function formatLeaderboard(rows: LeaderRow[], direction: "slop" | "human"): string {
  const title =
    direction === "slop" ? "🤖 MOST SLOP-PILLED TIMELINES" : "🧑 MOST HUMAN TIMELINES";
  const lines = [title, ""];
  if (rows.length === 0) {
    lines.push("No scores yet — be the first. DM me an @handle.");
    return lines.join("\n");
  }
  rows.forEach((r, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
    lines.push(`${medal} @${r.handle} — ${r.slopScore}/100 (${r.verdict})`);
  });
  lines.push("");
  lines.push("go check your fave's score, they're def top 10 slop 👀");
  return lines.join("\n");
}
