# Kaze — the local-first download family

**Kaze** is a family of download tools that all share one belief: **inspect first, download second**. Every tool shows you what actually exists — real resolutions, real sizes, real sources — before a single byte is written. Everything runs on *your* machine. Nothing is uploaded anywhere.

| Product | Type | Where it lives | What it does |
|---|---|---|---|
| **Kaze Anime** | Chrome extension | `../kaze-downloader` | Search anime, pick episodes, inspect what each release actually offers, batch-download into any folder. |
| **Kaze Video** | Web app + local server | this repo → `site/` | Paste a link, see real formats as pills, download straight to disk via a local companion server. |
| **Kaze Hub** | Brand showcase | this repo → `showcase/` | The public front door that presents the family. |

> Live: [Video grabber](https://kaze-downloader.vercel.app) · [Hub](https://kaze-media-hub.vercel.app)

---

## This repository (`kaze-web`)

Premium UI (Vercel) + a local companion server (yt-dlp). Downloads run **100% on the user's PC**.

```
kaze-web/
├─ showcase/   ← brand hub (Vercel project `kaze-media-hub`)
│   ├─ index.html · styles.css · app.js
├─ site/       ← the video grabber (Vercel project `kaze-downloader`)
│   ├─ index.html · styles.css · app.js
└─ server/     ← zipped and attached to GitHub Releases as Kaze-Server.zip
    ├─ Kaze.bat   ← user-facing menu: initialize / start / stop
    └─ server.py  ← stdlib-only Python, port 8619
```

### How the video grabber fits together

1. User visits the Vercel site → clicks **Check my PC**.
2. Site pings `http://127.0.0.1:8619/ping`.
3. Not running → welcome wizard (download zip → run `Kaze.bat` → option 1 → option 2 → re-check).
4. Running → dashboard opens, live progress over SSE from localhost.

The bat installs on first init: portable Python 3.12 embeddable (`runtime\`), latest `yt-dlp.exe`, FFmpeg essentials (`bin\`).

### Design language

All three surfaces share one design system:

- Dark (`#0a0b0f`) with violet→cyan gradient accents (`#8b7cf8 → #4cc3f0`)
- Animated **aurora blobs + wind streaks** background (Kaze = wind)
- Space Grotesk display type + Inter UI type
- Scroll-reveal animations, button sheens, pill-shaped interactive elements
- Motion respects `prefers-reduced-motion`

---

## Local dev / test

```powershell
cd server
python -m py_compile server.py      # syntax check
python server.py                    # needs bin\yt-dlp.exe to exist
```

Then open `site/index.html` in a browser — or serve it:

```powershell
cd ..\site; python -m http.server 8080
```

## Ship checklist

1. `ZIP_URL` in `site/app.js` must point at the real GitHub release asset.
2. Build the zip (from repo root):
   ```powershell
   Compress-Archive -Path server\Kaze.bat,server\server.py -DestinationPath Kaze-Server.zip -Force
   ```
3. GitHub: push to `main`, then attach `Kaze-Server.zip` to a release.
4. Vercel: import the repo → Root Directory = `site` → project `kaze-downloader` → Deploy.
5. Showcase: Root Directory = `showcase` → project `kaze-media-hub` → Deploy.

> After any UI change, **bump the `?v=` query on the CSS/JS links** in `index.html` so browsers don't serve stale assets.

## Security notes

- Server binds `127.0.0.1` only; CORS allows the Vercel origin + any localhost page.
- POST endpoints require `Content-Type: application/json` (forces preflight, so foreign sites can't hit it).
- Sends `Access-Control-Allow-Private-Network: true` for Chrome's PNA preflight.
- `Kaze.bat` uses `start "KazeServer" /min "%PY%" server.py` + a polling wait loop (curl ping) so startup is reliable.
