# Gap-closing report

Command run for all results below: `npm test` (from repo root).

Final result:
```
1..89
# tests 89
# pass 80
# fail 0
# cancelled 0
# skipped 9
# todo 0
```
Baseline was 79 total / 70 pass / 0 fail / 9 skip. New suite: 89 total / 80 pass / 0 fail / 9 skip (10 new tests, skip count unchanged).

---

## Gap 1: Rate limiting + input validation on /api/chat and /api/lead

**Changes:**
- `package.json` / `package-lock.json`: added `express-rate-limit@^7`.
- `server/middleware/rate-limit.js` (new): `createPublicApiLimiter(options)` — builds an `express-rate-limit` instance, default `windowMs=60000`, `max=20`, JSON 429 handler returning `{ error: 'Too many requests, please try again shortly.' }`.
- `server/index.js:8-33`: import the limiter factory; when `config && db`, mount a fresh limiter instance on `/api/chat` and a separate fresh instance on `/api/lead` (two instances, not one shared instance, so the two routes have independent budgets). `createApp` now accepts a `rateLimit` option (`{ windowMs, max }`) forwarded into both limiter instances — this is what makes the behavior testable without slow tests.
- `server/index.js` (`require.main === module` block): reads `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` env vars into the same option, defaults preserved when unset.
- `server/routes/chat.js:4-16`: added `MAX_MESSAGE_LENGTH = 1000`; reject with 400 (`message must be 1000 characters or fewer`) if `message.length > 1000`, checked alongside the existing required/type check.
- `server/routes/lead.js:4-15,20-27`: added `MAX_NAME_LENGTH = 200`, `MAX_REASON_LENGTH = 2000`, `PHONE_PATTERN = /^\+?[1-9]\d{6,14}$/`, and `looksLikePhoneNumber()` which strips spaces/dashes/parens/dots before testing. Route now rejects (400) an over-length `name`, an over-length `reason`, or a `phone` that doesn't pass `looksLikePhoneNumber`.

**Tests:**
- `test/rate-limit.test.js` (new, 3 tests): trips a `max: 3` limiter on `/api/chat` and asserts a mix of 200s then a 429 with the expected JSON body; same for `/api/lead`; a third test confirms `/api/chat`'s limiter tripping doesn't block `/api/lead` (separate limiter instances).
- `test/chat-route.test.js`: added "POST /api/chat with message over 1000 chars returns 400".
- `test/lead-route.test.js`: added "invalid phone number returns 400 and does not create a lead row" (`'not a phone number'`), "too-short phone number (\"123\") returns 400", "real-looking phone numbers pass validation" (`+15125550100` and `(512) 555-0100` both → 200), "name over 200 chars returns 400", "reason over 2000 chars returns 400".

Commit: `d7eba2a` — "Add rate limiting and input validation to /api/chat and /api/lead"

---

## Gap 2: `branding.logoUrl` never rendered in the widget

**Changes:**
- `widget/widget.js` `applyBranding()` (inside the browser-only `init()` block): after setting the title text, removes any pre-existing `.hvac-logo` element, then, if `cfg.branding.logoUrl` is a string, creates `<img class="hvac-logo">`, sets `src`, `alt=""`, an `onerror` handler that calls `logo.remove()` (so a broken URL degrades to text-only rather than a broken-image icon), and inserts it as the first child of `.hvac-header` (before the title span). When `logoUrl` is absent/non-string, no image element is added — unchanged text-only behavior.
- `widget/widget.css`: added `.hvac-logo` rule — `max-height: 28px; max-width: 96px; margin-right: 8px; object-fit: contain; vertical-align: middle;`.

**Tests:** None added — this is DOM-wiring code inside `widget.js`'s browser-only `init()` IIFE (guarded by `typeof document !== 'undefined'`), which per the file's own structure is skipped entirely under Node and has no dedicated test today (the existing `test/widget-logic.test.js` only covers the exported pure functions `formatGreeting`/`buildQuickReplyAnswer`). Consistent with that existing pattern, this DOM change was not given a Node test. Verified by code inspection: image only appended when `logoUrl` is a non-empty string, sized via CSS, and self-removes on load error.

Commit: `057e9d4` — "Render branding.logoUrl in widget header"

---

## Gap 3: config-degradation.test.js never exercised POST /api/chat

**Changes:** none to source; `server/services/faq.js`'s `answerQuestion()` already wraps the `anthropicClient.messages.create(...)` call in try/catch, so a `null` `anthropicClient` (as produced by `startAppFor()` in the degradation test file, which never passes one) throws synchronously when `.messages` is accessed on `null`, is caught, and returns `safeFallback()` — confirmed this is the existing fail-safe path, no code changes needed there.

**Test:** `test/config-degradation.test.js` — extended the "missing pricing" scenario (renamed to "missing pricing: server starts, /api/config returns sane defaults, and /api/chat still works") to, after asserting `/api/config` returns `pricing: null`, also `POST /api/chat` with `{ sessionId: 'degrade-sess-1', message: 'what are your hours?' }` and assert `200` with `answer` (string) and `inScope` (boolean) present. This exercises the exact `anthropicClient === null` path described in the gap.

Commit: `74aef1f` — "Exercise POST /api/chat in config-degradation tests"

---

## Gap 4: `trust proxy` unset — express-rate-limit crash risk behind Railway's reverse proxy

**Finding:** `express-rate-limit` v7 keys requests by `req.ip` and throws `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` at request time if it sees an `X-Forwarded-For` header while Express's `trust proxy` setting is unset/default. Railway (per the project's README) puts a reverse proxy/load balancer in front of the app, so every `/api/chat` and `/api/lead` request in production would likely 500 instead of being rate-limited correctly, and without this the limiter would otherwise key on the proxy's IP for every visitor rather than the real client IP.

**Changes:**
- `server/index.js`: added `app.set('trust proxy', 1)` immediately after `const app = express()`, before any middleware, with a comment explaining the Railway single-hop-proxy reasoning.

**Tests:**
- `test/rate-limit.test.js` (new test): "POST /api/chat with an X-Forwarded-For header does not 500 (trust proxy configured)" — sends a request with a forged `X-Forwarded-For: 203.0.113.5` header and asserts `200` instead of a crash.

**Command:** `npm test`

**Result:**
```
1..90
# tests 90
# pass 81
# fail 0
# cancelled 0
# skipped 9
# todo 0
```
Full suite green: 90 total / 81 pass / 0 fail / 9 skipped (1 new test added on top of the prior 89).

Commit: `26dfb92` — "Set trust proxy for Railway reverse-proxy deployment"
