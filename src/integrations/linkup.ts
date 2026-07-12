/**
 * LinkUp integration — pulls recent public posts for an X/Twitter handle.
 *
 * Real mode: hits LinkUp's search API and parses sourced snippets into tweets.
 * Mock mode (no key): returns a deterministic, per-handle synthetic timeline so
 * the whole pipeline — scoring, card, voice, leaderboard — still demos end to end.
 */

import { config, live } from "../config.js";
import type { Tweet } from "../engine/types.js";

const LINKUP_ENDPOINT = "https://api.linkup.so/v1/search";

export interface FetchResult {
  handle: string;
  tweets: Tweet[];
  source: "linkup" | "mock";
}

export async function fetchTweets(handle: string, limit = 20): Promise<FetchResult> {
  const clean = handle.replace(/^@/, "").trim();
  if (live.linkup) {
    try {
      const tweets = await fetchFromLinkup(clean, limit);
      if (tweets.length > 0) return { handle: clean, tweets, source: "linkup" };
    } catch (err) {
      console.warn(`[linkup] live fetch failed, falling back to mock:`, (err as Error).message);
    }
  }
  return { handle: clean, tweets: mockTimeline(clean, limit), source: "mock" };
}

async function fetchFromLinkup(handle: string, limit: number): Promise<Tweet[]> {
  const res = await fetch(LINKUP_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.linkup.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: `recent posts and tweets by @${handle} on x.com twitter`,
      depth: "standard",
      outputType: "searchResults",
      includeImages: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`LinkUp ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    results?: Array<{ name?: string; url?: string; content?: string; snippet?: string }>;
  };

  const tweets: Tweet[] = [];
  for (const [i, r] of (data.results ?? []).entries()) {
    const text = (r.content ?? r.snippet ?? r.name ?? "").trim();
    if (!text || text.length < 8) continue;
    // A single result may bundle several posts; split on blank lines.
    for (const chunk of text.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean)) {
      tweets.push({
        id: `${i}-${tweets.length}`,
        text: chunk.slice(0, 500),
        url: r.url,
      });
      if (tweets.length >= limit) return tweets;
    }
  }
  return tweets;
}

// ── Deterministic mock timeline ────────────────────────────────────────────

/** Small string hash -> stable per-handle "slop dial" in [0,1]. */
function slopDial(handle: string): number {
  let h = 2166136261;
  for (let i = 0; i < handle.length; i++) {
    h ^= handle.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let dial = (h >>> 0) / 0xffffffff;

  // Nudge the dial on obvious keywords so mock demos + the leaderboard feel
  // intentional (a handle with "gpt"/"ai"/"slop" reads more slop-pilled).
  const lower = handle.toLowerCase();
  if (/(slop|gpt|ai|bot|thought|guru|founder|hustle)/.test(lower)) dial = 0.6 + dial * 0.4;
  if (/(human|real|messy|raw|shitpost|gremlin)/.test(lower)) dial = dial * 0.35;
  return Math.min(1, Math.max(0, dial));
}

const SLOP_POOL: string[] = [
  "Let's delve into the rich tapestry of modern innovation — it's a testament to human ingenuity. 🚀",
  "This isn't just a product, it's a movement. Ever wonder why the best teams win? It's not luck, it's systems.",
  "Key takeaways from today:\n🚀 Move fast\n✅ Stay humble\n💡 Keep shipping\n🔥 Never stop learning",
  "In today's ever-evolving landscape, we must leverage robust, seamless, and scalable solutions to unlock real value.",
  "Here's the truth nobody tells you: success isn't about talent, it's about consistency. Moreover, it underscores discipline.",
  "Navigating the intricate world of AI is a journey. It's not merely about tools — it's about mindset, meaning, and momentum.",
  "The result? A holistic, nuanced approach that fosters growth, elevates outcomes, and resonates deeply. 💡",
  "Three things that changed everything for me: clarity, consistency, and courage. What would you add? 👇",
];

const HUMAN_POOL: string[] = [
  "lol ok this bug has been kicking my ass all day ngl",
  "idk why but the coffee here just hits different rn",
  "gonna go touch grass brb",
  "wait that's actually kinda genius wtf",
  "me: i'll sleep early tonight. also me at 3am:",
  "ok who moved my semicolon i s2g",
  "shipped it. probably broke prod. we'll see 🫠",
  "tbh the meeting couldve been an email but here we are",
  "brain empty today no thoughts just vibes",
  "new keyboard clacky af, productivity +1000%",
];

/** Blend the two pools according to the handle's slop dial. */
function mockTimeline(handle: string, limit: number): Tweet[] {
  const dial = slopDial(handle);
  const n = Math.min(limit, 12);
  const tweets: Tweet[] = [];
  // Use a second hash stream for deterministic pool indexing.
  let seed = Math.floor(dial * 100000) + handle.length * 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < n; i++) {
    const useSlop = rand() < dial;
    const pool = useSlop ? SLOP_POOL : HUMAN_POOL;
    const text = pool[Math.floor(rand() * pool.length)];
    tweets.push({
      id: `mock-${i}`,
      text,
      url: `https://x.com/${handle}/status/${1000 + i}`,
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    });
  }
  return tweets;
}
