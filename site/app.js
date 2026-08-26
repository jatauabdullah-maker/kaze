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
  sysBadge: $("sys-badge"),
  sysPulse: document.querySelector("#sys-card .pulse-dot"),
  sysVer: $("sys-ver"),
  sysEngine: $("sys-engine"),
  sysDir: $("sys-dir"),
  sysCaps: $("sys-caps"),
  workspace: $("workspace"),
  url: $("url-input"),
  inspect: $("btn-inspect"),
  inspectLabel: $("inspect-btn-label"),
  inspectIco: document.querySelector("#btn-inspect .inspect-ico"),
  note: $("composer-note"),
  progress: $("inspect-progress"),
  scanTitle: $("scan-title"),
  scanSub: $("scan-sub"),
  scanTimer: $("scan-timer"),
  scanFill: $("scan-fill"),
  scanStages: document.querySelectorAll("#scan-stages .st"),
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
  resCount: $("res-count"),
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
  clearQueue: $("btn-clear-queue"),
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
const liMap = new Map();
const progRec = new Map();

let inspectStart = 0;
let inspectTick = null;
let currentInspectUrl = null;

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
  if (s === null || s === undefined || Number.isNaN(s)) return "";
  if (s < 0) s = 0;
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
  setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 320); }, 3600);
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
    els.sysBadge.textContent = "Offline";
    els.sysBadge.classList.remove("on");
    els.sysPulse.classList.remove("on");
    els.sysVer.textContent = "Not detected";
    els.sysDir.textContent = "Downloads\\KazeVideos";
    els.sysCaps.innerHTML = '<span style="opacity:.45">waiting for server…</span>';
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
  els.sysBadge.textContent = "Online";
  els.sysBadge.classList.add("on");
  els.sysPulse.classList.add("on");
  els.sysVer.textContent = `v${info.version}`;
  if (info.provider) els.sysEngine.textContent = info.provider;
  els.hero.classList.add("hidden");
  els.workspace.classList.remove("hidden");
  renderCaps(info.capabilities);
}

function renderCaps(caps) {
  if (!caps) return;
  const order = ["inspect", "formats", "audio", "subtitles", "playlists", "sponsorblock", "thumbnails", "metadata"];
  const labels = { sponsorblock: "sponsor skip", thumbnails: "thumbnails", metadata: "metadata", subtitles: "subtitles", playlists: "playlists", audio: "audio", formats: "formats", inspect: "inspect" };
  const on = order.filter((k) => caps[k]);
  els.sysCaps.innerHTML = on.map((k) => `<span>${esc(labels[k] || k)}</span>`).join("") ||
    '<span>updates</span>';
}

async function ping(timeoutMs = 2500) {
  try {
    const r = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function connectAndLoad(info) {
  setOnline(true, info);
  await loadState();
  connectSSE();
}

function connectSSE() {
  if (es) es.close();
  es = new EventSource(`${API}/events`);
  es.onmessage = (e) => {
    try {
      const { event, data } = JSON.parse(e.data);
      if (event === "hello") setOnline(true, data);
      if (event === "inspect") {
        if (data && currentInspectUrl && data.url === currentInspectUrl && data.phase === "done") {
          scanMarkDone(data);
        }
      }
      if (event === "job") {
        const prev = jobsMap.get(data.id);
        if (prev && prev.status !== data.status) {
          if (data.status === "done") toast("Saved");
          if (data.status === "error") toast((data.error || "Download failed").slice(0, 90), "err");
        }
        jobsMap.set(data.id, data);
        renderQueue();
      }
    } catch {}
  };
  es.onerror = () => setPill("off", "offline");
}

async function loadState() {
  try {
    const r = await fetch(`${API}/state`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const s = await r.json();
    online = true;
    serverInfo = s.server || serverInfo;
    if (s.downloadsDir) {
      els.dlDir.textContent = s.downloadsDir;
      els.sysDir.textContent = s.downloadsDir;
    }
    jobsMap.clear();
    liMap.clear();
    for (const j of s.jobs || []) jobsMap.set(j.id, j);
    renderQueue();
  } catch {}
}

/* ------------------------------------------------------------------
   Inspection progress (wind scanner)
------------------------------------------------------------------- */

function scanReset() {
  els.progress.classList.remove("hidden");
  els.scanTitle.textContent = "Inspecting link";
  els.scanSub.textContent = "Contacting the source…";
  els.scanTimer.textContent = "0s";
  els.scanFill.style.width = "4%";
  els.scanStages.forEach((s) => {
    s.classList.remove("active", "done");
    if (s.dataset.st === "0") s.classList.add("active");
  });
  inspectStart = Date.now();
  if (inspectTick) clearInterval(inspectTick);
  inspectTick = setInterval(scanTick, 250);
}

const SCAN_STAGES = [
  ["Contacting the source…", 1.6],
  ["Reading the page metadata…", 4.2],
  ["Mapping available formats…", Infinity],
];

function scanTick() {
  const t = (Date.now() - inspectStart) / 1000;
  els.scanTimer.textContent = `${Math.floor(t)}s`;
  let active = 0;
  for (let i = 0; i < SCAN_STAGES.length; i++) {
    if (t >= SCAN_STAGES[i][1]) active = i;
  }
  els.scanStages.forEach((s) => {
    const st = Number(s.dataset.st);
    s.classList.toggle("active", st === active);
    s.classList.toggle("done", st < active);
  });
  els.scanSub.textContent = SCAN_STAGES[active][0];
  if (t > 10) els.scanSub.textContent = active >= 2 ? "Still scanning — large playlists can take a moment…" : SCAN_STAGES[active][0];
  const target = 90;
  const fill = target * (1 - Math.exp(-t / 6));
  els.scanFill.style.width = `${Math.min(90, 4 + fill)}%`;
}

function scanMarkDone() {
  if (inspectTick) { clearInterval(inspectTick); inspectTick = null; }
  els.scanFill.style.width = "100%";
  els.scanTitle.textContent = "Formats found";
  els.scanSub.textContent = "Done — nothing has been downloaded yet.";
  els.scanStages.forEach((s) => { s.classList.remove("active"); s.classList.add("done"); });
  setTimeout(() => {
    els.progress.classList.add("hidden");
    els.scanFill.style.width = "4%";
  }, 900);
}

function scanStop() {
  if (inspectTick) { clearInterval(inspectTick); inspectTick = null; }
  els.progress.classList.add("hidden");
}

/* ------------------------------------------------------------------
   Inspection
------------------------------------------------------------------- */

async function doInspect() {
  els.note.textContent = "";
  els.downloadNote.textContent = "";
  els.result.classList.add("hidden");
  const url = els.url.value.trim();
  if (!url) { els.note.textContent = "Paste a link first."; return; }
  if (!online) { els.note.textContent = "Server is offline. Hit Check my PC above."; return; }

  btnDisabled(els.inspect, true);
  els.inspect.classList.add("loading");
  els.inspectIco.style.display = "none";
  els.inspectLabel.textContent = "Inspecting…";
  currentInspectUrl = url;
  scanReset();

  try {
    const r = await fetch(`${API}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const j = await r.json().catch(() => ({}));
    currentInspectUrl = null;
    if (!r.ok || !j.ok) {
      scanStop();
      showInspectError(j.error || { code: "INSPECTION_FAILED", message: `Server said no (${r.status}).` });
      return;
    }
    inspection = j.inspection;
    selectedFormatId = null;
    renderInspection();
    scanMarkDone();
    els.result.classList.remove("hidden");
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    currentInspectUrl = null;
    scanStop();
    setOnline(false, null);
    els.note.textContent = "Lost the server. Hit Check my PC again.";
  } finally {
    btnDisabled(els.inspect, false);
    els.inspect.classList.remove("loading");
    els.inspectIco.style.display = "";
    els.inspectLabel.textContent = "Inspect link";
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
  btn.className = "btn btn-ghost btn-xs";
  btn.innerHTML = `${ICONS.refresh} ${label}`;
  btn.addEventListener("click", fn);
  els.note.innerHTML = "";
  els.note.textContent = err.message || "Could not inspect that link.";
  els.note.appendChild(document.createElement("br"));
  els.note.appendChild(btn);
}

function renderInspection() {
  const inc = inspection;
  els.thumb.onerror = () => { els.thumb.style.display = "none"; };
  els.thumb.src = inc.thumbnail || "";
  els.thumb.style.display = inc.thumbnail ? "" : "none";
  if (inc.thumbnail) {
    els.thumb.classList.remove("loaded");
    els.thumb.onload = () => els.thumb.classList.add("loaded");
  }
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

/* Codec short names */
function codecLabel(v) {
  if (!v) return "";
  const c = String(v).split(".")[0].toLowerCase();
  const map = { avc1: "h264", vp09: "vp9", av01: "av1", hev1: "hevc", hvc1: "hevc", vp8: "vp8", mp4a: "aac" };
  return map[c] || c;
}

const TIERS = [
  [2160, "4K"], [1440, "1440p"], [1080, "1080p"], [720, "720p"], [480, "480p"], [360, "360p"], [240, "240p"], [0, "SD"],
];
function tierLabel(h) {
  for (const [min, label] of TIERS) if (h >= min) return label;
  return "SD";
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
      els.resCount.textContent = "";
      return;
    }
    const sorted = videos.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || Number(b.hasAudio) - Number(a.hasAudio));
    els.formatHint.textContent = sorted.some((f) => !f.hasAudio)
      ? "Picks are merged with the best audio automatically. Filled pill = one-file format."
      : "One-file formats — audio already included.";
    els.resCount.textContent = `${sorted.length} formats`;

    const byTier = new Map();
    for (const f of sorted) {
      const k = tierLabel(f.height || 0);
      if (!byTier.has(k)) byTier.set(k, []);
      byTier.get(k).push(f);
    }
    let delay = 0;
    for (const [label, fs] of byTier) {
      const tier = document.createElement("div");
      tier.className = "tier";
      const tlabel = document.createElement("div");
      tlabel.className = "tier-label";
      tlabel.textContent = label;
      tier.appendChild(tlabel);
      const pills = document.createElement("div");
      pills.className = "tier-pills";
      for (const f of fs) {
        pills.appendChild(formatPill(f, delay));
        delay += 0.03;
      }
      tier.appendChild(pills);
      grid.appendChild(tier);
    }
    if (!selectedFormatId) {
      const best = sorted.find((f) => f.hasAudio) || sorted[0];
      if (best) selectFormat(best);
    }
  } else {
    if (!audios.length) {
      els.formatHint.textContent = "No audio-only formats reported. Switch to Video and it will grab the best stream.";
      els.resCount.textContent = "";
      return;
    }
    const sorted = audios.slice().sort((a, b) => (b.abr || 0) - (a.abr || 0));
    els.formatHint.textContent = "Pick the source stream. MP3/M4A output is converted on your PC.";
    els.resCount.textContent = `${sorted.length} formats`;
    const tier = document.createElement("div");
    tier.className = "tier";
    const tlabel = document.createElement("div");
    tlabel.className = "tier-label";
    tlabel.textContent = "Audio streams";
    tier.appendChild(tlabel);
    const pills = document.createElement("div");
    pills.className = "tier-pills";
    sorted.forEach((f, i) => pills.appendChild(formatPill(f, i * 0.03)));
    tier.appendChild(pills);
    grid.appendChild(tier);
    if (!selectedFormatId && sorted.length) selectFormat(sorted[0]);
  }
}

function formatPill(f, delay) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fmt" + (selectedFormatId === f.formatId ? " selected" : "");
  b.dataset.fid = f.formatId;
  b.style.animationDelay = `${Math.min(delay, 0.5)}s`;

  const res = document.createElement("span");
  res.className = "pf-res";
  const ext = document.createElement("span");
  ext.className = "pf-ext";
  const subBits = [];

  if (f.type === "video") {
    res.textContent = `${f.height}p`;
    ext.textContent = (f.ext || "").toUpperCase();
    const codec = codecLabel(f.vcodec);
    if (codec) subBits.push(codec);
  } else {
    res.textContent = (f.ext || "AUDIO").toUpperCase();
    if (f.abr) subBits.push(`${Math.round(f.abr)} kbps`);
  }
  const size = fmtBytes(f.filesize);
  if (size) subBits.push((f.filesizeApprox ? "~" : "") + size);

  const sub = document.createElement("span");
  sub.className = "pf-sub";
  sub.textContent = subBits.join(" · ");

  b.appendChild(res);
  if (f.type === "video") b.appendChild(ext);
  if (subBits.length) b.appendChild(sub);
  if (f.type === "video" && f.hasAudio) {
    const prog = document.createElement("span");
    prog.className = "pf-prog";
    prog.textContent = "progressive";
    b.appendChild(prog);
  }
  const check = document.createElement("span");
  check.className = "pf-check";
  check.textContent = "✓";
  b.appendChild(check);

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

/* ------------------------------------------------------------------
   Download
------------------------------------------------------------------- */

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
  els.download.classList.add("loading");
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
        again.className = "btn btn-ghost btn-xs";
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
    document.querySelector(".queue-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    setOnline(false, null);
    els.downloadNote.textContent = "Lost the server. Check your connection.";
  } finally {
    btnDisabled(els.download, false);
    els.download.classList.remove("loading");
  }
}

/* ------------------------------------------------------------------
   Queue — smooth in-place updates
------------------------------------------------------------------- */

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

function jobMeta(j) {
  if (j.status === "running") {
    const bits = [];
    if (j.downloaded) bits.push(fmtBytes(j.downloaded));
    if (j.total) bits.push(`/ ${fmtBytes(j.total)}`);
    if (j.speed) bits.push(`· ${fmtSpeed(j.speed)}`);
    const eta = fmtEta(j.eta);
    if (eta) bits.push(`· ${eta} left`);
    return bits.join(" ");
  }
  if (j.status === "done" && j.filename) {
    return [esc(j.filename), j.formatLabel ? `· ${esc(j.formatLabel)}` : ""].join(" ");
  }
  return j.formatLabel
    ? esc(j.formatLabel)
    : (j.mode === "audio" ? `audio · ${esc(j.audioFormat || "mp3")}` : `video`);
}

function updateItem(li, j) {
  const now = Date.now();
  const rec = progRec.get(j.id) || { last: now, pct: 0 };
  if (j.status === "running") {
    if (j.percent > rec.pct) rec.last = now;
  }
  rec.pct = j.percent;
  progRec.set(j.id, rec);

  const stalled = j.status === "running" && now - rec.last > 2800 && j.percent < 100;
  const processing = j.status === "running" && (stalled || j.percent >= 99.6);
  const connecting = j.status === "running" && !j.downloaded && j.percent <= 0 && now - rec.last > 1500;

  li.classList.toggle("processing", processing);
  li.classList.toggle("done", j.status === "done");
  li.classList.toggle("queued", j.status === "queued");
  li.classList.toggle("error", j.status === "error");

  const cancel = j.status === "running" || j.status === "queued"
    ? `<button class="icon-btn" data-cancel="${esc(j.id)}" title="Cancel">${ICONS.close}</button>`
    : "";

  li.innerHTML = `
    <div class="item-top">
      <span class="item-title">${esc(j.title || j.url)}</span>
      <span style="display:inline-flex;gap:8px;align-items:center">${badge(j.status)}${cancel}</span>
    </div>
    <div class="item-meta">${jobMeta(j)}</div>
    <div class="bar"><div style="width:${Math.max(2, Math.min(100, j.percent))}%"></div></div>
    <div class="bar-ind"><span>${processing ? "Processing with FFmpeg…" : connecting ? "Connecting…" : "Working…"}</span><span class="dots"><i></i><i></i><i></i></span></div>
    ${j.status === "error" ? `<div class="err-msg">${esc(j.error)}</div><span class="repair-chip" data-repair>Fix: Kaze.bat option 1</span>` : ""}`;
}

function renderQueue() {
  const list = [...jobsMap.values()].sort((a, b) => b.addedAt - a.addedAt);
  els.queueCount.textContent = list.length;
  els.queueEmpty.classList.toggle("hidden", list.length > 0);

  const seen = new Set();
  const frag = document.createDocumentFragment();
  for (const j of list) {
    seen.add(j.id);
    let li = liMap.get(j.id);
    if (!li) {
      li = document.createElement("li");
      li.className = "item";
      liMap.set(j.id, li);
    }
    updateItem(li, j);
    frag.appendChild(li);
  }
  for (const [id, li] of liMap) {
    if (!seen.has(id)) { li.remove(); liMap.delete(id); progRec.delete(id); }
  }
  els.queueList.innerHTML = "";
  els.queueList.appendChild(frag);

  els.queueList.querySelectorAll("[data-cancel]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await fetch(`${API}/jobs/${b.dataset.cancel}`, { method: "DELETE" }); } catch {}
    })
  );
  els.queueList.querySelectorAll("[data-repair]").forEach((b) =>
    b.addEventListener("click", controlsModal)
  );
}

/* ------------------------------------------------------------------
   Modal + help
------------------------------------------------------------------- */

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
    <h3>Pick <kbd>2</kbd> to start the server now</h3>
    <p>Or run <kbd>Kaze.bat</kbd> 5 for silent auto-start with Windows.</p>
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
  $("modal-zip").addEventListener("click", () => {
    toast("Opening the Kaze Server download…");
    const a = document.createElement("a");
    a.href = ZIP_URL;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  });
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
    <div class="step-card"><div class="step-body"><h3><kbd>3</kbd> Turn OFF</h3><p>Stops the server.</p></div></div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Got it</button></div>`);
}

function connectOkBanner(info) {
  const zone = document.createElement("section");
  zone.className = "card";
  zone.innerHTML = `
    <div class="ok-banner">${ICONS.check} Server detected — connected to your own PC</div>
    <p class="dash-foot" style="margin:0 0 10px">Server v${esc(info.version)}. To shut it down: run <b>Kaze.bat</b> and pick <b>3</b>.</p>`;
  els.workspace.prepend(zone);
  setTimeout(() => {
    zone.style.transition = "opacity .4s ease, transform .4s ease";
    zone.style.opacity = "0";
    zone.style.transform = "translateY(-6px)";
    setTimeout(() => zone.remove(), 420);
  }, 5200);
}

/* Scroll reveal */
const revealObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) {
      en.target.classList.add("in");
      revealObserver.unobserve(en.target);
    }
  }
}, { threshold: 0.12 });
document.querySelectorAll(".card, .dash-foot, .hero-main").forEach((n) => {
  n.classList.add("reveal");
  revealObserver.observe(n);
});

/* ------------------------------------------------------------------
   Wiring
------------------------------------------------------------------- */

els.check.addEventListener("click", async () => {
  btnDisabled(els.check, true);
  const orig = els.check.innerHTML;
  els.check.innerHTML = '<span class="spinner"></span><span>Checking…</span>';
  const info = await ping();
  els.check.innerHTML = orig;
  btnDisabled(els.check, false);
  if (info) {
    await connectAndLoad(info);
    if (!sessionStorage.getItem("kaze-banner-shown")) {
      connectOkBanner(info);
      sessionStorage.setItem("kaze-banner-shown", "1");
    }
  } else {
    wizard("Welcome to Kaze", "Your PC is not running the Kaze Server yet — one-time setup takes about two minutes:");
  }
});

els.inspect.addEventListener("click", doInspect);
els.url.addEventListener("keydown", (e) => { if (e.key === "Enter") doInspect(); });
els.download.addEventListener("click", submitDownload);
els.zip.addEventListener("click", () => {
  toast("Opening the Kaze Server download…");
  const a = document.createElement("a");
  a.href = ZIP_URL;
  a.target = "_blank";
  a.rel = "noopener";
  a.click();
});
els.how.addEventListener("click", () => wizard("How Kaze works", "The website is the remote control. The muscle runs on your PC:"));
els.controls.addEventListener("click", controlsModal);

els.clearQueue.addEventListener("click", () => {
  for (const [id, j] of jobsMap) {
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") jobsMap.delete(id);
  }
  renderQueue();
});

els.modeSeg.forEach((b) =>
  b.addEventListener("click", () => {
    els.modeSeg.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    els.audioFormatRow.classList.toggle("hidden", mode !== "audio");
    els.formatLabel.textContent = mode === "video" ? "Choose a format" : "Choose an audio source";
    selectedFormatId = null;
    if (inspection) renderFormats();
  })
);

let connected = false;
setInterval(async () => {
  const p = await ping(2000);
  if (p) {
    if (!connected) { await connectAndLoad(p); connected = true; }
    else setOnline(true, p);
  } else {
    connected = false;
    setOnline(false, null);
  }
}, 15000);

ping().then((p) => { if (p) { connectAndLoad(p); connected = true; } });
