# SlopScore — Setup

Everything degrades to a mock, so you can run the webapp with **zero setup** and
turn on capabilities one at a time. Setup is grouped by how "live" you want it.

---

## Tier 0 — Run it now (no setup)

```bash
npm install
npm run web      # → http://localhost:3000
```

- Tweets: deterministic mock · Voice: placeholder · Leaderboard: local JSON (`.data/`)
- Scoring path: **direct** (Hermes not required for dev)

Check status any time: the badge under the search box, or `curl localhost:3000/api/health`.

---

## Tier 1 — Make Hermes mandatory (the headline requirement)

The webapp scores each handle **through Hermes Agent**. Hermes calls the
SlopScore MCP server, which does the retrieval + scoring.

1. **Install Hermes Agent** — follow the official installer at
   <https://hermes-agent.nousresearch.com>. Confirm it's on your PATH:
   ```bash
   hermes --version
   ```
2. **Register the SlopScore MCP server.** Open `hermes.config.example.yaml` in
   this repo, copy the `mcp_servers.slopscore` block into `~/.hermes/config.yaml`,
   and set the absolute path to `src/mcp/server.ts` in *this* project.
   ```yaml
   mcp_servers:
     slopscore:
       command: "npx"
       args: ["tsx", "/ABSOLUTE/PATH/TO/hermes-X-app/src/mcp/server.ts"]
   ```
   (For production, `npm run build` first and point at `dist/mcp/server.js` with `command: "node"`.)
3. **Verify Hermes sees the tools:**
   ```bash
   hermes chat        # then ask: "what tools do you have?" → should list score_slop
   ```
4. **Force the Hermes path** in `.env`:
   ```
   HERMES_MODE=cli
   ```
   Now `npm run web` routes every score through `hermes -z`. The result card
   shows **"scored via Hermes 🤖"**. (`HERMES_MODE=auto` uses Hermes if present,
   else falls back to direct — good for dev.)

> Tip: test the MCP server on its own with `npm run mcp` (it speaks MCP over
> stdio). `npm test` includes an integration test that connects a real MCP
> client to it and calls `score_slop`.

---

## Tier 2 — Turn on the external capabilities

Copy the env template and fill any subset. Each key flips one capability from
`mock` → `LIVE`.

```bash
cp .env.example .env
```

| Capability | Get it from | Env var(s) | Notes |
|---|---|---|---|
| **LinkUp** (real tweets) | [linkup.so](https://www.linkup.so) | `LINKUP_API_KEY` | verify the response shape once live (see below) |
| **ElevenLabs** (voice clip) | [elevenlabs.io](https://elevenlabs.io) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (optional) | clip is served to the webapp only when live |
| **Convex** (shared board) | run `npx convex dev` | `CONVEX_URL` | see below |
| **Dodo** ($2 unlock) | [dodopayments.com](https://dodopayments.com) | `DODO_API_KEY`, `DODO_PRODUCT_ID`, `DODO_ENV` | create a $2 product first |
| **Image gen bg** (optional) | OpenAI | `OPENAI_API_KEY` | card works without it; this only adds an AI background |

The verdict card renderer needs **no key** — it's always on.

### Convex (extra step)

```bash
npx convex dev      # first run: login, creates a deployment, generates
                    # convex/_generated, prints your deployment URL
```

Paste the printed URL into `.env` as `CONVEX_URL`. This deploys `convex/schema.ts`
+ the leaderboard/history/user functions. Until then, the board lives in
`.data/store.json` locally.

### Dodo

Create a **$2 product** in the Dodo dashboard, put its id in `DODO_PRODUCT_ID`,
keep `DODO_ENV=test` until you're ready for real charges. The `/api/unlock`
endpoint returns a checkout link. Flipping a user to *premium after payment*
needs a Dodo webhook → `store.setPremium` (not yet wired — see Open items).

---

## Tier 3 — Scheduled re-test

```bash
npm run cron          # re-score handles not seen in 7 days, report the delta
npm run cron -- 0     # force re-test everyone (demo the delta)
```

If `TELEGRAM_BOT_TOKEN` is set and the requester is a Telegram user, the cron DMs
the weekly update. You can wire `npm run cron` to a system scheduler or Convex cron.

---

## Optional: Telegram bot surface

```bash
# set TELEGRAM_BOT_TOKEN in .env (from @BotFather)
npm run bot
```

DM it a handle for the same verdict + card + (live) voice clip. This is a
secondary surface; the webapp is primary.

---

## Open items before a fully-live demo

1. **LinkUp parser** — `src/integrations/linkup.ts` queries general search and
   splits snippets into tweets. Once your key is in, run one real call and tune
   the parser to LinkUp's actual JSON shape.
2. **Dodo → premium webhook** — `/api/unlock` creates the checkout; a webhook
   endpoint that verifies payment and calls `store.setPremium(userId, true)` is
   the last mile for automatic unlocks.
```
