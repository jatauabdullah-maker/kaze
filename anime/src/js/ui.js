'use strict';

const UI = (() => {
  const stepOrder = ['discover', 'details', 'queue', 'done'];

  const ICON = {
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.1l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.7L12 3.1z"/></svg>',
    verified: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    partial: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.2A1.6 1.6 0 0 0 4 19.6h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z"/></svg>',
    unknown: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4m0 2.9v.01"/></svg>',
  };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(`#screen-${name}`)?.classList.add('active');
    const idx = stepOrder.indexOf(name);
    document.querySelectorAll('#stepper .step').forEach((st, i) => {
      st.classList.toggle('active', i === idx);
      st.classList.toggle('done', i < idx);
    });
    window.scrollTo({ top: 0 });
  }

  function status(kind, text) {
    $('#statusDot').className = `status-dot ${kind}`;
    $('#statusText').textContent = text;
  }

  function sourceLabel(label) {
    const n = $('#sourceLabel');
    if (n) n.textContent = label;
  }

  function discoverState(mode, message) {
    const box = $('#discoverState');
    if (!mode) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    if (mode === 'loading') {
      box.appendChild(el('div', 'spinner'));
      box.appendChild(el('div', '', message || 'Searching'));
    } else {
      box.textContent = message;
    }
  }

  function results(list, query) {
    const grid = $('#resultsGrid');
    grid.innerHTML = '';
    $('#resultsHead').hidden = !list.length;
    $('#resultsCount').textContent = list.length
      ? `${list.length} result${list.length > 1 ? 's' : ''} for "${query}"`
      : `No results for "${query}"`;

    list.forEach((a) => {
      const c = el('button', 'card');
      c.type = 'button';

      const body = el('div', 'card-body');
      const top = el('div', 'card-top');
      top.appendChild(el('div', 'card-title', a.title));
      if (a.score) {
        const badge = el('span', 'score-badge');
        badge.innerHTML = ICON.star;
        badge.appendChild(document.createTextNode(Number(a.score).toFixed(2)));
        top.appendChild(badge);
      }
      body.appendChild(top);

      const chips = el('div', 'chiprow');
      if (a.type) chips.appendChild(el('span', 'chip', a.type));
      if (a.episodeCount != null) chips.appendChild(el('span', 'chip hl', `${a.episodeCount} eps`));
      if (a.status) chips.appendChild(el('span', 'chip', a.status));
      if (a.season && a.year) chips.appendChild(el('span', 'chip', `${a.season} ${a.year}`));
      body.appendChild(chips);

      c.appendChild(body);
      c.addEventListener('click', () => App.selectTitle(a));
      grid.appendChild(c);
    });
  }

  function details(title) {
    $('#dTitle').textContent = title.title;
    const chips = $('#dChips');
    chips.innerHTML = '';
    const add = (txt, cls) => txt && chips.appendChild(el('span', 'chip' + (cls ? ' ' + cls : ''), txt));
    if (title.score) add(`${Number(title.score).toFixed(2)} score`, 'hl');
    if (title.type) add(title.type);
    if (title.episodeCount != null) add(`${title.episodeCount} episodes`);
    if (title.status) add(title.status);
    if (title.season && title.year) add(`${title.season} ${title.year}`);
  }

  function episodeTotal(max) {
    const s = $('#epStart'), e = $('#epEnd');
    s.max = max; e.max = max;
    e.value = Math.min(Number(e.value) || 1, max);
    $('#epTotal').textContent = `${max} eps`;
  }

  function episodeSummary(count) {
    $('#epSummary').textContent = count
      ? `${count} episode${count > 1 ? 's' : ''} selected`
      : 'No episodes selected';
  }

  function inspectEnabled(on) {
    $('#inspectBtn').disabled = !on;
  }

  function inspecting(on) {
    const btn = $('#inspectBtn');
    btn.disabled = on;
    btn.classList.toggle('busy', on);
    $('#inspectLabel').textContent = on ? 'Inspecting' : 'Inspect sources';
    if (on) {
      $('#sourceList').innerHTML = '';
      const box = el('div', 'source-loading');
      box.appendChild(el('div', 'spinner'));
      box.appendChild(el('div', '', 'Checking what this release actually offers'));
      $('#sourceList').appendChild(box);
    }
  }

  function stateChip(state, foundIn, sampled) {
    const map = {
      verified: ['ok', ICON.verified, 'available'],
      partial: ['warn', ICON.partial, `${foundIn}/${sampled} sampled`],
      unverified: ['faint', ICON.unknown, 'unverified'],
    };
    const [cls, icon, label] = map[state] || map.unverified;
    const chip = el('span', `src-state ${cls}`);
    chip.innerHTML = icon;
    chip.appendChild(document.createTextNode(label));
    return chip;
  }

  function sourceList(inspection, audio, selectedKey) {
    const list = $('#sourceList');
    list.innerHTML = '';
    if (!inspection) {
      list.appendChild(el('p', 'hint', 'Select your episodes, then inspect sources to see real qualities and sizes.'));
      return;
    }

    const rows = inspection.sources.filter((s) => s.audio === audio);
    if (!rows.length) {
      list.appendChild(el('p', 'hint', audio === 'dub'
        ? 'No dubbed sources were found for these episodes.'
        : 'No sources were found for these episodes.'));
      return;
    }

    for (const s of rows) {
      const row = el('button', 'src-row' + (selectedKey === s.key ? ' selected' : ''));
      row.type = 'button';
      row.dataset.key = s.key;

      const left = el('div', 'src-left');
      left.appendChild(el('span', 'src-q', s.quality));
      left.appendChild(el('span', 'src-group', s.group));
      row.appendChild(left);

      const right = el('div', 'src-right');
      right.appendChild(el('span', 'src-size', s.sizeMB ? `${s.sizeMB.toFixed(0)} MB / ep` : 'size unknown'));
      right.appendChild(stateChip(s.state, s.foundIn, inspection.sampledOk));
      row.appendChild(right);

      row.addEventListener('click', () => App.selectSource(s.key));
      list.appendChild(row);
    }
  }

  function inspectionSummary(inspection) {
    const n = $('#inspectSummary');
    if (!n) return;
    if (inspection.unverified) {
      n.textContent = 'Sources could not be confirmed for this series.';
      return;
    }
    const sampled = inspection.sampledEpisodes.length;
    n.textContent = inspection.exact
      ? `Checked all ${inspection.requestedEpisodes} selected episodes.`
      : `Based on ${sampled} sampled episode${sampled > 1 ? 's' : ''} out of ${inspection.requestedEpisodes} selected.`;
  }

  function setAudio(audio) {
    document.querySelectorAll('#audioSeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.audio === audio);
    });
  }

  function audioSeg(enableDub) {
    document.querySelectorAll('#audioSeg button').forEach((b) => {
      b.disabled = b.dataset.audio === 'dub' && !enableDub;
      b.title = b.disabled ? 'No dubbed sources found for these episodes' : '';
    });
  }

  function folder(name) {
    const n = $('#folderName');
    n.textContent = name;
    n.classList.add('set');
  }

  function estimate(src, count) {
    const n = $('#estText');
    if (!src || !count) { n.textContent = ''; return; }
    if (!src.sizeMB) { n.textContent = `${count} episode${count > 1 ? 's' : ''} selected`; return; }
    const totalMB = src.sizeMB * count;
    n.textContent = totalMB >= 1024
      ? `About ${(totalMB / 1024).toFixed(2)} GB for ${count} episode${count > 1 ? 's' : ''}`
      : `About ${totalMB.toFixed(0)} MB for ${count} episode${count > 1 ? 's' : ''}`;
  }

  function startHint(text) {
    const n = $('#startHint');
    if (n) n.textContent = text || '';
  }

  function startEnabled(on) { $('#startBtn').disabled = !on; }

  function queueHeader(title, eps, src, dest) {
    $('#qTitle').textContent = title.title;
    $('#qMeta').textContent = `Ep ${eps[0].num}-${eps[eps.length - 1].num} · ${src.quality} · ${src.audio.toUpperCase()} · ${src.group} · into ${dest}`;
  }

  let queueRows = [];

  function buildQueue(count) {
    const listEl = $('#queueList');
    listEl.innerHTML = '';
    queueRows = [];
    for (let i = 0; i < count; i++) {
      const item = el('div', 'qitem');
      const num = el('div', 'qep-num', '#');
      const mid = el('div', 'qmid');
      const name = el('div', 'qname', `Episode ${i + 1}`);
      const sub = el('div', 'qsub', '');
      const track = el('div', 'qtrack');
      const fill = el('div', 'qfill');
      track.appendChild(fill);
      mid.append(name, sub, track);
      const right = el('div', 'qright');
      const st = el('div', 'qstatus', 'Queued');
      const mb = el('div', 'qmb', '');
      right.append(st, mb);
      item.append(num, mid, right);
      listEl.appendChild(item);
      queueRows.push({ item, num, name, sub, fill, st, mb, received: 0, total: 0 });
    }
  }

  function setQueueRow(i, epNum) {
    const r = queueRows[i];
    if (!r) return;
    r.num.textContent = String(epNum);
    r.name.textContent = `Episode ${epNum}`;
  }

  const STATUS_LABEL = { queued: 'Queued', resolving: 'Resolving', downloading: 'Downloading', done: 'Done', skipped: 'Skipped', error: 'Failed' };

  function episodeStatus(i, s, msg) {
    const r = queueRows[i];
    if (!r) return;
    r.st.textContent = msg && (s === 'error' || s === 'skipped') ? msg.slice(0, 64) : STATUS_LABEL[s] || s;
    r.item.classList.remove('running', 'done', 'error', 'skipped');
    if (s === 'resolving' || s === 'downloading') r.item.classList.add('running');
    else if (s === 'done') r.item.classList.add('done');
    else if (s === 'error') r.item.classList.add('error');
    else if (s === 'skipped') r.item.classList.add('skipped');
    if (s === 'resolving') {
      r.fill.classList.add('indeterminate');
      r.fill.style.width = '35%';
    }
    if (s !== 'downloading' && s !== 'resolving') r.fill.classList.remove('indeterminate');
    if (s === 'done') r.fill.style.width = '100%';
  }

  function episodeFilename(i, f) {
    const r = queueRows[i];
    if (r && f) {
      r.name.textContent = f;
      r.name.title = f;
    }
  }

  function episodeSize(i, bytes) {
    const r = queueRows[i];
    if (r && bytes) r.total = bytes;
  }

  function episodeProgress(i, received, total, speed) {
    const r = queueRows[i];
    if (!r) return;
    r.received = received;
    if (total) r.total = total;
    r.mb.textContent = `${fmtBytes(received)}${r.total ? ' / ' + fmtBytes(r.total) : ''}${speed ? ' · ' + fmtBytes(speed) + '/s' : ''}`;
    if (total) {
      r.fill.classList.remove('indeterminate');
      r.fill.style.width = `${Math.min((received / total) * 100, 100)}%`;
    }
    episodeStatus(i, 'downloading');
  }

  function globalProgress(totalCount, fracSum) {
    const pct = totalCount ? Math.min((fracSum / totalCount) * 100, 100) : 0;
    $('#gpNum').textContent = `${Math.floor(pct)}%`;
    $('#gpFill').style.width = `${pct}%`;
  }

  function logLine(line) {
    const pre = $('#logPre');
    const stamp = new Date().toLocaleTimeString();
    pre.textContent += `[${stamp}] ${line}\n`;
    pre.scrollTop = pre.scrollHeight;
  }

  function done(summary, path) {
    const bits = [`${summary.succeeded} episode${summary.succeeded === 1 ? '' : 's'} saved`];
    bits.push(`${fmtBytes(summary.totalBytes)} in ${Math.floor(summary.totalSeconds / 60)}m ${summary.totalSeconds % 60}s`);
    if (summary.skipped) bits.push(`${summary.skipped} skipped`);
    if (summary.failed) bits.push(`${summary.failed} failed`);
    $('#doneSummary').textContent = bits.join(' · ');
    $('#donePath').textContent = path;
    showScreen('done');
    Confetti.celebrate();
  }

  return {
    showScreen, status, sourceLabel, discoverState, results, details,
    episodeTotal, episodeSummary, inspectEnabled, inspecting,
    sourceList, inspectionSummary, setAudio, audioSeg, folder,
    estimate, startHint, startEnabled, queueHeader, buildQueue, setQueueRow,
    episodeStatus, episodeFilename, episodeSize, episodeProgress,
    globalProgress, logLine, done,
  };
})();
