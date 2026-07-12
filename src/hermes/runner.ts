/**
 * HermesRunner — runs the scoring step *through Hermes Agent*.
 *
 * "Running Hermes is mandatory": in the default flow the web backend does NOT
 * call the engine directly. It shells out to `hermes -z "<task>"`, and Hermes
 * uses the SlopScore MCP tools (score_slop / fetch_tweets) to do the retrieval
 * and scoring. We then parse the SlopReport JSON out of Hermes's reply.
 *
 * Modes (HERMES_MODE):
 *   cli    — always use the hermes binary (fail if unavailable)
 *   direct — skip Hermes, run computeReport() in-process (dev / no install)
 *   auto   — use hermes if it's on PATH, otherwise fall back to direct
 */

import { spawn } from "node:child_process";
import { config } from "../config.js";
import { computeReport } from "../pipeline.js";
import type { SlopReport } from "../engine/types.js";

export interface HermesRunResult {
  report: SlopReport;
  via: "hermes" | "direct";
  /** Raw stdout from Hermes, for debugging/telemetry (empty in direct mode). */
  raw?: string;
}

/** The instruction we hand Hermes. Constrains it to tools + JSON output. */
function buildPrompt(handle: string): string {
  const clean = handle.replace(/^@/, "");
  return [
    `You are wired to the "slopscore" MCP tools.`,
    `Call the score_slop tool with handle "${clean}".`,
    `Then respond with ONLY the raw JSON object returned by that tool — no prose,`,
    `no markdown, no code fences. The JSON must include a "slopScore" field.`,
  ].join(" ");
}

/** Extract the first balanced JSON object that contains "slopScore". */
export function extractReportJson(text: string): SlopReport | null {
  // Fast path: whole string is JSON.
  const direct = tryParse(text);
  if (direct) return direct;

  // Scan for balanced { } blocks and try each.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          const candidate = tryParse(text.slice(i, j + 1));
          if (candidate) return candidate;
          break;
        }
      }
    }
  }
  return null;
}

function tryParse(s: string): SlopReport | null {
  try {
    const obj = JSON.parse(s.trim());
    if (obj && typeof obj.slopScore === "number" && typeof obj.handle === "string") {
      return obj as SlopReport;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

async function hermesAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(config.hermes.bin, ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

function runHermesCli(handle: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.hermes.bin, ["-z", buildPrompt(handle)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hermes timed out after ${config.hermes.timeoutMs}ms`));
    }, config.hermes.timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`hermes exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

export async function runScore(handle: string, maxTweets = 20): Promise<HermesRunResult> {
  const mode = config.hermes.mode;

  const useHermes =
    mode === "cli" || (mode === "auto" && (await hermesAvailable()));

  if (useHermes) {
    try {
      const { stdout } = await runHermesCli(handle);
      const report = extractReportJson(stdout);
      if (report) return { report, via: "hermes", raw: stdout };
      throw new Error("could not parse a SlopReport from Hermes output");
    } catch (err) {
      if (mode === "cli") throw err; // strict: no silent fallback
      console.warn(`[hermes] run failed, falling back to direct:`, (err as Error).message);
    }
  }

  // Direct fallback (dev / no Hermes install).
  const { report } = await computeReport(handle, maxTweets);
  return { report, via: "direct" };
}
