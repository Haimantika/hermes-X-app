/**
 * The SlopScore pipeline, split into two phases so Hermes can own the
 * agentic part and the backend can own deterministic rendering:
 *
 *   computeReport(handle)  = LinkUp fetch + engine scoring  → SlopReport
 *      ↳ this is what the Hermes MCP tools call (the "agent does the work" part)
 *
 *   finalize(report)       = card image + ElevenLabs voice + Convex store
 *      ↳ deterministic post-processing the web/bot layer runs on the report
 *
 *   scoreHandle(handle)    = computeReport + finalize (direct, no Hermes) —
 *                            used by the CLI/bot and as the HermesRunner fallback.
 */

import { analyze } from "./engine/index.js";
import type { SlopReport } from "./engine/types.js";
import { fetchTweets } from "./integrations/linkup.js";
import { renderCard } from "./integrations/card.js";
import { voiceRoast } from "./integrations/elevenlabs.js";
import { getStore } from "./store/index.js";

export interface ComputeResult {
  report: SlopReport;
  tweetSource: "linkup" | "mock";
}

/** Phase 1: retrieval + scoring. Pure-ish (only network is LinkUp). */
export async function computeReport(
  handle: string,
  maxTweets = 20
): Promise<ComputeResult> {
  const clean = handle.replace(/^@/, "").trim();
  const { tweets, source } = await fetchTweets(clean, maxTweets);
  const report = analyze(clean, tweets, { maxTweets });
  return { report, tweetSource: source };
}

export interface FinalizeResult {
  cardPath: string;
  cardPng: Buffer;
  voicePath: string;
  voiceScript: string;
  voiceSource: "elevenlabs" | "mock";
  storeBackend: "convex" | "local";
}

export interface FinalizeOptions {
  requestedBy?: string;
  outDir?: string;
  /** Skip card/voice generation (text-only). */
  artifacts?: boolean;
}

/** Phase 2: persist to leaderboard + render card & voice. */
export async function finalize(
  report: SlopReport,
  opts: FinalizeOptions = {}
): Promise<FinalizeResult> {
  const store = await getStore();
  await store.record(report, opts.requestedBy);
  if (opts.requestedBy) await store.touchUser(opts.requestedBy, report.handle);

  if (opts.artifacts === false) {
    return {
      cardPath: "",
      cardPng: Buffer.alloc(0),
      voicePath: "",
      voiceScript: "",
      voiceSource: "mock",
      storeBackend: store.backend,
    };
  }

  const [card, voice] = await Promise.all([
    renderCard(report, opts.outDir ?? "output"),
    voiceRoast(report, opts.outDir ?? "output"),
  ]);

  return {
    cardPath: card.path,
    cardPng: card.png,
    voicePath: voice.path,
    voiceScript: voice.script,
    voiceSource: voice.source,
    storeBackend: store.backend,
  };
}

export interface ScoreResult extends FinalizeResult {
  report: SlopReport;
  tweetSource: "linkup" | "mock";
}

export interface RunOptions {
  requestedBy?: string;
  maxTweets?: number;
  textOnly?: boolean;
  outDir?: string;
}

/** Direct end-to-end run (no Hermes). Used by CLI/bot and as a fallback. */
export async function scoreHandle(handle: string, opts: RunOptions = {}): Promise<ScoreResult> {
  const { report, tweetSource } = await computeReport(handle, opts.maxTweets ?? 20);
  const fin = await finalize(report, {
    requestedBy: opts.requestedBy,
    outDir: opts.outDir,
    artifacts: !opts.textOnly,
  });
  return { report, tweetSource, ...fin };
}
