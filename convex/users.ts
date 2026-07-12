import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Remember a Telegram user + the handle they last scored. */
export const touch = mutation({
  args: { userId: v.string(), handle: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        handle: args.handle ?? existing.handle,
        lastScoredAt: now,
      });
    } else {
      await ctx.db.insert("users", {
        userId: args.userId,
        handle: args.handle,
        premium: false,
        lastScoredAt: now,
        createdAt: now,
      });
    }
  },
});

/** Flip a user's premium flag (called after a verified Dodo payment). */
export const setPremium = mutation({
  args: { userId: v.string(), premium: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { premium: args.premium });
    } else {
      await ctx.db.insert("users", {
        userId: args.userId,
        premium: args.premium,
        createdAt: Date.now(),
      });
    }
  },
});

export const get = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});
