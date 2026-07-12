# SlopScore 🧪

**The Turing test for your timeline.** A webapp where you enter an X handle and get a *receipts-based* roast of how AI-generated your writing *reads*.

Not a forensic "who typed this" claim — a **vibes rating on your writing style**. Unfalsifiable, funny, and defensible: *"you used 'delve' four times, bestie, here are the tweets."* A specific roast beats a generic one every time, and a specific roast is the thing people screenshot unprompted.

> **Scoring runs through Hermes Agent.** The webapp doesn't score in-process — it invokes `hermes -z`, and Hermes calls the SlopScore **MCP tools** to fetch and score. See [Architecture](#architecture).

---

## Architecture

```
Browser (webapp) ──POST /api/score { handle }──▶ Node web server
                                                      │
                                                      ▼
                                                 HermesRunner
                                                      │  spawn: hermes -z "call slopscore tools, score @handle, return JSON"
                                                      ▼
                                    Hermes Agent ──(MCP stdio)──▶ SlopScore MCP server
                                                                    ├─ fetch_tweets  (LinkUp)
                                                                    └─ score_slop    (pure engine + receipts)
                                                      ◀── SlopReport JSON ──┘
                                                      │
              deterministic post-processing ─────────┤
              ├─ 🖼  verdict card (image, score + link baked in)
              ├─ 🔊  ElevenLabs voice-reads the roast
              └─ 🗄  Convex: shared leaderboard + score-history memory
                                                      │
                          JSON + card + clip ─────────▶ webapp renders result
```

- **Hermes is mandatory** in the scoring path. `HERMES_MODE=cli` enforces it (fails if Hermes is missing); `auto` uses Hermes when installed and falls back to a direct in-process run for local dev.
- The **scoring engine stays deterministic** and lives behind an MCP tool, so the roast is reproducible and the receipts are auditable.

---

## What it detects (the receipts)

Each tell produces a **count** and **verbatim quotes**:

| Tell | What it catches |
|---|---|
| Em-dash abuse | `—` (and improvised ` -- `) as a crutch |
| "It's not just X, it's Y" | the antithesis construction LLMs love |
| ChatGPT vocabulary | `delve`, `tapestry`, `testament to`, `seamless`, `leverage`, `realm`… (counted per word) |
| Rhetorical-question bait | "Ever wonder why…?", "The result?" openers |
| Emoji bullet lists | 🚀✅💡 down the left margin |
| Suspiciously perfect grammar | immaculate caps + full stops, zero "lol" |
| Tricolon rhythm | the balanced "X, Y, and Z" cadence |

Scores are density-normalised, weighted, and rolled into a `0–100` **SlopScore** with a verdict bucket (*Certified Human → Fully Slop-Pilled*).

---

## Quick start

```bash
npm install
npm run web          # → http://localhost:3000   (open it, enter a handle)
```

With **no keys and no Hermes install**, everything falls back to mocks and a
direct scoring run, so the webapp is fully clickable immediately. To see which
capabilities are live, check the badge under the search box or `GET /api/health`.

Other entry points:

```bash
npm test             # 17 tests: engine + a real MCP client↔server integration test
npm run demo         # CLI: scores a slop + human example, writes a card + clip
npm run score -- sama
npm run mcp          # run just the MCP server on stdio (what Hermes connects to)
```

## Make Hermes mandatory (the real flow)

1. Install Hermes Agent (see the [Hermes docs](https://hermes-agent.nousresearch.com)).
2. Register this project's MCP server — merge `hermes.config.example.yaml` into
   `~/.hermes/config.yaml` (point the path at this repo).
3. In `.env`, set `HERMES_MODE=cli` so scoring *must* go through Hermes.
4. `npm run web` → every score now runs `hermes -z`, and Hermes calls
   `score_slop`. The result card shows **"scored via Hermes 🤖"**.

See **[SETUP.md](./SETUP.md)** for the full, step-by-step setup of every capability.

---

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/score` | `{ handle }` → verdict + `cardUrl` + `clipUrl` |
| `GET` | `/api/leaderboard?direction=slop\|human` | shared board |
| `POST` | `/api/unlock` | `{ userId, handle }` → Dodo $2 checkout |
| `GET` | `/api/health` | capability status (live vs mock) |
| `GET` | `/cards/:file`, `/clips/:file` | generated artifacts |

## Growth mechanics (by design)

- **Shared leaderboard** (Convex): "most human vs most slop-pilled" → tag-bait + repeat visits.
- **Anti-spoof card**: the SlopScore **and the link are drawn onto the image**, so reposts carry the link back.
- **Revenue** (Dodo): full forensic breakdown + anonymous roast-someone mode behind a $2 impulse buy.
- **Weekly cron** re-test (`npm run cron`) DMs/updates "your slop score this week".

## Project layout

```
public/              the webapp (index.html · styles.css · app.js)
src/
  engine/            pure, deterministic slop-detection core (+ tests)
  mcp/server.ts      SlopScore MCP server — the tools Hermes calls (+ integration test)
  hermes/runner.ts   invokes `hermes -z`, parses the SlopReport (direct fallback)
  web/server.ts      the webapp backend + JSON API + artifact serving
  integrations/      linkup · card · elevenlabs · dodo
  store/             Convex ↔ local-JSON store (leaderboard + memory)
  pipeline.ts        computeReport (fetch+score) + finalize (card+voice+store)
  cli.ts cron.ts     terminal scorer + weekly re-test
  bot/index.ts       optional Telegram surface (grammy)
convex/              schema + leaderboard/history/user functions
hermes.config.example.yaml   MCP registration snippet for ~/.hermes/config.yaml
```
