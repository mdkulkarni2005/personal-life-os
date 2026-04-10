import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeTitle(value: string) {
  return value.trim().toLowerCase();
}

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reminders")
      .withIndex("by_user_dueAt", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    notes: v.optional(v.string()),
    dueAt: v.number(),
    recurrence: v.optional(
      v.union(v.literal("none"), v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
    ),
  },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    const now = Date.now();

    const sameTime = await ctx.db
      .query("reminders")
      .withIndex("by_user_dueAt", (q) => q.eq("userId", args.userId).eq("dueAt", args.dueAt))
      .collect();

    const duplicate = sameTime.find(
      (item) =>
        item.status === "pending" && normalizeTitle(item.title) === normalizeTitle(title)
    );
    if (duplicate) {
      return { created: false, reminder: duplicate };
    }

    const id = await ctx.db.insert("reminders", {
      userId: args.userId,
      title,
      notes: args.notes?.trim() || undefined,
      dueAt: args.dueAt,
      status: "pending",
      recurrence: args.recurrence ?? "none",
      createdAt: now,
      updatedAt: now,
    });

    const reminder = await ctx.db.get(id);
    return { created: true, reminder };
  },
});

export const update = mutation({
  args: {
    userId: v.string(),
    reminderId: v.id("reminders"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("pending"), v.literal("done"))),
    recurrence: v.optional(
      v.union(v.literal("none"), v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
    ),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.reminderId);
    if (!current || current.userId !== args.userId) return null;

    await ctx.db.patch(args.reminderId, {
      title: args.title?.trim() ?? current.title,
      notes: args.notes?.trim() || undefined,
      dueAt: args.dueAt ?? current.dueAt,
      status: args.status ?? current.status,
      recurrence: args.recurrence ?? current.recurrence ?? "none",
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.reminderId);
  },
});

export const remove = mutation({
  args: { userId: v.string(), reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.reminderId);
    if (!current || current.userId !== args.userId) return false;
    await ctx.db.delete(args.reminderId);
    return true;
  },
});
