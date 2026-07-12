/**
 * ElevenLabs integration — voice-reads the roast as a shareable clip.
 *
 * Real mode: text-to-speech via the ElevenLabs API, writes an mp3.
 * Mock mode (no key): writes a tiny placeholder file and returns it, so the
 * pipeline still produces a "clip" artifact and the demo never breaks.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config, live } from "../config.js";
import type { SlopReport } from "../engine/types.js";

export interface VoiceResult {
  path: string;
  audio: Buffer;
  source: "elevenlabs" | "mock";
  /** The exact script that was read, for captions/subtitles. */
  script: string;
}

/** Trim the roast into a punchy ~20s spoken script. */
export function roastScript(report: SlopReport): string {
  const top = report.topTell;
  const parts = [
    `SlopScore for @${report.handle}: ${report.slopScore} out of 100. ${report.verdict}.`,
  ];
  if (top) parts.push(top.quip);
  const second = report.tells.filter((t) => t.hits > 0 && t.id !== top?.id)[0];
  if (second) parts.push(second.quip);
  parts.push(report.tips[0] ?? "Stay human out there.");
  return parts.join(" ");
}

export async function voiceRoast(report: SlopReport, outDir = "output"): Promise<VoiceResult> {
  const script = roastScript(report);
  const path = resolve(outDir, `slopscore-${report.handle}-${report.slopScore}.mp3`);
  await mkdir(dirname(path), { recursive: true });

  if (live.elevenlabs) {
    try {
      const audio = await synthesize(script);
      await writeFile(path, audio);
      return { path, audio, source: "elevenlabs", script };
    } catch (err) {
      console.warn(`[elevenlabs] TTS failed, writing placeholder:`, (err as Error).message);
    }
  }

  // Mock: write the script as a .txt sidecar and an empty mp3 placeholder so the
  // artifact exists and can be inspected without a key.
  const placeholder = Buffer.from(`SLOPSCORE MOCK CLIP\n\n${script}\n`, "utf8");
  await writeFile(path.replace(/\.mp3$/, ".txt"), placeholder);
  await writeFile(path, Buffer.alloc(0));
  return { path, audio: placeholder, source: "mock", script };
}

async function synthesize(text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabs.apiKey!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.6 },
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
