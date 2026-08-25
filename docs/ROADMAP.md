# Kaze Build Order

## Completed

- Local Kaze Server with a Vercel control surface
- Portable runtime and engine bootstrap
- Local queue, progress events, history, and repair flow
- Versioned platform contract and capability model

## Next

1. Add `/inspect` and normalized format metadata to the local video server.
2. Change the video UI from direct Grab to Inspect, Configure, Download.
3. Extract AnimePahe behavior behind an anime source adapter contract.
4. Add episode-first source inspection with verified and sampled states.
5. Build the unified Kaze showcase and shared visual system.
6. Move user data outside replaceable server files and add capability/version checks.

## Acceptance Rule

Every new source or Kaze product must be addable by implementing a module adapter and capability document. Existing shared UI and queue behavior should not require provider-specific branches.
