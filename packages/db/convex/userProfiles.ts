import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const lifeDomain = v.union(
  v.literal("health"),
  v.literal("finance"),
  v.literal("career"),
  v.literal("hobby"),
  v.literal("fun")
);

export const get = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const upsert = mutation({
  args: {
    userId: v.string(),
    preferredWorkingHoursStart: v.optional(v.number()),
    preferredWorkingHoursEnd: v.optional(v.number()),
    dominantDomain: v.optional(lifeDomain),
    avgCompletionDelayMinutes: v.optional(v.number()),
    topTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const { userId, ...fields } = args;
    const data = { ...fields, updatedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("userProfiles", { userId, ...data });
    }
  },
});
