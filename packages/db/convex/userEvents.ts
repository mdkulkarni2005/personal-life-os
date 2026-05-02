import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const lifeDomain = v.union(
  v.literal("health"),
  v.literal("finance"),
  v.literal("career"),
  v.literal("hobby"),
  v.literal("fun")
);

const eventType = v.union(
  v.literal("reminder_completed"),
  v.literal("reminder_deleted"),
  v.literal("reminder_created"),
  v.literal("task_completed"),
  v.literal("task_created"),
);

const EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const track = mutation({
  args: {
    userId: v.string(),
    eventType,
    entityId: v.optional(v.string()),
    entityTitle: v.optional(v.string()),
    domain: v.optional(lifeDomain),
    metadata: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("userEvents", {
      userId: args.userId,
      eventType: args.eventType,
      entityId: args.entityId,
      entityTitle: args.entityTitle,
      domain: args.domain,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const getRecent = query({
  args: { userId: v.string(), limitDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const days = args.limitDays ?? 30;
    const cutoff = Date.now() - Math.min(days, 30) * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("userEvents")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", args.userId).gte("createdAt", cutoff)
      )
      .collect();
  },
});

export const purgeOld = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - EVENTS_RETENTION_MS;
    const old = await ctx.db
      .query("userEvents")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", args.userId).lt("createdAt", cutoff)
      )
      .collect();
    for (const row of old) await ctx.db.delete(row._id);
  },
});
