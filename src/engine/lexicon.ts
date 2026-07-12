/**
 * The slop lexicon: the specific words, phrases and constructions that read as
 * LLM-generated. Kept in one place so the receipts stay honest and auditable.
 */

/** High-signal "ChatGPT voice" vocabulary. Matched as whole words. */
export const SLOP_VOCAB: string[] = [
  "delve",
  "delved",
  "delving",
  "tapestry",
  "testament",
  "testament to",
  "underscore",
  "underscores",
  "underscoring",
  "elevate",
  "elevates",
  "elevating",
  "unleash",
  "unlock",
  "unlocking",
  "harness",
  "harnessing",
  "leverage",
  "leveraging",
  "seamless",
  "seamlessly",
  "robust",
  "myriad",
  "plethora",
  "realm",
  "landscape",
  "nuanced",
  "holistic",
  "synergy",
  "paradigm",
  "pivotal",
  "crucial",
  "vibrant",
  "bustling",
  "ever-evolving",
  "ever-changing",
  "fast-paced",
  "game-changer",
  "game changer",
  "cutting-edge",
  "boasts",
  "navigating",
  "embark",
  "foster",
  "fostering",
  "resonate",
  "resonates",
  "meticulous",
  "meticulously",
  "intricate",
  "intricacies",
  "beacon",
  "treasure trove",
  "in today's world",
  "in the world of",
  "at its core",
  "when it comes to",
];

/**
 * Transition/hedge phrases that pile up in generated prose. Softer signal than
 * SLOP_VOCAB, weighted lower in the scorer.
 */
export const SLOP_TRANSITIONS: string[] = [
  "moreover",
  "furthermore",
  "additionally",
  "consequently",
  "importantly",
  "notably",
  "ultimately",
  "in conclusion",
  "it's worth noting",
  "it is worth noting",
  "that being said",
  "on the other hand",
  "as we navigate",
  "in the ever-evolving",
];

/**
 * The "It's not X, it's Y" / "not just X but Y" antithesis construction —
 * one of the most recognisable LLM tells. Expressed as regexes.
 */
export const NOT_JUST_PATTERNS: RegExp[] = [
  /\bit'?s not (?:just|only|merely|about)\b[^.?!]{0,60}?\bit'?s\b/gi,
  /\bnot (?:just|only|merely)\b[^.?!]{0,50}?\bbut\b/gi,
  /\bthis (?:isn'?t|is not) (?:just|only|merely|about)\b[^.?!]{0,60}?\bit'?s\b/gi,
  /\bmore than (?:just )?a\b[^.?!]{0,40}?\bit'?s\b/gi,
];

/** Emoji as bullet/list markers, e.g. lines beginning with an emoji + text. */
// Broad emoji range; used both to detect bullet markers and to count density.
export const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{2728}\u{1F004}\u{1F0CF}]/gu;

/** Common "engagement bait" openers before a rhetorical question. */
export const RHETORICAL_OPENERS: RegExp[] = [
  /\b(?:ever wonder(?:ed)?|have you ever|what if|why (?:do|does|is|are)|the (?:secret|truth|key) (?:to|is)|here'?s (?:the|why|what)|let'?s be honest|the result\?|the best part\?|sound familiar\?)\b/gi,
];
