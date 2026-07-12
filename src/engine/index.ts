/**
 * Public entry point for the SlopScore engine.
 *
 *   analyze(handle, tweets) -> SlopReport
 *
 * Pure and deterministic. Everything the bot shows (score, verdict, roast,
 * receipts, tips) comes from here.
 */

import type { SlopReport, Tweet, TellResult, TellId } from "./types.js";
import { DETECTORS } from "./detectors.js";
import { bucketFor, buildRoast } from "./roast.js";
import { buildTips } from "./tips.js";

/**
 * Relative importance of each tell in the aggregate. Sums are normalised, so
 * these are just ratios. The two most damning/specific tells carry the most.
 */
const WEIGHTS: Record<TellId, number> = {
  not_just_x_but_y: 1.6,
  slop_vocab: 1.5,
  em_dash: 1.2,
  tricolon: 1.1,
  emoji_bullets: 1.0,
  rhetorical_bait: 1.0,
  perfect_grammar: 0.9,
};

export interface AnalyzeOptions {
  /** Clamp the corpus to the most recent N tweets before scoring. */
  maxTweets?: number;
}

export function analyze(
  handle: string,
  tweets: Tweet[],
  opts: AnalyzeOptions = {}
): SlopReport {
  const clean = handle.replace(/^@/, "").trim();
  const corpus = opts.maxTweets ? tweets.slice(0, opts.maxTweets) : tweets;

  const tells: TellResult[] = (Object.keys(DETECTORS) as TellId[]).map((id) =>
    DETECTORS[id](corpus)
  );

  // Weighted aggregate -> 0..100.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const t of tells) {
    const w = WEIGHTS[t.id];
    weightedSum += t.score * w;
    weightTotal += w;
  }
  const raw = weightTotal ? weightedSum / weightTotal : 0;
  const slopScore = Math.round(Math.min(100, Math.max(0, raw * 100)));

  // Sort worst-first for display + roast.
  const sorted = [...tells].sort((a, b) => b.score - a.score);
  const fired = sorted.filter((t) => t.hits > 0 && t.score > 0.02);

  const bucket = bucketFor(slopScore);
  const roast = buildRoast(clean, slopScore, fired);
  const tips = buildTips(fired.map((t) => t.id));

  return {
    handle: clean,
    slopScore,
    verdict: bucket.verdict,
    tagline: bucket.tagline,
    sampleSize: corpus.length,
    tells: sorted,
    topTell: fired[0],
    roast,
    tips,
    generatedAt: new Date().toISOString(),
  };
}

export * from "./types.js";
export { bucketFor, buildRoast, receiptsBlock } from "./roast.js";
export type { Tweet, SlopReport } from "./types.js";
