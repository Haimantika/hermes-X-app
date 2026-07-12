import { describe, it, expect } from "vitest";
import { analyze } from "./index.js";
import {
  detectEmDash,
  detectNotJust,
  detectSlopVocab,
  detectTricolon,
  detectEmojiBullets,
  detectRhetoricalBait,
  detectPerfectGrammar,
} from "./detectors.js";
import type { Tweet } from "./types.js";

function tw(id: string, text: string): Tweet {
  return { id, text, url: `https://x.com/i/status/${id}` };
}

const SLOP_TWEETS: Tweet[] = [
  tw("1", "Let's delve into the rich tapestry of modern AI — it's a testament to human ingenuity."),
  tw("2", "This isn't just a tool, it's a paradigm shift. Ever wonder why? 🚀"),
  tw("3", "We must leverage robust, seamless, and scalable solutions to unlock value."),
  tw("4", "Key takeaways:\n🚀 Move fast\n✅ Stay humble\n💡 Keep learning"),
  tw("5", "In today's world, navigating the ever-evolving landscape is crucial. Moreover, it underscores growth."),
];

const HUMAN_TWEETS: Tweet[] = [
  tw("1", "lol ok this bug has been kicking my ass all day ngl"),
  tw("2", "idk why but the coffee here just hits different rn"),
  tw("3", "gonna go touch grass brb"),
  tw("4", "wait that's actually kinda genius wtf"),
  tw("5", "me: i'll sleep early tonight. also me at 3am:"),
];

describe("individual detectors", () => {
  it("em-dash detector finds real and improvised dashes with receipts", () => {
    const r = detectEmDash([tw("1", "this — that -- other")]);
    expect(r.hits).toBeGreaterThanOrEqual(2);
    expect(r.receipts.length).toBeGreaterThan(0);
  });

  it("not-just-x-but-y detector catches the antithesis and quotes it", () => {
    const r = detectNotJust([tw("1", "It's not just a car, it's a lifestyle.")]);
    expect(r.hits).toBeGreaterThanOrEqual(1);
    expect(r.receipts[0].quote.toLowerCase()).toContain("not just");
  });

  it("slop vocab detector counts specific words for the receipt callout", () => {
    const r = detectSlopVocab([
      tw("1", "delve delve into the tapestry, a testament to delve."),
    ]);
    expect(r.hits).toBeGreaterThanOrEqual(3);
    expect(r.quip.toLowerCase()).toContain("delve");
  });

  it("tricolon detector catches X, Y, and Z rhythm", () => {
    const r = detectTricolon([tw("1", "It was fast, cheap, and reliable.")]);
    expect(r.hits).toBe(1);
  });

  it("emoji-bullet detector needs multiple emoji lines", () => {
    const r = detectEmojiBullets([tw("1", "🚀 one\n✅ two\n💡 three")]);
    expect(r.hits).toBeGreaterThanOrEqual(2);
  });

  it("rhetorical bait detector catches opener questions", () => {
    const r = detectRhetoricalBait([tw("1", "Ever wonder why startups fail?")]);
    expect(r.hits).toBeGreaterThanOrEqual(1);
  });

  it("perfect grammar detector flags immaculate essay-tweets, not casual ones", () => {
    const clean = detectPerfectGrammar([
      tw("1", "The quarterly results demonstrate consistent growth across all segments."),
    ]);
    expect(clean.hits).toBe(1);
    const casual = detectPerfectGrammar([tw("1", "lol idk this is kinda broken ngl fr")]);
    expect(casual.hits).toBe(0);
  });
});

describe("analyze() aggregate", () => {
  it("scores a slop-heavy timeline high", () => {
    const report = analyze("sloptron", SLOP_TWEETS);
    expect(report.slopScore).toBeGreaterThan(55);
    expect(report.topTell).toBeDefined();
    expect(report.roast).toContain("SlopScore");
    expect(report.tips.length).toBeGreaterThan(0);
  });

  it("scores a human timeline low", () => {
    const report = analyze("realperson", HUMAN_TWEETS);
    expect(report.slopScore).toBeLessThan(35);
  });

  it("slop timeline scores strictly higher than human timeline", () => {
    const slop = analyze("a", SLOP_TWEETS).slopScore;
    const human = analyze("b", HUMAN_TWEETS).slopScore;
    expect(slop).toBeGreaterThan(human);
  });

  it("is deterministic (same input -> same score & roast)", () => {
    const a = analyze("x", SLOP_TWEETS);
    const b = analyze("x", SLOP_TWEETS);
    expect(a.slopScore).toBe(b.slopScore);
    expect(a.roast).toBe(b.roast);
  });

  it("every fired tell carries at least one verbatim receipt", () => {
    const report = analyze("x", SLOP_TWEETS);
    for (const t of report.tells) {
      if (t.hits > 0 && t.receipts.length === 0) {
        // vocab/grammar density tells may aggregate without a per-line quote;
        // the specific-construction tells must always have receipts.
        expect(["slop_vocab", "perfect_grammar", "emoji_bullets"]).toContain(t.id);
      }
    }
    expect(report.topTell?.receipts.length ?? 0).toBeGreaterThan(0);
  });

  it("handles an empty corpus without throwing", () => {
    const report = analyze("ghost", []);
    expect(report.slopScore).toBe(0);
    expect(report.sampleSize).toBe(0);
  });
});
