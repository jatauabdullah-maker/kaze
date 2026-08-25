# Kaze Platform Contract

Kaze is a product family, not a single downloader. Product surfaces must depend on shared contracts and capabilities rather than provider-specific UI assumptions.

## Product Modules

| Module | Surface | Primary workflow |
|---|---|---|
| `showcase` | Public web | Discover Kaze products, setup, help |
| `anime` | Chrome extension | Search, choose episodes, inspect sources, download |
| `video` | Vercel UI + local server | Connect, inspect URL, choose format, download |

Each module owns its domain behavior. Shared UI owns navigation, status, settings, history, errors, and update messaging.

## Stable Workflow Contracts

The shared workflow vocabulary is:

```text
connect -> inspect -> configure -> download -> history
```

Anime uses a provider-specific prefix before the common configuration flow:

```text
search -> select title -> select episodes -> inspect sources -> configure -> download
```

Providers may add capabilities, but they must not change the meaning of these stages.

## Capability Model

Every provider or local-server implementation should expose capabilities. The UI renders only controls supported by the active capability set.

```json
{
  "module": "video",
  "provider": "yt-dlp",
  "protocol": 2,
  "capabilities": {
    "inspect": true,
    "formats": true,
    "audio": true,
    "subtitles": true,
    "thumbnails": true,
    "metadata": true,
    "playlists": true,
    "sponsorblock": true,
    "history": true,
    "updates": true
  }
}
```

Anime source adapters use the same idea:

```json
{
  "provider": "animepahe",
  "capabilities": {
    "search": true,
    "episodes": true,
    "sourceInspection": true,
    "quality": true,
    "fansubGroups": true,
    "dub": true,
    "subtitles": true
  }
}
```

## Versioning Rules

- `protocol` is an integer and changes only when a request or response contract changes.
- Additive response fields are backward-compatible.
- Removing or changing the meaning of a field requires a protocol increment.
- The client must check `protocol` and capabilities before enabling actions.
- The server must return typed errors, not provider-specific terminal output.
- User data such as history, settings, and logs must live outside replaceable application binaries.

## Error Contract

All product APIs should use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "VIDEO_UNAVAILABLE",
    "message": "This video is unavailable or removed.",
    "retryable": false,
    "action": "edit_url"
  }
}
```

Recommended codes include `INVALID_URL`, `UNSUPPORTED_SOURCE`, `AUTH_REQUIRED`, `VIDEO_UNAVAILABLE`, `RATE_LIMITED`, `INSPECTION_TIMEOUT`, `FORMAT_UNAVAILABLE`, `SERVER_OFFLINE`, `PROTOCOL_MISMATCH`, and `ENGINE_UPDATE_REQUIRED`.

## Source Adapter Boundary

An anime provider adapter should expose normalized operations:

```text
search(query)
getEpisodes(titleId)
inspectSources(episodes)
resolveDownload(source, episode)
```

The adapter may use AnimePahe-specific selectors, cookies, or challenge handling internally. Those details must not leak into the UI or shared queue.

## Upgrade Boundary

The local server package is replaceable. The following data must survive upgrades:

```text
user-data/history.json
user-data/settings.json
logs/
runtime/
bin/
```

An update may replace server code and download engines, but it must not delete user data. The UI should display the installed server protocol, version, and capabilities before offering downloads.
