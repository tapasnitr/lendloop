# LendLoop

> Borrow what you need. Lend what you don't.

A neighborhood tool-lending board. Next.js (App Router) + Clerk + Convex + n8n, in TypeScript.

## Architecture

```
Browser (Next.js, Clerk)
   │  Clerk JWT                         ┌─────────────────────────┐
   ▼                                    │ n8n (Docker)            │
Convex  ── signed webhook (HMAC) ─────▶ │ 1. Request notification │
 queries/mutations/actions              │ 2. Overdue reminders    │
 HTTP endpoints  ◀── Bearer key ─────── │ 3. Error handler        │
 (/api/overdue, /api/reminders)         └─────────────────────────┘
```

- **Auth:** Clerk issues a JWT (template `convex`); Convex validates it (`convex/auth.config.ts`).
- **Data:** `users`, `tools`, `loans`, `automationEvents` (see `convex/schema.ts`).
- **Authorization:** every mutation/query calls `getViewer()` and checks role/ownership **inside Convex**; the UI only hides buttons.
- **Automation:** Convex mutations schedule `automation.sendWebhook`; n8n handles notifications and the daily overdue job.

## Roles and rules

| Action | user | admin |
|---|---|---|
| See public list (name + category only) | anyone, even signed out | |
| Create listing | yes | yes |
| Edit listing | own only | own only |
| Delete listing | own only | any |
| Request to borrow | not own tool | not own tool |
| Approve/decline request | on own tools only | on own tools only |
| Mark returned | lender | lender or admin |
| View all loans, mark Trusted Lender | no | yes |

Admins are set by the `ADMIN_EMAILS` Convex env var (promoted on sign-in). Nobody can self-promote.

## Local setup

Prereqs: Node 20+, Docker, a free [Clerk](https://clerk.com) app, a free [Convex](https://convex.dev) account.

1. `npm install`
2. **Clerk:** create an app. In *JWT Templates* create a template named **`convex`** (Convex preset) and make sure the `email` and `name` claims are included. Note the *Issuer* URL.
3. `npx convex dev` (first run creates a deployment and writes `.env.local` with `NEXT_PUBLIC_CONVEX_URL`). Leave it running.
4. Add Clerk keys to `.env.local` (see `.env.example`).
5. Set Convex env vars (generate secrets with `openssl rand -hex 32`):
   ```
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev
   npx convex env set ADMIN_EMAILS you@example.com
   npx convex env set N8N_WEBHOOK_SECRET <secret>
   npx convex env set N8N_API_KEY <api-key>
   npx convex env set N8N_WEBHOOK_URL https://<public-n8n-url>/webhook/lendloop-request
   ```
6. `npm run dev` → http://localhost:3000

### n8n

Convex Cloud must be able to reach n8n, so expose it with a tunnel while developing (e.g. `cloudflared tunnel --url http://localhost:5678` or `ngrok http 5678`) and use that URL as `N8N_PUBLIC_URL` and in `N8N_WEBHOOK_URL`.

1. Copy the "docker-compose / n8n" block of `.env.example` to `.env` and fill it in (`CONVEX_SITE_URL` is the `.convex.site` URL).
2. `docker compose up -d`, open http://localhost:5678.
3. Import `n8n/01…`, `02…`, `03…` (Workflows → Import from file).
4. Create a **Header Auth** credential named **Convex API Key**: name `Authorization`, value `Bearer <N8N_API_KEY>`. Select it on the two HTTP Request nodes in workflow 2.
5. In workflows 1 and 2 → Settings → **Error workflow** = "LendLoop - Error handler".
6. Publish (activate) all three workflows. `N8N_WEBHOOK_URL` must use the Production URL (`/webhook/…`); use the Test URL only while editing in n8n.

Try it: sign in as two users, list a tool as A, request it as B → n8n logs `[NOTIFY] …`. To test overdue reminders, approve a loan whose end date is in the past (edit the date in the Convex dashboard), then run workflow 2 manually.

## Environment variables

| Where | Name | Purpose |
|---|---|---|
| `.env.local` | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | App + Clerk |
| Convex | `CLERK_JWT_ISSUER_DOMAIN` | JWT validation |
| Convex | `ADMIN_EMAILS` | Comma-separated admin emails |
| Convex | `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | Outbound signed webhook |
| Convex | `N8N_API_KEY` | Inbound auth for `/api/*` |
| n8n (`.env`) | `N8N_WEBHOOK_SECRET`, `CONVEX_SITE_URL`, `N8N_ENCRYPTION_KEY` | Verify signature, call Convex, encrypt credentials |

No secret is stored in code or in the exported workflow JSON (the API key lives in an n8n credential; the HMAC secret in env).

## Security and data-minimisation decisions

- **Server-side RBAC** in every Convex function; ownership checked on the document, not trusted from the client.
- **Public query** returns only `name` and `category` of available tools — no ids, owners, descriptions.
- **Webhook payloads** carry only what one notification needs (recipient name/email, tool name, dates, status, other party's display name). No user ids, no tokens, no descriptions.
- **Signed webhooks (Convex → n8n):** HMAC-SHA256 over `timestamp.body`, 5-minute replay window, timing-safe comparison in n8n.
- **Authenticated API (n8n → Convex):** bearer key, constant-time comparison, **fails closed** if unset; strict body validation.
- **Idempotency:** `automationEvents.key` is unique-by-convention (`notify:<event>:<loan>`, `overdue:<loan>:<date>`); a `sent` record is never duplicated, so retries and double-posts are harmless. Overdue reminders are at most one per loan per day.
- **Reliability:** Convex retries failed webhooks with exponential backoff (10/20/40/80 s, 5 attempts) and records each failure; n8n HTTP nodes retry 3×; the error workflow makes failed runs visible. Failures also show in the loan's activity line in the UI.
- **Input validation:** length limits, date format and range checks, overlap prevention on request and approval.
- Admins can remove listings but cannot edit others' content.

## Known trade-offs

- Signature is verified over `JSON.stringify(parsedBody)` rather than the raw bytes (simpler in n8n; works because Convex sends compact JSON). Production should verify the raw body.
- Notifications are **mock/logged**; swap the Code nodes for Email/Slack/Discord.
- `convex/_generated` is committed so type checking works on a fresh clone; `npx convex dev` keeps it up to date.

See [PRODUCTION.md](PRODUCTION.md) for what I would change before shipping.
