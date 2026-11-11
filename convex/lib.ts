import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/** Resolve the signed-in user's row. Throws if unauthenticated. */
export async function getViewer(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new Error("Profile not initialised");
  return user;
}

export async function getViewerOrNull(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export function assertAdmin(user: Doc<"users">) {
  if (user.role !== "admin") throw new Error("Forbidden: admin only");
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function assertDate(s: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
}

export const overlaps = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) => a.startDate <= b.endDate && b.startDate <= a.endDate;

export function clean(s: string, max: number, label: string) {
  const t = s.trim();
  if (!t) throw new Error(`${label} is required`);
  if (t.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return t;
}
