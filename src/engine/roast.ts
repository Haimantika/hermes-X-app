/**
 * Verdict + roast copy generation. Deterministic given a report so the same
 * timeline always produces the same roast (repeatable, screenshot-stable).
 */

import type { SlopReport, TellResult } from "./types.js";

interface VerdictBucket {
  min: number;
  verdict: string;
  tagline: string;
}

const BUCKETS: VerdictBucket[] = [
  { min: 90, verdict: "Fully Slop-Pilled", tagline: "Certified LinkedIn Thought-Leader 🤖" },
  { min: 75, verdict: "Heavily Slop-Coded", tagline: "Your ghostwriter is a language model" },
  { min: 55, verdict: "Slop-Leaning", tagline: "Suspicious amount of 'delve' energy" },
  { min: 35, verdict: "Mixed Signals", tagline: "Human with a GPT tab open" },
  { min: 18, verdict: "Mostly Human", tagline: "Passes the Turing test for your timeline" },
  { min: 0, verdict: "Certified Human", tagline: "Gloriously, messily, real" },
];

export function bucketFor(score: number): VerdictBucket {
  return BUCKETS.find((b) => score >= b.min) ?? BUCKETS[BUCKETS.length - 1];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Assemble the roast paragraph. Leads with the single most damning tell, then
 * stacks receipts, then lands a closer keyed to the overall score.
 */
export function buildRoast(
  handle: string,
  slopScore: number,
  firedTells: TellResult[]
): string {
  const bucket = bucketFor(slopScore);
  const lines: string[] = [];

  lines.push(`@${handle} — SlopScore: ${slopScore}/100. Verdict: ${bucket.verdict}.`);

  if (firedTells.length === 0) {
    lines.push(
      `Genuinely stumped. No em-dash abuse, no "delve," no "it's not X, it's Y." This reads like a human who types with their own hands. Rare. Almost suspiciously human.`
    );
    return lines.join(" ");
  }

  const top = firedTells[0];
  lines.push(`The headline crime: ${top.label.toLowerCase()}. ${top.quip}`);

  // Stack up to two more offenders as receipts.
  const rest = firedTells.slice(1, 3);
  for (const t of rest) {
    lines.push(t.quip);
  }

  // A closer keyed to severity.
  if (slopScore >= 75) {
    lines.push(
      `Bestie, at ${slopScore}/100 the model isn't assisting you, it's writing you. The receipts are right there. 💀`
    );
  } else if (slopScore >= 45) {
    lines.push(
      `Solid ${slopScore}/100 — human core, GPT crust. A couple of tells away from passing clean.`
    );
  } else {
    lines.push(
      `Only ${slopScore}/100. Mostly human, just don't let autocomplete get comfortable.`
    );
  }

  return lines.join(" ");
}

/** Compact one-tell-per-line receipts block for the card + Telegram message. */
export function receiptsBlock(report: SlopReport, maxTells = 5): string {
  const out: string[] = [];
  for (const t of report.tells.filter((x) => x.hits > 0).slice(0, maxTells)) {
    const example = t.receipts[0]?.quote;
    const line = example
      ? `• ${t.label} (${t.hits}×): “${example}”`
      : `• ${t.label} (${t.hits}×)`;
    out.push(line);
  }
  return out.join("\n");
}

export { pct };
