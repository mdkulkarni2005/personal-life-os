import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const lifeDomain = v.union(
  v.literal("health"),
  v.literal("finance"),
  v.literal("career"),
  v.literal("hobby"),
  v.literal("fun")
);

export const listForUser = query({
  args: { userId: v.string() },
  handler: async (ctx: QueryCtx, args: { userId: string }) => {
    const pending = await ctx.db
      .query("tasks")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "pending"))
      .collect();
    const done = await ctx.db
      .query("tasks")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "done"))
      .collect();
    return [...pending, ...done];
  },
});

export const create = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("pending"), v.literal("done"))),
    priority: v.optional(v.number()),
    domain: v.optional(lifeDomain),
  },
  handler: async (ctx: MutationCtx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("tasks", {
      userId: args.userId,
      title: args.title.trim(),
      notes: args.notes?.trim() || undefined,
      dueAt: args.dueAt,
      status: args.status ?? "pending",
      priority: args.priority,
      domain: args.domain,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    userId: v.string(),
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("pending"), v.literal("done"))),
    priority: v.optional(v.number()),
    domain: v.optional(v.union(lifeDomain, v.null())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.taskId);
    if (!row || row.userId !== args.userId) return null;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.dueAt !== undefined) patch.dueAt = args.dueAt;
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.domain !== undefined) {
      patch.domain = args.domain === null ? undefined : args.domain;
    }
    await ctx.db.patch(args.taskId, patch);
    return await ctx.db.get(args.taskId);
  },
});

export const remove = mutation({
  args: { userId: v.string(), taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.taskId);
    if (!row || row.userId !== args.userId) return { ok: false as const };
    await ctx.db.delete(args.taskId);
    return { ok: true as const };
  },
});
