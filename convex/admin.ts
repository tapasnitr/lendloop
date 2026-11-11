import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertAdmin, getViewer } from "./lib";

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    assertAdmin(await getViewer(ctx));
    const users = await ctx.db.query("users").take(200);
    return users.map((u) => ({ _id: u._id, name: u.name, role: u.role, trusted: u.trusted }));
  },
});

export const setTrusted = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    assertAdmin(await getViewer(ctx));
    if (!(await ctx.db.get(userId))) throw new Error("Not found");
    await ctx.db.patch(userId, { trusted });
  },
});
