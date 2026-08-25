# Kaze Build Order

## Completed

- Local Kaze Server with a Vercel control surface
- Portable runtime and engine bootstrap
- Local queue, progress events, history, and repair flow
- Versioned platform contract and capability model
- Video server protocol 2: `/inspect`, real format metadata, typed errors, format validation
- Video UI: Connect, Inspect, Choose format, Configure, Download

## Next

1. Extract AnimePahe behavior behind an anime source adapter contract.
2. Add episode-first source inspection with verified and sampled states.
3. Build the unified Kaze showcase and shared visual system.
4. Move user data outside replaceable server files and add capability/version checks.

## Acceptance Rule

Every new source or Kaze product must be addable by implementing a module adapter and capability document. Existing shared UI and queue behavior should not require provider-specific branches.
