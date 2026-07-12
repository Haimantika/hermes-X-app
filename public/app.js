const $ = (id) => document.getElementById(id);

// A per-browser id so scores map to a "user" for history.
const userId =
  localStorage.getItem("slopscore_uid") ||
  (() => {
    const id = "web-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("slopscore_uid", id);
    return id;
  })();

const LOADING_LINES = [
  "waking up hermes…",
  "pulling recent posts via linkup…",
  "counting the em-dashes…",
  "tallying every 'delve' and 'tapestry'…",
  "checking for emoji bullet lists 🚀✅…",
  "measuring the tricolon rhythm…",
  "assembling the receipts…",
];

// Score-based accent, matching the terminal tier palette.
function scoreColor(s) {
  if (s >= 80) return "#ff5a5a";
  if (s >= 60) return "#ff9a5a";
  if (s >= 40) return "#f5d76e";
  if (s >= 20) return "#c6ff3d";
  return "#6fe08a";
}

// Score-based emoji pair: [big reaction face, small badge face].
function scoreEmoji(s) {
  if (s >= 80) return { face: "💀", badge: "🤖" };
  if (s >= 60) return { face: "😬", badge: "🫥" };
  if (s >= 40) return { face: "🫣", badge: "🫥" };
  if (s >= 20) return { face: "😌", badge: "🌱" };
  return { face: "🧑", badge: "✨" };
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function countUp(el, target) {
  let cur = 0;
  const step = Math.max(1, Math.round(target / 40));
  const t = setInterval(() => {
    cur = Math.min(target, cur + step);
    el.textContent = cur;
    if (cur >= target) clearInterval(t);
  }, 20);
}

let loadingTimer = null;
function startLoading() {
  $("result").classList.add("hidden");
  $("loading").classList.remove("hidden");
  let i = 0;
  $("loading-line").textContent = LOADING_LINES[0];
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    $("loading-line").textContent = LOADING_LINES[i];
  }, 1400);
}
function stopLoading() {
  clearInterval(loadingTimer);
  $("loading").classList.add("hidden");
}

async function scoreHandle(handle) {
  startLoading();
  $("score-btn").disabled = true;
  try {
    const res = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "scoring failed");
    renderResult(data);
    loadBoard(currentDir);
  } catch (err) {
    toast(err.message);
  } finally {
    stopLoading();
    $("score-btn").disabled = false;
  }
}

let lastReport = null;
let lastShare = null;
function renderResult(data) {
  const r = data.report;
  lastReport = r;
  lastShare = {
    url: data.shareUrl || location.origin + "/s/" + r.handle,
    text: data.shareText || `@${r.handle} scored ${r.slopScore}/100 on SlopScore — “${r.verdict}”. Can you beat it? 🧪`,
    intent: data.shareIntent,
    cardUrl: data.cardUrl,
  };
  const color = scoreColor(r.slopScore);
  const emoji = scoreEmoji(r.slopScore);

  $("result-handle").textContent = r.handle;
  countUp($("score-num"), r.slopScore);

  $("score-face").textContent = emoji.face;

  const badge = $("tier-badge");
  badge.innerHTML = `<span class="badge-emoji">${emoji.badge}</span>${escapeHtml(r.verdict)}`;
  badge.style.background = color;
  badge.style.borderColor = color;

  $("tagline").textContent = "“" + r.tagline + "”";
  $("meta").textContent =
    `@${r.handle} · sampled ${r.sampleSize} posts · scored via ${data.via === "hermes" ? "hermes 🤖" : "direct"}`;

  if (data.cardUrl) {
    $("card-img").src = data.cardUrl + "?t=" + Date.now();
    $("download-card").href = data.cardUrl;
  }

  // Signal bars — fired tells scaled against the loudest one.
  const fired = r.tells.filter((t) => t.hits > 0);
  const maxHits = fired.reduce((m, t) => Math.max(m, t.hits), 1);
  $("signal-bars").innerHTML =
    fired
      .map((t) => {
        const q = t.receipts && t.receipts[0] ? t.receipts[0].quote : "";
        const w = Math.max(6, Math.round((t.hits / maxHits) * 100));
        return `<div class="bar-row">
          <div class="bar-top"><span>${escapeHtml(t.label)}</span><span class="bar-count">${t.hits}×</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
          ${q ? `<span class="bar-quote">“${escapeHtml(q)}”</span>` : ""}
        </div>`;
      })
      .join("") || `<div class="bar-quote">no slop-tells fired. suspiciously human. 👀</div>`;

  // Receipts — raw quote list.
  $("receipts-list").innerHTML =
    fired
      .map((t) => {
        const q = t.receipts && t.receipts[0] ? t.receipts[0].quote : "";
        return `<li><span class="label">${escapeHtml(t.label)}</span><span class="count"> — ${t.hits}×</span>${
          q ? `<span class="quote">“${escapeHtml(q)}”</span>` : ""
        }</li>`;
      })
      .join("") || `<li>no slop-tells fired. suspiciously human. 👀</li>`;

  // Roast
  $("roast-text").textContent = r.roast;
  if (data.clipUrl) {
    $("clip").src = data.clipUrl;
    $("clip").classList.remove("hidden");
  } else {
    $("clip").classList.add("hidden");
  }

  // Tips
  $("tips-list").innerHTML = r.tips
    .map(
      (t, i) =>
        `<div class="tip-item"><span class="tip-num">${String(i + 1).padStart(2, "0")}</span><span>${escapeHtml(
          t
        )}</span></div>`
    )
    .join("");

  $("result").classList.remove("hidden");
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Leaderboard
let currentDir = "slop";
async function loadBoard(dir) {
  currentDir = dir;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.dir === dir));
  const res = await fetch("/api/leaderboard?direction=" + dir);
  const data = await res.json();
  $("board-list").innerHTML =
    (data.rows || [])
      .map((row, i) => {
        return `<li>
        <span class="rank">${String(i + 1).padStart(2, "0")}</span>
        <span class="who">@${escapeHtml(row.handle)}<small>${escapeHtml(row.verdict || "")}</small></span>
        <span class="val" style="color:${scoreColor(row.slopScore)}">${row.slopScore}</span>
      </li>`;
      })
      .join("") || `<li><span class="who">no scores yet — be the first.</span></li>`;
}

// Wiring
$("score-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const handle = $("handle").value.trim().replace(/^@/, "");
  if (!handle) return toast("enter a handle first");
  scoreHandle(handle);
});
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => loadBoard(t.dataset.dir))
);
function xIntentUrl() {
  if (!lastShare) return null;
  return (
    lastShare.intent ||
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(lastShare.text)}&url=${encodeURIComponent(lastShare.url)}`
  );
}

// Try to attach the actual PNG via the native share sheet (mobile), so the user
// can post the image straight to X. Falls back to the X web intent (which
// unfurls the shareable link into the card image) everywhere else.
async function shareOnX() {
  if (!lastShare) return;
  if (navigator.canShare && lastShare.cardUrl) {
    try {
      const resp = await fetch(lastShare.cardUrl);
      const blob = await resp.blob();
      const file = new File([blob], "slopscore.png", { type: blob.type || "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "SlopScore",
          text: `${lastShare.text} ${lastShare.url}`,
        });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  const url = xIntentUrl();
  if (url) window.open(url, "_blank", "noopener");
}

$("share-x").addEventListener("click", shareOnX);
$("copy-link").addEventListener("click", () => {
  if (!lastShare) return;
  navigator.clipboard
    .writeText(lastShare.url)
    .then(() => toast("share link copied!"))
    .catch(() => toast(lastShare.url));
});

// Init
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    $("hermes-badge").textContent = "capabilities → " + h.capabilities;
  })
  .catch(() => {});
loadBoard("slop");
