# Kaze Platform Contract

Kaze is a product family, not a single downloader. All surfaces share one workflow idea and one visual language. This contract keeps them coherent so any agent can build on or maintain any surface.

## Product Modules

| Module | Surface | Primary workflow |
|---|---|---|
| `hub` | Public web (showcase) | Discover Kaze products, setup, help |
| `anime` | Chrome extension (`../kaze-downloader`) | Search, choose episodes, inspect sources, download |
| `video` | Vercel UI + local server (this repo `site/` + `server/`) | Connect, inspect URL, choose format, download |

## Shared Workflow

```text
connect -> inspect -> configure -> download -> history
```

Anime adds a provider prefix:

```text
search -> select title -> select episodes -> inspect sources -> configure -> download
```

Providers may add capabilities but must not change the meaning of these stages.

## Capability Model

Providers expose capabilities; the UI renders only what's supported.

```json
{
  "module": "video",
  "provider": "yt-dlp",
  "protocol": 2,
  "capabilities": {
    "inspect": true, "formats": true, "audio": true, "subtitles": true,
    "thumbnails": true, "metadata": true, "playlists": true,
    "sponsorblock": true, "history": true, "updates": true
  }
}
```

Anime adapters use the same idea (`search`, `episodes`, `sourceInspection`, `quality`, `fansubGroups`, `dub`, `subtitles`).

## Versioning Rules

- `protocol` is an integer; changes only when a request/response contract changes.
- Additive fields are backward-compatible.
- The client must check `protocol` and capabilities before enabling actions.
- The server must return typed errors, not provider terminal output.
- User data (history, settings, logs) lives outside replaceable binaries.

## Error Contract

```json
{
  "ok": false,
  "error": { "code": "VIDEO_UNAVAILABLE", "message": "This video is unavailable or removed.", "retryable": false, "action": "edit_url" }
}
```

Recommended codes: `INVALID_URL`, `UNSUPPORTED_SOURCE`, `AUTH_REQUIRED`, `VIDEO_UNAVAILABLE`, `RATE_LIMITED`, `INSPECTION_TIMEOUT`, `FORMAT_UNAVAILABLE`, `SERVER_OFFLINE`, `PROTOCOL_MISMATCH`, `ENGINE_UPDATE_REQUIRED`.

## Design Contract (shared family look)

- Dark `#0a0b0f`; surface `#14161f`; text `#eceef4`; muted `#9aa1b1`.
- Accent gradient `#8b7cf8 → #4cc3f0`; success `#3fd68a`; warn `#f0b64f`; error `#f27474`.
- Animated aurora blobs + wind streaks on a fixed `.bg` layer.
- Space Grotesk display + Inter body (system fallbacks in the extension).
- Motion eases `cubic-bezier(.22,1,.36,1)`; respect `prefers-reduced-motion`.

## Upgrade Boundary

The local server package is replaceable. These must survive upgrades:

```text
user-data/history.json
user-data/settings.json
logs/
runtime/
bin/
```

An update may replace server code and engines but must never delete user data.
