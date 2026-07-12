import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Upsert a score into the leaderboard and append to history. */
export const record = mutation({
  args: {
    handle: v.string(),
    slopScore: v.number(),
    verdict: v.string(),
    tagline: v.string(),
    topTell: v.optional(v.string()),
    sampleSize: v.number(),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        slopScore: args.slopScore,
        verdict: args.verdict,
        tagline: args.tagline,
        topTell: args.topTell,
        sampleSize: args.sampleSize,
        updatedAt: now,
        requestedBy: args.requestedBy,
      });
    } else {
      await ctx.db.insert("scores", { ...args, updatedAt: now });
    }

    await ctx.db.insert("history", {
      handle: args.handle,
      slopScore: args.slopScore,
      verdict: args.verdict,
      createdAt: now,
      requestedBy: args.requestedBy,
    });

    return { ok: true };
  },
});

/** Leaderboard. direction "slop" = most slop-pilled, "human" = most human. */
export const leaderboard = query({
  args: {
    direction: v.union(v.literal("slop"), v.literal("human")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const rows = await ctx.db.query("scores").withIndex("by_score").collect();
    rows.sort((a, b) =>
      args.direction === "slop" ? b.slopScore - a.slopScore : a.slopScore - b.slopScore
    );
    return rows.slice(0, limit);
  },
});

/** Full history for a handle (for weekly trend / cron re-test). */
export const history = query({
  args: { handle: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("history")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows.slice(0, args.limit ?? 20);
  },
});

/** Handles that haven't been re-tested in `olderThanMs`, for the weekly cron. */
export const stale = query({
  args: { olderThanMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const rows = await ctx.db.query("scores").collect();
    return rows
      .filter((r) => r.updatedAt < cutoff)
      .slice(0, args.limit ?? 25)
      .map((r) => ({ handle: r.handle, slopScore: r.slopScore, requestedBy: r.requestedBy }));
  },
});
