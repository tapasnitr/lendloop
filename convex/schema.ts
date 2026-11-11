import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const CATEGORIES = [
  "power tools",
  "hand tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trusted: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    status: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned"),
    ),
    returnedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_tool", ["toolId"])
    .index("by_status", ["status"]),

  // Audit trail of automation (webhooks + reminders). `key` makes writes idempotent.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: v.string(), // e.g. "notify:request_created", "overdue_reminder"
    key: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"]),
});
