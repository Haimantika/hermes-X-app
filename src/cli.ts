#!/usr/bin/env node
/**
 * SlopScore CLI — score a handle from the terminal.
 *
 *   npm run score -- elonmusk
 *   npm run demo                 # runs a fixed slop + human example
 *   npm run score -- --leaderboard
 *
 * Works with zero API keys (everything falls back to mock), so it's the
 * fastest way to see the whole pipeline produce a card + clip + verdict.
 */

import { scoreHandle } from "./pipeline.js";
import { getStore } from "./store/index.js";
import { formatReport, formatLeaderboard } from "./format.js";
import { capabilitySummary } from "./config.js";

async function main() {
  const args = process.argv.slice(2);

  console.log(`\n\x1b[35m▓▓ SlopScore\x1b[0m — the turing test for your timeline`);
  console.log(`\x1b[90mcapabilities: ${capabilitySummary()}\x1b[0m\n`);

  if (args.includes("--leaderboard")) {
    const store = await getStore();
    const slop = await store.leaderboard("slop", 10);
    const human = await store.leaderboard("human", 10);
    console.log(formatLeaderboard(slop, "slop"));
    console.log("");
    console.log(formatLeaderboard(human, "human"));
    return;
  }

  const handles = args.includes("--demo")
    ? ["slopgpt_official", "real_messy_human"]
    : args.filter((a) => !a.startsWith("--"));

  if (handles.length === 0) {
    console.log("usage: npm run score -- <handle> [handle2 ...]");
    console.log("       npm run demo");
    console.log("       npm run score -- --leaderboard");
    return;
  }

  for (const handle of handles) {
    const result = await scoreHandle(handle, { requestedBy: "cli" });
    console.log(formatReport(result.report));
    console.log("");
    console.log(
      `\x1b[90m🖼  card:  ${result.cardPath}\n🔊 clip:  ${result.voicePath}` +
        `\n📡 tweets:${result.tweetSource}  voice:${result.voiceSource}  store:${result.storeBackend}\x1b[0m`
    );
    console.log("\n" + "─".repeat(60) + "\n");
  }
}

main().catch((err) => {
  console.error("SlopScore CLI error:", err);
  process.exit(1);
});
