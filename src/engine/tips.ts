/**
 * "How to sound human again" — per-tell remediation advice. Only tips for the
 * tells that actually fired are surfaced, so the advice feels earned.
 */

import type { TellId } from "./types.js";

const TIP_BANK: Record<TellId, string> = {
  em_dash:
    "Break up with the em-dash. Use a period. Two short sentences read more human than one that keeps —interrupting— itself.",
  not_just_x_but_y:
    'Kill the "it\'s not X, it\'s Y" reflex. Just state Y. The setup is scaffolding a model left in the final draft.',
  slop_vocab:
    'Ban the top-10 slop words: delve, tapestry, testament, seamless, robust, leverage, elevate, unlock, realm, landscape. Say the plain version instead.',
  rhetorical_bait:
    "Cut the rhetorical opener. Don't ask 'ever wonder why?' — lead with the actual point. Hooks that beg for engagement read as bait.",
  emoji_bullets:
    "Retire the emoji bullet list. If it has 🚀 and ✅ down the left margin, it's a slide deck, not a thought. One emoji, used ironically, max.",
  perfect_grammar:
    "Let it be a little messy. Lowercase a tweet. Drop a terminal period. Perfect capitalisation + full stops on every line reads as generated.",
  tricolon:
    'Escape the rule of three. Not everything needs to be "fast, cheap, and reliable." Sometimes a thing is just fast.',
};

/** Generic fallback tips shown when the timeline is already pretty human. */
const HUMAN_TIPS = [
  "Genuinely human timeline. Keep writing like a person who has typos and opinions.",
  "Your worst enemy now is the autocomplete button. Don't let it finish your sentences.",
];

export function buildTips(firedTells: TellId[]): string[] {
  if (firedTells.length === 0) return HUMAN_TIPS;
  return firedTells.map((id) => TIP_BANK[id]);
}
