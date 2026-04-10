import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const reminders = defineTable({
  userId: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  dueAt: v.number(),
  status: v.union(v.literal("pending"), v.literal("done")),
  recurrence: v.optional(
    v.union(v.literal("none"), v.literal("daily"), v.literal("weekly"), v.literal("monthly"))
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_dueAt", ["userId", "dueAt"])
  .index("by_user_status_dueAt", ["userId", "status", "dueAt"]);

export default defineSchema({
  reminders,
});
