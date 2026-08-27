'use strict';

/**
 * AnimeHeaven source adapter.
 *
 * Far simpler than AnimePahe: no Cloudflare, no Turnstile, no referer
 * rewriting, and one hop to the video instead of three.
 *
 *   search.php?s=<query>   -> a.c[href^="anime.php"]           series ids
 *   anime.php?<id>         -> a[href="gate.php"] id=<32 hex>   episode hashes
 *   cookie key=<hash>      -> GET gate.php                     unlocks the episode
 *   gate.php               -> "Download Episode N" anchor       direct .mp4
 *
 * The "gate" is not a real gate. gatea() on their page just writes the episode
 * hash into a `key` cookie and the server reads it back; there is no token and
 * nothing signed. We replicate that in two lines.
 *
 * Honest capability note: this site serves exactly ONE file per episode. No
 * quality ladder, no fansub groups, no dub track. Measured across two series
 * every file was 1280x720. So instead of inventing choices, the adapter reports
 * a single source and can probe the real file to state the true resolution and
 * size rather than guessing.
 */
const AnimeHeavenSource = (() => {
  const ID = 'animeheaven';
  const BASE = 'https://animeheaven.me';
  const MAX_PROBES = 2;
  // Only enrich what a user is likely to look at. Each item costs a request to
  // a host that rate-limits, so hydrating 30 results would get us throttled.
  const HYDRATE_LIMIT = 10;

  const capabilities = {
    search: true,
    episodes: true,
    sourceInspection: true,
    quality: false,          // one file per episode, no ladder
    fansubGroups: false,     // no group metadata at all
    dub: false,              // sub only
    posters: true,           // series pages do carry poster images
    selectableSubtitles: false,
    measuredQuality: true,   // resolution/duration/bitrate read from the file itself
  };

  let activeJob = null;

  /* ── fetching ─────────────────────────────────────────────── */

  async function fetchDoc(url, signal) {
    const r = await fetch(url, { credentials: 'include', signal });
    if (!r.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${r.status}`);
    const html = await r.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function absolute(href) {
    return href.startsWith('http') ? href : `${BASE}/${href.replace(/^\/+/, '')}`;
  }

  /* ── search ───────────────────────────────────────────────── */

  async function search(query, opts = {}) {
    const doc = await fetchDoc(`${BASE}/search.php?s=${encodeURIComponent(query)}`);
    const seen = new Set();
    const out = [];

    // Result markup, verified live:
    //   <div class="p1">
    //     <a href="anime.php?<id>"><img class="coverimg" src="image.php?<id>"></a>
    //     <div class="similarname c"><a href="anime.php?<id>" class="c">Title</a></div>
    //   </div>
    // The search page carries ONLY a title and a poster - no episode count,
    // year, score or status. Rather than render near-empty cards, fetch the
    // real metadata from each series page.
    for (const a of doc.querySelectorAll('a[href^="anime.php"]')) {
      const id = (a.getAttribute('href') || '').split('?')[1];
      const label = a.textContent.trim();
      if (!id || !label || seen.has(id)) continue;
      seen.add(id);

      // The poster lives on the sibling anchor that wraps the <img>.
      const wrap = a.closest('.p1') || a.parentElement;
      const img = wrap ? wrap.querySelector('img.coverimg') : null;
      const poster = img ? absolute(img.getAttribute('src') || '') : '';

      out.push({
        id,
        title: label,
        type: '',
        episodeCount: null,
        status: '',
        season: '',
        year: null,
        score: null,
        poster,
      });
    }

    // Hydrate in the background and let the caller re-render as details land.
    // Deliberately NOT awaited: results appear immediately with title + poster.
    hydrate(out.slice(0, HYDRATE_LIMIT), opts.onUpdate).catch(() => undefined);
    return out;
  }

  /**
   * Pull year / score / episode count / tags from each series page.
   *
   * Kept deliberately slow. This host rate-limits: hammering it with parallel
   * requests produced ERR_CONNECTION_TIMED_OUT for ~15s, and only recovered
   * after backing off. Two at a time with a gap is enough to stay welcome.
   */
  async function hydrate(items, onUpdate) {
    if (!items.length) return;
    const CONCURRENCY = 2;
    const GAP_MS = 300;
    let cursor = 0;

    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        const it = items[i];
        try {
          const doc = await fetchDoc(`${BASE}/anime.php?${encodeURIComponent(it.id)}`);
          const infoText = (doc.querySelector('.infoyear') || {}).textContent || '';
          const meta = parseYearScore(infoText);
          it.year = meta.year;
          it.score = meta.score;
          // Prefer the stated count. The gate anchors are rendered twice per
          // episode in some layouts, so counting them overstates the total.
          it.episodeCount = meta.episodeCount;

          const jp = doc.querySelector('.infotitlejp');
          if (jp && jp.textContent.trim()) it.type = jp.textContent.trim().slice(0, 48);

          const tags = [...doc.querySelectorAll('.infotags a')].map((t) => t.textContent.trim());
          if (tags.length) it.status = tags.slice(0, 2).join(', ');

          if (!it.poster) {
            const img = doc.querySelector('.infoimg img');
            if (img) it.poster = absolute(img.getAttribute('src') || '');
          }
          if (onUpdate) onUpdate();
        } catch {
          /* keep the bare title - a missing detail must not hide a result */
        }
        await sleep(GAP_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  }

  /* ── series page ──────────────────────────────────────────── */

  function parseYearScore(text) {
    const year = (text.match(/Year:\s*(\d{4})/) || [])[1] || null;
    const score = (text.match(/Score:\s*([\d.]+)/) || [])[1] || null;
    const eps = (text.match(/Episodes:\s*(\d+)/) || [])[1] || null;
    return { year, score: score ? Number(score) : null, episodeCount: eps ? Number(eps) : null };
  }

  async function getEpisodes(titleId) {
    const doc = await fetchDoc(`${BASE}/anime.php?${encodeURIComponent(titleId)}`);
    const rows = [];

    // Episode labels are not always plain numbers. Verified live:
    //   "24"     - the normal release
    //   "24ch"   - an alternate audio cut (To Be Hero X, Chinese animation,
    //              lists all 24 episodes twice: 24 plain + 24 "ch")
    //   "7.5"    - a recap/special ([Oshi no Ko])
    // So parse a leading number and keep any suffix as a variant tag rather
    // than letting Number() return NaN and silently dropping half the list.
    for (const a of doc.querySelectorAll('a[href="gate.php"]')) {
      const hash = a.id;
      const numEl = a.querySelector('.watch2');
      if (!hash || !/^[a-f0-9]{32}$/i.test(hash) || !numEl) continue;

      const raw = numEl.textContent.trim();
      const m = raw.match(/^(\d+(?:\.\d+)?)(.*)$/);
      if (!m) continue;
      const num = Number(m[1]);
      if (!Number.isFinite(num)) continue;
      const variant = m[2].trim().toLowerCase();

      rows.push({ num, variant, id: hash, titleId, audio: 'sub', duration: '', snapshot: '' });
    }

    // Prefer the unsuffixed cut when a number appears more than once, so the
    // list shows 24 episodes rather than 48 near-duplicates.
    const byNum = new Map();
    for (const r of rows) {
      const prev = byNum.get(r.num);
      if (!prev || (prev.variant && !r.variant)) byNum.set(r.num, r);
    }

    // The page lists newest first; the rest of the app assumes ascending.
    return [...byNum.values()].sort((a, b) => a.num - b.num);
  }

  /* ── episode -> direct mp4 ────────────────────────────────── */

  async function resolveEpisode(ep, signal) {
    // gatea() on their page writes the episode hash into a `key` cookie and
    // gate.php reads it back server-side. Verified: without that cookie
    // gate.php returns 404, so it is mandatory.
    //
    // document.cookie CANNOT be used here - this page is a chrome-extension://
    // origin, so it can only set cookies on itself. The cookies API can write
    // to animeheaven.me because the manifest holds host permissions for it.
    await setKeyCookie(ep.id);

    const doc = await fetchDoc(`${BASE}/gate.php`, signal);

    let url = null;
    for (const a of doc.querySelectorAll('a')) {
      if (/download/i.test(a.textContent || '')) {
        url = absolute(a.getAttribute('href') || '');
        break;
      }
    }
    // Fall back to the <source> the player uses if the download anchor moves.
    if (!url) {
      const s = doc.querySelector('video source');
      if (s) url = absolute(s.getAttribute('src') || '');
    }
    if (!url) throw new Error('No video link on the episode page - the gate cookie may not have applied');
    return url;
  }

  async function setKeyCookie(hash) {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      throw new Error('Kaze needs the cookies permission to unlock AnimeHeaven episodes');
    }
    await chrome.cookies.set({
      url: `${BASE}/`,
      name: 'key',
      value: hash,
      path: '/',
      // Their own gatea() sets a 48h expiry; match it rather than making this
      // a session cookie, so a long batch job cannot lose it mid-run.
      expirationDate: Math.floor(Date.now() / 1000) + 48 * 3600,
    });
  }

  /**
   * Read the true resolution, duration and size straight out of the MP4 header.
   *
   * This site advertises nothing about quality, so parsing the container is the
   * only honest way to tell the user what they are about to download. A 16 KB
   * Range request is enough - verified identical results at 16 KB and 64 KB on
   * a 136 MB file, so this costs ~0.01% of a download.
   *
   * Replaces an earlier <video> metadata probe, which was unreliable: the CDN
   * sends `Access-Control-Allow-Origin: https://animeheaven.me`, and a media
   * element does not get the host-permission CORS bypass that fetch() does.
   */
  const PROBE_BYTES = 16384;

  /**
   * One Range request gives everything: the MP4 header AND the total file size,
   * because a 206 response carries `content-range: bytes 0-16383/142793714`.
   *
   * Deliberately a SINGLE request. This CDN hangs when two requests for the
   * same file are in flight at once - verified: a lone Range request returns
   * 206 in under a second, while firing the range and a size request in
   * parallel makes both stall past 60s. That is what made quality read as
   * "unknown" while the size still appeared.
   */
  async function probeFile(url, signal) {
    try {
      const r = await fetch(url, {
        headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
        credentials: 'omit',
        signal,
      });
      if (!r.ok) return null;

      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 64) return null;

      const meta = parseMp4Header(buf) || { width: 0, height: 0, seconds: 0, codec: '' };

      // Total size from content-range; fall back to content-length when the
      // server ignored the range and sent the whole thing.
      let bytes = 0;
      const cr = r.headers.get('content-range');
      const m = cr && cr.match(/\/(\d+)\s*$/);
      if (m) bytes = Number(m[1]);
      if (!bytes && r.status === 200) bytes = Number(r.headers.get('content-length')) || 0;

      return { ...meta, bytes };
    } catch {
      return null;
    }
  }

  function parseMp4Header(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const text = new TextDecoder('latin1').decode(buf);

    // The ftyp box lists compatible brands, and for H.264 files that list
    // literally contains "avc1" (e.g. "isomiso2avc1mp41"). Searching from 0
    // finds that string first and yields 0x0 - start past ftyp instead.
    let start = 0;
    const ftypLen = dv.getUint32(0);
    if (text.slice(4, 8) === 'ftyp' && ftypLen > 8 && ftypLen < buf.length) start = ftypLen;

    let width = 0;
    let height = 0;
    let codec = '';
    // VisualSampleEntry: 4B size, 4B type, then 78 bytes of fixed fields with
    // width at +24 and height at +26 from the end of the type field.
    for (const tag of ['avc1', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v']) {
      let i = start - 1;
      while ((i = text.indexOf(tag, i + 1)) !== -1) {
        if (i + 32 > buf.length) break;
        const w = dv.getUint16(i + 28);
        const h = dv.getUint16(i + 30);
        if (w > 0 && h > 0 && w < 16384 && h < 16384) {
          width = w; height = h; codec = tag;
          break;
        }
      }
      if (height) break;
    }

    let seconds = 0;
    const mv = text.indexOf('mvhd');
    if (mv > 0 && mv + 32 <= buf.length) {
      const version = buf[mv + 4];
      const timescale = version === 0 ? dv.getUint32(mv + 16) : dv.getUint32(mv + 24);
      const duration = version === 0
        ? dv.getUint32(mv + 20)
        : Number(dv.getBigUint64(mv + 28));
      if (timescale > 0) seconds = Math.round(duration / timescale);
    }

    if (!height && !seconds) return null;
    return { width, height, seconds, codec };
  }

  /* ── inspection ───────────────────────────────────────────── */

  function singleSource({ height, width, sizeMB, state, seconds, codec, mbps }) {
    const quality = height ? `${height}p` : 'unknown quality';
    return {
      key: `animeheaven|${quality}|sub`,
      group: 'AnimeHeaven',
      quality,
      height: height || 0,
      width: width || 0,
      audio: 'sub',
      sizeMB: sizeMB || null,
      seconds: seconds || 0,
      codec: codec || '',
      mbps: mbps || 0,
      foundIn: 1,
      state,
      label: quality,
      onlyOption: true,
    };
  }

  async function inspectSources(episodes, opts = {}) {
    const requested = episodes.length;
    if (!requested) {
      return {
        provider: ID,
        requestedEpisodes: 0,
        sampledEpisodes: [],
        sampledOk: 0,
        exact: false,
        unverified: true,
        groups: ['AnimeHeaven'],
        dubAvailable: false,
        fixedQuality: true,
        sources: [singleSource({ height: 0, sizeMB: null, state: 'unverified' })],
      };
    }

    // Probe the first and middle selected episode. Two is enough to catch a
    // series that mixes resolutions without making the user wait.
    const picks = [episodes[0], episodes[Math.floor(episodes.length / 2)]]
      .filter((e, i, arr) => e && arr.indexOf(e) === i)
      .slice(0, MAX_PROBES);

    const seen = [];
    const sampledEpisodes = [];

    for (const ep of picks) {
      if (opts.isStale && opts.isStale()) return null;
      try {
        const url = await resolveEpisode(ep);
        const meta = await probeFile(url, opts.signal);
        if (meta && (meta.height || meta.bytes)) {
          seen.push({
            height: meta.height,
            width: meta.width,
            codec: meta.codec,
            seconds: meta.seconds,
            bytes: meta.bytes,
            url,
          });
          sampledEpisodes.push(ep.num);
        }
      } catch {
        /* a failed probe only lowers confidence */
      }
      if (opts.onSample) opts.onSample(sampledEpisodes.length, picks.length);
      // This host stalls under concurrent load, so pace the samples.
      await sleep(400);
    }

    if (opts.isStale && opts.isStale()) return null;

    if (!seen.length) {
      return {
        provider: ID,
        requestedEpisodes: requested,
        sampledEpisodes: [],
        sampledOk: 0,
        exact: false,
        unverified: true,
        groups: ['AnimeHeaven'],
        dubAvailable: false,
        fixedQuality: true,
        sources: [singleSource({ height: 0, sizeMB: null, state: 'unverified' })],
      };
    }

    const heights = seen.map((s) => s.height).filter(Boolean);
    // Report the lowest sampled height - promising more than every episode
    // delivers is the failure mode that matters here.
    const height = heights.length ? Math.min(...heights) : 0;
    const mixed = new Set(heights).size > 1;
    const sizes = seen.map((s) => s.bytes).filter(Boolean);
    const avgBytes = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    const sizeMB = avgBytes ? avgBytes / 1048576 : null;

    const withSecs = seen.find((s) => s.seconds);
    const seconds = withSecs ? withSecs.seconds : 0;
    // Bitrate is the honest tell for whether a 720p file is a good one or a
    // bloated re-encode, and it comes free from size + duration.
    const mbps = seconds && avgBytes ? +((avgBytes * 8 / seconds) / 1e6).toFixed(2) : 0;
    const codecHit = seen.find((s) => s.codec);

    return {
      provider: ID,
      requestedEpisodes: requested,
      sampledEpisodes,
      sampledOk: seen.length,
      exact: false,
      unverified: false,
      groups: ['AnimeHeaven'],
      dubAvailable: false,
      fixedQuality: true,
      mixedQuality: mixed,
      sources: [singleSource({
        height,
        width: seen[0].width,
        sizeMB,
        seconds,
        mbps,
        codec: codecHit ? codecHit.codec : '',
        state: height ? 'verified' : 'partial',
      })],
    };
  }

  /* ── download ─────────────────────────────────────────────── */

  /**
   * Episode numbers are not always integers - specials and recaps appear as
   * 7.5, so pad only the whole part and keep the fraction.
   * Verified live: [Oshi no Ko] lists an episode 7.5.
   */
  function padEp(num) {
    const [whole, frac] = String(num).split('.');
    return whole.padStart(2, '0') + (frac ? '.' + frac : '');
  }

  async function processEpisode(ep, cfg, cb) {
    cb.status('resolving');

    const url = await resolveEpisode(ep, cfg.signal);
    const name = `${safeName(cfg.animeTitle)} - Ep ${padEp(ep.num)}.mp4`
      .replace(/\s+/g, '_');
    cb.filename(name);

    const res = await fetch(url, { credentials: 'omit', signal: cfg.signal });
    if (!res.ok || !res.body) throw new Error(`Download stream refused (HTTP ${res.status})`);

    const total = Number(res.headers.get('content-length')) || 0;
    cb.sizeEstimate(total);

    const finalName = await uniqueName(cfg.dirHandle, name);
    const fh = await cfg.dirHandle.getFileHandle(finalName, { create: true });
    const ws = await fh.createWritable();

    const reader = res.body.getReader();
    let received = 0;
    let lastTick = 0;
    let lastBytes = 0;
    let speed = 0;
    const startedAt = Date.now();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await ws.write(value);
        received += value.byteLength;
        const now = Date.now();
        if (now - lastTick >= 220) {
          if (lastTick) {
            const inst = ((received - lastBytes) * 1000) / (now - lastTick);
            speed = speed ? speed * 0.7 + inst * 0.3 : inst;
          }
          lastTick = now;
          lastBytes = received;
          cb.progress(received, total, speed);
        }
      }
      await ws.close();
    } catch (e) {
      try { await ws.abort(); } catch {}
      throw e;
    }

    cb.progress(received, total || received, speed);
    return { bytes: received, seconds: (Date.now() - startedAt) / 1000, filename: finalName };
  }

  async function uniqueName(dir, name) {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; i < 500; i++) {
      try {
        await dir.getFileHandle(candidate, { create: false });
        candidate = `${stem} (${i})${ext}`;
      } catch {
        return candidate;
      }
    }
    return candidate;
  }

  async function run(cfg, hooks = {}) {
    if (activeJob && !activeJob.finished) throw new Error('A job is already running');

    const controller = new AbortController();
    activeJob = { cancelled: false, finished: false, controller };

    const results = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();
    const log = (l) => hooks.onLog && hooks.onLog(l);

    for (let i = 0; i < cfg.episodes.length; i++) {
      if (activeJob.cancelled) break;
      const ep = cfg.episodes[i];
      const cb = {
        status: (s, msg) => hooks.onEpisodeStatus && hooks.onEpisodeStatus(i, s, msg),
        filename: (f) => hooks.onEpisodeFilename && hooks.onEpisodeFilename(i, f),
        sizeEstimate: (b) => hooks.onEpisodeSize && hooks.onEpisodeSize(i, b),
        progress: (r, t, s) => hooks.onEpisodeProgress && hooks.onEpisodeProgress(i, r, t, s),
      };
      try {
        if (hooks.onStage) hooks.onStage(`Ep ${ep.num}: resolving`);
        log(`Ep ${ep.num}: resolving`);
        const r = await processEpisode(ep, {
          animeTitle: cfg.title,
          dirHandle: cfg.dirHandle,
          signal: controller.signal,
        }, cb);
        succeeded++;
        cb.status('done', '');
        log(`Ep ${ep.num}: saved ${r.filename} (${fmtBytes(r.bytes)})`);
        results.push({ ok: true, num: ep.num, ...r });
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (activeJob.cancelled) break;
        failed++;
        cb.status('error', msg);
        log(`Ep ${ep.num}: FAILED - ${msg}`);
        results.push({ ok: false, num: ep.num, error: msg });
        await sleep(600);
      }
    }

    activeJob.finished = true;
    return {
      cancelled: activeJob.cancelled,
      results,
      succeeded,
      skipped,
      failed,
      totalSeconds: Math.round((Date.now() - startedAt) / 1000),
      totalBytes: results.reduce((a, r) => a + (r.bytes || 0), 0),
    };
  }

  function cancel() {
    if (activeJob && !activeJob.finished) {
      activeJob.cancelled = true;
      activeJob.controller.abort();
    }
  }

  async function ensureAccess() {
    if (typeof chrome === 'undefined' || !chrome.permissions) return true;
    const origins = ['https://animeheaven.me/*', 'https://*.animeheaven.me/*'];
    if (await chrome.permissions.contains({ origins })) return true;
    return chrome.permissions.request({ origins });
  }

  return {
    id: ID,
    label: 'AnimeHeaven',
    capabilities,
    search,
    getEpisodes,
    inspectSources,
    run,
    cancel,
    cleanup: () => {},
    ensureAccess,
    isBusy: () => Boolean(activeJob && !activeJob.finished),
    probeFile,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnimeHeavenSource };
}
