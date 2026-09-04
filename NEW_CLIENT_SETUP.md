# Setting Up a New Client

This codebase is reused as-is for every client. Onboarding a new client
means: duplicate the folder, edit one file, deploy. No code changes.

## 1. Duplicate the project folder

Copy this whole project into a new folder (or a new git repo/branch) named
for the client, e.g. `hvac-chatbot-acme/`.

## 2. Edit `client-config.json`

Copy `client-config.example.json` to `client-config.json` in the new
folder and fill in the client's real info:

- `businessName` — shown in the widget header and greeting.
- `hours.display` — the human-readable hours string shown to visitors.
- `hours.timezone` — an IANA timezone string (e.g. `America/Chicago`) —
  this is what the after-hours check uses.
- `hours.schedule` — one entry per day (`monday`...`sunday`), each either
  `{ "open": "HH:MM", "close": "HH:MM" }` (24-hour time) or `null` for a
  closed day. If you skip this whole file or get it wrong, the bot just
  always acts like it's open — it won't break.
- `serviceArea` — a sentence or two describing where they work.
- `pricing` — a sentence or two describing pricing ranges/policy.
- `services` — a list of services offered.
- `branding.primaryColor` / `branding.accentColor` — hex colors for the
  widget header/accents. Leave as-is to use the default navy/terracotta
  theme.
- `branding.logoUrl` — optional; omit for a text-only header.
- `owner.notificationEmail` — where new-lead emails and the monthly
  recap go.
- `owner.notificationPhone` — reserved for future use; fill in if known.

## 3. Set environment variables

Copy `.env.example` to `.env` and fill in:

- `ANTHROPIC_API_KEY` — same key can be reused across all clients.
- `SENDGRID_API_KEY`, `NOTIFY_FROM_EMAIL` — same SendGrid account and
  verified sender can be reused for every client. Lead emails send from
  `NOTIFY_FROM_EMAIL`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
  `TWILIO_MESSAGING_SERVICE_SID` — same Twilio account can be reused, or
  use a client-specific number if you want the SMS to come from a
  locally-recognizable number.
- `DATA_DB_PATH` — leave as `./data/leads.sqlite`; each deployed instance
  gets its own file automatically.

## 4. Deploy a new Railway service for this client

1. Create a new Railway project (or a new service within an umbrella
   project) pointing at this client's folder/repo.
2. Add a persistent volume mounted at `./data` so the SQLite file
   survives restarts/redeploys.
3. Set the environment variables from step 3 in Railway's dashboard.
4. Deploy. Railway will run `npm install && npm start`.
5. Note the Railway-provided URL (or attach a subdomain).

## 5. Embed on the client's website

Give the client (or their web developer) this one line to paste before
the closing `</body>` tag on every page they want the bot on:

```html
<script src="https://<their-railway-url>/widget.js" async></script>
```

No other integration is required — the widget renders itself, isolated
in a Shadow DOM, and won't conflict with the rest of the page's styling.

## 6. Verify

- Open the site, confirm the bubble appears bottom-right in the client's
  brand colors.
- Ask a couple of FAQ questions in different phrasings, confirm grounded
  answers.
- Submit a test lead, confirm you receive the owner email and the SMS
  confirmation arrives at your test phone.
- Check `data/leads.sqlite` (or ask them to) to confirm the lead is
  stored.

That's the whole reskin process — typically well under an hour once you
have the client's hours/pricing/service-area text in hand.
