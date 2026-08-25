# Kaze — web + server

Premium UI (Vercel) + local companion server (yt-dlp). Downloads run 100% on the user's PC.

The long-term platform contract lives in [`docs/PLATFORM.md`](docs/PLATFORM.md). Product modules and source adapters must use its capability and versioning rules.

```
kaze-web/
├─ site/          ← deploy this folder to Vercel (static, no build step)
│   ├─ index.html
│   ├─ styles.css
│   └─ app.js
└─ server/        ← zipped and attached to GitHub Releases as Kaze-Server.zip
    ├─ Kaze.bat   ← user-facing menu: install / start / autostart / off
    └─ server.py  ← stdlib-only Python, port 8619
```

## Product family

Kaze is intended to grow beyond this first video surface. The planned modules are the public showcase, the Anime Chrome extension, and the local video grabber. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the build order.

## How it fits together

1. User visits the Vercel site → clicks **Check my PC**.
2. Site pings `http://127.0.0.1:8619/ping`.
3. Not running → welcome wizard (download zip → run `Kaze.bat` → option 1 → option 2 → re-check).
4. Running → dashboard opens, live progress over SSE from localhost.

The bat downloads on first init: portable Python 3.12 embeddable (`runtime\`), latest `yt-dlp.exe`, FFmpeg essentials (`bin\`). Option 3 registers a logon Scheduled Task; option 4 stops the server and removes it.

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
(localhost origins are CORS-allowed by the server).

## Ship checklist

1. Replace `YOUR_USERNAME` in `site/app.js` (`ZIP_URL`) with the real GitHub repo.
2. Build the zip (from repo root):
   ```powershell
   Compress-Archive -Path server\Kaze.bat,server\server.py -DestinationPath Kaze-Server.zip -Force
   ```
3. GitHub: create repo `kaze-web`, push, then **Releases → New release** → attach `Kaze-Server.zip`.
4. Vercel: import the repo → **Root Directory = `site`** → Framework Preset: Other → Deploy.
5. Set project name to `kaze-downloader` so the domain matches `SITE_URL` in both `site/app.js` (CORS allow-list) and `server/server.py`.

## Security notes

- Server binds `127.0.0.1` only; CORS allows the Vercel origin + any localhost page.
- POST endpoints require `Content-Type: application/json` (forces preflight, so foreign sites can't hit it).
- Sends `Access-Control-Allow-Private-Network: true` for Chrome's PNA preflight.

## Known v1 limits

- One yt-dlp process per submitted URL; playlists handled inside one process unless "Full playlist" off (`--no-playlist`).
- History is a local JSON file (max 300 entries); delete removes entry, optionally file with `?file=1` (UI uses entry-only for now).
