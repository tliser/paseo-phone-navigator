# Phone Navigator for Paseo

Host → Project → Workspace tree for Paseo, built for the iOS app. See [OVERVIEW.md](OVERVIEW.md) for what it does.

## Install

```bash
# local checkout (development)
paseo plugin install /home/liser/diesdas
# after pushing to a Git host
paseo plugin install git:<owner>/<repo>
paseo plugin ls                       # phone-navigator should be "running"
paseo plugin logs phone-navigator     # "Plugin ready"
```

After code changes in a local install: `paseo plugin reload phone-navigator`.

## Development

```bash
npm install
npm run typecheck
npm test
```

Layout:

- `shared/`: pure logic with tests. `tree.ts` builds, sorts and filters the flattened tree, `profiles.ts` handles profiles, resolution and the collapse map, `derive.ts` turns daemon payloads into rows, `format.ts` shortens model names and formats times.
- `client/host-observer.ts`: follows one host (paged snapshot, buffered live updates, reconnect-safe).
- `client/store.ts`: one store for every surface. It watches all online hosts and persists profiles and collapse state.
- `client/device.ts`: the only file that touches `localStorage` (web and desktop only).
- `client/paseo.ts`: SDK types derived from `getPaseoClient`, so a Git install compiles without dev dependencies.
- `mockups/index.html`: the clickable design mockup.

No classes anywhere, because the iOS app runs plugins on Hermes.
