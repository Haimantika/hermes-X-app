/**
 * Storage abstraction for the leaderboard + score-history "memory".
 *
 * Backend A (preferred): Convex — shared, real-time state. Enables the public
 *   leaderboard and cross-device history. Used when CONVEX_URL is set.
 * Backend B (fallback): a local JSON file in .data/ — so the leaderboard and
 *   weekly re-test still work in a demo without a Convex deployment.
 *
 * Both backends implement the same Store interface.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config, live } from "../config.js";
import type { SlopReport } from "../engine/types.js";

export interface LeaderRow {
  handle: string;
  slopScore: number;
  verdict: string;
  tagline?: string;
  updatedAt: number;
  requestedBy?: string;
}

export interface HistoryRow {
  handle: string;
  slopScore: number;
  verdict: string;
  createdAt: number;
}

export interface Store {
  backend: "convex" | "local";
  record(report: SlopReport, requestedBy?: string): Promise<void>;
  leaderboard(direction: "slop" | "human", limit?: number): Promise<LeaderRow[]>;
  history(handle: string, limit?: number): Promise<HistoryRow[]>;
  stale(olderThanMs: number, limit?: number): Promise<LeaderRow[]>;
  touchUser(userId: string, handle?: string): Promise<void>;
  isPremium(userId: string): Promise<boolean>;
  setPremium(userId: string, premium: boolean): Promise<void>;
}

// ── Convex backend ─────────────────────────────────────────────────────────

class ConvexStore implements Store {
  backend = "convex" as const;
  private client: any;
  private api: any;

  private constructor(client: any, api: any) {
    this.client = client;
    this.api = api;
  }

  static async create(): Promise<ConvexStore> {
    const { ConvexHttpClient } = await import("convex/browser");
    const { anyApi } = await import("convex/server");
    const client = new ConvexHttpClient(config.convex.url!);
    return new ConvexStore(client, anyApi);
  }

  async record(report: SlopReport, requestedBy?: string): Promise<void> {
    await this.client.mutation(this.api.scores.record, {
      handle: report.handle,
      slopScore: report.slopScore,
      verdict: report.verdict,
      tagline: report.tagline,
      topTell: report.topTell?.label,
      sampleSize: report.sampleSize,
      requestedBy,
    });
  }

  async leaderboard(direction: "slop" | "human", limit = 10): Promise<LeaderRow[]> {
    return await this.client.query(this.api.scores.leaderboard, { direction, limit });
  }

  async history(handle: string, limit = 20): Promise<HistoryRow[]> {
    return await this.client.query(this.api.scores.history, { handle, limit });
  }

  async stale(olderThanMs: number, limit = 25): Promise<LeaderRow[]> {
    return await this.client.query(this.api.scores.stale, { olderThanMs, limit });
  }

  async touchUser(userId: string, handle?: string): Promise<void> {
    await this.client.mutation(this.api.users.touch, { userId, handle });
  }

  async isPremium(userId: string): Promise<boolean> {
    const u = await this.client.query(this.api.users.get, { userId });
    return Boolean(u?.premium);
  }

  async setPremium(userId: string, premium: boolean): Promise<void> {
    await this.client.mutation(this.api.users.setPremium, { userId, premium });
  }
}

// ── Local JSON backend ─────────────────────────────────────────────────────

interface LocalData {
  scores: Record<string, LeaderRow>;
  history: HistoryRow[];
  users: Record<string, { premium: boolean; handle?: string; lastScoredAt?: number }>;
}

class LocalStore implements Store {
  backend = "local" as const;
  private file = resolve(".data/store.json");
  private data: LocalData = { scores: {}, history: [], users: {} };
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      this.data = { scores: {}, history: [], users: {} };
    }
    this.loaded = true;
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2));
  }

  async record(report: SlopReport, requestedBy?: string): Promise<void> {
    await this.load();
    const now = Date.now();
    this.data.scores[report.handle] = {
      handle: report.handle,
      slopScore: report.slopScore,
      verdict: report.verdict,
      tagline: report.tagline,
      updatedAt: now,
      requestedBy,
    };
    this.data.history.push({
      handle: report.handle,
      slopScore: report.slopScore,
      verdict: report.verdict,
      createdAt: now,
    });
    await this.save();
  }

  async leaderboard(direction: "slop" | "human", limit = 10): Promise<LeaderRow[]> {
    await this.load();
    const rows = Object.values(this.data.scores);
    rows.sort((a, b) =>
      direction === "slop" ? b.slopScore - a.slopScore : a.slopScore - b.slopScore
    );
    return rows.slice(0, limit);
  }

  async history(handle: string, limit = 20): Promise<HistoryRow[]> {
    await this.load();
    return this.data.history
      .filter((h) => h.handle === handle)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async stale(olderThanMs: number, limit = 25): Promise<LeaderRow[]> {
    await this.load();
    const cutoff = Date.now() - olderThanMs;
    return Object.values(this.data.scores)
      .filter((r) => r.updatedAt < cutoff)
      .slice(0, limit);
  }

  async touchUser(userId: string, handle?: string): Promise<void> {
    await this.load();
    const u = this.data.users[userId] ?? { premium: false };
    u.handle = handle ?? u.handle;
    u.lastScoredAt = Date.now();
    this.data.users[userId] = u;
    await this.save();
  }

  async isPremium(userId: string): Promise<boolean> {
    await this.load();
    return Boolean(this.data.users[userId]?.premium);
  }

  async setPremium(userId: string, premium: boolean): Promise<void> {
    await this.load();
    const u = this.data.users[userId] ?? { premium: false };
    u.premium = premium;
    this.data.users[userId] = u;
    await this.save();
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

let cached: Store | null = null;

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (live.convex) {
    try {
      cached = await ConvexStore.create();
      return cached;
    } catch (err) {
      console.warn(`[store] Convex init failed, using local store:`, (err as Error).message);
    }
  }
  cached = new LocalStore();
  return cached;
}
