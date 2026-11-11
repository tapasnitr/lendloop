import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, clean, getViewer, todayISO } from "./lib";

/** Tools currently out on loan (approved, not returned, already started). */
async function toolsOnLoan(ctx: QueryCtx): Promise<Set<Id<"tools">>> {
  const today = todayISO();
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_status", (q) => q.eq("status", "approved"))
    .collect();
  return new Set(approved.filter((l) => l.startDate <= today).map((l) => l.toolId));
}

/** PUBLIC: name + category only. No ids, no owner data. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const onLoan = await toolsOnLoan(ctx);
    const tools = await ctx.db.query("tools").order("desc").take(100);
    return tools
      .filter((t) => !onLoan.has(t._id))
      .map((t) => ({ key: t._id.toString(), name: t.name, category: t.category }));
  },
});

export const listAll = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    const viewer = await getViewer(ctx);
    const onLoan = await toolsOnLoan(ctx);
    const base =
      category && category !== "all"
        ? ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category))
        : ctx.db.query("tools");
    const tools = await base.order("desc").take(200);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          available: !onLoan.has(t._id),
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trusted ?? false,
          isMine: t.ownerId === viewer._id,
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    const onLoan = await toolsOnLoan(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    return tools.map((t) => ({ ...t, available: !onLoan.has(t._id) }));
  },
});

const toolFields = {
  name: v.string(),
  category: v.string(),
  condition: v.string(),
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, a) => {
    const viewer = await getViewer(ctx);
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name: clean(a.name, 80, "Name"),
      category: clean(a.category, 40, "Category").toLowerCase(),
      condition: clean(a.condition, 40, "Condition"),
      description: clean(a.description, 400, "Description"),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...a }) => {
    const viewer = await getViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("Not found");
    // Owner only. Admins may remove listings but not edit someone else's content.
    if (tool.ownerId !== viewer._id) throw new Error("Forbidden");
    await ctx.db.patch(toolId, {
      name: clean(a.name, 80, "Name"),
      category: clean(a.category, 40, "Category").toLowerCase(),
      condition: clean(a.condition, 40, "Condition"),
      description: clean(a.description, 400, "Description"),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await getViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("Not found");
    const isOwner = tool.ownerId === viewer._id;
    if (!isOwner) assertAdmin(viewer); // owner or admin only

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (loans.some((l) => l.status === "approved") && !(viewer.role === "admin")) {
      throw new Error("Tool is on loan; mark it returned first");
    }
    // Close out any open requests so nobody is left waiting.
    for (const l of loans) {
      if (l.status === "requested") await ctx.db.patch(l._id, { status: "declined" });
    }
    await ctx.db.delete(toolId);
  },
});
