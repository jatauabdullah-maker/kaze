'use strict';

const Pipeline = (() => {
  const BASE = 'https://animepahe.pw';
  const APP_PATH = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
    ? chrome.runtime.getURL('src/index.html')
    : 'chrome-extension://kaze/src/index.html';
  const REFERRER_RULE_ID = 424242;

  let activeJob = null;
  let solving = false;
  const workTabs = new Map();
  let workWinId = null;

  async function getWorkWindow() {
    if (workWinId !== null) {
      try { await chrome.windows.get(workWinId); return workWinId; } catch { workWinId = null; }
    }
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    workWinId = win.id;
    return workWinId;
  }

  async function createWorkTab(url) {
    const winId = await getWorkWindow();
    return chrome.tabs.create({ url, windowId: winId, active: false });
  }

  async function minimizeWorkWindow() {
    if (workWinId === null) return;
    try { await chrome.windows.update(workWinId, { state: 'minimized', focused: false }); } catch {}
  }

  /* ── per-host work tabs (first-party cookie context) ─────── */

  function waitTabComplete(tabId, timeoutMs = 45000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); setTimeout(() => resolve(v), 500); } };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') finish(true); }).catch(() => finish(false));
    });
  }

  const creating = new Map();

  async function getWorkTab(hostname) {
    if (creating.has(hostname)) return creating.get(hostname);
    const p = (async () => {
      let tabId = workTabs.get(hostname);
      if (tabId !== undefined) {
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.url && new URL(t.url).hostname === hostname) return tabId;
        } catch {}
        workTabs.delete(hostname);
      }
      const url = hostname === 'pahe.win' ? 'https://pahe.win/' : `https://${hostname}/`;
      const tab = await createWorkTab(url);
      workTabs.set(hostname, tab.id);
      await waitTabComplete(tab.id);
      return tab.id;
    })();
    creating.set(hostname, p);
    try {
      return await p;
    } finally {
      creating.delete(hostname);
    }
  }

  function tabFetch(tabId, url, opts = {}) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: async (u, o) => {
        try {
          const r = await fetch(u, { credentials: 'include', ...o });
          const text = await r.text();
          const ra = r.headers.get('retry-after');
          return { status: r.status, text, retryAfter: ra ? Number(ra) : null };
        } catch (e) {
          return { status: 0, error: String(e && e.message || e) };
        }
      },
      args: [url, opts],
    }).then(([r]) => r?.result || { status: 0, error: 'no result' }).catch((e) => ({ status: 0, error: String(e) }));
  }

  function injectBanner(tabId, text) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (t) => {
        const old = document.getElementById('kaze-banner');
        if (old) { old.textContent = t; return; }
        const b = document.createElement('div');
        b.id = 'kaze-banner';
        b.textContent = t;
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:linear-gradient(100deg,#7c5cff,#38bdf8);color:#fff;font:600 14px system-ui,sans-serif;padding:11px 16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.45);';
        document.documentElement.appendChild(b);
      },
      args: [text],
    }).catch(() => undefined);
  }

  /* ── low-level fetch with clearance handling ─────────────── */

  function looksLikeChallenge(status, text) {
    if (status === 403 || status === 503) return true;
    if (typeof text === 'string' && text.length < 100000 && /just a moment/i.test(text)) return true;
    return false;
  }

  async function rawFetch(url, opts = {}) {
    const maxAttempts = 4;
    const hostname = new URL(url).hostname;
    let lastRes = null;
    for (let i = 0; i < maxAttempts; i++) {
      if (activeJob?.cancelled) throw new Error('Cancelled');
      const tabId = await getWorkTab(hostname);
      const res = await tabFetch(tabId, url, opts);
      if (res.status === 0) {
        await sleep(1200);
        continue;
      }
      lastRes = res;
      if (res.status === 429) {
        const wait = res.retryAfter && res.retryAfter > 0 ? Math.min(res.retryAfter, 60) * 1000 : Math.min(4000 * (i + 1) * (i + 1), 30000);
        log(`Rate limited by ${hostname} — waiting ${Math.round(wait / 1000)}s…`);
        stage(`Rate limited — waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!looksLikeChallenge(res.status, res.text)) return res;
      if (opts.noSolve || solving) return res;
      log(`Security check triggered on ${hostname}`);
      stage(`Security check on ${hostname} — handing you the tab`);
      solving = true;
      let solved = false;
      try {
        solved = await humanSolve(url, tabId);
      } finally {
        solving = false;
      }
      if (!solved) return res;
    }
    if (lastRes) return lastRes;
    throw new Error(`Could not reach ${hostname}`);
  }

  async function fetchText(url, opts = {}) {
    const res = await rawFetch(url, opts);
    if (looksLikeChallenge(res.status, res.text)) {
      throw new Error(`${new URL(url).hostname} is showing a security check that could not be passed`);
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    return res.text;
  }

  async function fetchJson(url, opts = {}) {
    return JSON.parse(await fetchText(url, { ...opts, headers: { ...(opts.headers || {}), Accept: 'application/json' } }));
  }

  /* ── cloudflare / turnstile ───────────────────────────────── */

  function clickTurnstileInFrame() {
    const input = document.querySelector('input[type="checkbox"]');
    if (input) { input.click(); return 'input'; }
    const box = document.querySelector('[role="checkbox"], .ctp-checkbox-label, #challenge-stage label');
    if (box) { box.click(); return 'box'; }
    return null;
  }

  function findAppTab() {
    return chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url && t.url.startsWith(APP_PATH)) || null);
  }

  async function focusTab(tabId, active) {
    try {
      await chrome.tabs.update(tabId, { active });
      if (active) {
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
      }
    } catch {}
  }

  async function humanSolve(url, tabId) {
    const u = new URL(url);
    await chrome.tabs.update(tabId, { url: u.origin + '/', active: true }).catch(() => undefined);
    await focusTab(tabId, true);
    injectBanner(tabId, 'Kaze needs ONE click: solve the security checkbox — it continues automatically');

    setTimeout(() => {
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: clickTurnstileInFrame,
      }).catch(() => undefined);
    }, 4000);

    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await sleep(2500);
      if (activeJob?.cancelled) return false;
      const probe = await tabFetch(tabId, url, { cache: 'no-store' });
          if (probe.status === 200 && !looksLikeChallenge(200, probe.text)) {
            const appTab = await findAppTab();
            if (appTab) await focusTab(appTab.id, true);
            else await focusTab(tabId, false);
            await minimizeWorkWindow();
            stage('Security check passed — continuing');
            log(`Clearance obtained for ${u.hostname}`);
            return true;
          }
    }
    return false;
  }

  async function closeSolverTabs() {
    for (const [host, tabId] of workTabs) {
      await chrome.tabs.remove(tabId).catch(() => undefined);
      workTabs.delete(host);
    }
    if (kwikTabId !== null) {
      await chrome.tabs.remove(kwikTabId).catch(() => undefined);
      kwikTabId = null;
    }
    if (workWinId !== null) {
      await chrome.windows.remove(workWinId).catch(() => undefined);
      workWinId = null;
    }
  }

  /* ── animepahe API ────────────────────────────────────────── */

  async function search(q) {
    const j = await fetchJson(`${BASE}/api?m=search&q=${encodeURIComponent(q)}`);
    return Array.isArray(j.data) ? j.data : [];
  }

  async function getEpisodes(session) {
    const eps = [];
    for (let p = 1; p <= 80; p++) {
      const j = await fetchJson(`${BASE}/api?m=release&id=${encodeURIComponent(session)}&sort=episode_asc&page=${p}`);
      for (const d of j.data || []) {
        eps.push({
          num: Number(d.episode),
          session: d.session,
          audio: d.audio || '',
          duration: d.duration || '',
          snapshot: d.snapshot || '',
        });
      }
      if (!j.next_page_url) break;
    }
    eps.sort((a, b) => a.num - b.num);
    return eps;
  }

  /* ── play page parsing ────────────────────────────────────── */

  function parsePlayLinks(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="pahe.win"]')) {
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const qm = text.match(/(\d{3,4})p/i);
      const sm = text.match(/\((\d+(?:\.\d+)?)\s*(MB|GB)\)/i);
      out.push({
        href: a.href,
        group: text.split('·')[0].trim(),
        quality: qm ? qm[1] + 'p' : null,
        sizeMB: sm ? parseFloat(sm[1]) * (sm[2].toUpperCase() === 'GB' ? 1024 : 1) : null,
        dub: /\beng\b/i.test(text),
        text,
      });
    }
    return out.filter((l) => l.quality);
  }

  async function getPlayLinks(ep) {
    const html = await fetchText(`${BASE}/play/${ep.animeSession}/${ep.session}`);
    return parsePlayLinks(html);
  }

  function pickLink(links, { quality, group, audio }) {
    const wantDub = audio === 'eng';
    const byAudio = (l) => (wantDub ? l.dub : !l.dub);
    return (
      links.find((l) => byAudio(l) && l.quality === quality && l.group.toLowerCase() === String(group).toLowerCase()) ||
      links.find((l) => byAudio(l) && l.quality === quality) ||
      null
    );
  }

  /* ── pahe.win resolution (parked tab + XHR snipe, handoff fallback) */

  async function tabExists(tabId) {
    try { await chrome.tabs.get(tabId); return true; } catch { return false; }
  }

  function probePaheDom(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        host: location.hostname,
        challenged: /just a moment/i.test(document.title || ''),
        kwikHref: (() => { const a = document.querySelector('a.redirect[href]'); return a && /kwik\./.test(a.href || '') ? a.href : null; })(),
      }),
    }).then(([r]) => r?.result ?? null).catch(async () => {
      if (await tabExists(tabId)) return { navigating: true };
      return { gone: true };
    });
  }

  async function resolveKwik(paheUrl) {
    const u = new URL(paheUrl);
    const host = u.hostname;
    let tabId = workTabs.get(host);
    if (tabId !== undefined) {
      try { await chrome.tabs.get(tabId); } catch { tabId = undefined; workTabs.delete(host); }
    }
    if (tabId === undefined) {
      const tab = await createWorkTab(`https://${host}/`);
      tabId = tab.id;
      workTabs.set(host, tabId);
      injectBanner(tabId, 'Kaze is controlling this tab — no action needed');
      await waitTabComplete(tabId);
    }

    const extractViaXhr = async () => {
      const html = await tabFetch(tabId, paheUrl, { cache: 'no-store' });
      if (html.status === 429) { await sleep(4000); return null; }
      if (html.status === 0) return null;
      const m = html.text && html.text.match(/https?:\/\/kwik\.cx\/[ef]\/([A-Za-z0-9]+)/);
      return m ? `https://kwik.cx/f/${m[1]}` : null;
    };

    const quick = await extractViaXhr();
    if (quick) return quick;

    log('pahe.win gate active — handing you the tab once');
    stage('Security check on pahe.win — handing you the tab');
    await chrome.tabs.update(tabId, { url: paheUrl }).catch(() => undefined);
    await waitTabComplete(tabId);
    injectBanner(tabId, 'Kaze needs ONE click: solve the checkbox — then do NOT click anything else');
    await focusTab(tabId, true);

    let handedOff = true;
    let recreations = 0;
    for (let i = 0; i < 150; i++) {
      if (activeJob?.cancelled) throw new Error('Cancelled');
      const probe = await probePaheDom(tabId);
      if (probe?.navigating) { await waitTabComplete(tabId); continue; }
      if (probe?.gone) {
        recreations++;
        if (recreations > 3) throw new Error('The pahe.win tab keeps getting closed');
        log('pahe.win tab was closed — reopening…');
        const tab = await createWorkTab(paheUrl);
        tabId = tab.id;
        workTabs.set(host, tabId);
        handedOff = true;
        await waitTabComplete(tabId);
        continue;
      }
      if (probe?.challenged) { await sleep(2000); continue; }
      if (probe?.host && probe.host !== host) {
        await waitTabComplete(tabId);
        const recheck = await probePaheDom(tabId);
        if (recheck?.host && recheck.host !== host && !recheck.challenged) {
          log('pahe.win tab navigated away — bringing it back');
          await chrome.tabs.update(tabId, { url: paheUrl }).catch(() => undefined);
          injectBanner(tabId, 'Kaze is controlling this tab — no action needed');
          await waitTabComplete(tabId);
        }
        continue;
      }
      if (handedOff) {
        handedOff = false;
        stage('Security check passed — continuing');
        log('Clearance obtained for pahe.win');
        injectBanner(tabId, 'Solved — Kaze is continuing automatically');
        const appTab = await findAppTab();
        if (appTab) await focusTab(appTab.id, true);
        await minimizeWorkWindow();
      }
      const kwik = await extractViaXhr();
      if (kwik) {
        await chrome.tabs.update(tabId, { url: `https://${host}/` }).catch(() => undefined);
        return kwik;
      }
      if (probe?.kwikHref) {
        await chrome.tabs.update(tabId, { url: `https://${host}/` }).catch(() => undefined);
        return probe.kwikHref;
      }
      await sleep(800);
    }
    throw new Error('Could not find the kwik link on the redirect page');
  }

  /* ── kwik work tab ────────────────────────────────────────── */

  function probeKwikDom(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        host: location.hostname,
        challenged: /just a moment/i.test(document.title || ''),
        action: (() => { const f = document.querySelector('form[action*="/d/"]'); return f ? f.action : null; })(),
        token: (() => { const i = document.querySelector('form[action*="/d/"] input[name="_token"]'); return i ? i.value : null; })(),
        title: document.title,
      }),
    }).then(([r]) => r?.result ?? null).catch(async () => {
      if (await tabExists(tabId)) return { navigating: true };
      return { gone: true };
    });
  }

  function tabFetchFormPost(tabId, url, token) {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: async (u, t) => {
        try {
          await fetch(u, {
            method: 'POST',
            credentials: 'include',
            redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ _token: t }).toString(),
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) };
        }
      },
      args: [url, token],
    }).then(([r]) => r?.result || { ok: false }).catch(() => ({ ok: false }));
  }

  let kwikTabId = null;

  async function getKwikTab(kwikUrl) {
    if (kwikTabId !== null) {
      try {
        await chrome.tabs.get(kwikTabId);
        await chrome.tabs.update(kwikTabId, { url: kwikUrl }).catch(() => undefined);
      } catch {
        const tab = await createWorkTab(kwikUrl);
        kwikTabId = tab.id;
      }
    } else {
      const tab = await createWorkTab(kwikUrl);
      kwikTabId = tab.id;
    }
    injectBanner(kwikTabId, 'Kaze is controlling this tab — no action needed');
    return kwikTabId;
  }

  async function extractKwikForm(kwikUrl) {
    const tabId = await getKwikTab(kwikUrl);
    try {
      await waitTabComplete(tabId);
      let handedOff = false;
      for (let i = 0; i < 90; i++) {
        if (activeJob?.cancelled) throw new Error('Cancelled');
        const probe = await probeKwikDom(tabId);
        if (probe?.navigating) {
          await waitTabComplete(tabId);
          continue;
        }
        if (probe?.gone) {
          throw new Error('Download tab was closed — Kaze will reopen it for the next episode');
        }
        if (probe?.host && probe.host !== 'kwik.cx') {
          await waitTabComplete(tabId);
          const recheck = await probeKwikDom(tabId);
          if (recheck?.host && recheck.host !== 'kwik.cx' && !recheck.challenged) {
            await chrome.tabs.update(tabId, { url: kwikUrl }).catch(() => undefined);
            injectBanner(tabId, 'Kaze is controlling this tab — no action needed');
            await waitTabComplete(tabId);
          }
          continue;
        }
        if (probe?.challenged) {
          if (!handedOff) {
            stage('Security check on kwik.cx — handing you the tab');
            log('Security check triggered on kwik.cx');
            await focusTab(tabId, true);
            injectBanner(tabId, 'Kaze needs ONE click: solve the checkbox — then do NOT click anything else, it continues automatically');
            handedOff = true;
          }
          await sleep(2500);
          continue;
        }
        if (handedOff) {
          handedOff = false;
          stage('Security check passed — continuing');
          log('Clearance obtained for kwik.cx');
          injectBanner(tabId, 'Kaze is controlling this tab — no action needed');
          const appTab = await findAppTab();
          if (appTab) await focusTab(appTab.id, true);
          await minimizeWorkWindow();
        }
        if (probe?.token && probe?.action) {
          const captureP = captureRedirect(['https://kwik.cx/d/*']);
          await tabFetchFormPost(tabId, probe.action, probe.token);
          const cdnUrl = await captureP;
          await chrome.tabs.update(tabId, { url: 'about:blank' }).catch(() => undefined);
          return {
            action: probe.action,
            token: probe.token,
            filename: (probe.title || '').replace(/\s*::\s*Kwik\s*$/i, '').trim(),
            cdnUrl,
          };
        }
        await sleep(500);
      }
      throw new Error('The download form did not appear in time');
    } catch (e) {
      throw e;
    }
  }

  /* ── capture final CDN URL from the kwik POST redirect ────── */

  function captureRedirect(captureUrls) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          chrome.webRequest.onBeforeRedirect.removeListener(onRedirect);
          chrome.webRequest.onResponseStarted.removeListener(onStarted);
          chrome.webRequest.onCompleted.removeListener(onCompleted);
        } catch {}
        resolve(url);
      };
      const extract = (details) => {
        const loc = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === 'location');
        if (loc && loc.value) finish(loc.value);
      };
      const onRedirect = (details) => { if (details.redirectUrl && !details.redirectUrl.startsWith('data:')) finish(details.redirectUrl); else extract(details); };
      const onStarted = extract;
      const onCompleted = extract;
      const timer = setTimeout(() => finish(null), 30000);
      try {
        chrome.webRequest.onBeforeRedirect.addListener(onRedirect, { urls: captureUrls }, ['responseHeaders']);
        chrome.webRequest.onResponseStarted.addListener(onStarted, { urls: captureUrls }, ['responseHeaders']);
        chrome.webRequest.onCompleted.addListener(onCompleted, { urls: captureUrls }, ['responseHeaders']);
      } catch {
        finish(null);
      }
    });
  }

  async function setRefererRule(hostname) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [REFERRER_RULE_ID],
        addRules: [{
          id: REFERRER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://kwik.cx/' }],
          },
          condition: { requestDomains: [hostname], resourceTypes: ['xmlhttprequest'] },
        }],
      });
    } catch {}
  }

  async function clearRefererRule() {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [REFERRER_RULE_ID] });
    } catch {}
  }

  /* ── file writing ─────────────────────────────────────────── */

  async function uniqueFileName(dir, name) {
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

  /* ── episode processing ───────────────────────────────────── */

  async function processEpisode(ep, cfg, cb) {
    cb.status('resolving');
    await sleep(350);

    const playHtml = await fetchText(`${BASE}/play/${cfg.animeSession}/${ep.session}`);
    const links = parsePlayLinks(playHtml);
    if (!links.length) throw new Error('No download links found on the episode page');

    const chosen = pickLink(links, cfg);
    if (!chosen) throw new Error(`Preferred ${cfg.quality}${cfg.audio === 'eng' ? ' DUB' : ''} (${cfg.group}) unavailable here`);

    const kwikUrl = await resolveKwik(chosen.href);

    const info = await extractKwikForm(kwikUrl);
    if (!info || !info.token) throw new Error('Could not read the download form');

    let filename = info.filename || safeName(`${cfg.animeTitle} - Ep ${padNum(ep.num)} ${chosen.quality}`).replace(/\s+/g, '_') + '.mp4';
    if (!/\.[a-z0-9]{2,4}$/i.test(filename)) filename += '.mp4';

    cb.filename(filename);
    cb.sizeEstimate(chosen.sizeMB ? chosen.sizeMB * 1048576 : 0);

    const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const formBody = new URLSearchParams({ _token: info.token }).toString();

    let res = null;
    if (info.cdnUrl) {
      log(`Resolved CDN: ${new URL(info.cdnUrl).host}`);
      await setRefererRule(new URL(info.cdnUrl).hostname);
      try {
        const r = await fetch(info.cdnUrl, { credentials: 'omit', signal: cfg.signal });
        if (r.ok && r.body) res = r;
        else log(`CDN stream rejected (HTTP ${r.status})`);
      } catch (e) {
        if (cfg.signal.aborted) throw new Error('Cancelled');
        log(`CDN stream error: ${String(e && e.message || e).slice(0, 90)}`);
      }
    } else {
      log('CDN link was not captured from the redirect');
    }

    if (!res) {
      log('Trying direct form POST from extension context…');
      try {
        const r = await fetch(info.action, {
          method: 'POST',
          credentials: 'include',
          headers: formHeaders,
          body: formBody,
          signal: cfg.signal,
        });
        if (r.ok && r.body) res = r;
        else log(`Direct POST rejected (HTTP ${r.status})`);
      } catch (e) {
        if (cfg.signal.aborted) throw new Error('Cancelled');
        log(`Direct POST error: ${String(e && e.message || e).slice(0, 90)}`);
      }
    }

    if (!res || !res.ok || !res.body) throw new Error('Could not start the download stream');

    const disp = res.headers.get('content-disposition') || '';
    const dm = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (dm && dm[1]) {
      const serverName = decodeURIComponent(dm[1]);
      if (serverName !== filename) {
        filename = serverName;
        cb.filename(filename);
      }
    }

    const total = Number(res.headers.get('content-length')) || 0;
    const finalName = await uniqueFileName(cfg.dirHandle, safeName(filename));
    const fh = await cfg.dirHandle.getFileHandle(finalName, { create: true });
    const ws = await fh.createWritable();

    const reader = res.body.getReader();
    let received = 0;
    let lastTick = 0;
    let lastBytes = 0;
    let speedBps = 0;
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
            speedBps = speedBps ? speedBps * 0.7 + inst * 0.3 : inst;
          }
          lastTick = now;
          lastBytes = received;
          cb.progress(received, total, speedBps);
        }
      }
      await ws.close();
    } catch (e) {
      try { await ws.abort(); } catch {}
      throw e;
    }

    cb.progress(received, total || received, speedBps);
    await clearRefererRule();

    return { bytes: received, seconds: (Date.now() - startedAt) / 1000, filename: finalName };
  }

  function padNum(n) {
    const s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  /* ── job orchestration ────────────────────────────────────── */

  function stage(msg) {
    if (activeJob?.onStage) activeJob.onStage(msg);
  }

  function log(line) {
    if (activeJob?.onLog) activeJob.onLog(line);
  }

  async function run(cfg, hooks = {}) {
    if (activeJob && !activeJob.finished) throw new Error('A job is already running');

    const controller = new AbortController();
    activeJob = {
      cancelled: false,
      finished: false,
      controller,
      onStage: hooks.onStage,
      onLog: hooks.onLog,
    };

    const results = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();

    for (let i = 0; i < cfg.eps.length; i++) {
      if (activeJob.cancelled) break;
      const ep = cfg.eps[i];
      const cb = {
        status: (s, msg) => hooks.onEpisodeStatus && hooks.onEpisodeStatus(i, s, msg),
        filename: (f) => hooks.onEpisodeFilename && hooks.onEpisodeFilename(i, f),
        sizeEstimate: (b) => hooks.onEpisodeSize && hooks.onEpisodeSize(i, b),
        progress: (rec, tot, spd) => hooks.onEpisodeProgress && hooks.onEpisodeProgress(i, rec, tot, spd),
      };
      try {
        log(`Ep ${padNum(ep.num)}: resolving…`);
        const r = await processEpisode(ep, { ...cfg, signal: controller.signal }, cb);
        succeeded++;
        cb.status('done', '');
        log(`Ep ${padNum(ep.num)}: saved ${r.filename} (${fmtBytes(r.bytes)})`);
        results.push({ ok: true, num: ep.num, ...r });
      } catch (e) {
        const msg = String(e && e.message || e);
        if (activeJob.cancelled) break;
        if (/unavailable here/i.test(msg)) {
          skipped++;
          cb.status('skipped', msg);
          log(`Ep ${padNum(ep.num)}: SKIPPED — ${msg}`);
        } else {
          failed++;
          cb.status('error', msg);
          log(`Ep ${padNum(ep.num)}: FAILED — ${msg}`);
        }
        results.push({ ok: false, num: ep.num, error: msg });
        await sleep(800);
      }
    }

    clearRefererRule();
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
      stage('Cancelling — closing work tabs…');
      closeSolverTabs();
    }
  }

  async function ensureBroadAccess() {
    const has = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
    if (has) return true;
    return chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
  }

  return {
    search,
    getEpisodes,
    getPlayLinks,
    pickLink,
    run,
    cancel,
    closeSolverTabs,
    ensureBroadAccess,
    isBusy: () => activeJob && !activeJob.finished,
  };
})();
