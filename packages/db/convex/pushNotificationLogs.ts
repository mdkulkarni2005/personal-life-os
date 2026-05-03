import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Record that a push was sent — prevents duplicate firing for the same event. */
export const logSent = mutation({
  args: {
    userId: v.string(),
    type: v.string(),
    reminderId: v.optional(v.string()),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pushNotificationLogs", {
      userId: args.userId,
      type: args.type,
      reminderId: args.reminderId,
      sentAt: args.sentAt,
    });
  },
});

/**
 * Check whether a push of this type was already sent for this reminder
 * within the given lookback window (milliseconds).
 */
export const wasSentRecently = query({
  args: {
    userId: v.string(),
    type: v.string(),
    reminderId: v.optional(v.string()),
    sinceMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.sinceMs;
    const rows = await ctx.db
      .query("pushNotificationLogs")
      .withIndex("by_user_type_sentAt", (q) =>
        q.eq("userId", args.userId).eq("type", args.type).gte("sentAt", cutoff),
      )
      .collect();
    if (args.reminderId) {
      return rows.some((r) => r.reminderId === args.reminderId);
    }
    return rows.length > 0;
  },
});

/** List recent logs for a user — used by the cron to avoid double-sending. */
export const listRecentForUser = query({
  args: { userId: v.string(), type: v.string(), sinceMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.sinceMs;
    return await ctx.db
      .query("pushNotificationLogs")
      .withIndex("by_user_type_sentAt", (q) =>
        q.eq("userId", args.userId).eq("type", args.type).gte("sentAt", cutoff),
      )
      .collect();
  },
});

/** Prune logs older than 7 days — called periodically by the cron. */
export const pruneOld = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // Convex doesn't support delete-by-index directly; collect then delete.
    // We limit to 500 rows per run to stay within mutation time limits.
    const old = await ctx.db.query("pushNotificationLogs").order("asc").take(500);
    for (const row of old) {
      if (row.sentAt < cutoff) await ctx.db.delete(row._id);
    }
  },
});
