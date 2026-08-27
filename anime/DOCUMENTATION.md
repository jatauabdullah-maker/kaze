# Kaze Anime - Engineering Documentation

**Version:** 2.3.0 | **Platform:** Chrome Manifest V3 | **Location:** `anime/` in the [kaze](https://github.com/jatauabdullah-maker/kaze) monorepo

Standalone anime downloader with two interchangeable sources (AnimePahe and AnimeHeaven). Search -> pick episodes -> inspect sources -> pick a verified source -> pick folder -> download to disk.

Part of the Kaze family. Its sibling lives in the same repo: `video/` (video grabber + local yt-dlp server). Both share one design system - dark `#0a0b0f`, violet-to-cyan gradient (`#8b7cf8` -> `#4cc3f0`), aurora + wind-streak background, Space Grotesk / Inter type. Keep the look consistent when touching the UI.

This document records every design decision, observed site behavior, and bug fought, so the project can be picked up and safely updated when the source sites change.

---

## 1. File Map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Permissions, hosts, version. |
| `background.js` | Minimal service worker. Opens/focuses the app tab on icon click & install. PING handler. |
| `src/index.html` | The entire UI (single page, 4 screens: discover → details → queue → done). |
| `src/styles.css` | Design system. Dark glassmorphism, gradient accents, `color-scheme: dark`. |
| `src/js/util.js` | `$`, `el`, `fmtBytes`, `safeName`, `toast`, `showModal`, `sleep`. |
| `src/js/idb.js` | Tiny IndexedDB wrapper. Persists the picked `FileSystemDirectoryHandle`. |
| `src/js/confetti.js` | Canvas confetti (no deps). `Confetti.celebrate()`. |
| `src/js/pipeline.js` | **The engine.** All networking, Cloudflare handling, parsing, streaming, file writing. IIFE exposing `Pipeline`. |
| `src/js/sources/animepahe.js` | **Source adapter.** Normalizes search/episodes/source-inspection/run against `pipeline.js`. Exposes `capabilities`. |
| `src/js/sources/animeheaven.js` | **Source adapter.** Self-contained: its own fetch/parse/download path plus the MP4 header probe. No Cloudflare, no work tabs. |
| `src/js/sources/registry.js` | Source registry (`Sources`). Registers adapters, resolves the active provider, checks capabilities. |
| `src/js/ui.js` | Rendering module (`UI`). Screens, cards, source rows, queue rows, progress, toasts. No business logic. |
| `src/js/app.js` | Orchestrator (`App`). Wires DOM events to the active source adapter; owns UI state. |
| `icons/` | Generated from the in-app logo (gradient + wind glyph). |

**Load order matters:** `util.js → idb.js → confetti.js → pipeline.js → sources/animepahe.js → sources/animeheaven.js → sources/registry.js → ui.js → app.js` (classic scripts, no modules, no build step).

---

## 1a. Source Adapter Layer (two sources since v2.3.0)

`app.js` never talks to `Pipeline` directly. It calls the **active source adapter**
(`Sources.active()`), which owns all provider-specific behaviour:

```
search(query, { onUpdate })           -> titles { id, title, type, episodeCount, score, poster, ... }
getEpisodes(titleId)                  -> episodes { num, id, titleId, audio, duration }
inspectSources(episodes, { isStale, onSample }) -> inspection { sources[], sampledOk, ... }
run(cfg, hooks)                       -> downloads, reporting progress through hooks
cancel() / cleanup() / ensureAccess() / isBusy()
```

Registered in `registry.js`. **Registration order sets the default** - AnimePahe
first, because it offers real quality and dub choice.

| | AnimePahe | AnimeHeaven |
|---|---|---|
| Cloudflare / Turnstile | yes, needs a tab handoff | **none** |
| Hops to the video | 3 (pahe.win -> kwik.cx -> CDN) | **1** (gate.php -> CDN) |
| Referer rewriting | required (`declarativeNetRequest`) | not needed |
| Work tabs | required | **not used at all** |
| Quality choice | 360p/720p/1080p, multiple groups | one file per episode |
| Dub | yes | no |
| Posters in results | blocked (see below) | yes |
| Episode metadata | from the API | measured from the file |

### Capabilities drive the UI

Each adapter publishes a `capabilities` object, and the UI **hides** what a
source cannot honour rather than showing dead controls:

- `dub: false` hides the SUB/DUB segmented control entirely.
- `quality: false` replaces the source list with a single "only option" panel.
- `posters: false` skips the card image.
- `measuredQuality: true` means the numbers came from probing the real file.

### Source states

| state | meaning |
|---|---|
| `verified` | found in every sampled episode |
| `partial` | found in some samples only (chip shows `n/total sampled`) |
| `unverified` | inspection failed entirely; a safe fallback set is offered |

AnimePahe samples first / middle / last of the selected range (max 3), 350ms
apart. AnimeHeaven probes the first and middle episode (max 2), 400ms apart.
Both honour `isStale` so changing the range cancels an in-flight probe.

---

## 1b. AnimeHeaven Pipeline

Four steps, no Cloudflare, no work tabs. All verified live 2026-08.

```
search.php?s=<query>   -> a[href^="anime.php"]  (title in .similarname, poster in img.coverimg)
anime.php?<id>         -> a[href="gate.php"], id attr = 32-hex hash, .watch2 = episode label
cookie key=<hash>      -> chrome.cookies.set on animeheaven.me
gate.php               -> "Download Episode N" anchor = direct .mp4
```

**The gate is not a real gate.** Their `gatea()` writes the episode hash into a
`key` cookie and `gate.php` reads it back. No token, nothing signed. But it *is*
mandatory - without the cookie `gate.php` returns **404**.

`document.cookie` cannot be used: this page is a `chrome-extension://` origin, so
it can only set cookies on itself. Hence the **`cookies` permission** in the
manifest and `chrome.cookies.set()`. This is the only reason that permission
exists.

### Episode labels are not integers

Verified live, and each case broke a naive `Number(raw)` parse:

| label | meaning | source |
|---|---|---|
| `24` | normal release | everywhere |
| `24ch` | alternate audio cut | To Be Hero X lists all 24 episodes twice |
| `7.5` | recap / special | [Oshi no Ko] |

The parser takes a leading number, keeps any suffix as a `variant` tag, and
prefers the unsuffixed cut when a number appears twice. Without the dedupe, To Be
Hero X shows 48 entries for 24 episodes; without the suffix handling, half the
list silently vanishes.

Episodes are listed **newest first** on the page and sorted ascending before
returning, because the rest of the app assumes ascending order.

### CDN hosts rotate

The download host changes between requests - `co`, `ct`, `ci`, `cv`, `po`, `rk`
have all been observed for the same episode. Always read the host from the page;
never cache it.

---

## 1c. Reading the real quality (MP4 header probe)

AnimeHeaven advertises nothing about resolution. Parsing the container is the
only honest way to say what a download will be, and it costs **16 KB** of a
~200 MB file.

`probeFile()` sends one Range request and reads:

- **resolution** from the `avc1` VisualSampleEntry (width at +28, height at +30)
- **duration** from `mvhd` (v0 and v1 layouts both handled)
- **total size** from the 206 response's `content-range: bytes 0-16383/202051404`
- **bitrate** derived from size and duration - the honest tell for whether a
  720p file is a good one or a bloated re-encode

Measured live: `1280x720 avc1, 26:00, 199 MB, 1.07 Mbps`. Identical results at
8 KB, 16 KB and 64 KB, so 16 KB is enough.

**Two traps, both hit during development:**

1. The string `avc1` appears **twice**. The `ftyp` box's compatible-brands list
   literally contains it (`isomiso2avc1mp41`), and that hit yields `0x0`. Skip
   past `ftyp` before searching.
2. **One request only.** This CDN stalls when two requests for the same file are
   in flight - a lone Range request answers in under a second, while a Range plus
   a size request in parallel both hang past 60s. That produced the symptom
   "size shown, quality unknown". The `content-range` header makes the second
   request unnecessary anyway.

A `<video preload="metadata">` probe was tried first and removed: the CDN sends
`Access-Control-Allow-Origin: https://animeheaven.me`, and a media element does
not get the host-permission CORS bypass that `fetch()` does.

---

## 1d. AnimePahe posters do not work

The search API returns a `poster` URL, but `i.animepahe.pw` serves it only to an
`animepahe.pw` page. Tested every angle:

| attempt | result |
|---|---|
| from an animepahe.pw page | loads (2000x3000) |
| `<img>` from a foreign origin | fails |
| direct fetch, no cookies | 403 |
| with `Referer: https://animepahe.pw/` | 403 |
| `referrerPolicy` no-referrer / origin / unsafe-url | all fail |
| with a valid `SameSite=None` `cf_clearance` cookie | still 403 |

The host keys off `Sec-Fetch-Site`, a forbidden header an extension cannot forge.
`posters` is therefore `false` and `toTitle()` drops the URL rather than
rendering a broken image. Fetching each poster through a work tab and
blob-URLing it would work, but at 2000x3000 per result that is a lot of
bandwidth for decoration.

---

## 2. Architecture Overview

```
┌────────────────────────────┐
│  App Page (src/index.html) │  ← full-tab extension page. Runs the WHOLE orchestration.
│  App.js → Pipeline.run()   │    (Long-lived: no MV3 service-worker lifetime issues.)
└──────────┬─────────────────┘
           │ chrome.scripting.executeScript (fetch inside tab = first-party cookies)
           ▼
┌─────────────────────────────────────────────┐
│  Minimized "work window" (invisible)        │
│  ├─ tab: animepahe.pw   (API + play pages)  │
│  ├─ tab: pahe.win       (kwik link snipe)   │
│  └─ tab: kwik.cx        (form + token)      │
└──────────┬──────────────────────────────────┘
           │ extension-context fetch (CORS-exempt via host permissions)
           ▼
   CDN (vault-N.owocdn.top / uwucdn.top …) ──► FileSystemDirectoryHandle (user-picked folder)
```

**Key principle:** every site request runs **inside a tab on that site** (first-party context → cookies attach, CF satisfied), while the **file stream** runs from the **extension page** (host-permission fetch → no CORS), writing chunks into the user-picked folder via the File System Access API.

---

## 3. The Pipeline, End to End

### 3.1 Search (Discover screen)
- `GET https://animepahe.pw/api?m=search&q={query}` (JSON, from the animepahe work tab).
- Response `data[]`: `{ id, title, type, episodes, status, season, year, score, poster, session }`.
- **Everything the details screen shows comes free from this endpoint** — no detail-page scraping needed.

### 3.2 Episode list
- `GET /api?m=release&id={anime session UUID}&sort=episode_asc&page={N}` — **note: `id` is the session UUID, NOT the numeric id** (a numeric id returns `{"message":""}`).
- 30 per page, walk while `next_page_url` exists.
- Entry: `{ episode, session, audio ("eng" = dub), duration, snapshot }`.
- Play URL for an episode: `https://animepahe.pw/play/{animeSession}/{epSession}`.

### 3.3 Quality discovery (probe)
- **Called through the source adapter** (`AnimePaheSource.inspectSources`, §1a) — the engine below is unchanged.
- Fetch the play page's **raw HTML** (no JS execution needed) and parse anchors:
 - Selector: `a[href*="pahe.win"]`
 - Text format: `Group · Qp (sizeMB)` with optional ` eng` suffix → `{ group, quality: "1080p", sizeMB, dub }`.
- Probe up to 3 episodes of the selected range (first / middle / last), **sequentially with 350ms gaps** (rate limiting).
- Builds the source rows (with ≈ MB/ep), fansub group, SUB/DUB availability, and **verified / partial / unverified** states.
- If ALL probes fail → fallback source set (360/720/1080, no sizes) + warning toast. Never dead-end the user.

### 3.4 pahe.win resolution (kwik link snipe)
- The chosen anchor href is a short link: `http://pahe.win/{code}` (redirects to https).
- **The work tab stays parked on `https://pahe.win/`** (a harmless "private website" notice — NOT challenge-gated).
- **XHR snipe:** from that parked tab, `fetch(shortUrl)` returns the **real interstitial HTML even without clearance**. The raw HTML contains the kwik URL directly inside its countdown script:
  ```js
  $("a.redirect").attr("href","https://kwik.cx/f/XXXXXXXX")   // ← regex this
  ```
  Regex: `/https?:\/\/kwik\.cx\/[ef]\/([A-Za-z0-9]+)/`. **No countdown wait needed.**
- If the XHR *is* gated (challenge HTML / 403): fall back to the one-time handoff — navigate the tab to the short URL, focus it, banner says "solve the checkbox, don't touch anything else", poll until the page settles, then XHR again. After success the tab **parks back on root**.
- DOM fallback: after the on-page countdown, `a.redirect[href*="kwik."]` appears (only used if XHR path somehow fails).

### 3.5 kwik form extraction (must render JS!)
- **The kwik `/f/{id}` page builds its download form CLIENT-SIDE** (obfuscated inline script + `/app/js/downstream.js`). The raw HTML has **no form** — verified. DOM-scraping the raw fetch returns null.
- Therefore: a **kwik work tab** navigates to the kwik URL and we poll its DOM via `chrome.scripting.executeScript`:
 - `form[action*="/d/"]` → `action` + `input[name="_token"]`
 - Real filename from `<title>`: `AnimePahe_..._1080p_SubsPlease.mp4 :: Kwik` (strip ` :: Kwik`).
- If the tab shows a challenge → handoff (focus + banner + poll). If the tab was closed → clear error; auto-reopens next episode.
- The tab is **reused across episodes** (one tab total), and sent to `about:blank` after each extraction (kills ad scripts, nothing for the user to mis-click).

### 3.6 The download hop (the hard-won part)
1. Register a **one-shot `chrome.webRequest` capture** (`onBeforeRedirect` + `onResponseStarted` + `onCompleted`, urls `https://kwik.cx/d/*`, `["responseHeaders"]`) to catch the `Location` of the 302.
2. From **inside the kwik tab** (first-party → CF happy): `fetch(form.action, {method:'POST', credentials:'include', redirect:'manual', body: _token})`.
3. The capture resolves with the **CDN URL** (`https://vault-N.owocdn.top/mp4/...?file=Name.mp4`).
4. **Stream from the extension page**: `fetch(cdnUrl, {credentials:'omit'})` — extension-context fetches are CORS-exempt for granted hosts, and the CDN is TLS-fingerprint gated (see §4.4) which browser-stack fetches satisfy.
5. Before streaming, a **dynamic declarativeNetRequest rule** (id `424242`) sets `Referer: https://kwik.cx/` on XHRs to the CDN host (removed after). Defensive — covers CDNs that check Referer.
6. Fallback if the CDN fetch fails: direct `POST form.action` from extension context (works when third-party cookies aren't blocked).
7. Last-resort safety net (not yet needed): `chrome.downloads.download({url: cdnUrl, filename: "Kaze/..."})` saves to `~/Downloads/Kaze/`.

### 3.7 Writing to disk
- User picks a folder once via `showDirectoryPicker({mode:'readwrite'})`; the handle is stored in **IndexedDB** (handles are structured-cloneable; `chrome.storage` cannot store them).
- On every Start: `queryPermission`/`requestPermission` re-verify (needs user gesture — the Start click qualifies).
- `uniqueFileName()`: if `Name.mp4` exists → `Name (2).mp4`, etc.
- `createWritable()` + sequential `ws.write(uint8array)` per chunk. On error: `ws.abort()`.
- Progress: throttled to ~220ms, speed via EMA (0.7·old + 0.3·instant).
- Cancel: `AbortController` per job; checked between chunks, between episodes, and in every wait loop.

---

## 4. Site Intelligence (observed 2026-08, keep updated!)

### 4.1 animepahe (.pw / .com / .org)
- **They rotate TLDs.** Their own site banner states the live set is
  `animepahe.pw`, `animepahe.com`, `animepahe.org`; `.com` and `.org` both 301 to
  whichever is current. `pipeline.js` probes all three via `resolveBase()` and
  caches the first that answers, treating a 403 as alive-but-challenged. A TLD
  change no longer needs a release.
- **`animepahe.ru` is NOT them any more.** It redirects to `animepahe.su`, a
  parked "domain for sale" page. Do not add it.
- CF-managed challenge on first visit; clearance (`cf_clearance` cookie) lasts ~1 year.
- API endpoints are XHR-friendly and return JSON (see §3.1–3.2).
- Play pages: ad scripts exist that can hijack top-level navigation (observed redirect to ad landing). **Never rely on tab navigation for play pages — fetch raw HTML from the work tab instead.**
- **Rate limiting: HTTP 429.** Aggressive parallel requests trigger it. The pipeline spaces requests (350–800ms gaps) and backs off exponentially on 429 (honors `Retry-After` when present).

### 4.2 pahe.win
- **Root (`https://pahe.win/`) is NOT challenge-gated** — it's a static "website is used privately" notice. Perfect parking page.
- Short links (`/XXXXXX`) ARE gated for top-level navigation, but **same-origin XHR returns the real interstitial HTML** (with the kwik URL embedded) — this is the snipe trick.
- The interstitial's countdown JS sets `a.redirect` after ~5s — irrelevant when XHR-sniping.

### 4.3 kwik.cx
- CF-gated on first visit (clearance persists).
- `/f/{id}`: form is JS-built (obfuscated). Needs a real tab.
- `POST /d/{id}` with `_token` → 302 → CDN. Token is per-page-load, short-lived.

### 4.4 CDN (vault-N.owocdn.top, uwucdn.top, …)
- **TLS-fingerprint gated:** curl / Node clients get 403 *even with a perfect browser UA + Referer + fresh URL*. Only real browser network-stack requests pass.
- Signed URLs are short-lived/single-use — mint them fresh per episode (the POST does that).
- Hosts vary (`owocdn.top`, `uwucdn.top` observed). This is why the manifest requests **optional `http://*/*` + `https://*/*`** at first Start (`Pipeline.ensureBroadAccess()`).

### 4.6 animeheaven.me
- **No Cloudflare at all.** Plain Apache. This is the whole reason it is a good
  fallback: none of the Turnstile machinery in §4.5 applies.
- **It rate-limits by concurrency, not by rate.** Parallel requests produce
  `ERR_CONNECTION_TIMED_OUT` for ~15s and recover only after backing off. Search
  metadata hydration is capped at 2 concurrent with a 300ms gap; episode probes
  run sequentially with a 400ms gap.
- Search results carry **only** a title and a poster. Year, score, episode count
  and tags require a follow-up fetch of each series page - that is what
  `hydrate()` does, in the background, so results paint immediately.
- Search is loose: querying "oshi no ko" also returns "My Deer Friend Nokotan".
  That is their matching, not a parse bug.
- Poster images are **not** hotlink-protected (unlike animepahe's).

### 4.5 Cloudflare / Turnstile — handling strategy
1. **Detection:** status 403/503, OR body contains `Just a moment` (pahe.win serves its challenge with **HTTP 200** — status-only detection misses it!).
2. **Auto-click attempt:** `chrome.scripting.executeScript({allFrames:true})` clicking `input[type=checkbox]` / `[role=checkbox]` inside the challenges.cloudflare.com iframe. Works sometimes (synthetic clicks are ignored by the widget other times).
3. **Human handoff:** focus the tab, inject a purple banner: *"Kaze needs ONE click: solve the checkbox — then do NOT click anything else"*. Poll every 2–2.5s (probe via in-tab fetch). On success: refocus the app tab, re-minimize the work window, continue.
4. **Clearance persists** in the profile — this is a one-time-per-site event (animepahe, pahe.win, kwik each have their own).

---

## 5. Why Work Tabs Exist (the third-party-cookie lesson)

**The #1 architectural constraint.** Chrome blocks third-party cookies by default. A `fetch()` from the extension page to `animepahe.pw` is a **cross-site** request → `cf_clearance` is **not attached** → permanent 403 no matter how many times the user solves the checkbox.

**Solution:** run every site request *inside a tab on that site* via `chrome.scripting.executeScript` — first-party context, cookies attach naturally. The extension page only does the CDN stream (no cookies needed) and file writes.

The work tabs live in a **single minimized window** (`chrome.windows.create({state:'minimized'})`) so they never clutter the tab strip. Challenge handoffs restore the window; after solving it re-minimizes.

---

## 6. Self-Healing Work-Tab Logic (read before touching!)

The hardest bugs lived here. Rules the current code follows — **do not regress them:**

1. **Distinguish "navigating" from "closed".** `executeScript` throws *during page transitions* (e.g., right after the user solves a Turnstile — CF reloads the page). Catch → `chrome.tabs.get(tabId)` → exists? = `{navigating:true}` → `waitTabComplete` and continue. Only a real `tabs.get` failure = `{gone:true}` → recreate. **Misreading this causes infinite reload loops** (the original v2.0 bug).
2. **Drift detection double-checks.** If `probe.host !== expected`, wait for load to settle, re-probe once, only then re-navigate. Mid-navigation hostname reads cause false drift.
3. **Creation lock.** `getWorkTab` stores an in-flight promise per hostname (`creating` map) — concurrent callers share one tab. (Without it: double tabs from search-submit + live-debounce firing together.)
4. **Park, don't wander.** pahe tab parks on root; kwik tab goes to `about:blank` after token extraction; pahe tab parks back on root after handoff success. Idle work tabs attract **ad redirects** — parked pages minimize that.
5. **Banners announce automation.** Every work tab shows a fixed purple banner: *"Kaze is controlling this tab — no action needed"* (or the one-click instruction during handoff). Users must know not to touch.
6. **Cancel = hard kill.** `Pipeline.cancel()` aborts the controller AND `closeSolverTabs()` (tabs + work window). All loops check `activeJob?.cancelled` at the top; the gone-branch checks *before* recreating so cancel never reopens tabs.
7. **429 backoff.** `rawFetch` retries 429s with `Retry-After` or quadratic backoff (4s→16s→36s), max 4 attempts, with UI status updates.

---

## 7. UI Notes

**Source switcher** (discover screen, `#sourceSwitch`). Only rendered when more
than one source is registered. Each pill states the tradeoff plainly - "quality
choice / sub + dub" vs "one quality / sub only" - so the choice is informed.
Disabled while a job runs. Switching resets title, episodes, inspection and
results, because session ids and episode hashes do not carry between sources.

**Capabilities hide controls, they do not disable them.** `dub: false` removes the
SUB/DUB segment entirely rather than greying it out. `quality: false` replaces the
source list with a single panel that says so, plus the measured facts:

```
720p  [only option]
1280x720 resolution   26:00 per episode   199 MB per episode   1.07 Mbps bitrate   AVC1 codec
This site serves one file per episode - there is no quality menu.
Kaze read these numbers from the video file itself before downloading it.
```

Showing a one-item menu as if it were a decision is worse than saying there is no
decision to make.

**Search hydration.** `search()` takes an `onUpdate` callback. AnimeHeaven paints
titles and posters immediately, then re-renders as year/score/episode-count land.

**Favicon.** All three Kaze surfaces use the identical inline-SVG data URI with a
**flat** `#8b7cf8` fill. Do not point this at the gradient PNG: at 16px the ramp
averages to `#7BA9F5`, which reads visibly blue-cyan next to the siblings.

**Cards** render a poster when the source provides one, with an `error` handler
that removes the image rather than leaving a broken frame.

## 8. Bug Archaeology (every fight, so you don't refight it)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Whole page blurred, nothing visible | `.modal-root` CSS `display:grid` overrode the `hidden` attribute → invisible fullscreen blur veil always on | `.modal-root[hidden] { display:none }` |
| 2 | "Security check could not be passed" forever despite clicking the box | Extension-context fetch = cross-site → `cf_clearance` never attached (3PCD) | Work-tab architecture (§5) |
| 3 | pahe.win failed instantly (~3s), no handoff | pahe serves its challenge with **HTTP 200**; solver only reacted to 403/503 | Body-based challenge detection (`Just a moment`) |
| 4 | Handoff showed the "private website" page, nothing to click | Solver navigated to pahe.win **root** (not gated); only short links are gated | Navigate to the **short URL** for handoff; park on root otherwise |
| 5 | Stuck on "Resolving"; tab refreshed back to pahe.win repeatedly | Post-checkbox page transition threw in `executeScript` → misread as "tab closed" → recreate → loop | `navigating` vs `gone` distinction (§6.1) |
| 6 | Two animepahe tabs on first search | Concurrent `getWorkTab` (submit + debounced live search) both created tabs | Creation lock + search sequence guard |
| 7 | `HTTP 429 from animepahe.pw` per episode | No rate-limit handling; parallel probes | Backoff + serialized probes + inter-request gaps |
| 8 | "Continue"/"Download" clicks expected | Background-tab timer throttling froze the pahe countdown; raw HTML already contains the kwik URL | XHR snipe — countdown never waited on |
| 9 | kwik form parse returned null on raw HTML | Form is built client-side by obfuscated JS | kwik work tab + DOM polling |
| 10 | `Failed to fetch` streaming from kwik tab | POST 302s to CDN; CDN sends no CORS headers → page-context read blocked | Extension-context stream (§3.6) |
| 11 | CDN 403 via curl/Node even fresh | TLS-fingerprint gating | Accept: only browser-stack fetches work |
| 12 | Posters broken | Hotlink protection | Removed images from UI |
| 13 | Fansub dropdown white/invisible | Native select in dark UI | `color-scheme: dark` + option styles |
| 14 | Global % stuck at 0% with failures | Progress only updated on chunk events | Recompute on terminal statuses too |
| 15 | Queue showed "Episode 1" next to "#3" | Name cell never got the real ep number | `setQueueRow` sets both |
| 16 | Cancel left work tabs; closing a tab "revived" it | Cancel didn't close tabs; gone-branch recreated unconditionally | Cancel closes work window; cancelled-check before recreate |
| 17 | Toolbar icon ≠ app logo | Hand-drawn icon | Icons regenerated from the actual UI logo |

---

**v2.3.0 round**

| Symptom | Cause | Fix |
|---|---|---|
| Extension logo looked blue vs the sibling apps | in-page logo was a bare glyph over a CSS `120deg` gradient at stroke-width 6; the sibling uses a self-contained SVG with its own rect, `135deg`, stroke 4.5 | copied the sibling's SVG verbatim |
| Toolbar/tab icon still blue | favicon pointed at the gradient PNG; at 16px the ramp averages to `#7BA9F5` (green +45 over target) | use the same flat `#8b7cf8` inline SVG the siblings use |
| Solver window flickered; Chrome minimized; focus never returned to Kaze | app was focused *then* the work window minimized - minimizing reassigns focus, stealing it straight back. `focusTab` also forced `state:'normal'`, un-maximizing a maximized window. `rawFetch` re-entered `humanSolve` while clearance settled | `returnToApp()` minimizes first then focuses, with verify-and-retry; only un-minimize; 20s per-host clearance grace |
| AnimeHeaven quality read "unknown" but size appeared | Range probe and size probe fired via `Promise.all`; that CDN stalls on concurrent requests to one file | single Range request; size comes from `content-range` |
| MP4 parse returned `0x0` | `avc1` matched the `ftyp` compatible-brands string first | skip past the `ftyp` box before searching |
| Half of To Be Hero X's episodes vanished | `Number('24ch')` -> `NaN` -> silently skipped | parse leading number, keep suffix as `variant`, dedupe |
| First 5 downloaded the *last* 5 | AnimeHeaven lists episodes newest-first | sort ascending in `getEpisodes()` |
| AnimeHeaven cards were blank | search page has no metadata, and the card UI never rendered posters | background `hydrate()` + poster `<img>` |


## 9. Testing (the harness)

**Location:** `%TEMP%\opencode\kaze-test\` (`test.js` + `cookies.json` + `node_modules/playwright-core`).

**Why it exists:** the Playwright MCP browser can't load unpacked extensions, and Chrome 137+ stable blocks `--load-extension` entirely. The harness uses **Playwright's bundled Chromium** (`chromium-1234`) with `launchPersistentContext` + `--load-extension` — a real browser with the real extension.

**What it does:**
1. Launches with the extension; discovers the extension id via service worker / extension page.
2. **Transplants clearance cookies** (incl. httpOnly `cf_clearance`, from a prior solved session — see `cookies.json`; valid until ~2027) so tests skip challenges.
3. Overrides `window.showDirectoryPicker` to return `navigator.storage.getDirectory()` (OPFS) — automates the folder pick, and files can be **verified byte-size afterward**.
4. Drives the real UI: search → card click → range → quality pill → folder → Start.
5. Background watcher clicks Turnstiles (human-like mouse, ≥12s spacing — clicking mid-reload RESETS the challenge).
6. Polls queue rows/status, dumps the app's Activity log, lists OPFS files.

**Run it:**
```powershell
cd $env:TEMP\opencode\kaze-test
node test.js
```

**Gotchas learned:**
- Chrome 151 stable ignores `--load-extension` (even with `--disable-features=DisableLoadExtensionCommandLineSwitch`) → must use the Playwright Chromium build.
- `workTabs.set` must happen *before* `waitTabComplete` + creation lock, or concurrent flows double-create tabs.
- Aggressive challenge clicking makes CF re-challenge forever.
- Back-to-back full-flow runs trigger animepahe 429s — space test runs.

---

## 10. Maintenance Playbook (when it breaks in the future)

**Golden rule: the Activity log names the failing step.** Queue screen → "Activity log" → read the last lines. Map the message:

| Log says | Failing step | Check / fix |
|---|---|---|
| `Search failed: …` | §3.1 search API | Endpoint changed? Fetch `/api?m=search&q=test` in a tab; check JSON shape. Challenge? Solve once manually. |
| `Could not load episodes` | §3.2 release API | Verify `m=release&id={session UUID}&sort=episode_asc&page=1` still returns `data[]` + `next_page_url`. **id must be the UUID.** |
| `No download links found on the episode page` | §3.3 play parse | View-source a play page: are `pahe.win` anchors still present? Text format changed? Update `parsePlayLinks` regexes (`(\d{3,4})p`, `(xMB)`, `eng`). |
| `pahe.win gate active` every run + handoff fails | §3.4 snipe | The root-page XHR exemption may have been removed. Then handoff is mandatory — ensure the challenge click flow still works. |
| `Could not find the kwik link on the redirect page` | §3.4 regex | View-source the interstitial: the countdown script format may have changed. Update the `kwik.cx/[ef]/` regex / `a.redirect` selector. |
| `The download form did not appear in time` | §3.5 kwik DOM | kwik changed their form builder. Open a kwik /f/ page, inspect the real form (`form[action*="/d/"]`, `_token`). |
| `CDN stream rejected (HTTP 403)` repeatedly | §3.6 stream | CDN policy changed. Try: keep the DNR referer rule; try `credentials:'include'`; or implement the `chrome.downloads` fallback (§3.6.7). |
| `HTTP 429` storms | Rate limiting | Increase gaps in `processEpisode`/`probeRange`; backoff constants in `rawFetch`. |
| Challenge loops forever | §4.5 | Check `looksLikeChallenge` (pahe serves 200-challenges!). Check banner/handoff UX still reaches the right tab. |

**When site selectors change:** all parsing lives in `pipeline.js` — `parsePlayLinks`, `resolveKwik` (regex + `a.redirect`), `probeKwikDom` (`form[action*="/d/"]`, `_token`, title). Nowhere else.

**Version protocol:** bump `manifest.json` `version` on every change (header shows it) so testers confirm they run new code. After loading changes: `chrome://extensions` → ⟳ on Kaze.

---

## 11. Known Limitations

**Both sources**
- Episode range inputs are **positions, not episode numbers**. With a 7.5 special
  in the list, position 8 is episode 7.5.
- No resume. A cancelled or failed episode restarts from zero.

**AnimePahe**
- Needs one human click per site for Turnstile (animepahe, pahe.win, kwik.cx),
  once per profile.
- Posters cannot be shown - see §1d.
- The CDN is TLS-fingerprint gated, so downloads must come from real browser
  network requests (§4.4).

**AnimeHeaven**
- One quality per episode, no choice. Measured 720p on every file sampled so far,
  but that is an observation, not a guarantee - the probe reports whatever is
  actually there.
- No dub, no fansub groups, no subtitle selection.
- Alternate audio cuts (`24ch`) are detected and deduped, but only the
  unsuffixed cut is offered. Downloading a specific variant is not exposed.
- Stalls under concurrent load, so inspection is deliberately slower than
  AnimePahe's.

## 12. Quick Reference - Endpoints & Selectors

### AnimePahe

```
BASE      resolveBase() probes .pw -> .com -> .org, caches the first that answers
SEARCH    GET {BASE}/api?m=search&q={q}
EPISODES  GET {BASE}/api?m=release&id={sessionUUID}&sort=episode_asc&page={n}
PLAY      GET {BASE}/play/{animeSession}/{epSession}
            -> parse: a[href*="pahe.win"]  ->  "Group - 1080p (215MB) [eng]"
PAHE      GET http://pahe.win/{code}   (from parked pahe.win tab, XHR)
            -> regex: /https?:\/\/kwik\.cx\/[ef]\/([A-Za-z0-9]+)/
KWIK      TAB https://kwik.cx/f/{id}   (JS-rendered!)
            -> DOM: form[action*="/d/"] + input[name="_token"] + <title> filename
DOWNLOAD  POST {form action}  body: _token=...   (from kwik tab, redirect:'manual')
            -> webRequest captures 302 Location -> CDN URL
STREAM    GET {cdnUrl}  from extension page (DNR Referer: https://kwik.cx/)
WRITE     dirHandle.getFileHandle(name,{create:true}) -> createWritable() -> chunk writes
```

### AnimeHeaven

```
SEARCH    GET https://animeheaven.me/search.php?s={q}
            -> a[href^="anime.php"]        id = href.split('?')[1]
            -> .similarname a              title
            -> img.coverimg                poster (NOT hotlink-protected)
SERIES    GET https://animeheaven.me/anime.php?{id}
            -> a[href="gate.php"]          id attr = 32-hex episode hash
            -> .watch2                     label: "24" | "24ch" | "7.5"
            -> .infoyear                   "Episodes: 24 Year: 2025 Score: 8.6/10"
            -> .infotitle / .infotitlejp / .infotags a / .infoimg img
GATE      chrome.cookies.set({url:'https://animeheaven.me/', name:'key', value:hash})
          GET https://animeheaven.me/gate.php     (404 without the cookie)
            -> a containing "Download"     direct .mp4
            -> video source                fallback, 3 rotating mirrors
PROBE     GET {mp4}  Range: bytes=0-16383   ONE request only
            -> skip ftyp box, find avc1     width +28, height +30
            -> mvhd                         timescale + duration
            -> content-range                total size after the slash
STREAM    GET {mp4}  credentials:'omit'
WRITE     same as AnimePahe
```


*Generated 2026-08-24 · Kaze Downloader v2.1.0 · Built with too much coffee and one very patient tester.*
