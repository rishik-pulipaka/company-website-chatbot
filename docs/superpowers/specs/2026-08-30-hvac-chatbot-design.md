# HVAC Website Chatbot — v1 Design Spec

Date: 2026-08-30
Status: Approved for implementation

## Purpose

A resellable, embeddable website chat widget for local HVAC companies. The
same codebase is redeployed per client by editing one config file and
deploying a new instance — no code changes per client. v1 scope only:
smart FAQ answering, lead capture (save + email + SMS), after-hours
awareness, monthly recap email, missed-question log. No calendar/booking
integration.

## Non-goals (explicitly out of scope for v1)

- Real calendar/booking sync
- Multi-tenant single deployment (each client is its own deployed instance)
- Admin dashboard / UI for reviewing leads or missed questions (data is
  queryable via the DB file directly for v1)
- Authentication/login for the widget or any admin surface
- Any frontend framework — vanilla JS/HTML/CSS only

## Decisions (from clarifying questions)

- **Hosting:** Railway — persistent Node/Express process, persistent
  volume for SQLite, supports in-process `node-cron` for the monthly
  recap job. One Railway service per client.
- **Storage:** SQLite via `better-sqlite3`, single file on Railway's
  persistent volume.
- **Email:** Resend, for owner lead notifications and the monthly recap.
- **SMS:** Twilio, for the visitor confirmation text.
- **Config format:** `client-config.json` (not `.js`) — no code execution
  risk, easy to hand-edit or validate.
- **LLM:** Claude Haiku (via Anthropic API) for free-text FAQ answering,
  grounded strictly in config data.

## Architecture

```
company-website-chatbot/
├── widget/
│   ├── widget.js             # single script-tag include, builds Shadow DOM
│   └── widget.css            # injected into the shadow root
├── server/
│   ├── index.js               # Express app entry
│   ├── db.js                  # better-sqlite3 setup + schema migrations
│   ├── routes/
│   │   ├── config.js          # GET /api/config (safe, public-facing subset)
│   │   ├── chat.js            # POST /api/chat
│   │   └── lead.js            # POST /api/lead
│   ├── services/
│   │   ├── faq.js             # system prompt construction + Anthropic call
│   │   ├── notify-email.js    # Resend send, isolated try/catch
│   │   ├── notify-sms.js      # Twilio send, isolated try/catch
│   │   └── hours.js           # after-hours check with fail-safe default
│   ├── jobs/
│   │   └── monthly-recap.js   # node-cron schedule, queries SQLite, emails owner
│   └── config-loader.js       # loads + validates client-config.json
├── client-config.example.json
├── data/                      # sqlite file (gitignored, volume-mounted)
├── test/
│   └── ...                    # scripted tests, see Testing section
├── NEW_CLIENT_SETUP.md
├── README.md
└── .env.example
```

## Data model (SQLite)

`conversations` — id, session_id, started_at, ended_at (nullable)
`messages` — id, conversation_id, role (user/assistant), text, created_at,
  answered_from_config (bool, nullable — only meaningful for assistant
  replies to free text)
`leads` — id, conversation_id (nullable), name, phone, reason, created_at,
  email_sent (bool), sms_sent (bool)
`missed_questions` — id, conversation_id, question_text, created_at

The monthly recap and missed-question review both read directly from
these tables — no separate tracking/analytics infrastructure.

## Client config schema (`client-config.json`)

```json
{
  "businessName": "string, required",
  "hours": {
    "display": "human-readable string, e.g. 'Mon-Fri 8am-6pm, Sat 9am-2pm'",
    "timezone": "IANA tz string, e.g. 'America/Chicago'",
    "schedule": {
      "monday": { "open": "08:00", "close": "18:00" },
      "...": "one entry per day; a day can be omitted or null for closed"
    }
  },
  "serviceArea": "free-text description, required",
  "pricing": "free-text description of pricing/services ranges, required",
  "services": ["list", "of", "services", "offered"],
  "branding": {
    "primaryColor": "#0b1f3a",
    "accentColor": "#d9603b",
    "logoUrl": "https://... (optional)"
  },
  "owner": {
    "notificationEmail": "required for lead email",
    "notificationPhone": "optional, E.164 format, for future use"
  }
}
```

Every field beyond `businessName` degrades gracefully if missing/malformed
(see Fail-safe behavior below) — the loader validates and fills defaults,
never throws in a way that stops the server or blocks chat.

## Embedding

```html
<script src="https://<client>.up.railway.app/widget.js" async></script>
```

- Widget renders into a **Shadow DOM** root so host-site CSS cannot leak
  in and the widget's CSS cannot leak out. No iframe.
- On load, widget calls `GET /api/config` to get branding + after-hours
  greeting state, then renders the bubble.
- Fixed-position bottom-right bubble, scoped z-index, expands to a chat
  window on click.

## Request flow

1. **Greeting:** `GET /api/config` returns branding + whether the
   business is currently open (computed server-side from `hours` +
   config timezone vs. server clock — acceptable approximation for v1
   rather than trusting client-reported time, since it's simpler and not
   spoofable). Fail-safe: if hours config is missing/malformed, treat as
   open.
2. **Quick-reply buttons:** hours / service area / pricing / book a visit
   — client-side canned answers built directly from config (no LLM call
   needed for these, since they're a direct field lookup) for speed;
   "book a visit" opens the lead form directly.
3. **Free-text question:** `POST /api/chat { sessionId, message }` →
   server builds a system prompt embedding only the config's hours,
   service area, pricing, and services, instructs Haiku to answer only
   from that data and to respond with a specific sentinel
   (e.g. `{"inScope": false}` marker in a structured response) when the
   question is out of scope, rather than guessing. Server logs the
   message either way; out-of-scope messages are also logged to
   `missed_questions` and the response tells the widget to open the lead
   form.
4. **Lead submit:** `POST /api/lead { name, phone, reason, sessionId }`
   → server performs three independent steps, each in its own
   try/catch, in this order: (a) insert into `leads` table — must
   succeed for the request to be considered successful; (b) send owner
   email via Resend; (c) send visitor SMS via Twilio. (b) and (c)
   failures are logged but do not affect the HTTP response or roll back
   (a). Response to the widget confirms as soon as (a) succeeds.
5. **Monthly recap:** `node-cron` scheduled job (runs daily, checks if a
   recap for the current month has already been sent by checking a
   small `recap_log` table, sends once per month) queries counts from
   `conversations` and `leads` for the prior month and emails the owner
   via Resend.

## Fail-safe behavior (explicit table)

| Condition | Behavior |
|---|---|
| `hours` missing/malformed | Treat as always open; skip after-hours greeting |
| `branding` missing | Use default navy/terracotta theme |
| `logoUrl` missing/unreachable | Text-only header, no broken image |
| `pricing`/`serviceArea`/`services` missing | FAQ system prompt omits that field; Haiku treats it as unknown and hands off to lead capture for questions about it |
| Anthropic API call fails/times out | Widget shows a friendly fallback message and a "still want help? leave your info" prompt into lead capture |
| Resend send fails | Logged; lead save + SMS unaffected |
| Twilio send fails | Logged; lead save + email unaffected |
| SQLite write fails on lead save | This is the one hard failure — surfaced to the visitor as an error asking them to call directly (config's phone number if present), since we cannot silently drop a lead |

## Testing plan

1. **FAQ free-text correctness** — automated script sends each of the
   required phrasings (`what are your hours`, `when are you open`, `do
   you work weekends`, `what do you do`, `what services do you offer`,
   `how much does it cost`, `is this expensive`, `do you service my
   area`, `are you near me`) against the example config, asserts the
   response is grounded in that config's actual values (not just
   "non-empty").
2. **Config degradation** — run the server against configs with: missing
   `hours`, malformed `hours.schedule`, missing `branding`, missing
   `logoUrl`, missing `pricing`. Assert server starts, `/api/config`
   returns sane defaults, `/api/chat` still works.
3. **Lead flow end-to-end** — submit a lead against a working
   Resend/Twilio setup (or realistic mocks), assert DB row + email send
   invoked + SMS send invoked. Then force a Twilio failure (invalid
   credentials/mock throw) and assert the lead row and email send still
   happen and the HTTP response still reports success.
4. Results shown as actual command output, not just narrated.

## Deployment / hosting summary

- **Backend:** Railway (Node/Express service + persistent volume for
  `data/*.sqlite`), one service per client.
- **Widget assets:** served by the same Express app as static files
  (`/widget.js`, `/widget.css`) — no separate CDN needed for v1,
  keeping "one thing to deploy" per client.
- **Email:** Resend.
- **SMS:** Twilio.
- **LLM:** Anthropic API (Claude Haiku).

## Deliverables

1. Widget (`widget/`)
2. Backend (`server/`)
3. `client-config.example.json` (pre-filled example) + schema doc
4. `NEW_CLIENT_SETUP.md`
5. `README.md` (local setup, env vars, deployment)
6. Test summary in the final handoff message
