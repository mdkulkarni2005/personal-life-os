import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeTitle(value: string) {
  return value.trim().toLowerCase();
}

async function getReminderAccess(
  ctx: QueryCtx | MutationCtx,
  reminderId: Id<"reminders">,
  userId: string
) {
  const reminder = await ctx.db.get(reminderId);
  if (!reminder) return null;
  if (reminder.userId === userId) return { reminder, role: "owner" as const };
  const participant = await ctx.db
    .query("reminderParticipants")
    .withIndex("by_reminder_user", (q) =>
      q.eq("reminderId", reminderId).eq("userId", userId)
    )
    .unique();
  if (participant) return { reminder, role: "participant" as const };
  return null;
}

async function deleteReminderCascade(ctx: MutationCtx, reminderId: Id<"reminders">) {
  const invites = await ctx.db
    .query("reminderInvites")
    .withIndex("by_reminder", (q) => q.eq("reminderId", reminderId))
    .collect();
  for (const inv of invites) {
    await ctx.db.delete(inv._id);
  }
  const participants = await ctx.db
    .query("reminderParticipants")
    .withIndex("by_reminder", (q) => q.eq("reminderId", reminderId))
    .collect();
  for (const p of participants) {
    await ctx.db.delete(p._id);
  }
  await ctx.db.delete(reminderId);
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

export const listForUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const owned = await ctx.db
      .query("reminders")
      .withIndex("by_user_dueAt", (q) => q.eq("userId", args.userId))
      .collect();
    const participation = await ctx.db
      .query("reminderParticipants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const shared: typeof owned = [];
    for (const p of participation) {
      const r = await ctx.db.get(p.reminderId);
      if (r) shared.push(r);
    }
    return { owned, shared };
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
    priority: v.optional(v.number()),
    urgency: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(v.union(v.literal("pending"), v.literal("done"), v.literal("archived"))),
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
      status: args.status ?? "pending",
      recurrence: args.recurrence ?? "none",
      priority: args.priority,
      urgency: args.urgency,
      tags: args.tags?.filter((tag) => tag.trim().length > 0),
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
    status: v.optional(v.union(v.literal("pending"), v.literal("done"), v.literal("archived"))),
    recurrence: v.optional(
      v.union(v.literal("none"), v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
    ),
    priority: v.optional(v.number()),
    urgency: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const access = await getReminderAccess(ctx, args.reminderId, args.userId);
    if (!access) return null;
    const current = access.reminder;

    await ctx.db.patch(args.reminderId, {
      title: args.title?.trim() ?? current.title,
      notes: args.notes?.trim() || undefined,
      dueAt: args.dueAt ?? current.dueAt,
      status: args.status ?? current.status,
      recurrence: args.recurrence ?? current.recurrence ?? "none",
      priority: args.priority ?? current.priority,
      urgency: args.urgency ?? current.urgency,
      tags: args.tags ?? current.tags,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.reminderId);
  },
});

export const remove = mutation({
  args: { userId: v.string(), reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const access = await getReminderAccess(ctx, args.reminderId, args.userId);
    if (!access) return { ok: false as const };
    const title = access.reminder.title;
    const ownerUserId = access.reminder.userId;
    await deleteReminderCascade(ctx, args.reminderId);
    return {
      ok: true as const,
      title,
      ownerUserId,
      actorWasOwner: access.role === "owner",
    };
  },
});
