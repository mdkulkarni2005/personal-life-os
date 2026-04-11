import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const reminders = defineTable({
  userId: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  dueAt: v.number(),
  status: v.union(v.literal("pending"), v.literal("done"), v.literal("archived")),
  recurrence: v.optional(
    v.union(v.literal("none"), v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
  ),
  priority: v.optional(v.number()),
  urgency: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_dueAt", ["userId", "dueAt"])
  .index("by_user_status_dueAt", ["userId", "status", "dueAt"]);

const reminderInvites = defineTable({
  token: v.string(),
  reminderId: v.id("reminders"),
  ownerUserId: v.string(),
  createdAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_reminder", ["reminderId"]);

const reminderParticipants = defineTable({
  reminderId: v.id("reminders"),
  userId: v.string(),
  displayName: v.string(),
  acceptedAt: v.number(),
})
  .index("by_reminder", ["reminderId"])
  .index("by_reminder_user", ["reminderId", "userId"])
  .index("by_user", ["userId"]);

const tasks = defineTable({
  userId: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  status: v.union(v.literal("pending"), v.literal("done")),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_user_status", ["userId", "status"]);

export default defineSchema({
  reminders,
  reminderInvites,
  reminderParticipants,
  tasks,
});
