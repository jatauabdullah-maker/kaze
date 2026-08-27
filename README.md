# Kaze

Media downloaders that show you what actually exists before writing a byte.
Real resolutions, real file sizes, real sources - then you choose. Everything
runs on your own machine; nothing is uploaded anywhere and there are no
accounts.

**Live:** [Hub](https://kaze-media-hub.vercel.app) · [Video grabber](https://kaze-downloader.vercel.app)

## What's here

| Directory | Product | Type |
|---|---|---|
| `anime/` | **Kaze Anime** - search AnimePahe, pick episodes, inspect what each release offers, batch download | Chrome extension (MV3) |
| `site/` | **Kaze Video** - paste any link, see real formats as pills, download to disk | Web UI + local server |
| `server/` | The local companion server for Kaze Video | Python + yt-dlp |
| `showcase/` | **Kaze Hub** - the front page for both products | Static site |

`anime/` and `site/` are independent - you can use either without the other.
They share a design system, and `anime/src/js/sources/registry.js` is the
adapter layer new sources plug into.

## Install

### Kaze Video

1. Open [kaze-downloader.vercel.app](https://kaze-downloader.vercel.app) and
   click **Check my PC**.
2. It won't find a server yet, so download the zip it offers
   ([or grab it directly](https://github.com/jatauabdullah-maker/kaze/releases/latest/download/Kaze-Server.zip)).
3. Unzip anywhere and run **`Kaze.bat`**.
4. Pick **1** once to install components, then **2** to start the server.
5. Back on the site, click **Check my PC** again.

First run downloads a portable Python, `yt-dlp`, and FFmpeg into `runtime/` and
`bin/` next to the bat. Nothing is installed system-wide and nothing touches
your PATH. Menu option **4** toggles always-on, which adds a Startup shortcut so
the server is already running next time you log in - then the site just works
without opening the menu at all.

### Kaze Anime

1. Download
   [Kaze-Anime.zip](https://github.com/jatauabdullah-maker/kaze/releases/latest/download/Kaze-Anime.zip)
   and unzip it.
2. Go to `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** and select the unzipped folder.
4. Click the Kaze icon in your toolbar.

No server needed - the extension does everything in the browser.

## How Kaze Video works

```
browser (hosted UI)  ->  http://127.0.0.1:8619  ->  yt-dlp  ->  your disk
```

The UI is static and hosted on Vercel; the server is on your machine. The site
pings loopback to find it, then streams live progress back over
Server-Sent Events. The hosted page never sees your files or your links - it
only talks to your own server.

Downloads land in `~/Downloads/KazeVideos`.

## Development

```powershell
# server
cd server
python -m py_compile server.py     # syntax check
python server.py                   # needs bin\yt-dlp.exe (run Kaze.bat option 1)

# any of the three frontends - they're static, no build step
cd site        # or showcase
python -m http.server 8080
```

The extension has no build step either. Edit files in `anime/` and hit reload
on `chrome://extensions`.

Load order in `anime/` matters and is not managed by a bundler:
`util → idb → confetti → pipeline → sources/animepahe → sources/registry → ui → app`.

After changing frontend CSS or JS, bump the `?v=` query on the `<link>` and
`<script>` tags in that directory's `index.html`, or browsers will serve stale
assets.

## Releasing

```powershell
Compress-Archive -Path server\Kaze.bat,server\server.py,server\kaze.ico -DestinationPath Kaze-Server.zip -Force
Compress-Archive -Path anime\* -DestinationPath Kaze-Anime.zip -Force
```

Attach both to a GitHub release. The download buttons point at
`releases/latest/download/`, so the filenames must stay exactly
`Kaze-Server.zip` and `Kaze-Anime.zip`.

## Security

The server binds loopback only and validates request origins on every
state-changing endpoint - loopback alone is not a security boundary, since any
page you visit can reach `127.0.0.1`. See [SECURITY.md](SECURITY.md) for the
threat model and how to report an issue.

## Legal

Kaze automates requests you could make by hand in a browser. It doesn't break
DRM and it doesn't host or redistribute anything. What you download, and whether
you have the right to, is on you - check the terms of the sites you point it at
and your local law.

[MIT licensed](LICENSE). Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp)
and [FFmpeg](https://ffmpeg.org), which carry their own licenses.
