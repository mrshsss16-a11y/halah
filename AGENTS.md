# AGENTS.md

> This file exists so agents that look for `AGENTS.md` land in the right place.

**Read [`AGENT.md`](AGENT.md) — it is the full architecture and safety guide for this repo.**
Non-negotiable rules are also summarised in [`CLAUDE.md`](CLAUDE.md).

## The three that will break production if ignored

1. **Never introduce Astro or anything that emits `dist/_worker.js`.** It switches Cloudflare
   Pages into Advanced Mode, which makes it ignore `functions/` entirely — this already took
   all 56 API endpoints down with 404s in production (2026-07-31), WhatsApp webhook and login
   included. `scripts/verify-dist.mjs` blocks it; do not disable that guard.
2. **Deploy only via `npm run deploy`** (build → verify → `--branch=main`). Deploying without
   `--branch=main` publishes to a Preview branch that no one sees on the live domain.
3. **Fail closed on missing secrets.** No hardcoded secrets, no default secret values, no auth
   bypass behind an env flag. Never trust a client-supplied identity.

## Verify after every deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hala-ai-os.pages.dev/api/health   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://hala-ai-os.pages.dev/api/whatsapp/webhook -d '{}'                        # expect 401
```
A 404 on either means the API is down.
