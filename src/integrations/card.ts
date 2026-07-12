/**
 * Verdict card renderer.
 *
 * Draws a deterministic, screenshottable card as SVG and rasterises to PNG with
 * @resvg/resvg-js (no headless browser needed). The SlopScore and the app link
 * are baked INTO the image — so when someone reposts their verdict, the link
 * travels with the screenshot (the anti-spoof requirement).
 */

import { Resvg } from "@resvg/resvg-js";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlopReport } from "../engine/types.js";
import { computeBadges, type Badge } from "../engine/badges.js";

const WIDTH = 1200;
const HEIGHT = 675; // 16:9, ideal for X cards

const EMOJI_DIR = join(dirname(fileURLToPath(import.meta.url)), "emoji");
const EMOJI_CACHE = new Map<string, string>();

/**
 * Inline a bundled Twemoji glyph. resvg has no colour-emoji font, so instead of
 * relying on text glyphs we drop the emoji's own vector shapes straight into the
 * card SVG. Returns the inner markup of the 36x36 Twemoji source (paths only).
 */
function emojiInner(code: string): string {
  let inner = EMOJI_CACHE.get(code);
  if (inner === undefined) {
    const raw = readFileSync(join(EMOJI_DIR, `${code}.svg`), "utf8");
    inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    EMOJI_CACHE.set(code, inner);
  }
  return inner;
}

/** Render a Twemoji glyph (native 36x36 viewBox) at (x,y), scaled to `size` px. */
function emoji(code: string, x: number, y: number, size: number, opacity = 1): string {
  const s = size / 36;
  const op = opacity !== 1 ? ` opacity="${opacity}"` : "";
  return `<g transform="translate(${x} ${y}) scale(${s})"${op}>${emojiInner(code)}</g>`;
}

/** Score → reaction face. More slop = more alarmed. Matches scoreColor tiers. */
function scoreFace(score: number): string {
  if (score >= 75) return "1f480"; // 💀 fully cooked
  if (score >= 55) return "1f62c"; // 😬 yikes
  if (score >= 35) return "1fae3"; // 🫣 peeking
  if (score >= 18) return "1f60c"; // 😌 relieved
  return "1f607"; // 😇 gloriously human
}

/**
 * Strip emoji + symbol codepoints from user/report text. Text is drawn with
 * system fonts that have no colour-emoji glyphs, so stray emoji in copy would
 * become tofu boxes (□). Decorative emoji are drawn separately as vectors.
 */
function stripEmoji(s: string): string {
  return s
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2705}\u{2728}\u{FE0F}\u{200D}\u{20E3}]/gu,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function xmlEscape(s: string): string {
  return stripEmoji(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Naive width-aware wrap for the receipts list (monospace-ish estimate). */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur.trim());
  if (lines.length === maxLines && cur) lines[maxLines - 1] += "…";
  return lines;
}

/** Colour ramp from green (human) to red (slop). */
function scoreColor(score: number): string {
  if (score >= 75) return "#ff4d5e";
  if (score >= 55) return "#ff8a3d";
  if (score >= 35) return "#ffd23d";
  if (score >= 18) return "#7ee081";
  return "#3ddc84";
}

/**
 * A single punchy roast line for the card footer ("quick roast" mode).
 * Deterministic given the report: leads with the worst tell when receipts are
 * present, otherwise falls back to a score-keyed jab so summary-rebuilt cards
 * still land. Kept to one line so it fits the footer band.
 */
function quickRoast(report: SlopReport): string {
  const top = report.tells.find((t) => t.hits > 0);
  const s = report.slopScore;

  let line: string;
  if (top) {
    const label = top.label.toLowerCase();
    if (s >= 75) line = `${top.hits}× ${label} — the model isn't assisting you, it's writing you.`;
    else if (s >= 45) line = `${top.hits}× ${label} — human core, GPT crust, receipts attached.`;
    else line = `A little ${label} (${top.hits}×), but this mostly reads like a real person.`;
  } else if (s >= 75) {
    line = "The slop is coming from inside the timeline. It's not looking great, bestie.";
  } else if (s >= 45) {
    line = "Half human, half autocomplete — and you know which half.";
  } else if (s >= 18) {
    line = "Mostly human, with the occasional GPT tab left open.";
  } else {
    line = "Gloriously, messily, real. The rare human-typed timeline.";
  }

  const MAX = 96;
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

/**
 * Lay out earned badges as a single left-aligned row of rounded pills just under
 * the handle/verdict block. Widths are estimated from the label length (Arial
 * ~0.56em per char) so nothing needs a real text-measuring pass. The row stops
 * short of the reaction face on the right, and badges that would spill past that
 * margin are dropped so the row always stays on one clean line.
 */
const BADGE_ROW_TOP = 292;
const BADGE_ROW_HEIGHT = 44;

function renderBadges(badges: Badge[], color: string): string {
  if (badges.length === 0) return "";

  const yTop = BADGE_ROW_TOP;
  const h = BADGE_ROW_HEIGHT;
  const emojiSize = 22;
  const fontSize = 21;
  const leftPad = 16;
  const gapEmojiText = 9;
  const rightPad = 16;
  const pillGap = 13;
  const maxRight = 900; // leave the reaction face on the right untouched

  let x = 70;
  let svg = "";
  for (const b of badges) {
    const label = xmlEscape(b.label);
    const textW = Math.ceil(label.length * fontSize * 0.56);
    const pillW = leftPad + emojiSize + gapEmojiText + textW + rightPad;
    if (x + pillW > maxRight) break; // keep the row to a single line

    svg += `<rect x="${x}" y="${yTop}" width="${pillW}" height="${h}" rx="23" fill="#1c2434" stroke="${color}" stroke-opacity="0.55" stroke-width="1.5"/>`;
    svg += emoji(b.emoji, x + leftPad, yTop + (h - emojiSize) / 2, emojiSize);
    svg += `<text x="${x + leftPad + emojiSize + gapEmojiText}" y="${
      yTop + h / 2 + fontSize * 0.36
    }" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#e7ebf3">${label}</text>`;
    x += pillW + pillGap;
  }
  return svg;
}

export function buildCardSvg(report: SlopReport): string {
  const color = scoreColor(report.slopScore);
  const badges = computeBadges({
    handle: report.handle,
    slopScore: report.slopScore,
  }).slice(0, 4);
  const badgesSvg = renderBadges(badges, color);

  // Top 3 fired tells as receipts.
  const fired = report.tells.filter((t) => t.hits > 0).slice(0, 3);
  const receiptLines: string[] = [];
  for (const t of fired) {
    const quote = stripEmoji(t.receipts[0]?.quote ?? "");
    const head = `${t.label}  (${t.hits}x)`;
    receiptLines.push(`__HEAD__${head}`);
    if (quote.length >= 3) {
      for (const l of wrap(`“${quote}”`, 58, 2)) receiptLines.push(l);
    }
  }

  let receiptsSvg = "";
  // Start receipts below the badge row when badges are present, else reclaim the space.
  let y = badges.length > 0 ? BADGE_ROW_TOP + BADGE_ROW_HEIGHT + 34 : 300;
  for (const line of receiptLines.slice(0, 7)) {
    if (y > HEIGHT - 130) break; // keep clear of the quick-roast footer band
    if (line.startsWith("__HEAD__")) {
      y += 14;
      receiptsSvg += `<text x="70" y="${y}" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${color}">${xmlEscape(
        line.replace("__HEAD__", "")
      )}</text>`;
      y += 34;
    } else {
      receiptsSvg += `<text x="70" y="${y}" font-family="Georgia, serif" font-size="23" font-style="italic" fill="#d7dae0">${xmlEscape(
        line
      )}</text>`;
      y += 30;
    }
  }

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0f17"/>
      <stop offset="1" stop-color="#161c2b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="8" fill="url(#accent)"/>

  <!-- Brand -->
  <text x="70" y="90" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#ffffff">Slop<tspan fill="${color}">Score</tspan></text>
  <text x="70" y="122" font-family="Arial, sans-serif" font-size="20" fill="#8891a5">the turing test for your timeline</text>

  <!-- Big score, right side -->
  <text x="${WIDTH - 70}" y="150" text-anchor="end" font-family="Arial, sans-serif" font-size="150" font-weight="900" fill="${color}">${report.slopScore}</text>
  <text x="${WIDTH - 70}" y="192" text-anchor="end" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#8891a5">/ 100 SLOP</text>

  <!-- Reaction face + sparkles, keyed to the score -->
  ${emoji("2728", 928, 338, 34, 0.85)}
  ${emoji(scoreFace(report.slopScore), 955, 232, 175)}
  ${emoji("2728", 1096, 208, 50, 0.95)}

  <!-- Handle + verdict -->
  <text x="70" y="200" font-family="Arial, sans-serif" font-size="46" font-weight="800" fill="#ffffff">@${xmlEscape(
    report.handle
  )}</text>
  <text x="70" y="240" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${color}">${xmlEscape(
    report.verdict
  )}</text>
  <text x="70" y="272" font-family="Arial, sans-serif" font-size="22" fill="#a7b0c2">${xmlEscape(
    report.tagline
  )}</text>

  <!-- Collectible badges -->
  ${badgesSvg}

  <!-- Receipts -->
  ${receiptsSvg}

  <!-- Quick roast footer band -->
  <rect x="0" y="${HEIGHT - 96}" width="${WIDTH}" height="96" fill="#0a0d14"/>
  <rect x="0" y="${HEIGHT - 96}" width="${WIDTH}" height="3" fill="url(#accent)"/>
  <text x="70" y="${HEIGHT - 54}" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="${color}">Okay, this is what it is.</text>
  <text x="70" y="${HEIGHT - 22}" font-family="Georgia, serif" font-size="26" font-style="italic" fill="#eef1f6">${xmlEscape(
    quickRoast(report)
  )}</text>
</svg>`;
}

export interface CardResult {
  path: string;
  png: Buffer;
}

/** The deterministic on-disk / URL filename for a handle's verdict card. */
export function cardBasename(handle: string, slopScore: number): string {
  return `slopscore-${handle}-${slopScore}.png`;
}

export async function renderCard(report: SlopReport, outDir = "output"): Promise<CardResult> {
  const svg = buildCardSvg(report);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  const path = resolve(outDir, cardBasename(report.handle, report.slopScore));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  return { path, png };
}

/** A minimal summary sufficient to redraw a card when the full report is gone. */
export interface CardSummary {
  handle: string;
  slopScore: number;
  verdict: string;
  tagline?: string;
}

/**
 * Rebuild a handle's card from stored summary fields (no receipts). Used by the
 * share page so a shareable link keeps working even if the original PNG was
 * cleaned up or lost across a redeploy.
 */
export async function renderCardFromSummary(
  summary: CardSummary,
  outDir = "output"
): Promise<CardResult> {
  const report: SlopReport = {
    handle: summary.handle,
    slopScore: summary.slopScore,
    verdict: summary.verdict,
    tagline: summary.tagline ?? "",
    sampleSize: 0,
    tells: [],
    roast: "",
    tips: [],
    generatedAt: new Date().toISOString(),
  };
  return renderCard(report, outDir);
}
