# DevTool plugins

Optional plugins for [DevTool](https://github.com/DianaSensei/developer-desktop-utils),
installable at runtime (Settings → Extensions → paste a manifest URL) instead
of being compiled into the main app. They moved here because not every
DevTool user needs a Redis client, a RabbitMQ client, or a Docker/container
manager — see `docs/decisions/architecture/platform-plugin-architecture.md`
in the main repo for the full reasoning.

## What's here

| Plugin | UI (webview bundle) | Sidecar (native binary) |
|---|---|---|
| `redis-client` | `plugins/redis-client/` | `devtool-svc-redis` |
| `rabbit-client` | `plugins/rabbit-client/` | `devtool-svc-rabbit` |
| `container-manager` | `plugins/container-manager/` | `devtool-svc-container` |

Each plugin folder has:
- `ui/` — the plugin's React components, copied from the main app's
  `src/components/tools/<name>/` at the point it moved out.
- `entry.tsx` — the single default-export wrapper Vite builds into
  `dist/bundle.mjs` (the format `kind: "plugin"` manifests require — see
  developer-desktop-utils's `docs/plugin-sdk/05-external-install.md`).
- `sidecar/` — a standalone Rust binary crate (`devtool-svc-*`), speaking the
  same JSONL-over-stdio protocol as any other Tier-B DevTool sidecar.
- `manifest.plugin.json` / `manifest.service.json` — templates. CI
  (`.github/workflows/release.yml`) fills in `version`/`entry`/`integrity` (or
  `targets`) and publishes the filled versions as GitHub Release assets.

`shared/` holds a **vendored, trimmed copy** of the app's shadcn/ui kit and a
few `src/lib/*` utilities — just the pieces these three plugins actually use.
It's a deliberate duplication, not a shared package: an externally-installed
plugin bundle can't import the app's own `src/components/ui/*` (only
`react`/`react-dom`/`react/jsx-runtime` are shared, via
`window.__DEVTOOL_VENDOR__` — see `shared/vendor.d.ts` and
`shared/platform.ts`). If you add a new plugin here that needs another
primitive, vendor the specific file (and whatever it imports) rather than
inflating the app's own design-system re-export surface — see the comment at
the top of `shared/design-system/index.ts`.

## Building locally

```bash
npm install
npm run build            # all three bundles -> plugins/*/dist/bundle.mjs
npm run typecheck
npm test
```

Sidecars build with plain `cargo build --release` inside each
`plugins/<id>/sidecar/` directory — they're independent crates, not a
workspace, so each can be cross-compiled/released on its own schedule if
that's ever needed.

## Releasing

Push a tag (`vX.Y.Z`). `.github/workflows/release.yml` builds every bundle,
cross-builds every sidecar for the target triples DevTool's installer
understands, computes SHA-256 for each artifact, fills in the manifest
templates, and publishes everything — plus one aggregated `catalog.json` —
as assets on a GitHub Release. The site's plugin list
(developer-desktop-utils' companion site) reads
`releases/latest/download/catalog.json`.

## Installing a plugin

In DevTool: **Settings → Extensions**, paste the plugin's manifest URL (from
`catalog.json`'s `pluginManifestUrl`), install, then do the same with
`serviceManifestUrl` for its sidecar, and restart the app.
