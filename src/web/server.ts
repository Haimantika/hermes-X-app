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

    send(res, 200, {
      via,
      report,
      cardUrl: fin.cardPath ? `/cards/${basename(fin.cardPath)}` : null,
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
