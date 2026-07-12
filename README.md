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


### How it actually works

The three key tools each play one job, and the pipeline is split into two phases so the *agent* owns the thinking and the *server* owns the deterministic rendering:

- **Hermes (the agent) — does the scoring.** The web server never scores in-process on the main path. It spawns `hermes -z "call score_slop for @handle, return the JSON"`. Hermes connects over MCP stdio to the SlopScore MCP server (`src/mcp/server.ts`), decides to call the `score_slop` tool, and returns the raw `SlopReport` JSON, which the server parses back out.
- **LinkUp — supplies the data.** Inside `score_slop`, LinkUp fetches the handle's recent posts (`POST https://api.linkup.so/v1/search`). Those tweets feed the deterministic slop engine. No `LINKUP_API_KEY`? It falls back to a mock timeline so the app still runs.
- **Convex — stores the results.** After Hermes returns, the server writes the score to Convex (leaderboard + history + users) and reads it back for the board and share pages. The browser never talks to Convex directly — only the Node server does, via `ConvexHttpClient`. No `CONVEX_URL`? Scores go to a local `.data/store.json`.

A single `POST /api/score` therefore flows:

1. Browser → `POST /api/score { handle }`.
2. **Phase 1 — `computeReport`** (the agent part): server spawns **Hermes** → Hermes calls the `score_slop` MCP tool → the tool pulls tweets via **LinkUp** → deterministic engine produces the `SlopReport` → Hermes returns the JSON.
3. **Phase 2 — `finalize`** (deterministic, always server-side): persist the report to **Convex**, render the verdict card (PNG), and generate the ElevenLabs voice clip.
4. Server responds with the report + `cardUrl` + `clipUrl`; the webapp renders it and pulls the leaderboard from Convex.

**Everything degrades gracefully:** no LinkUp key → mock tweets, no Hermes CLI → direct in-process scoring, no Convex → local JSON. The whole app runs end-to-end with zero keys.

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
| `GET` | `/api/health` | capability status (live vs mock) |
| `GET` | `/cards/:file`, `/clips/:file` | generated artifacts |

## Growth mechanics (by design)

- **Shared leaderboard** (Convex): "most human vs most slop-pilled" → tag-bait + repeat visits.
- **Anti-spoof card**: the SlopScore **and the link are drawn onto the image**, so reposts carry the link back.
- **Weekly cron** re-test (`npm run cron`) DMs/updates "your slop score this week".

## Project layout

```
public/              the webapp (index.html · styles.css · app.js)
src/
  engine/            pure, deterministic slop-detection core (+ tests)
  mcp/server.ts      SlopScore MCP server — the tools Hermes calls (+ integration test)
  hermes/runner.ts   invokes `hermes -z`, parses the SlopReport (direct fallback)
  web/server.ts      the webapp backend + JSON API + artifact serving
  integrations/      linkup · card · elevenlabs
  store/             Convex ↔ local-JSON store (leaderboard + memory)
  pipeline.ts        computeReport (fetch+score) + finalize (card+voice+store)
  cli.ts cron.ts     terminal scorer + weekly re-test
  bot/index.ts       optional Telegram surface (grammy)
convex/              schema + leaderboard/history/user functions
hermes.config.example.yaml   MCP registration snippet for ~/.hermes/config.yaml
```
