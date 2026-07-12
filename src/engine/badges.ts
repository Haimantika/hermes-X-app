/**
 * Collectible badges for the verdict card.
 *
 * Everyone loves collecting badges — so alongside the SlopScore we award a few
 * little flexes. Badges are PURE and deterministic: each one is decided solely
 * from data we actually have (the handle + the score), so a card is always
 * reproducible and never claims something we can't back up.
 *
 * Note on "account" badges (OG Username, Verified Vibes, Joined Before 2015):
 * those need account metadata (creation date, verified flag) that the current
 * pipeline does not fetch, so they are intentionally NOT awarded here. The
 * catalog is structured so they're trivial to add once that data exists.
 */

export interface Badge {
  id: string;
  /** Short label drawn inside the pill. */
  label: string;
  /** Twemoji codepoint drawn to the left of the label (see integrations/emoji). */
  emoji: string;
}

export interface BadgeInputs {
  handle: string;
  slopScore: number;
}

/** Case-insensitive palindrome check, ignoring separators/digits. */
function isPalindrome(handle: string): boolean {
  const s = handle.toLowerCase().replace(/[^a-z]/g, "");
  if (s.length < 3) return false;
  for (let i = 0, j = s.length - 1; i < j; i++, j--) {
    if (s[i] !== s[j]) return false;
  }
  return true;
}

/**
 * Decide which badges a handle has earned. Returned worst-to-best-effort in a
 * stable priority order; callers can cap how many they render.
 */
export function computeBadges(input: BadgeInputs): Badge[] {
  const handle = input.handle.replace(/^@/, "").trim();
  const lower = handle.toLowerCase();
  const len = handle.length;
  const oneWord = /^[a-z]+$/i.test(handle); // pure letters: no digits, no underscores

  const badges: Badge[] = [];

  // Elite human writing. Rare, so it leads.
  if (input.slopScore <= 5) {
    badges.push({ id: "top_1pct", label: "Top 1%", emoji: "1f3c6" });
  }
  if (isPalindrome(lower)) {
    badges.push({ id: "palindrome", label: "Palindrome", emoji: "1f501" });
  }
  if (oneWord) {
    // A pure-letters handle already implies "Zero Numbers" + "No Underscores",
    // so we award the stronger badge and suppress the two subsumed ones below.
    badges.push({ id: "one_word", label: "One-word Username", emoji: "1f524" });
  }
  if (len > 0 && len <= 4) {
    badges.push({ id: "shortest", label: "Shortest Username", emoji: "1f4cf" });
  }
  if (len >= 14) {
    badges.push({ id: "longest", label: "Longest Username", emoji: "1f4d0" });
  }
  if (!oneWord && !/\d/.test(handle)) {
    badges.push({ id: "zero_numbers", label: "Zero Numbers", emoji: "1f522" });
  }
  if (!oneWord && !handle.includes("_")) {
    badges.push({ id: "no_underscores", label: "No Underscores", emoji: "1f6ab" });
  }
  // Writing that reads reliably human — a softer tier than Top 1%.
  if (input.slopScore > 5 && input.slopScore <= 18) {
    badges.push({ id: "verified_vibes", label: "Verified Vibes", emoji: "2705" });
  }

  return badges;
}
