# Kaze Build Order

## Completed

- Local Kaze Server with a Vercel control surface
- Portable runtime and engine bootstrap
- Local queue, progress events, history, and repair flow
- Versioned platform contract and capability model
- Video server protocol 2: `/inspect`, real format metadata, typed errors, format validation
- Video UI: Connect, Inspect, Choose format, Configure, Download
- Anime extension source-adapter layer (`sources/animepahe.js`, `sources/registry.js`) with episode-first source inspection and verified/partial/unverified states (lives in `../kaze-downloader`, v2.2.0)

## Next

1. Build the unified Kaze showcase and shared visual system.
2. Move user data outside replaceable server files and add capability/version checks in the bat/site update path.
3. Wire poster thumbnails into the anime source adapter when a provider supports them.

## Acceptance Rule

Every new source or Kaze product must be addable by implementing a module adapter and capability document. Existing shared UI and queue behavior should not require provider-specific branches.
