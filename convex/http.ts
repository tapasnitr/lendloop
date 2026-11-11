import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

/** Constant-time string compare (avoids leaking the key via timing). */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorised(req: Request) {
  const key = process.env.N8N_API_KEY;
  if (!key) return false; // fail closed
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), key);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// n8n (daily schedule) -> list of overdue loans needing a reminder.
http.route({
  path: "/api/overdue",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorized" }, 401);
    const loans = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json({ loans });
  }),
});

// n8n -> write back reminder outcome. Idempotent on idempotencyKey.
http.route({
  path: "/api/reminders",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorized" }, 401);
    let b: { idempotencyKey?: unknown; loanId?: unknown; status?: unknown; detail?: unknown };
    try {
      b = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const { idempotencyKey, loanId, status, detail } = b;
    if (
      typeof idempotencyKey !== "string" ||
      typeof loanId !== "string" ||
      (status !== "sent" && status !== "failed") ||
      !idempotencyKey.startsWith(`overdue:${loanId}:`) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(idempotencyKey.slice(`overdue:${loanId}:`.length))
    ) {
      return json({ error: "invalid body" }, 400);
    }
    try {
      const r = await ctx.runMutation(internal.automation.recordEvent, {
        loanId,
        kind: "overdue_reminder",
        key: idempotencyKey,
        status,
        detail: typeof detail === "string" ? detail : undefined,
      });
      return json({ ok: true, duplicate: r.duplicate });
    } catch {
      return json({ error: "unknown loan" }, 404);
    }
  }),
});

export default http;
