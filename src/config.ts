/**
 * Central config. Reads .env once and exposes typed getters plus per-capability
 * "is this live or mock?" flags so the rest of the app can degrade gracefully.
 */

import "dotenv/config";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export const config = {
  publicUrl: env("PUBLIC_APP_URL") ?? "https://slopscore.app",

  web: {
    port: Number(env("PORT") ?? "3000"),
  },

  hermes: {
    /** auto = use the hermes CLI if present, else run the pipeline directly. */
    mode: (env("HERMES_MODE") ?? "auto") as "auto" | "cli" | "direct",
    bin: env("HERMES_BIN") ?? "hermes",
    /** per-run timeout for the hermes CLI in ms. */
    timeoutMs: Number(env("HERMES_TIMEOUT_MS") ?? "120000"),
  },

  telegram: {
    token: env("TELEGRAM_BOT_TOKEN"),
  },
  linkup: {
    apiKey: env("LINKUP_API_KEY"),
  },
  elevenlabs: {
    apiKey: env("ELEVENLABS_API_KEY"),
    voiceId: env("ELEVENLABS_VOICE_ID") ?? "JBFqnCBsd6RMkjVDRZzb",
  },
  imageGen: {
    apiKey: env("OPENAI_API_KEY"),
    model: env("IMAGE_GEN_MODEL") ?? "gpt-image-1",
  },
  convex: {
    url: env("CONVEX_URL"),
  },
} as const;

/** Which capabilities are wired with real credentials right now. */
export const live = {
  telegram: Boolean(config.telegram.token),
  linkup: Boolean(config.linkup.apiKey),
  elevenlabs: Boolean(config.elevenlabs.apiKey),
  imageGen: Boolean(config.imageGen.apiKey),
  convex: Boolean(config.convex.url),
};

export function capabilitySummary(): string {
  const mark = (b: boolean) => (b ? "LIVE" : "mock");
  return [
    `LinkUp:${mark(live.linkup)}`,
    `ElevenLabs:${mark(live.elevenlabs)}`,
    `ImageGen:${mark(live.imageGen)}`,
    `Convex:${mark(live.convex)}`,
    `Telegram:${mark(live.telegram)}`,
  ].join("  ");
}
