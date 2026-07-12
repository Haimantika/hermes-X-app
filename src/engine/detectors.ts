/**
 * Individual slop-tell detectors.
 *
 * Each detector receives the corpus of tweets and returns a TellResult with:
 *  - a raw hit count,
 *  - a density-normalised 0..1 score (fair across small/large samples),
 *  - verbatim receipts (the defensible part),
 *  - a ready-to-drop quip.
 */

import type { Receipt, Tweet, TellResult, TellId } from "./types.js";
import {
  SLOP_VOCAB,
  SLOP_TRANSITIONS,
  NOT_JUST_PATTERNS,
  EMOJI_REGEX,
  RHETORICAL_OPENERS,
} from "./lexicon.js";

const MAX_RECEIPTS = 4;

/** Maps a per-tweet rate to 0..1 with diminishing returns. */
function saturate(rate: number, k: number): number {
  return 1 - Math.exp(-k * rate);
}

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function totalWords(tweets: Tweet[]): number {
  return tweets.reduce((n, t) => n + wordCount(t.text), 0);
}

function snippet(text: string, index: number, matchLen: number, pad = 24): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + matchLen + pad);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

function pushReceipt(receipts: Receipt[], t: Tweet, quote: string) {
  if (receipts.length >= MAX_RECEIPTS) return;
  receipts.push({ tweetId: t.id, quote, url: t.url });
}

function esc(re: RegExp): RegExp {
  // clone with lastIndex reset for safe reuse
  return new RegExp(re.source, re.flags);
}

function wholeWord(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

// ── 1. Em-dash abuse ──────────────────────────────────────────────────────
export function detectEmDash(tweets: Tweet[]): TellResult {
  let hits = 0;
  const receipts: Receipt[] = [];
  // Real em dash, plus " - " and " -- " used as an em dash.
  const re = /—|(?:\s)-{1,2}(?=\s)/g;
  for (const t of tweets) {
    const local = t.text.match(re);
    if (local && local.length) {
      hits += local.length;
      const idx = t.text.search(/—|(?:\s)-{1,2}(?=\s)/);
      if (idx >= 0) pushReceipt(receipts, t, snippet(t.text, idx, 1));
    }
  }
  const perTweet = tweets.length ? hits / tweets.length : 0;
  return {
    id: "em_dash",
    label: "Em-dash abuse",
    hits,
    score: saturate(perTweet, 1.1),
    receipts,
    quip: `${hits} em-dashes across ${tweets.length} tweets — the punctuation of someone who let autocomplete finish the thought.`,
  };
}

// ── 2. "It's not just X, it's Y" ───────────────────────────────────────────
export function detectNotJust(tweets: Tweet[]): TellResult {
  let hits = 0;
  const receipts: Receipt[] = [];
  for (const t of tweets) {
    for (const pat of NOT_JUST_PATTERNS) {
      const re = esc(pat);
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.text)) !== null) {
        hits++;
        pushReceipt(receipts, t, snippet(t.text, m.index, m[0].length, 8));
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  const perTweet = tweets.length ? hits / tweets.length : 0;
  return {
    id: "not_just_x_but_y",
    label: '"It\'s not just X, it\'s Y"',
    hits,
    score: saturate(perTweet, 6),
    receipts,
    quip:
      hits > 0
        ? `The "it's not X, it's Y" antithesis appears ${hits}×. This isn't a writing style — it's a diagnosis. (See what I did there.)`
        : `No "it's not X, it's Y" antithesis. Rare restraint.`,
  };
}

// ── 3. Slop vocabulary ("delve", "tapestry", "testament to") ───────────────
export function detectSlopVocab(tweets: Tweet[]): TellResult {
  let hits = 0;
  const receipts: Receipt[] = [];
  const counts = new Map<string, number>();

  for (const t of tweets) {
    for (const term of SLOP_VOCAB) {
      const re = wholeWord(term);
      const found = t.text.match(re);
      if (found && found.length) {
        hits += found.length;
        counts.set(term, (counts.get(term) ?? 0) + found.length);
        const idx = t.text.search(wholeWord(term));
        if (idx >= 0) pushReceipt(receipts, t, snippet(t.text, idx, term.length));
      }
    }
    // Transitions count at reduced weight (0.5 each toward hits-for-scoring).
    for (const term of SLOP_TRANSITIONS) {
      const found = t.text.match(wholeWord(term));
      if (found) hits += found.length * 0.5;
    }
  }

  const words = totalWords(tweets) || 1;
  const per100 = (hits / words) * 100;
  // Build a "you said X n times" callout for the worst offenders.
  const worst = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w, n]) => `"${w}" ${n}×`);

  return {
    id: "slop_vocab",
    label: "ChatGPT vocabulary",
    hits: Math.round(hits),
    score: saturate(per100, 0.9),
    receipts,
    quip: worst.length
      ? `Certified slop vocab: ${worst.join(", ")}. Bestie, humans do not "delve into a rich tapestry."`
      : `Clean vocabulary — not a single "delve" or "tapestry" in sight.`,
  };
}

// ── 4. Rhetorical-question engagement bait ─────────────────────────────────
export function detectRhetoricalBait(tweets: Tweet[]): TellResult {
  let hits = 0;
  const receipts: Receipt[] = [];
  for (const t of tweets) {
    let matched = false;
    for (const pat of RHETORICAL_OPENERS) {
      const re = esc(pat);
      const m = re.exec(t.text);
      if (m) {
        matched = true;
        pushReceipt(receipts, t, snippet(t.text, m.index, m[0].length, 12));
      }
    }
    // A standalone one-word/short question used as a hook, e.g. "The result?"
    const shortQ = /(^|\.\s)([A-Z][\w' ]{0,18}\?)/.exec(t.text);
    if (shortQ) {
      matched = true;
      pushReceipt(receipts, t, shortQ[2]);
    }
    if (matched) hits++;
  }
  const perTweet = tweets.length ? hits / tweets.length : 0;
  return {
    id: "rhetorical_bait",
    label: "Rhetorical-question bait",
    hits,
    score: saturate(perTweet, 2.2),
    receipts,
    quip:
      hits > 0
        ? `${hits} tweets open with engagement-bait rhetorical questions. Ever wonder why? (You do it too.)`
        : `No rhetorical-question bait. You just… say the thing. Respect.`,
  };
}

// ── 5. Emoji bullet lists ──────────────────────────────────────────────────
export function detectEmojiBullets(tweets: Tweet[]): TellResult {
  let bulletHits = 0;
  let emojiTotal = 0;
  const receipts: Receipt[] = [];
  for (const t of tweets) {
    const emojis = t.text.match(EMOJI_REGEX);
    if (emojis) emojiTotal += emojis.length;

    const lines = t.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const bulletLines = lines.filter((l) =>
      new RegExp(`^(?:[-*•]\\s*)?${EMOJI_REGEX.source}`, "u").test(l)
    );
    if (bulletLines.length >= 2) {
      bulletHits += bulletLines.length;
      pushReceipt(receipts, t, bulletLines.slice(0, 2).join("  "));
    }
  }
  const words = totalWords(tweets) || 1;
  const emojiPer100 = (emojiTotal / words) * 100;
  const bulletScore = saturate(bulletHits / (tweets.length || 1), 1.5);
  const emojiScore = saturate(emojiPer100, 0.5);
  const score = Math.min(1, bulletScore * 0.7 + emojiScore * 0.3);
  return {
    id: "emoji_bullets",
    label: "Emoji bullet lists",
    hits: bulletHits,
    score,
    receipts,
    quip:
      bulletHits > 0
        ? `Emoji-bulleted lists detected (${bulletHits} rocket/checkmark lines). This is a LinkedIn carousel wearing a trench coat. 🚀✅`
        : `No emoji bullet lists. Your tweets aren't slide decks.`,
  };
}

// ── 6. Suspiciously perfect grammar ────────────────────────────────────────
export function detectPerfectGrammar(tweets: Tweet[]): TellResult {
  let cleanTweets = 0;
  let considered = 0;
  const receipts: Receipt[] = [];

  const casualMarkers =
    /\b(lol|lmao|idk|tbh|imo|ngl|fr|rn|gonna|wanna|gotta|kinda|sorta|dunno|ya|u|ur|omg|wtf|bruh|bestie)\b/i;
  const abbreviations = /\b(?:btw|rt|dm|fyi)\b/i;

  for (const t of tweets) {
    const text = t.text.trim();
    if (wordCount(text) < 6) continue; // too short to judge
    considered++;

    const startsUpper = /^[A-Z"']/.test(text);
    const endsPunct = /[.!?]["')]?$/.test(text);
    const hasCasual = casualMarkers.test(text) || abbreviations.test(text);
    const hasContractionSlang = /\b\w+in'(?:\s|$)/.test(text); // "runnin'"
    const allLower = text === text.toLowerCase();

    // "Suspiciously perfect": capitalised start, terminal punctuation,
    // no lowercase-only casual voice, no slang. That's essay energy.
    if (startsUpper && endsPunct && !hasCasual && !hasContractionSlang && !allLower) {
      cleanTweets++;
      pushReceipt(receipts, t, snippet(text, 0, Math.min(text.length, 40), 0));
    }
  }
  const rate = considered ? cleanTweets / considered : 0;
  return {
    id: "perfect_grammar",
    label: "Suspiciously perfect grammar",
    hits: cleanTweets,
    // Only really suspicious when it's the dominant mode.
    score: rate > 0.6 ? saturate(rate, 2.5) : rate * 0.6,
    receipts,
    quip:
      rate > 0.6
        ? `${cleanTweets}/${considered} tweets are grammatically immaculate — capital letters, full stops, zero "lol". Nobody types like this on main.`
        : `Grammar is human-messy in the right places. Good.`,
  };
}

// ── 7. Tricolon "X, Y, and Z" rhythm ───────────────────────────────────────
export function detectTricolon(tweets: Tweet[]): TellResult {
  let hits = 0;
  const receipts: Receipt[] = [];
  // "a, b, and c" (Oxford-comma triad) — the LLM cadence.
  const re = /\b[\w'-]+(?:\s[\w'-]+){0,3},\s[\w'-]+(?:\s[\w'-]+){0,3},\s(?:and|or)\s[\w'-]+/gi;
  for (const t of tweets) {
    let m: RegExpExecArray | null;
    const local = esc(re);
    while ((m = local.exec(t.text)) !== null) {
      hits++;
      pushReceipt(receipts, t, snippet(t.text, m.index, m[0].length, 4));
      if (m.index === local.lastIndex) local.lastIndex++;
    }
  }
  const perTweet = tweets.length ? hits / tweets.length : 0;
  return {
    id: "tricolon",
    label: 'Tricolon "X, Y, and Z" rhythm',
    hits,
    score: saturate(perTweet, 2.5),
    receipts,
    quip:
      hits > 0
        ? `${hits} textbook tricolons ("X, Y, and Z"). Balanced, rhythmic, and unmistakably generated.`
        : `No tricolon addiction. You resist the rule of three.`,
  };
}

export type Detector = (tweets: Tweet[]) => TellResult;

export const DETECTORS: Record<TellId, Detector> = {
  em_dash: detectEmDash,
  not_just_x_but_y: detectNotJust,
  slop_vocab: detectSlopVocab,
  rhetorical_bait: detectRhetoricalBait,
  emoji_bullets: detectEmojiBullets,
  perfect_grammar: detectPerfectGrammar,
  tricolon: detectTricolon,
};
