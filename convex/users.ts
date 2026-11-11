import { mutation, query } from "./_generated/server";
import { getViewerOrNull } from "./lib";

/** Called once after sign-in. Creates/refreshes the profile row. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const email = identity.email?.toLowerCase();
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const shouldBeAdmin = !!email && admins.includes(email);
    const name = identity.name ?? identity.nickname ?? email ?? "Neighbor";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        email,
        // Promote only; demotion is a deliberate manual action.
        role: shouldBeAdmin ? "admin" : existing.role,
      });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: shouldBeAdmin ? "admin" : "user",
      trusted: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await getViewerOrNull(ctx);
    return u ? { id: u._id, name: u.name, role: u.role, trusted: u.trusted } : null;
  },
});
