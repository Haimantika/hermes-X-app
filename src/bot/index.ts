#!/usr/bin/env node
/**
 * SlopScore Telegram bot (grammy).
 *
 * Flow: DM a handle → LinkUp pulls tweets → engine scores the slop-tells →
 * verdict card (image) + voice clip come back with receipts + "sound human"
 * tips. Leaderboard is shared via Convex. Premium modes gate behind Dodo.
 *
 *   /start                welcome + how it works
 *   <handle>              score that handle (your own or anyone's)
 *   /leaderboard [slop|human]
 *   /forensic <handle>   full breakdown (premium)
 *   /roast <handle>      anonymous roast of someone else (premium)
 *   /unlock              $2 Dodo checkout to unlock premium
 *   /caps                show which capabilities are live vs mock
 */

import { Bot, InputFile } from "grammy";
import { readFile } from "node:fs/promises";
import { config, live, capabilitySummary } from "../config.js";
import { scoreHandle } from "../pipeline.js";
import { getStore } from "../store/index.js";
import { formatReport, formatLeaderboard } from "../format.js";
import { createCheckout } from "../integrations/dodo.js";

if (!live.telegram) {
  console.error(
    "TELEGRAM_BOT_TOKEN is not set. Set it in .env to run the bot, or use `npm run demo` to try the pipeline in the terminal."
  );
  process.exit(1);
}

const bot = new Bot(config.telegram.token!);

const HANDLE_RE = /@?([A-Za-z0-9_]{2,15})/;

function parseHandle(text: string): string | null {
  const m = text.trim().match(HANDLE_RE);
  return m ? m[1] : null;
}

async function deliverScore(ctx: any, handle: string, opts: { premium: boolean }) {
  const status = await ctx.reply(`🔎 Scoring @${handle}… pulling tweets, counting the "delve"s.`);
  try {
    const result = await scoreHandle(handle, {
      requestedBy: String(ctx.from?.id ?? "tg"),
    });
    const caption = formatReport(result.report, { premium: opts.premium });

    // 1. The verdict card (screenshottable, link baked in).
    if (result.cardPng.length > 0) {
      await ctx.replyWithPhoto(new InputFile(result.cardPng, `slopscore-${handle}.png`), {
        caption: caption.slice(0, 1024),
      });
      // Telegram caption cap is 1024; send the full roast/tips as a follow-up.
      if (caption.length > 1024) await ctx.reply(caption.slice(1024));
    } else {
      await ctx.reply(caption);
    }

    // 2. The voice clip (only if real audio was produced).
    if (result.voiceSource === "elevenlabs") {
      const audio = await readFile(result.voicePath);
      if (audio.length > 0) {
        await ctx.replyWithVoice(new InputFile(audio, `slopscore-${handle}.mp3`));
      }
    }

    // 3. Nudge toward the leaderboard + sharing.
    if (!opts.premium) {
      await ctx.reply(
        `🔓 Want every tell + per-tweet forensics, or to roast someone anonymously?\n/unlock for $${config.dodo.priceUsd}.\n\n📊 /leaderboard to see who's most slop-pilled.`
      );
    }
  } catch (err) {
    console.error("score error:", err);
    await ctx.reply("Something broke while scoring. Try again in a sec.");
  } finally {
    ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  }
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "🧪 *SlopScore* — the turing test for your timeline.",
      "",
      "DM me an X handle and I'll score how AI-generated your writing *reads* — em-dash abuse, \"it's not X, it's Y,\" \"delve,\" emoji bullet lists, the tricolon rhythm — and roast you *with receipts*.",
      "",
      "Try it: just send `@handle` (or any @).",
      "",
      "📊 /leaderboard — most human vs most slop-pilled",
      "🔓 /unlock — full forensics + roast-someone mode ($2)",
      "",
      "_It's a vibes rating on your writing style, not a claim about who typed it._",
    ].join("\n"),
    { parse_mode: "Markdown" }
  );
});

bot.command("caps", async (ctx) => {
  await ctx.reply(`capabilities: ${capabilitySummary()}`);
});

bot.command("leaderboard", async (ctx) => {
  const arg = ctx.match?.toString().trim().toLowerCase();
  const direction = arg === "human" ? "human" : "slop";
  const store = await getStore();
  const rows = await store.leaderboard(direction as "slop" | "human", 10);
  await ctx.reply(formatLeaderboard(rows, direction as "slop" | "human"));
});

bot.command("unlock", async (ctx) => {
  const userId = String(ctx.from?.id ?? "tg");
  const checkout = await createCheckout(userId, ctx.match?.toString().trim() || "self");
  await ctx.reply(
    [
      `🔓 Unlock SlopScore Premium — $${config.dodo.priceUsd}:`,
      "• Full forensic breakdown (every tell, every receipt, per-tweet)",
      "• Roast-someone-else mode (score any handle, anonymously)",
      "",
      `Checkout: ${checkout.url}`,
      checkout.source === "mock"
        ? "\n(demo mode: set DODO_API_KEY + DODO_PRODUCT_ID for real checkout)"
        : "",
    ].join("\n")
  );
});

bot.command("forensic", async (ctx) => {
  const handle = parseHandle(ctx.match?.toString() ?? "");
  if (!handle) return ctx.reply("usage: /forensic <handle>");
  const store = await getStore();
  const premium = await store.isPremium(String(ctx.from?.id ?? "tg"));
  if (!premium) {
    return ctx.reply(`🔒 Forensic mode is premium. /unlock for $${config.dodo.priceUsd}.`);
  }
  await deliverScore(ctx, handle, { premium: true });
});

bot.command("roast", async (ctx) => {
  const handle = parseHandle(ctx.match?.toString() ?? "");
  if (!handle) return ctx.reply("usage: /roast <handle>");
  const store = await getStore();
  const premium = await store.isPremium(String(ctx.from?.id ?? "tg"));
  if (!premium) {
    return ctx.reply(
      `🔒 Roast-someone-else mode is premium (keeps it fun, not abusive). /unlock for $${config.dodo.priceUsd}.`
    );
  }
  await deliverScore(ctx, handle, { premium: true });
});

// Any plain message: treat as a handle to score (free tier).
bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const handle = parseHandle(ctx.message.text);
  if (!handle) {
    return ctx.reply("Send me an X handle, like `@sama`.", { parse_mode: "Markdown" });
  }
  await deliverScore(ctx, handle, { premium: false });
});

bot.catch((err) => console.error("bot error:", err));

console.log(`SlopScore bot starting… capabilities: ${capabilitySummary()}`);
bot.start({
  onStart: (info) => console.log(`@${info.username} is live. DM it a handle.`),
});
