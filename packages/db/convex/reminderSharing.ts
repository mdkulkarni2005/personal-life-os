import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function randomToken() {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createInvite = mutation({
  args: {
    userId: v.string(),
    reminderId: v.id("reminders"),
  },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.userId !== args.userId) return null;

    const existing = await ctx.db
      .query("reminderInvites")
      .withIndex("by_reminder", (q) => q.eq("reminderId", args.reminderId))
      .first();
    if (existing) return { token: existing.token, reminderId: args.reminderId };

    const token = randomToken();
    await ctx.db.insert("reminderInvites", {
      token,
      reminderId: args.reminderId,
      ownerUserId: args.userId,
      createdAt: Date.now(),
    });
    return { token, reminderId: args.reminderId };
  },
});

export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.token.trim();
    const invites = await ctx.db
      .query("reminderInvites")
      .withIndex("by_token", (q) => q.eq("token", trimmed))
      .collect();
    const invite = invites[0];
    if (!invite) return null;
    const reminder = await ctx.db.get(invite.reminderId);
    if (!reminder) return null;
    return {
      token: invite.token,
      reminderId: invite.reminderId,
      ownerUserId: invite.ownerUserId,
      title: reminder.title,
      dueAt: reminder.dueAt,
      notes: reminder.notes,
      status: reminder.status,
    };
  },
});

export const acceptInvite = mutation({
  args: {
    token: v.string(),
    userId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.token.trim();
    const invites = await ctx.db
      .query("reminderInvites")
      .withIndex("by_token", (q) => q.eq("token", trimmed))
      .collect();
    const invite = invites[0];
    if (!invite) return { ok: false as const, reason: "not_found" as const };

    const reminder = await ctx.db.get(invite.reminderId);
    if (!reminder) return { ok: false as const, reason: "not_found" as const };

    if (reminder.userId === args.userId) {
      return {
        ok: false as const,
        reason: "owner_self" as const,
        reminderId: invite.reminderId,
        title: reminder.title,
      };
    }

    const existing = await ctx.db
      .query("reminderParticipants")
      .withIndex("by_reminder_user", (q) =>
        q.eq("reminderId", invite.reminderId).eq("userId", args.userId)
      )
      .unique();
    if (existing) {
      return {
        ok: true as const,
        already: true as const,
        reminderId: invite.reminderId,
        ownerUserId: invite.ownerUserId,
        title: reminder.title,
        displayName: existing.displayName,
      };
    }

    const name = args.displayName.trim() || "Someone";
    await ctx.db.insert("reminderParticipants", {
      reminderId: invite.reminderId,
      userId: args.userId,
      displayName: name,
      acceptedAt: Date.now(),
    });

    return {
      ok: true as const,
      already: false as const,
      reminderId: invite.reminderId,
      ownerUserId: invite.ownerUserId,
      title: reminder.title,
      displayName: name,
    };
  },
});

export const listParticipants = query({
  args: { reminderId: v.id("reminders"), userId: v.string() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.userId !== args.userId) return [];
    return await ctx.db
      .query("reminderParticipants")
      .withIndex("by_reminder", (q) => q.eq("reminderId", args.reminderId))
      .collect();
  },
});

export const shareRemindersToUsers = mutation({
  args: {
    userId: v.string(),
    reminderIds: v.array(v.id("reminders")),
    targetUserIds: v.array(v.string()),
    fromDisplayName: v.string(),
  },
  handler: async (ctx, args) => {
    const uniqueTargets = [...new Set(args.targetUserIds)].filter((id) => id && id !== args.userId);
    if (uniqueTargets.length === 0) return { ok: true as const, delivered: 0 };

    let delivered = 0;
    const name = args.fromDisplayName.trim() || "Someone";

    for (const reminderId of args.reminderIds) {
      const reminder = await ctx.db.get(reminderId);
      if (!reminder || reminder.userId !== args.userId) continue;

      let token: string;
      const existingInvite = await ctx.db
        .query("reminderInvites")
        .withIndex("by_reminder", (q) => q.eq("reminderId", reminderId))
        .first();
      if (existingInvite) {
        token = existingInvite.token;
      } else {
        token = randomToken();
        await ctx.db.insert("reminderInvites", {
          token,
          reminderId,
          ownerUserId: args.userId,
          createdAt: Date.now(),
        });
      }

      for (const toUserId of uniqueTargets) {
        const alreadyParticipant = await ctx.db
          .query("reminderParticipants")
          .withIndex("by_reminder_user", (q) =>
            q.eq("reminderId", reminderId).eq("userId", toUserId)
          )
          .unique();
        if (alreadyParticipant) continue;

        const existingInbox = await ctx.db
          .query("reminderShareInbox")
          .withIndex("by_to_reminder", (q) =>
            q.eq("toUserId", toUserId).eq("reminderId", reminderId)
          )
          .first();
        if (existingInbox && !existingInbox.dismissed) continue;

        if (existingInbox) {
          await ctx.db.patch(existingInbox._id, {
            token,
            fromDisplayName: name,
            title: reminder.title,
            dueAt: reminder.dueAt,
            createdAt: Date.now(),
            dismissed: false,
          });
        } else {
          await ctx.db.insert("reminderShareInbox", {
            reminderId,
            token,
            fromUserId: args.userId,
            fromDisplayName: name,
            toUserId,
            title: reminder.title,
            dueAt: reminder.dueAt,
            createdAt: Date.now(),
          });
        }
        delivered += 1;
      }
    }
    return { ok: true as const, delivered };
  },
});

export const listShareInbox = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("reminderShareInbox")
      .withIndex("by_to_user_created", (q) => q.eq("toUserId", args.userId))
      .order("desc")
      .collect();
    return rows.filter((r) => !r.dismissed);
  },
});

export const dismissShareInboxForReminder = mutation({
  args: { userId: v.string(), reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("reminderShareInbox")
      .withIndex("by_to_reminder", (q) =>
        q.eq("toUserId", args.userId).eq("reminderId", args.reminderId)
      )
      .collect();
    for (const r of rows) {
      await ctx.db.patch(r._id, { dismissed: true });
    }
    return { ok: true as const };
  },
});

export const dismissShareInboxRow = mutation({
  args: { userId: v.string(), inboxId: v.id("reminderShareInbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.inboxId);
    if (!row || row.toUserId !== args.userId) return null;
    await ctx.db.patch(args.inboxId, { dismissed: true });
    return { ok: true as const };
  },
});
