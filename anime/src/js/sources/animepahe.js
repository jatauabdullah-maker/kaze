'use strict';

const AnimePaheSource = (() => {
  const ID = 'animepahe';
  const MAX_SAMPLES = 3;
  const SAMPLE_GAP_MS = 350;

  const capabilities = {
    search: true,
    episodes: true,
    sourceInspection: true,
    quality: true,
    fansubGroups: true,
    dub: true,
    // The search API DOES return a poster URL, but i.animepahe.pw refuses to
    // serve it to anything except an animepahe.pw page. Verified: 403 with no
    // cookies, 403 with an explicit Referer, and an <img> fails from a foreign
    // origin under every referrerPolicy - even with a valid SameSite=None
    // cf_clearance cookie present. The host keys off Sec-Fetch-Site, which is
    // a forbidden header an extension cannot forge.
    // Fetching each poster through the work tab and blob-URLing it would work,
    // but the files are 2000x3000 - too much bandwidth for decoration.
    posters: false,
    selectableSubtitles: false,
    measuredQuality: false,  // the site publishes real sizes, no probing needed
  };

  function toTitle(a) {
    return {
      id: a.session,
      title: a.title,
      type: a.type || '',
      episodeCount: a.episodes == null ? null : Number(a.episodes),
      status: a.status || '',
      season: a.season || '',
      year: a.year || null,
      score: a.score == null ? null : Number(a.score),
      // Deliberately dropped: see the posters note in `capabilities`. Passing
      // the URL through would only render a broken image.
      poster: '',
    };
  }

  function toEpisode(e, titleId) {
    return {
      num: e.num,
      id: e.session,
      titleId,
      audio: e.audio || '',
      duration: e.duration || '',
      snapshot: e.snapshot || '',
    };
  }

  function pipelineEpisode(ep) {
    return { num: ep.num, session: ep.id, animeSession: ep.titleId };
  }

  function sourceKey(group, quality, audio) {
    return `${group}|${quality}|${audio}`;
  }

  function pickSamples(episodes) {
    const picks = [];
    if (!episodes.length) return picks;
    const idx = [0, Math.floor(episodes.length / 2), episodes.length - 1];
    for (const i of idx) {
      const ep = episodes[i];
      if (ep && !picks.includes(ep)) picks.push(ep);
    }
    return picks.slice(0, MAX_SAMPLES);
  }

  function fallbackInspection(requested) {
    const sources = ['360p', '720p', '1080p'].map((quality) => ({
      key: sourceKey('SubsPlease', quality, 'sub'),
      group: 'SubsPlease',
      quality,
      height: parseInt(quality, 10) || 0,
      audio: 'sub',
      sizeMB: null,
      foundIn: 0,
      state: 'unverified',
      label: quality,
    }));
    return {
      provider: ID,
      requestedEpisodes: requested,
      sampledEpisodes: [],
      sampledOk: 0,
      exact: false,
      unverified: true,
      groups: ['SubsPlease'],
      dubAvailable: false,
      sources,
    };
  }

  async function search(query) {
    const rows = await Pipeline.search(query);
    return rows.map(toTitle);
  }

  async function getEpisodes(titleId) {
    const eps = await Pipeline.getEpisodes(titleId);
    return eps.map((e) => toEpisode(e, titleId));
  }

  async function inspectSources(episodes, opts = {}) {
    const requested = episodes.length;
    if (!requested) return fallbackInspection(0);

    const samples = pickSamples(episodes);
    const collected = [];
    const sampledEpisodes = [];

    for (const ep of samples) {
      if (opts.isStale && opts.isStale()) return null;
      try {
        const links = await Pipeline.getPlayLinks(pipelineEpisode(ep));
        if (links.length) {
          collected.push(links);
          sampledEpisodes.push(ep.num);
        }
      } catch {
        /* a failed sample only lowers confidence, never blocks the user */
      }
      if (opts.onSample) opts.onSample(sampledEpisodes.length, samples.length);
      await sleep(SAMPLE_GAP_MS);
    }

    if (opts.isStale && opts.isStale()) return null;
    if (!collected.length) return fallbackInspection(requested);

    const byKey = new Map();
    const groups = new Set();
    let dubAvailable = false;

    for (const links of collected) {
      const seenInThisEpisode = new Set();
      for (const l of links) {
        if (!l.quality) continue;
        const audio = l.dub ? 'dub' : 'sub';
        if (l.dub) dubAvailable = true;
        groups.add(l.group);
        const key = sourceKey(l.group, l.quality, audio);
        const entry = byKey.get(key) || {
          key,
          group: l.group,
          quality: l.quality,
          height: parseInt(l.quality, 10) || 0,
          audio,
          sizeSum: 0,
          sizeCount: 0,
          foundIn: 0,
        };
        if (l.sizeMB) {
          entry.sizeSum += l.sizeMB;
          entry.sizeCount += 1;
        }
        if (!seenInThisEpisode.has(key)) {
          entry.foundIn += 1;
          seenInThisEpisode.add(key);
        }
        byKey.set(key, entry);
      }
    }

    const sampledOk = collected.length;
    const sources = [...byKey.values()]
      .map((e) => ({
        key: e.key,
        group: e.group,
        quality: e.quality,
        height: e.height,
        audio: e.audio,
        sizeMB: e.sizeCount ? e.sizeSum / e.sizeCount : null,
        foundIn: e.foundIn,
        state: e.foundIn >= sampledOk ? 'verified' : 'partial',
        label: e.quality,
      }))
      .sort((a, b) => b.height - a.height || a.group.localeCompare(b.group));

    return {
      provider: ID,
      requestedEpisodes: requested,
      sampledEpisodes,
      sampledOk,
      exact: sampledOk === requested,
      unverified: false,
      groups: [...groups],
      dubAvailable,
      sources,
    };
  }

  function run(cfg, hooks) {
    return Pipeline.run(
      {
        animeTitle: cfg.title,
        animeSession: cfg.titleId,
        eps: cfg.episodes.map(pipelineEpisode),
        quality: cfg.quality,
        group: cfg.group,
        audio: cfg.audio === 'dub' ? 'eng' : '',
        dirHandle: cfg.dirHandle,
      },
      hooks
    );
  }

  return {
    id: ID,
    label: 'AnimePahe',
    capabilities,
    search,
    getEpisodes,
    inspectSources,
    run,
    cancel: () => Pipeline.cancel(),
    cleanup: () => Pipeline.closeSolverTabs(),
    ensureAccess: () => Pipeline.ensureBroadAccess(),
    isBusy: () => Pipeline.isBusy(),
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnimePaheSource };
}
