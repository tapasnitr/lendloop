import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { assertAdmin, assertDate, getViewer, overlaps, todayISO } from "./lib";

async function enrich(ctx: QueryCtx, loans: Doc<"loans">[]) {
  return await Promise.all(
    loans.map(async (l) => {
      const [tool, owner, borrower, events] = await Promise.all([
        ctx.db.get(l.toolId),
        ctx.db.get(l.ownerId),
        ctx.db.get(l.borrowerId),
        ctx.db
          .query("automationEvents")
          .withIndex("by_loan", (q) => q.eq("loanId", l._id))
          .order("desc")
          .take(3),
      ]);
      return {
        _id: l._id,
        toolName: tool?.name ?? "(removed)",
        ownerName: owner?.name ?? "Unknown",
        borrowerName: borrower?.name ?? "Unknown",
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        overdue: l.status === "approved" && l.endDate < todayISO(),
        // Bonus: recent automation activity shown on each loan.
        activity: events.map((e) => ({ kind: e.kind, status: e.status, at: e.at })),
      };
    }),
  );
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    return await enrich(ctx, loans);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(100);
    return await enrich(ctx, loans);
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    assertAdmin(await getViewer(ctx));
    return await enrich(ctx, await ctx.db.query("loans").order("desc").take(200));
  },
});

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await getViewer(ctx);
    assertDate(startDate, "Start date");
    assertDate(endDate, "End date");
    if (endDate < startDate) throw new Error("End date must be on or after start date");
    if (startDate < todayISO()) throw new Error("Start date cannot be in the past");

    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("Tool not found");
    if (tool.ownerId === viewer._id) throw new Error("You cannot borrow your own tool");

    const existing = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    const range = { startDate, endDate };
    if (existing.some((l) => l.status === "approved" && overlaps(l, range))) {
      throw new Error("Tool is already booked for those dates");
    }
    if (existing.some((l) => l.borrowerId === viewer._id && l.status === "requested" && overlaps(l, range))) {
      throw new Error("You already have a pending request for those dates");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "requested",
    });
    await ctx.scheduler.runAfter(0, internal.automation.sendWebhook, {
      loanId,
      event: "request_created",
      attempt: 0,
    });
    return loanId;
  },
});

export const decide = mutation({
  args: { loanId: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, { loanId, approve }) => {
    const viewer = await getViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Not found");
    if (loan.ownerId !== viewer._id) throw new Error("Forbidden"); // lender only
    if (loan.status !== "requested") throw new Error("Request is no longer pending");

    if (approve) {
      const others = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
        .collect();
      if (others.some((o) => o._id !== loan._id && o.status === "approved" && overlaps(o, loan))) {
        throw new Error("Dates overlap with an approved loan");
      }
    }
    const status = approve ? "approved" : "declined";
    await ctx.db.patch(loanId, { status });
    await ctx.scheduler.runAfter(0, internal.automation.sendWebhook, {
      loanId,
      event: approve ? "request_approved" : "request_declined",
      attempt: 0,
    });
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await getViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Not found");
    // Lender confirms the return (admin may do it on their behalf).
    if (loan.ownerId !== viewer._id && viewer.role !== "admin") throw new Error("Forbidden");
    if (loan.status !== "approved") throw new Error("Only approved loans can be returned");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.sendWebhook, {
      loanId,
      event: "loan_returned",
      attempt: 0,
    });
  },
});
