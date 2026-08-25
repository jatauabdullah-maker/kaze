"use strict";

const API = "http://127.0.0.1:8619";
const ZIP_URL = "https://github.com/jatauabdullah-maker/kaze-web/releases/latest/download/Kaze-Server.zip";

const $ = (id) => document.getElementById(id);
const els = {
  pill: $("status-pill"),
  check: $("btn-check"),
  zip: $("btn-download-zip"),
  how: $("btn-how"),
  controls: $("btn-controls"),
  dash: $("dashboard"),
  zone: $("setup-zone"),
  url: $("url-input"),
  grab: $("btn-grab"),
  note: $("composer-note"),
  qualityLabel: $("quality-label"),
  quality: $("quality"),
  audioWrap: $("audio-format-wrap"),
  audioFormat: $("audio-format"),
  queueList: $("queue-list"),
  queueEmpty: $("queue-empty"),
  queueCount: $("queue-count"),
  historyList: $("history-list"),
  historyEmpty: $("history-empty"),
  historyCount: $("history-count"),
  dlDir: $("dl-dir"),
  modalRoot: $("modal-root"),
  modalCard: $("modal-card"),
};

let online = false;
let es = null;
const jobsMap = new Map();
let historyArr = [];

const MODE_BTN = document.querySelectorAll("#mode-seg .seg-btn");
let mode = "video";

function fmtBytes(n) {
  if (!n || n <= 0) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtSpeed(n) { return n ? `${fmtBytes(n)}/s` : ""; }
function fmtEta(s) {
  if (!s && s !== 0) return "";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}m ${r}s` : `${r}s`;
}
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function toast(msg, kind = "ok") {
  const box = $("toasts");
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 3200);
}

function setOnline(v) {
  online = v;
  els.pill.className = `pill ${v ? "pill-on" : "pill-off"}`;
  els.pill.querySelector("b").textContent = v ? "server online" : "offline";
  if (v) els.dash.classList.remove("hidden");
}

async function ping(timeoutMs = 2500) {
  try {
    const r = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function connectSSE() {
  if (es) es.close();
  es = new EventSource(`${API}/events`);
  es.onmessage = (e) => {
    try {
      const { event, data } = JSON.parse(e.data);
      if (event === "hello") setOnline(true);
      if (event === "job") {
        const prev = jobsMap.get(data.id);
        if (prev && prev.status !== data.status) {
          if (data.status === "done") toast("Saved ✓");
          if (data.status === "error") toast((data.error || "Download failed").slice(0, 90), "err");
        }
        jobsMap.set(data.id, data);
        renderQueue();
      }
      if (event === "history") { historyArr = data; renderHistory(); }
    } catch {}
  };
  es.onerror = () => setOnline(false);
}

async function loadState() {
  try {
    const r = await fetch(`${API}/state`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const s = await r.json();
    setOnline(true);
    jobsMap.clear();
    for (const j of s.jobs || []) jobsMap.set(j.id, j);
    historyArr = s.history || [];
    if (s.downloadsDir) els.dlDir.textContent = s.downloadsDir;
    renderQueue();
    renderHistory();
  } catch { setOnline(false); }
}

function badge(status) {
  const map = { running: ["b-run", "grabbing"], queued: ["b-q", "queued"], done: ["b-done", "done"], error: ["b-err", "failed"], cancelled: ["b-q", "cancelled"] };
  const [cls, label] = map[status] || ["b-q", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderQueue() {
  const list = [...jobsMap.values()].sort((a, b) => b.addedAt - a.addedAt);
  els.queueCount.textContent = list.length;
  els.queueEmpty.classList.toggle("hidden", list.length > 0);
  els.queueList.innerHTML = list.map((j) => {
    const title = esc(j.title || j.url);
    const meta =
      j.status === "running"
        ? `${fmtBytes(j.downloaded)}${j.total ? ` / ${fmtBytes(j.total)}` : ""} · ${fmtSpeed(j.speed)}${j.eta ? ` · ${fmtEta(j.eta)} left` : ""}`
        : j.status === "done" && j.filename
          ? esc(j.filename)
          : j.mode === "audio" ? `audio · ${j.audioFormat}` : `video · ${j.quality === "best" ? "best" : j.quality + "p"}`;
    const bar =
      j.status === "running" || j.status === "queued"
        ? `<div class="bar"><div style="width:${Math.max(2, Math.min(100, j.percent))}%"></div></div>`
        : "";
    const err =
      j.status === "error"
        ? `<div class="err-msg">${esc(j.error)}</div><span class="repair-chip">Fix: Kaze.bat → option 1</span>`
        : "";
    const cancel =
      j.status === "running" || j.status === "queued"
        ? `<button class="icon-btn" data-cancel="${j.id}" title="Cancel">✕</button>`
        : "";
    return `<li class="item">
      <div class="item-top"><span class="item-title">${title}</span><span>${badge(j.status)} ${cancel}</span></div>
      <div class="item-sub">${meta}</div>
      ${bar}${err}
    </li>`;
  }).join("");

  els.queueList.querySelectorAll("[data-cancel]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await fetch(`${API}/jobs/${b.dataset.cancel}`, { method: "DELETE" }); } catch {}
    })
  );
}

function renderHistory() {
  const list = [...historyArr].sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  els.historyCount.textContent = list.length;
  els.historyEmpty.classList.toggle("hidden", list.length > 0);
  els.historyList.innerHTML = list.slice(0, 60).map((h) => {
    const when = h.finishedAt ? new Date(h.finishedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    return `<li class="item">
      <div class="item-top">
        <span class="item-title">${esc(h.title || h.filename)}</span>
        <span><span class="badge b-done">saved</span> <button class="icon-btn" data-del="${esc(h.id)}" title="Remove from history">🗑</button></span>
      </div>
      <div class="item-sub">${esc(h.filename || "")} · ${fmtBytes(h.size)} · ${when}</div>
    </li>`;
  }).join("");

  els.historyList.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await fetch(`${API}/history/${b.dataset.del}`, { method: "DELETE" }); } catch {}
      historyArr = historyArr.filter((h) => h.id !== b.dataset.del);
      renderHistory();
    })
  );
}

function showModal(html) {
  els.modalCard.innerHTML = html;
  els.modalRoot.classList.remove("hidden");
  els.modalCard.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
}
function closeModal() { els.modalRoot.classList.add("hidden"); }
els.modalRoot.addEventListener("click", (e) => { if (e.target === els.modalRoot) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

const STEPS = `
  <div class="step-card"><div class="step-num">1</div><div class="step-body">
    <h3>Download the Kaze Server (.zip)</h3>
    <p>Small file, no installer. Get it from the releases page.</p>
    <p style="margin-top:8px"><a href="${ZIP_URL}" target="_blank" rel="noopener"><button class="btn btn-primary" data-close-zip>Open download</button></a></p>
  </div></div>
  <div class="step-card"><div class="step-num">2</div><div class="step-body">
    <h3>Unzip it anywhere</h3>
    <p>Desktop is perfect. Keep the folder as-is.</p>
  </div></div>
  <div class="step-card"><div class="step-num">3</div><div class="step-body">
    <h3>Double-click <kbd>Kaze.bat</kbd> → choose <kbd>1</kbd></h3>
    <p>This installs everything automatically (one time). Wait until it says DONE. Want Kaze always ready? Then also pick <kbd>3</kbd> for auto-start.</p>
  </div></div>
  <div class="step-card"><div class="step-num">4</div><div class="step-body">
    <h3>Pick <kbd>2</kbd> to start the server</h3>
    <p>The window minimizes — that's Kaze working quietly in the background.</p>
  </div></div>
  <div class="step-card"><div class="step-num">5</div><div class="step-body">
    <h3>Come back here and hit <em>Check my PC</em></h3>
    <p>This page connects straight to your PC. Nothing is uploaded anywhere.</p>
  </div></div>`;

function wizard(title, sub) {
  showModal(`
    <h2>${title}</h2>
    <p class="sub">${sub}</p>
    ${STEPS}
    <div class="modal-actions">
      <button class="btn btn-primary" id="modal-recheck">Check again</button>
      <button class="btn btn-ghost" data-close>Later</button>
    </div>`);
  $("modal-recheck").addEventListener("click", async () => {
    const info = await ping(3000);
    closeModal();
    if (info) afterConnect(info); else wizard("Hmm, still not seeing it", "Make sure the server window says running — or redo the steps below.");
  });
}

function controlsModal() {
  showModal(`
    <h2>Server controls</h2>
    <p class="sub">Everything lives in the little menu on <b>Kaze.bat</b>, right where you unzipped it:</p>
    <div class="step-card"><div class="step-body"><h3><kbd>1</kbd> Initialize / Repair</h3><p>First-time install — and the fix-all later: updates yt-dlp when YouTube changes something.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>2</kbd> Start server now</h3><p>Turns Kaze on for this session.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>3</kbd> Auto-start ON</h3><p>Kaze starts silently with Windows — this page just works whenever you visit. Recommended.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>4</kbd> Turn OFF</h3><p>Stops the server completely and removes auto-start. Full off switch.</p></div></div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Got it</button></div>`);
}

function afterConnect(info) {
  setOnline(true);
  loadState();
  connectSSE();
  els.zone.innerHTML = `
    <div class="card" style="border-color: rgba(52,211,153,.35)">
      <div class="ok-banner">✓ Server detected — you're connected to your own PC</div>
      <p style="margin:4px 0 10px;color:var(--muted);font-size:13.5px">
        Downloads land in your folder, never through us.
        Want Kaze ready every time without starting anything?
        Run <b>Kaze.bat → option 3</b> once (auto-start).
        To fully shut it down later: <b>option 4</b>.
      </p>
      <button class="btn btn-ghost" id="zone-dismiss" style="font-size:12.5px;padding:6px 12px">Dismiss</button>
    </div>`;
  els.zone.classList.remove("hidden");
  $("zone-dismiss").addEventListener("click", () => els.zone.classList.add("hidden"));
  els.dash.scrollIntoView({ behavior: "smooth", block: "start" });
}

els.check.addEventListener("click", async () => {
  els.check.disabled = true;
  const info = await ping();
  els.check.disabled = false;
  if (info) afterConnect(info);
  else wizard("Welcome to Kaze 👋", "Your PC isn't running the Kaze Server yet — one-time setup, ~2 minutes:");
});

els.zip.addEventListener("click", () => window.open(ZIP_URL, "_blank", "noopener"));
els.how.addEventListener("click", () => wizard("How Kaze works", "The website is just the remote control. The muscle runs on your PC:"));
els.controls.addEventListener("click", controlsModal);

MODE_BTN.forEach((b) =>
  b.addEventListener("click", () => {
    MODE_BTN.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    els.audioWrap.classList.toggle("hidden", mode !== "audio");
    els.qualityLabel.textContent = mode === "audio" ? "Note: audio grabs best quality source" : "Quality";
    els.quality.parentElement.classList.toggle("hidden", mode === "audio");
  })
);

els.grab.addEventListener("click", submitJob);
els.url.addEventListener("keydown", (e) => { if (e.key === "Enter") submitJob(); });

async function submitJob() {
  els.note.textContent = "";
  const url = els.url.value.trim();
  if (!url) { els.note.textContent = "Paste a link first."; return; }
  if (!online) { els.note.textContent = "Server is offline — hit 'Check my PC' above."; return; }
  const body = {
    url,
    mode,
    quality: els.quality.value,
    audioFormat: els.audioFormat.value,
    thumbnail: $("opt-thumb").checked,
    subs: $("opt-subs").checked,
    sponsorblock: $("opt-sponsor").checked,
    playlist: $("opt-playlist").checked,
  };
  els.grab.disabled = true;
  try {
    const r = await fetch(`${API}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) els.note.textContent = j.error || `Server said no (${r.status}).`;
    else {
      jobsMap.set(j.job.id, j.job);
      renderQueue();
      els.url.value = "";
      toast("Added to queue — grabbing now");
    }
  } catch {
    setOnline(false);
    els.note.textContent = "Lost the server. Hit 'Check my PC' again.";
  }
  els.grab.disabled = false;
}

setInterval(async () => { const p = await ping(2000); setOnline(!!p); }, 15000);

ping().then((p) => { if (p) afterConnect(p); });
