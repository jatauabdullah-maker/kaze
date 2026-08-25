"use strict";

const API = "http://127.0.0.1:8619";
const ZIP_URL = "https://github.com/jatauabdullah-maker/kaze-web/releases/latest/download/Kaze-Server.zip";
const REQUIRED_PROTOCOL = 2;

const $ = (id) => document.getElementById(id);
const els = {
  pill: $("status-pill"),
  pillLabel: document.querySelector("#status-pill .pill-label"),
  check: $("btn-check"),
  zip: $("btn-download-zip"),
  how: $("btn-how"),
  controls: $("btn-controls"),
  hero: $("connect-hero"),
  hintLine: $("hint-line"),
  workspace: $("workspace"),
  url: $("url-input"),
  inspect: $("btn-inspect"),
  note: $("composer-note"),
  result: $("result-card"),
  thumb: $("result-thumb"),
  title: $("result-title"),
  meta: $("result-meta"),
  chips: $("result-chips"),
  modeSeg: document.querySelectorAll("#mode-seg .seg-btn"),
  formatZone: $("format-zone"),
  formatLabel: $("format-label"),
  formatHint: $("format-hint"),
  formatGrid: $("format-grid"),
  audioFormatRow: $("audio-format-row"),
  audioFormat: $("audio-format"),
  optThumb: $("opt-thumb"),
  optMeta: $("opt-meta"),
  optSubs: $("opt-subs"),
  optSponsor: $("opt-sponsor"),
  optPlaylistWrap: $("opt-playlist-wrap"),
  optPlaylist: $("opt-playlist"),
  download: $("btn-download"),
  downloadNote: $("download-note"),
  est: $("est-text"),
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
let serverInfo = null;
let es = null;
let mode = "video";
let inspection = null;
let selectedFormatId = null;
const jobsMap = new Map();
let historyArr = [];

const ICONS = {
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
};

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
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 3600);
}
function setPill(state, label) {
  els.pill.className = `pill pill-${state}`;
  els.pillLabel.textContent = label;
}
function btnDisabled(btn, on) { btn.disabled = on; }

function setOnline(v, info) {
  online = v;
  serverInfo = info || null;
  if (!v) {
    setPill("off", "offline");
    els.workspace.classList.add("hidden");
    els.hero.classList.remove("hidden");
    return;
  }
  const okProto = info && info.protocol >= REQUIRED_PROTOCOL;
  if (!okProto) {
    setPill("off", "needs update");
    els.workspace.classList.add("hidden");
    els.hero.classList.remove("hidden");
    els.hintLine.innerHTML = "";
    toast("Your Kaze Server is outdated. Run Kaze.bat and pick option 1.", "warn");
    return;
  }
  setPill("on", "server online");
  els.hero.classList.add("hidden");
  els.workspace.classList.remove("hidden");
  loadState();
  connectSSE();
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
      if (event === "hello") setOnline(true, data);
      if (event === "job") {
        const prev = jobsMap.get(data.id);
        if (prev && prev.status !== data.status) {
          if (data.status === "done") toast("Saved");
          if (data.status === "error") toast((data.error || "Download failed").slice(0, 90), "err");
        }
        jobsMap.set(data.id, data);
        renderQueue();
      }
      if (event === "history") { historyArr = data; renderHistory(); }
    } catch {}
  };
  es.onerror = () => setPill("off", "offline");
}

async function loadState() {
  try {
    const r = await fetch(`${API}/state`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const s = await r.json();
    setOnline(true, s.server);
    if (s.downloadsDir) els.dlDir.textContent = s.downloadsDir;
    jobsMap.clear();
    for (const j of s.jobs || []) jobsMap.set(j.id, j);
    historyArr = s.history || [];
    renderQueue();
    renderHistory();
  } catch {}
}

/* Inspection */

async function doInspect() {
  els.note.textContent = "";
  const url = els.url.value.trim();
  if (!url) { els.note.textContent = "Paste a link first."; return; }
  if (!online) { els.note.textContent = "Server is offline. Hit Check my PC above."; return; }
  btnDisabled(els.inspect, true);
  els.inspect.querySelector("svg").style.display = "none";
  try {
    const r = await fetch(`${API}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      showInspectError(j.error || { code: "INSPECTION_FAILED", message: `Server said no (${r.status}).` });
      return;
    }
    inspection = j.inspection;
    selectedFormatId = null;
    renderInspection();
    els.result.classList.remove("hidden");
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    setOnline(false, null);
    els.note.textContent = "Lost the server. Hit Check my PC again.";
  } finally {
    btnDisabled(els.inspect, false);
    els.inspect.querySelector("svg").style.display = "";
  }
}

function showInspectError(err) {
  els.result.classList.add("hidden");
  const action = err.action || "edit_url";
  const map = {
    edit_url: ["Edit the link", els.url.focus.bind(els.url)],
    inspect: ["Inspect again", doInspect],
    retry: ["Try again", doInspect],
    repair: ["Repair server", () => controlsModal()],
  };
  const [label, fn] = map[action] || map.retry;
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost";
  btn.innerHTML = `${ICONS.refresh} ${label}`;
  btn.addEventListener("click", fn);
  els.note.innerHTML = "";
  els.note.textContent = err.message || "Could not inspect that link.";
  els.note.appendChild(document.createElement("br"));
  els.note.appendChild(btn);
}

function renderInspection() {
  const inc = inspection;
  els.thumb.src = inc.thumbnail || "";
  els.thumb.style.display = inc.thumbnail ? "" : "none";
  els.title.textContent = inc.title || "Untitled";
  const parts = [];
  if (inc.uploader) parts.push(esc(inc.uploader));
  if (inc.durationText) parts.push(esc(inc.durationText));
  els.meta.innerHTML = parts.join("  ·  ");
  els.chips.innerHTML = "";
  const addChip = (t) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = t;
    els.chips.appendChild(c);
  };
  if (inc.isPlaylist && inc.playlistCount) addChip(`${inc.playlistCount} items in playlist`);
  addChip((inc.extractor || "source").toUpperCase());
  if (inc.subtitles && inc.subtitles.length) addChip(`${inc.subtitles.length} subtitle lang`);

  els.optPlaylistWrap.classList.toggle("hidden", !inc.isPlaylist);
  if (!inc.isPlaylist) els.optPlaylist.checked = false;

  renderFormats();
}

function videoFormats(inc) {
  return (inc.formats || []).filter((f) => f.type === "video");
}
function audioFormats(inc) {
  return (inc.formats || []).filter((f) => f.type === "audio");
}

function renderFormats() {
  const inc = inspection;
  const videos = videoFormats(inc);
  const audios = audioFormats(inc);
  const grid = els.formatGrid;
  grid.innerHTML = "";

  if (mode === "video") {
    if (!videos.length) {
      els.formatHint.textContent = "No video formats were reported for this source.";
      return;
    }
    const sorted = videos.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || Number(b.hasAudio) - Number(a.hasAudio));
    els.formatHint.textContent = sorted.some((f) => !f.hasAudio)
      ? "Formats marked video-only are merged with the best available audio."
      : "Progressive formats include audio in one file.";
    for (const f of sorted) {
      grid.appendChild(formatCard(f));
    }
    if (!selectedFormatId) {
      const best = sorted.find((f) => f.hasAudio) || sorted[0];
      if (best) selectFormat(best);
    }
  } else {
    if (!audios.length) {
      els.formatHint.textContent = "No audio-only formats reported. Switch to Video and it will grab the best stream.";
      return;
    }
    const sorted = audios.slice().sort((a, b) => (b.abr || 0) - (a.abr || 0));
    els.formatHint.textContent = "Pick the source stream. MP3/M4A output is converted on your PC.";
    for (const f of sorted) {
      grid.appendChild(formatCard(f));
    }
    if (!selectedFormatId && sorted.length) selectFormat(sorted[0]);
  }
}

function formatCard(f) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fmt" + (selectedFormatId === f.formatId ? " selected" : "");
  b.dataset.fid = f.formatId;
  const main = document.createElement("div");
  main.className = "f-main";
  const res = document.createElement("span");
  res.className = "f-res";
  res.textContent = f.label.split(" · ")[0] || (f.type === "video" ? "Video" : "Audio");
  main.appendChild(res);
  if (f.type === "video" && !f.hasAudio) {
    const badge = document.createElement("span");
    badge.className = "f-badge";
    badge.textContent = "video only";
    main.appendChild(badge);
  }
  b.appendChild(main);
  const sub = document.createElement("span");
  sub.className = "f-sub";
  const bits = [];
  if (f.height && f.width) bits.push(`${f.width}x${f.height}`);
  if (f.fps) bits.push(`${f.fps} fps`);
  if (f.vcodec) bits.push(f.vcodec);
  if (f.type === "audio" && f.abr) bits.push(`${Math.round(f.abr)} kbps`);
  const size = fmtBytes(f.filesize);
  if (size) bits.push(size + (f.filesizeApprox ? " approx" : ""));
  sub.textContent = bits.join(" · ");
  b.appendChild(sub);
  b.addEventListener("click", () => selectFormat(f));
  return b;
}

function selectFormat(f) {
  selectedFormatId = f.formatId;
  els.formatGrid.querySelectorAll(".fmt").forEach((c) =>
    c.classList.toggle("selected", c.dataset.fid === f.formatId)
  );
  updateEstimate();
}

function updateEstimate() {
  if (!inspection || !selectedFormatId) return;
  const f = (inspection.formats || []).find((x) => x.formatId === selectedFormatId);
  if (!f) { els.est.textContent = ""; return; }
  const size = fmtBytes(f.filesize);
  if (size) {
    const approx = f.filesizeApprox ? " about" : "";
    els.est.textContent = `Estimated${approx} ${size}`;
  } else {
    els.est.textContent = "";
  }
}

/* Download */

async function submitDownload() {
  els.downloadNote.textContent = "";
  if (!inspection) return;
  if (!selectedFormatId) {
    els.downloadNote.textContent = "Pick a format first.";
    return;
  }
  const body = {
    url: inspection.url,
    inspectionId: inspection.inspectionId,
    mode,
    formatId: selectedFormatId,
    audioFormat: els.audioFormat.value,
    thumbnail: els.optThumb.checked,
    metadata: els.optMeta.checked,
    subs: els.optSubs.checked,
    sponsorblock: els.optSponsor.checked,
    playlist: els.optPlaylist.checked,
  };
  btnDisabled(els.download, true);
  try {
    const r = await fetch(`${API}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      const err = j.error || { message: `Server said no (${r.status}).` };
      els.downloadNote.textContent = err.message || "Could not start the download.";
      if (err.action === "inspect") {
        const again = document.createElement("button");
        again.className = "btn btn-ghost";
        again.innerHTML = `${ICONS.refresh} Inspect again`;
        again.addEventListener("click", doInspect);
        els.downloadNote.appendChild(document.createElement("br"));
        els.downloadNote.appendChild(again);
      }
      return;
    }
    jobsMap.set(j.job.id, j.job);
    renderQueue();
    toast("Added to the queue");
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    setOnline(false, null);
    els.downloadNote.textContent = "Lost the server. Check your connection.";
  } finally {
    btnDisabled(els.download, false);
  }
}

/* Queue + history */

function badge(status) {
  const map = {
    running: ["b-run", "grabbing"],
    queued: ["b-q", "queued"],
    done: ["b-done", "done"],
    error: ["b-err", "failed"],
    cancelled: ["b-q", "cancelled"],
  };
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
        ? `${fmtBytes(j.downloaded)}${j.total ? ` / ${fmtBytes(j.total)}` : ""}${fmtSpeed(j.speed) ? "  " + fmtSpeed(j.speed) : ""}${j.eta ? `  ·  ${fmtEta(j.eta)} left` : ""}`
        : j.status === "done" && j.filename
          ? esc(j.filename) + (j.formatLabel ? `  ·  ${esc(j.formatLabel)}` : "")
          : j.formatLabel ? esc(j.formatLabel) : (j.mode === "audio" ? `audio · ${j.audioFormat}` : `video · ${j.quality}`);
    const bar =
      j.status === "running" || j.status === "queued"
        ? `<div class="bar"><div style="width:${Math.max(2, Math.min(100, j.percent))}%"></div></div>`
        : "";
    const err = j.status === "error"
      ? `<div class="err-msg">${esc(j.error)}</div><span class="repair-chip">Fix: Kaze.bat option 1</span>`
      : "";
    const cancel =
      j.status === "running" || j.status === "queued"
        ? `<button class="icon-btn" data-cancel="${esc(j.id)}" title="Cancel">${ICONS.close}</button>`
        : "";
    return `<li class="item">
      <div class="item-top"><span class="item-title">${title}</span><span style="display:inline-flex;gap:8px;align-items:center">${badge(j.status)}${cancel}</span></div>
      <div class="item-meta">${meta}</div>
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
    const label = h.formatLabel ? esc(h.formatLabel) : (h.mode === "audio" ? "audio" : "video");
    return `<li class="item">
      <div class="item-top">
        <span class="item-title">${esc(h.title || h.filename)}</span>
        <button class="icon-btn" data-del="${esc(h.id)}" title="Remove from history">${ICONS.trash}</button>
      </div>
      <div class="item-meta">${label} · ${fmtBytes(h.size)} · ${when}</div>
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

/* Modal + help */

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
    <p>Small file, no installer, from the releases page.</p>
    <p style="margin-top:8px"><button class="btn btn-primary" id="modal-zip">${ICONS.down} Open download</button></p>
  </div></div>
  <div class="step-card"><div class="step-num">2</div><div class="step-body">
    <h3>Unzip it anywhere</h3>
    <p>Desktop is perfect. Keep the folder as-is.</p>
  </div></div>
  <div class="step-card"><div class="step-num">3</div><div class="step-body">
    <h3>Run <kbd>Kaze.bat</kbd> and pick <kbd>1</kbd></h3>
    <p>Installs everything, one time, and updates yt-dlp. Wait for the DONE box.</p>
  </div></div>
  <div class="step-card"><div class="step-num">4</div><div class="step-body">
    <h3>Pick <kbd>3</kbd> for auto-start, or <kbd>2</kbd> to start now</h3>
    <p>Auto-start keeps Kaze ready whenever you log into Windows.</p>
  </div></div>
  <div class="step-card"><div class="step-num">5</div><div class="step-body">
    <h3>Come back and hit Check my PC</h3>
    <p>This page connects straight to your PC. Nothing is uploaded anywhere.</p>
  </div></div>`;

function wizard(title, sub) {
  showModal(`
    <h2 id="modal-title">${esc(title)}</h2>
    <p class="sub">${esc(sub)}</p>
    ${STEPS}
    <div class="modal-actions">
      <button class="btn btn-primary" id="modal-recheck">${ICONS.refresh} Check again</button>
      <button class="btn btn-ghost" data-close>Later</button>
    </div>`);
  $("modal-zip").addEventListener("click", () => window.open(ZIP_URL, "_blank", "noopener"));
  $("modal-recheck").addEventListener("click", async () => {
    const info = await ping(3000);
    closeModal();
    if (info) setOnline(true, info);
    else wizard("Still not seeing it", "Make sure the server window says running, or redo the steps below.");
  });
}

function controlsModal() {
  showModal(`
    <h2 id="modal-title">Server controls</h2>
    <p class="sub">Everything lives in the menu on <b>Kaze.bat</b>, right where you unzipped it:</p>
    <div class="step-card"><div class="step-body"><h3><kbd>1</kbd> Initialize / Repair</h3><p>First-time install and the fix-all: updates yt-dlp when a source changes.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>2</kbd> Start server now</h3><p>Turns Kaze on for this session.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>3</kbd> Auto-start ON</h3><p>Kaze starts silently with Windows. Recommended.</p></div></div>
    <div class="step-card"><div class="step-body"><h3><kbd>4</kbd> Turn OFF</h3><p>Stops the server and removes auto-start.</p></div></div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Got it</button></div>`);
}

function connectOkBanner(info) {
  const zone = document.createElement("section");
  zone.className = "card";
  zone.innerHTML = `
    <div class="ok-banner">${ICONS.check} Server detected - connected to your own PC</div>
    <p class="dash-foot" style="margin:0 0 10px">Server v${esc(info.version)}. Wants Kaze always ready? Run <b>Kaze.bat</b> and pick <b>3</b> once. To shut it down: <b>4</b>.</p>
    <button class="btn btn-ghost" id="banner-dismiss">Dismiss</button>`;
  els.workspace.prepend(zone);
  $("banner-dismiss").addEventListener("click", () => zone.remove());
}

/* Wiring */

els.check.addEventListener("click", async () => {
  btnDisabled(els.check, true);
  const info = await ping();
  btnDisabled(els.check, false);
  if (info) {
    setOnline(true, info);
    if (!serverInfo || !sessionStorage.getItem("kaze-banner-shown")) {
      connectOkBanner(info);
      sessionStorage.setItem("kaze-banner-shown", "1");
    }
  } else {
    wizard("Welcome to Kaze", "Your PC is not running the Kaze Server yet - one-time setup takes about two minutes:");
  }
});

els.inspect.addEventListener("click", doInspect);
els.url.addEventListener("keydown", (e) => { if (e.key === "Enter") doInspect(); });
els.download.addEventListener("click", submitDownload);
els.zip.addEventListener("click", () => window.open(ZIP_URL, "_blank", "noopener"));
els.how.addEventListener("click", () => wizard("How Kaze works", "The website is the remote control. The muscle runs on your PC:"));
els.controls.addEventListener("click", controlsModal);

els.modeSeg.forEach((b) =>
  b.addEventListener("click", () => {
    els.modeSeg.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    els.audioFormatRow.classList.toggle("hidden", mode !== "audio");
    els.formatLabel.textContent = mode === "video" ? "Choose a video format" : "Choose an audio source";
    selectedFormatId = null;
    if (inspection) renderFormats();
  })
);

setInterval(async () => { const p = await ping(2000); setOnline(!!p, p); }, 15000);

ping().then((p) => { if (p) setOnline(true, p); });
