/**
 * Core types for the SlopScore detection engine.
 *
 * The engine is intentionally PURE: no network, no side effects, fully
 * deterministic. That is what makes the roast defensible ("you used 'delve'
 * four times, bestie, here are the tweets") and what makes it unit-testable.
 */

export interface Tweet {
  id: string;
  text: string;
  /** ISO date, optional. Used only for display in receipts. */
  createdAt?: string;
  /** Optional permalink so receipts can deep-link the exact tweet. */
  url?: string;
}

/** A single quoted piece of evidence pulled straight from the text. */
export interface Receipt {
  tweetId: string;
  /** The offending snippet, verbatim, trimmed for display. */
  quote: string;
  /** Optional permalink to the source tweet. */
  url?: string;
}

/** Stable identifiers for each slop-tell we look for. */
export type TellId =
  | "em_dash"
  | "not_just_x_but_y"
  | "slop_vocab"
  | "rhetorical_bait"
  | "emoji_bullets"
  | "perfect_grammar"
  | "tricolon";

export interface TellResult {
  id: TellId;
  /** Human label shown in the roast, e.g. "Em-dash abuse". */
  label: string;
  /** Raw number of hits found across all tweets. */
  hits: number;
  /**
   * Density-normalised 0..1 sub-score. This is what feeds the aggregate,
   * so a 3-tweet account and a 30-tweet account are judged fairly.
   */
  score: number;
  /** Verbatim evidence. Capped so the roast stays punchy. */
  receipts: Receipt[];
  /** One-liner the roast can drop in verbatim. */
  quip: string;
}

export interface SlopReport {
  handle: string;
  /** 0..100 headline number. Higher = more slop-pilled. */
  slopScore: number;
  /** Playful bucket derived from slopScore. */
  verdict: string;
  /** Short subtitle for the card, e.g. "Certified LinkedIn Thought-Leader". */
  tagline: string;
  /** How many tweets were analysed. */
  sampleSize: number;
  /** Per-tell breakdown, sorted worst-first. */
  tells: TellResult[];
  /** The single most damning tell, for the headline roast. */
  topTell?: TellResult;
  /** Fully assembled roast paragraph with receipts. */
  roast: string;
  /** "How to sound human again" actionable tips. */
  tips: string[];
  /** When this report was generated (ISO). */
  generatedAt: string;
}
