# HVAC Website Chatbot

An embeddable chat widget for local HVAC companies: grounded FAQ
answering (Claude Haiku), lead capture with independent email/SMS
notifications, after-hours awareness, a monthly recap email, and a
missed-question log — all driven by one `client-config.json` file per
deployed instance.

See `NEW_CLIENT_SETUP.md` for how to reskin and redeploy this for a new
client.

## Local setup

```bash
npm install
cp .env.example .env      # fill in your API keys, see below
cp client-config.example.json client-config.json   # or edit in place
npm start
```

The server listens on `PORT` (default `3000`). Open
`http://localhost:3000/api/health` to confirm it's running, and embed the
widget on a local test HTML page with:

```html
<script src="http://localhost:3000/widget.js" async></script>
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (default 3000) | HTTP port |
| `CONFIG_PATH` | no (default `./client-config.json`) | path to the client config file |
| `DATA_DB_PATH` | no (default `./data/leads.sqlite`) | SQLite file location |
| `ANTHROPIC_API_KEY` | yes, for FAQ answering | Claude API key |
| `ANTHROPIC_MODEL` | no (default `claude-haiku-4-5-20251001`) | model id override |
| `SENDGRID_API_KEY` | yes, for owner email notifications | SendGrid API key with "Mail Send" permission |
| `NOTIFY_FROM_EMAIL` | yes, for owner email notifications | From address; must be a verified sender in SendGrid |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | yes, for visitor SMS | Twilio credentials |
| `TWILIO_FROM_NUMBER` | yes, for visitor SMS | Twilio phone number, E.164 format |

If any of the above are left unset, that feature degrades gracefully
(e.g. no `ANTHROPIC_API_KEY` → chat falls back to lead capture for every
question; no Twilio creds → SMS is skipped but the lead is still saved
and emailed) rather than crashing the server.

## Running tests

```bash
npm test
```

This runs the full suite via Node's built-in test runner. The FAQ
phrasing reliability suite (`test/faq-phrasing.test.js`) calls the real
Anthropic API and only runs when `ANTHROPIC_API_KEY` is set in the
environment — otherwise it's skipped (not failed), so `npm test` works
without any keys configured. To get the full reliability signal:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm test
```

## Deployment

**Backend + widget assets:** [Railway](https://railway.app). This is a
long-running Node process (not serverless), which is what lets the
SQLite file persist on a mounted volume and lets the monthly recap run
as an in-process scheduled job (`node-cron`) rather than needing an
external cron trigger.

1. Push this folder to a git repo (one repo/branch per client, or one
   repo with per-client deploys — see `NEW_CLIENT_SETUP.md`).
2. Create a Railway service from that repo.
3. Attach a persistent volume mounted at `./data`.
4. Set the environment variables from the table above in Railway's
   dashboard.
5. Deploy — Railway runs `npm install` then `npm start`.
6. Point the client's DNS/subdomain at the Railway service, or use the
   Railway-provided URL directly in the widget `<script>` tag.

**Email:** [SendGrid](https://sendgrid.com) via its HTTPS API (Railway
blocks outbound SMTP on lower tiers, so SMTP-based providers won't work).
Verify a single sender address (Settings → Sender Authentication → Single
Sender Verification) — no domain required — or verify a domain, then
create an API key with "Mail Send" permission and set `SENDGRID_API_KEY`
and `NOTIFY_FROM_EMAIL`. One SendGrid account serves every client; the
free tier's 100 emails/day is far above what a handful of clients
generate.

**SMS:** [Twilio](https://twilio.com) — buy/verify a phone number, set
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

**LLM:** [Anthropic Claude](https://console.anthropic.com) — create an
API key, set `ANTHROPIC_API_KEY`. FAQ answering uses Claude Haiku by
default (fast + inexpensive), overridable via `ANTHROPIC_MODEL`.

## Project structure

```
server/     Express backend: routes, services, db, config loader, jobs
widget/     Embeddable widget (widget.js + widget.css), served statically
test/       node:test suite covering every service, route, and fail-safe
client-config.example.json   Template for the one per-client config file
```
