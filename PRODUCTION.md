# What I would change for production

1. **Raw-body signature verification** in n8n (enable the Webhook node's "Raw Body" option) instead of re-serialising JSON.
2. **Secrets management:** rotate `N8N_WEBHOOK_SECRET` / `N8N_API_KEY` regularly; support two active secrets during rotation; keep them in a secrets manager rather than `.env` files.
3. **Real notification channel** (email via SES/Resend + Slack for admins) with templates and unsubscribe/preferences; never include more than first name and tool name.
4. **n8n hardening:** run behind HTTPS and a reverse proxy, restrict webhook ingress to Convex egress where possible, use Postgres instead of SQLite, queue mode for scale, pin the image version, back up credentials and the encryption key.
5. **Observability:** Sentry for the Next.js app and Convex errors, alerts on `automationEvents.status = failed`, dashboards for webhook latency and failure rate; error workflow posts to a paging channel.
6. **Dead-letter handling:** after 5 failed attempts, surface the event to admins with a "retry" action instead of only recording it.
7. **Rate limiting** on mutations (e.g. requests per user per hour) and abuse controls (report/block users).
8. **Privacy:** privacy policy, data export/delete on request, retention limits on `automationEvents`, and avoid storing emails by reading them from Clerk at send time.
9. **Roles:** move from `ADMIN_EMAILS` to Clerk organization roles or an audited admin-management flow; add an audit log for admin actions.
10. **Testing/CI:** unit tests for Convex functions (convex-test), Playwright e2e for the borrow flow, CI with typecheck + lint, preview deployments.
11. **Data model:** timezone-aware dates, pickup/return handoff states, deposits/damage reports, pagination instead of `take(200)`.
