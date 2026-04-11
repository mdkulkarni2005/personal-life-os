import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

const messageValidator = v.object({
  clientId: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
  content: v.string(),
  createdAt: v.string(),
  metaJson: v.optional(v.string()),
});

export const listForUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId))
      .collect();
    const cutoff = Date.now() - RETENTION_MS;
    return rows
      .filter((r) => r.createdAt >= cutoff)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        clientId: r.clientId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        metaJson: r.metaJson,
      }));
  },
});

export const replaceAllForUser = mutation({
  args: {
    userId: v.string(),
    messages: v.array(messageValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatMessages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    const cutoff = Date.now() - RETENTION_MS;
    for (const m of args.messages) {
      const t = new Date(m.createdAt).getTime();
      if (!Number.isFinite(t) || t < cutoff) continue;
      await ctx.db.insert("chatMessages", {
        userId: args.userId,
        clientId: m.clientId,
        role: m.role,
        content: m.content,
        createdAt: t,
        metaJson: m.metaJson,
      });
    }
  },
});

export const clearForUser = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatMessages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
  },
});
