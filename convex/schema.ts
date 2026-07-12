import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Shared, real-time state for SlopScore.
 *
 * - `scores`   : the leaderboard — one row per handle (latest score wins),
 *                queryable "most human" vs "most slop-pilled".
 * - `history`  : every score ever run, so cron can fire a weekly re-test and
 *                show trend ("your slop score this week").
 * - `users`    : Telegram user memory.
 */
export default defineSchema({
  scores: defineTable({
    handle: v.string(),
    slopScore: v.number(),
    verdict: v.string(),
    tagline: v.string(),
    topTell: v.optional(v.string()),
    sampleSize: v.number(),
    updatedAt: v.number(),
    requestedBy: v.optional(v.string()),
  })
    .index("by_handle", ["handle"])
    .index("by_score", ["slopScore"]),

  history: defineTable({
    handle: v.string(),
    slopScore: v.number(),
    verdict: v.string(),
    createdAt: v.number(),
    requestedBy: v.optional(v.string()),
  }).index("by_handle", ["handle"]),

  users: defineTable({
    userId: v.string(),
    handle: v.optional(v.string()),
    lastScoredAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
