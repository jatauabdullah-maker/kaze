'use strict';

const App = {
  state: {
    source: null,
    title: null,
    episodes: [],
    selection: { start: 1, end: 1 },
    inspection: null,
    selectedSourceKey: null,
    audio: 'sub',
    dirHandle: null,
    running: false,
    lastQuery: '',
    lastResults: [],
    lastScroll: 0,
  },

  async init() {
    this.state.source = Sources.active();
    UI.showScreen('discover');
    UI.status('idle', 'Idle');
    UI.sourceLabel(this.state.source.label);
    try { $('#verText').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}

    try {
      const handle = await IDB.get('dir');
      if (handle && (await this.verifyPermission(handle))) {
        this.state.dirHandle = handle;
        UI.folder(handle.name);
      }
    } catch {}

    $('#searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#searchInput').value.trim();
      if (q) this.doSearch(q);
    });

    let debounceTimer = null;
    $('#searchInput').addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = $('#searchInput').value.trim();
      if (q.length >= 3) debounceTimer = setTimeout(() => this.doSearch(q, true), 450);
    });

    $('#backToSearch').addEventListener('click', () => this.backToResults());

    document.querySelectorAll('#quickChips button').forEach((b) => {
      b.addEventListener('click', () => this.applyQuickChip(b.dataset.q));
    });

    ['epStart', 'epEnd'].forEach((id) => {
      $('#' + id).addEventListener('change', () => this.onRangeChange());
    });

    $('#inspectBtn').addEventListener('click', () => this.inspectSources());

    document.querySelectorAll('#audioSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        this.state.audio = b.dataset.audio;
        document.querySelectorAll('#audioSeg button').forEach((x) => x.classList.toggle('active', x === b));
        this.state.selectedSourceKey = null;
        UI.sourceList(this.state.inspection, this.state.audio, null);
        this.updateReadiness();
      });
    });

    $('#pickFolder').addEventListener('click', () => this.pickFolder());
    $('#startBtn').addEventListener('click', () => this.start());
    $('#backToConfig').addEventListener('click', () => {
      if (this.state.running) return;
      UI.showScreen('details');
    });

    $('#cancelBtn').addEventListener('click', () => {
      this.state.source.cancel();
      UI.status('idle', 'Cancelling');
      toast('Cancelling after the current step', 'warn');
    });

    $('#againBtn').addEventListener('click', () => {
      $('#logPre').textContent = '';
      UI.showScreen('discover');
      UI.status('idle', 'Idle');
    });

    $('#copyPath').addEventListener('click', () => {
      navigator.clipboard.writeText($('#donePath').textContent)
        .then(() => toast('Path copied to clipboard', 'ok'));
    });

    window.addEventListener('beforeunload', (e) => {
      if (this.state.running) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  },

  async verifyPermission(handle) {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  },

  backToResults() {
    UI.showScreen('discover');
    if (this.state.lastResults.length) {
      UI.results(this.state.lastResults, this.state.lastQuery);
      window.scrollTo({ top: this.state.lastScroll });
    }
  },

  async doSearch(q, quiet) {
    const seq = (this._searchSeq = (this._searchSeq || 0) + 1);
    if (!quiet) UI.discoverState('loading', `Searching for "${q}"`);
    else UI.status('busy', 'Searching');

    try {
      const results = await this.state.source.search(q);
      if (seq !== this._searchSeq) return;
      this.state.lastQuery = q;
      this.state.lastResults = results;
      UI.results(results, q);
      UI.discoverState(null);
      UI.status(results.length ? 'ok' : 'idle', results.length ? `${results.length} found` : 'No results');
    } catch (e) {
      if (seq !== this._searchSeq) return;
      if (!quiet) UI.discoverState('error', `Search failed: ${e.message}`);
      else UI.status('err', 'Search failed');
      toast(`Search failed: ${e.message}`, 'err');
    }
  },

  async selectTitle(title) {
    this.state.lastScroll = window.scrollY;
    this.state.title = title;
    this.state.inspection = null;
    this.state.selectedSourceKey = null;
    this.state.episodes = [];

    UI.showScreen('details');
    UI.details(title);
    UI.sourceList(null, this.state.audio, null);
    UI.status('busy', 'Loading episodes');
    UI.startEnabled(false);

    try {
      const eps = await this.state.source.getEpisodes(title.id);
      this.state.episodes = eps;
      if (!eps.length) throw new Error('This series has no episodes listed yet');

      UI.episodeTotal(eps.length);
      $('#epStart').value = 1;
      $('#epEnd').value = Math.min(5, eps.length);
      this.onRangeChange();
      UI.status('ok', 'Pick episodes, then inspect sources');
    } catch (e) {
      toast(`Could not load episodes: ${e.message}`, 'err');
      UI.status('err', 'Load failed');
    }

    this.state.source.cleanup();
  },

  selectedEpisodes() {
    const list = this.state.episodes;
    if (!list.length) return [];
    let s = Math.max(1, Number($('#epStart').value) || 1);
    let e = Math.min(list.length, Number($('#epEnd').value) || list.length);
    if (s > e) [s, e] = [e, s];
    return list.slice(s - 1, e);
  },

  applyQuickChip(kind) {
    const n = this.state.episodes.length;
    if (!n) return;
    if (kind === 'all') { $('#epStart').value = 1; $('#epEnd').value = n; }
    else if (kind === 'first5') { $('#epStart').value = 1; $('#epEnd').value = Math.min(5, n); }
    else if (kind === 'last5') { $('#epStart').value = Math.max(1, n - 4); $('#epEnd').value = n; }
    this.onRangeChange();
  },

  onRangeChange() {
    const eps = this.selectedEpisodes();
    UI.episodeSummary(eps.length);
    if (this.state.inspection) {
      this.state.inspection = null;
      this.state.selectedSourceKey = null;
      UI.sourceList(null, this.state.audio, null);
    }
    UI.inspectEnabled(eps.length > 0);
    this.updateReadiness();
  },

  async inspectSources() {
    const eps = this.selectedEpisodes();
    if (!eps.length) { toast('Pick an episode range first.', 'warn'); return; }

    const seq = (this._inspectSeq = (this._inspectSeq || 0) + 1);
    const isStale = () => seq !== this._inspectSeq;

    UI.inspecting(true);
    UI.status('busy', 'Inspecting sources');

    try {
      const inspection = await this.state.source.inspectSources(eps, {
        isStale,
        onSample: (done, total) => UI.status('busy', `Inspecting sources ${done}/${total}`),
      });
      if (!inspection || isStale()) return;

      this.state.inspection = inspection;
      const preferred = this.pickDefaultSource(inspection);
      this.state.selectedSourceKey = preferred ? preferred.key : null;

      if (!inspection.dubAvailable && this.state.audio === 'dub') {
        this.state.audio = 'sub';
        UI.setAudio('sub');
      }
      UI.audioSeg(inspection.dubAvailable);
      UI.sourceList(inspection, this.state.audio, this.state.selectedSourceKey);
      UI.inspectionSummary(inspection);
      UI.status('ok', inspection.unverified ? 'Sources unverified' : 'Sources ready');

      if (inspection.unverified) {
        toast('Could not verify sources for these episodes. You can still try a download.', 'warn', 5200);
      }
    } catch (e) {
      if (!isStale()) {
        toast(`Source inspection failed: ${e.message}`, 'err');
        UI.status('err', 'Inspection failed');
      }
    } finally {
      if (!isStale()) UI.inspecting(false);
      this.updateReadiness();
      this.state.source.cleanup();
    }
  },

  pickDefaultSource(inspection) {
    const forAudio = inspection.sources.filter((s) => s.audio === this.state.audio);
    const pool = forAudio.length ? forAudio : inspection.sources;
    return pool.find((s) => s.height === 1080 && s.state === 'verified')
      || pool.find((s) => s.state === 'verified')
      || pool[0]
      || null;
  },

  selectSource(key) {
    this.state.selectedSourceKey = key;
    UI.sourceList(this.state.inspection, this.state.audio, key);
    this.updateReadiness();
  },

  currentSource() {
    if (!this.state.inspection || !this.state.selectedSourceKey) return null;
    return this.state.inspection.sources.find((s) => s.key === this.state.selectedSourceKey) || null;
  },

  updateReadiness() {
    const eps = this.selectedEpisodes();
    const src = this.currentSource();
    UI.estimate(src, eps.length);
    UI.startEnabled(Boolean(eps.length && src && this.state.dirHandle));
    UI.startHint(this.startBlockedReason(eps, src));
  },

  startBlockedReason(eps, src) {
    if (!eps.length) return 'Pick at least one episode.';
    if (!this.state.inspection) return 'Inspect sources to see what is available.';
    if (!src) return 'Choose a source.';
    if (!this.state.dirHandle) return 'Choose a folder to save into.';
    if (src.state === 'partial') return `This source was only found in ${src.foundIn} of ${this.state.inspection.sampledOk} sampled episodes. Missing episodes are skipped.`;
    if (src.state === 'unverified') return 'This source could not be verified. Kaze will try anyway.';
    return '';
  },

  async pickFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      this.state.dirHandle = handle;
      await IDB.set('dir', handle);
      UI.folder(handle.name);
      this.updateReadiness();
    } catch (e) {
      if (e && e.name !== 'AbortError') toast(`Could not open folder picker: ${e.message}`, 'err');
    }
  },

  async start() {
    if (this.state.running) return;

    const eps = this.selectedEpisodes();
    const src = this.currentSource();
    if (!eps.length || !src) { toast('Pick episodes and a source first.', 'warn'); return; }
    if (!this.state.dirHandle) { toast('Choose a folder to save into first.', 'warn'); return; }

    UI.status('busy', 'Requesting access');
    const granted = await this.state.source.ensureAccess();
    if (!granted) { toast('Kaze needs network access to reach the download servers.', 'err'); UI.status('idle', 'Idle'); return; }

    const ok = await this.verifyPermission(this.state.dirHandle);
    if (!ok) { toast('Folder permission was denied.', 'err'); UI.status('idle', 'Idle'); return; }

    const destLabel = this.state.dirHandle.name;
    UI.queueHeader(this.state.title, eps, src, destLabel);
    UI.buildQueue(eps.length);
    eps.forEach((ep, i) => UI.setQueueRow(i, ep.num));
    UI.globalProgress(eps.length, 0);
    UI.logLine(`Job started: ${this.state.title.title} eps ${eps[0].num}-${eps[eps.length - 1].num}, ${src.quality}, group=${src.group}, audio=${src.audio}`);
    UI.showScreen('queue');

    this.state.running = true;
    UI.status('busy', 'Downloading');

    const fractions = new Array(eps.length).fill(0);

    const summary = await this.state.source.run(
      {
        title: this.state.title.title,
        titleId: this.state.title.id,
        episodes: eps,
        quality: src.quality,
        group: src.group,
        audio: src.audio,
        dirHandle: this.state.dirHandle,
      },
      {
        onStage: (msg) => UI.status('busy', msg.length > 42 ? msg.slice(0, 42) : msg),
        onLog: (line) => UI.logLine(line),
        onEpisodeStatus: (i, s, msg) => {
          if (s === 'done' || s === 'error' || s === 'skipped') {
            if (fractions[i] < 1) fractions[i] = 1;
          }
          UI.episodeStatus(i, s, msg);
          UI.globalProgress(eps.length, fractions.reduce((a, b) => a + b, 0));
        },
        onEpisodeFilename: (i, f) => UI.episodeFilename(i, f),
        onEpisodeSize: (i, b) => UI.episodeSize(i, b),
        onEpisodeProgress: (i, received, total, speed) => {
          if (total) fractions[i] = received / total;
          UI.episodeProgress(i, received, total, speed);
          UI.globalProgress(eps.length, fractions.reduce((a, b) => a + b, 0));
        },
      }
    );

    this.state.running = false;
    this.state.source.cleanup();

    if (summary.cancelled) {
      UI.logLine('Job cancelled.');
      toast('Download cancelled, resetting', 'warn');
      setTimeout(() => location.reload(), 900);
      return;
    }

    if (summary.succeeded > 0) {
      UI.status('ok', 'Completed');
      UI.done(summary, destLabel);
      UI.logLine(`Job finished: ${summary.succeeded} ok, ${summary.skipped} skipped, ${summary.failed} failed.`);
    } else {
      UI.status('err', 'Failed');
      UI.logLine('Job finished with nothing downloaded.');
      toast('Nothing was downloaded. Check the activity log.', 'err', 7000);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
