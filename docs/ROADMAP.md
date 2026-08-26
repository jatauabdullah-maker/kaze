# Kaze Build Order

## Completed

- **Local Kaze Server** with a Vercel control surface (`server/`).
- **Portable runtime + engine bootstrap** (`Kaze.bat`: python + yt-dlp + ffmpeg, verified PE checks).
- **Video protocol 2** — `/inspect` returns real format metadata; typed errors; format validation.
- **Video UI** — Connect → Inspect (animated wind-scanner with SSE heartbeats) → choose format pills → download with smooth in-place queue bars + "Processing with FFmpeg…" state.
- **Anime extension** (`../kaze-downloader`, v2.2.0) — source-adapter layer with episode-first inspection, verified/partial/unverified states, self-healing work tabs.
- **Kaze Hub** — unified showcase at `kaze-media-hub.vercel.app` presenting both products.
- **Family design system** — shared aurora/wind background, tokens, type, and motion across all three surfaces.
- **Reliable startup** — bat uses direct `start` + curl-ping polling wait; no more "server did not start".

## Next

1. Move user data fully outside replaceable server files and add capability/version checks in the update path.
2. Wire poster thumbnails into the anime source adapter when a provider supports them.
3. Final cross-site QA pass (desktop + mobile) and encoding scan.

## Acceptance Rule

Every new source or Kaze product must be addable by implementing a module adapter + capability document. Existing shared UI and queue behavior should not require provider-specific branches.
