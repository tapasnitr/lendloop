import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { todayISO } from "./lib";

const MAX_ATTEMPTS = 5;

type WebhookEvent = "request_created" | "request_approved" | "request_declined" | "loan_returned";

const eventValidator = v.union(
  v.literal("request_created"),
  v.literal("request_approved"),
  v.literal("request_declined"),
  v.literal("loan_returned"),
);

async function hmacHex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Data minimisation: only what n8n needs to notify one person.
 * request_created -> notify the lender; everything else -> notify the borrower.
 */
export const getPayload = internalQuery({
  args: { loanId: v.id("loans"), event: eventValidator },
  handler: async (ctx, { loanId, event }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.ownerId),
      ctx.db.get(loan.borrowerId),
    ]);
    const toLender = event === "request_created";
    const recipient = toLender ? owner : borrower;
    const other = toLender ? borrower : owner;
    if (!recipient) return null;
    return {
      event,
      loanId: loan._id,
      recipient: { name: recipient.name, email: recipient.email ?? null },
      otherPartyName: other?.name ?? "A neighbor",
      toolName: tool?.name ?? "a tool",
      startDate: loan.startDate,
      endDate: loan.endDate,
      status: loan.status,
    };
  },
});

export const alreadySent = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const e = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    return e?.status === "sent";
  },
});

/** Idempotent upsert keyed by `key`. A "sent" record is never overwritten or duplicated. */
export const recordEvent = internalMutation({
  args: {
    loanId: v.string(),
    kind: v.string(),
    key: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const loanId = ctx.db.normalizeId("loans", a.loanId);
    if (!loanId) throw new Error("Unknown loan");
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
    const detail = a.detail?.slice(0, 300);
    if (existing) {
      if (existing.status === "sent") return { duplicate: true };
      await ctx.db.patch(existing._id, { status: a.status, detail, at: Date.now() });
      return { duplicate: false };
    }
    await ctx.db.insert("automationEvents", {
      loanId,
      kind: a.kind,
      key: a.key,
      status: a.status,
      detail,
      at: Date.now(),
    });
    return { duplicate: false };
  },
});

/** Convex -> n8n. Signed, retried with exponential backoff, failures recorded (never silent). */
export const sendWebhook = internalAction({
  args: { loanId: v.id("loans"), event: eventValidator, attempt: v.number() },
  // Explicit return type: the action schedules itself, which otherwise makes inference circular.
  handler: async (ctx, { loanId, event, attempt }): Promise<void> => {
    const key = `notify:${event}:${loanId}`;
    if (await ctx.runQuery(internal.automation.alreadySent, { key })) return; // retry-safe

    const payload = await ctx.runQuery(internal.automation.getPayload, { loanId, event });
    if (!payload) return;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    const fail = async (detail: string) => {
      if (attempt + 1 < MAX_ATTEMPTS) {
        const delayMs = 10_000 * 2 ** attempt; // 10s, 20s, 40s, 80s
        await ctx.scheduler.runAfter(delayMs, internal.automation.sendWebhook, {
          loanId,
          event: event as WebhookEvent,
          attempt: attempt + 1,
        });
      }
      await ctx.runMutation(internal.automation.recordEvent, {
        loanId,
        kind: `notify:${event}`,
        key,
        status: "failed",
        detail: `attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${detail}`,
      });
    };

    if (!url || !secret) return await fail("N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET not configured");

    const body = JSON.stringify({ ...payload, idempotencyKey: key });
    const ts = Date.now().toString();
    const signature = await hmacHex(secret, `${ts}.${body}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": ts,
          "x-lendloop-signature": `sha256=${signature}`,
          "x-idempotency-key": key,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return await fail(`n8n responded ${res.status}`);
    } catch (err) {
      return await fail(err instanceof Error ? err.message : "network error");
    }
    await ctx.runMutation(internal.automation.recordEvent, {
      loanId,
      kind: `notify:${event}`,
      key,
      status: "sent",
    });
  },
});

/** Overdue loans that have not yet been reminded today. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayISO();
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const out = [];
    for (const l of approved) {
      if (l.endDate >= today) continue;
      const idempotencyKey = `overdue:${l._id}:${today}`;
      const done = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", idempotencyKey)).unique();
      if (done?.status === "sent") continue;
      const [tool, borrower] = await Promise.all([ctx.db.get(l.toolId), ctx.db.get(l.borrowerId)]);
      if (!borrower) continue;
      out.push({
        loanId: l._id,
        idempotencyKey,
        borrowerName: borrower.name,
        borrowerEmail: borrower.email ?? null,
        toolName: tool?.name ?? "a tool",
        endDate: l.endDate,
        daysOverdue: Math.floor((Date.parse(today) - Date.parse(l.endDate)) / 86_400_000),
      });
    }
    return out;
  },
});
