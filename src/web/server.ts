#!/usr/bin/env node
/**
 * SlopScore web server.
 *
 * Serves the single-page webapp and the JSON API. The scoring path goes
 * THROUGH Hermes (see HermesRunner): the browser posts a handle, Hermes runs
 * the slopscore MCP tools to score it, and the backend renders the card + voice
 * and persists to the shared leaderboard.
 *
 *   GET  /                     the webapp
 *   POST /api/score            { handle } → full verdict + card/clip URLs
 *   GET  /api/leaderboard      ?direction=slop|human
 *   POST /api/unlock           { userId?, handle? } → Dodo checkout link
 *   GET  /cards/:file          verdict card PNGs
 *   GET  /clips/:file          voice clips
 *   GET  /api/health           capability status
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, basename } from "node:path";
import { config, capabilitySummary, live } from "../config.js";
import { runScore } from "../hermes/runner.js";
import { finalize } from "../pipeline.js";
import { getStore } from "../store/index.js";
import { createCheckout } from "../integrations/dodo.js";
import { cardBasename, renderCardFromSummary } from "../integrations/card.js";

const PUBLIC_DIR = resolve("public");
const OUT_DIR = resolve("output");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function send(res: any, status: number, body: any, headers: Record<string, string> = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": headers["Content-Type"] ?? "application/json; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** Serve a file from a whitelisted directory, guarding traversal. */
async function serveFile(res: any, dir: string, name: string): Promise<boolean> {
  const safe = normalize(name).replace(/^(\.\.[/\\])+/, "");
  const full = join(dir, safe);
  if (!full.startsWith(dir)) return false;
  try {
    const s = await stat(full);
    if (!s.isFile()) return false;
    const buf = await readFile(full);
    send(res, 200, buf, { "Content-Type": MIME[extname(full)] ?? "application/octet-stream" });
    return true;
  } catch {
    return false;
  }
}

const HANDLE_RE = /^@?[A-Za-z0-9_]{2,15}$/;

/** Public origin used for absolute share/card URLs (no trailing slash). */
function publicBase(): string {
  return config.publicUrl.replace(/\/+$/, "");
}

function htmlEscape(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/** Short, punchy text pre-filled into the X composer. */
function shareText(handle: string, slopScore: number, verdict: string): string {
  return `@${handle} scored ${slopScore}/100 on the SlopScore AI-writing test — “${verdict}”. Can you beat it? 🧪`;
}

/** X (Twitter) web-intent URL: pre-fills text; the link unfurls to the card image. */
function tweetIntent(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * Landing page for a shared card. Serves Open Graph + Twitter Card meta so the
 * link unfurls into the verdict card image (summary_large_image) on X, and shows
 * a human-facing page with a "share on X" button and a CTA to score your own.
 */
async function handleShare(res: any, rawHandle: string) {
  const base = publicBase();
  try {
    const handle = rawHandle.replace(/^@/, "").trim();

    if (!HANDLE_RE.test(handle)) {
      return send(res, 404, sharePageMissing(base, "That's not a valid X handle."), {
        "Content-Type": MIME[".html"],
      });
    }

    const store = await getStore();
    const row = await store.getByHandle(handle);
    if (!row) {
      return send(
        res,
        404,
        sharePageMissing(base, `@${handle} hasn't been scored yet.`),
        { "Content-Type": MIME[".html"] }
      );
    }

    // Ensure the card image exists on disk (re-render from summary if missing).
    const fileName = cardBasename(row.handle, row.slopScore);
    const cardPath = join(OUT_DIR, fileName);
    try {
      const s = await stat(cardPath);
      if (!s.isFile()) throw new Error("not a file");
    } catch {
      try {
        await renderCardFromSummary(
          { handle: row.handle, slopScore: row.slopScore, verdict: row.verdict, tagline: row.tagline },
          OUT_DIR
        );
      } catch (err) {
        console.error("share card render failed:", err);
      }
    }

    const cardUrl = `${base}/cards/${fileName}`;
    const shareUrl = `${base}/s/${row.handle}`;
    const text = shareText(row.handle, row.slopScore, row.verdict);
    const intent = tweetIntent(text, shareUrl);

    send(res, 200, sharePage({ row, cardUrl, shareUrl, intent }), {
      "Content-Type": MIME[".html"],
    });
  } catch (err) {
    console.error("share error:", err);
    send(res, 500, sharePageMissing(base, "Couldn't load that card right now."), {
      "Content-Type": MIME[".html"],
    });
  }
}

function sharePageMissing(base: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SlopScore</title>
<link rel="stylesheet" href="/styles.css" />
</head><body>
<div class="wrap" style="text-align:center;padding-top:80px">
  <h1 style="font-family:var(--serif);font-style:italic">SlopScore</h1>
  <p class="sub" style="margin:20px auto">${htmlEscape(message)}</p>
  <a class="btn primary" href="${htmlEscape(base)}/">score a handle →</a>
</div>
</body></html>`;
}

function sharePage(opts: {
  row: { handle: string; slopScore: number; verdict: string; tagline?: string };
  cardUrl: string;
  shareUrl: string;
  intent: string;
}): string {
  const { row, cardUrl, shareUrl, intent } = opts;
  const base = publicBase();
  const title = `@${row.handle} — ${row.slopScore}/100 SlopScore`;
  const desc = row.tagline
    ? `${row.verdict} — ${row.tagline}`
    : `${row.verdict}. The Turing test for your timeline.`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${htmlEscape(title)}</title>
<meta name="description" content="${htmlEscape(desc)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="SlopScore" />
<meta property="og:title" content="${htmlEscape(title)}" />
<meta property="og:description" content="${htmlEscape(desc)}" />
<meta property="og:url" content="${htmlEscape(shareUrl)}" />
<meta property="og:image" content="${htmlEscape(cardUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="675" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(title)}" />
<meta name="twitter:description" content="${htmlEscape(desc)}" />
<meta name="twitter:image" content="${htmlEscape(cardUrl)}" />

<link rel="stylesheet" href="/styles.css" />
</head><body>
<div class="grid-overlay"></div>
<div class="wrap" style="max-width:760px">
  <header class="topbar">
    <div class="brand"><span class="pulse"></span> slopscore.exe</div>
    <nav><a href="${htmlEscape(base)}/">score your own →</a></nav>
  </header>
  <main style="padding-top:32px">
    <div class="card-block">
      <div class="section-label">@${htmlEscape(row.handle)} · ${row.slopScore}/100 slop · ${htmlEscape(row.verdict)}</div>
      <div class="share-card">
        <div class="scanline"></div>
        <img src="${htmlEscape(cardUrl)}" alt="SlopScore verdict card for @${htmlEscape(row.handle)}" />
      </div>
      <div class="card-actions">
        <a class="btn primary" href="${htmlEscape(intent)}" target="_blank" rel="noopener">share on X</a>
        <a class="btn ghost" href="${htmlEscape(cardUrl)}" download>download card</a>
        <a class="btn ghost" href="${htmlEscape(base)}/">score a handle</a>
      </div>
    </div>
  </main>
  <footer><span>slopscore</span> · the turing test for your timeline</footer>
</div>
</body></html>`;
}

async function handleScore(req: any, res: any) {
  const body = await readBody(req);
  const handle = String(body.handle ?? "").trim();
  if (!/^@?[A-Za-z0-9_]{2,15}$/.test(handle)) {
    return send(res, 400, { error: "Enter a valid X handle (letters, numbers, underscore)." });
  }
  const userId = String(body.userId ?? "web");
  try {
    // 1. Score THROUGH Hermes (MCP tools) — this is the mandatory agent step.
    const { report, via } = await runScore(handle);
    // 2. Deterministic artifacts + shared leaderboard.
    const fin = await finalize(report, { requestedBy: userId, outDir: OUT_DIR });

    const shareUrl = `${publicBase()}/s/${report.handle}`;
    send(res, 200, {
      via,
      report,
      cardUrl: fin.cardPath ? `/cards/${basename(fin.cardPath)}` : null,
      shareUrl,
      shareText: shareText(report.handle, report.slopScore, report.verdict),
      shareIntent: tweetIntent(
        shareText(report.handle, report.slopScore, report.verdict),
        shareUrl
      ),
      clipUrl:
        fin.voiceSource === "elevenlabs" && fin.voicePath
          ? `/clips/${basename(fin.voicePath)}`
          : null,
      voiceScript: fin.voiceScript,
      sources: { voice: fin.voiceSource, store: fin.storeBackend },
    });
  } catch (err) {
    console.error("score error:", err);
    send(res, 500, { error: (err as Error).message || "scoring failed" });
  }
}

async function handleLeaderboard(res: any, url: URL) {
  const direction = url.searchParams.get("direction") === "human" ? "human" : "slop";
  const store = await getStore();
  const rows = await store.leaderboard(direction, 15);
  send(res, 200, { direction, rows });
}

async function handleUnlock(req: any, res: any) {
  const body = await readBody(req);
  const userId = String(body.userId ?? "web");
  const handle = String(body.handle ?? "self");
  const checkout = await createCheckout(userId, handle);
  send(res, 200, { url: checkout.url, mock: checkout.source === "mock", price: config.dodo.priceUsd });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.web.port}`);
  const path = url.pathname;

  try {
    if (req.method === "POST" && path === "/api/score") return handleScore(req, res);
    if (req.method === "GET" && path === "/api/leaderboard") return handleLeaderboard(res, url);
    if (req.method === "POST" && path === "/api/unlock") return handleUnlock(req, res);
    if (req.method === "GET" && path === "/api/health") {
      return send(res, 200, { ok: true, capabilities: capabilitySummary(), live });
    }
    if (req.method === "GET" && path.startsWith("/s/")) {
      return handleShare(res, decodeURIComponent(path.slice("/s/".length)));
    }
    if (path.startsWith("/cards/")) {
      if (await serveFile(res, OUT_DIR, path.slice("/cards/".length))) return;
      return send(res, 404, { error: "card not found" });
    }
    if (path.startsWith("/clips/")) {
      if (await serveFile(res, OUT_DIR, path.slice("/clips/".length))) return;
      return send(res, 404, { error: "clip not found" });
    }

    // Static site.
    const file = path === "/" ? "index.html" : path.slice(1);
    if (await serveFile(res, PUBLIC_DIR, file)) return;
    // SPA fallback.
    if (await serveFile(res, PUBLIC_DIR, "index.html")) return;
    return send(res, 404, { error: "not found" });
  } catch (err) {
    console.error("server error:", err);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(config.web.port, () => {
  console.log(`\n🧪 SlopScore webapp → http://localhost:${config.web.port}`);
  console.log(`   hermes mode: ${config.hermes.mode}   capabilities: ${capabilitySummary()}\n`);
});
