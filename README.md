# DevTool plugin: rabbit-client

Optional plugin for [DevTool](https://github.com/DianaSensei/developer-desktop-utils),
installable at runtime (Settings → Extensions → paste a manifest URL) instead
of being compiled into the main app. Forked from the `devtool-plugins`
skeleton (`main` branch) — see that branch's README.md for the overall
branch layout and why plugins live on their own branch each.

- `plugins/rabbit-client/ui/` — the plugin's React components.
- `plugins/rabbit-client/entry.tsx` — the single default-export wrapper Vite
  builds into `dist/bundle.mjs` (the format `kind: "plugin"` manifests
  require — see developer-desktop-utils's `docs/plugin-sdk/05-external-install.md`).
- `plugins/rabbit-client/sidecar/` — a standalone Rust binary crate
  (`devtool-svc-rabbit`), speaking the same JSONL-over-stdio protocol as any
  other Tier-B DevTool sidecar.
- `plugins/rabbit-client/manifest.plugin.json` / `manifest.service.json` —
  templates. CI (`.github/workflows/release.yml`) fills in
  `version`/`entry`/`integrity` (or `targets`) and publishes the filled
  versions as GitHub Release assets.
- `plugins/rabbit-client/testing/` — docker-compose fixtures and
  producer/consumer/RPC scripts for manual testing against a real
  RabbitMQ broker.
- `shared/` — vendored from `main`; pull skeleton updates with
  `git fetch origin main && git merge origin/main`.

## Building locally

```bash
npm install
npm run build            # -> plugins/rabbit-client/dist/bundle.mjs
npm run typecheck
npm test
```

## Releasing

Push a tag matching `rabbit-client-vX.Y.Z`. `.github/workflows/release.yml`
builds the bundle, cross-builds the sidecar for every target triple
DevTool's installer understands, computes SHA-256 for each artifact, fills
in the manifest templates, publishes everything as a GitHub Release, and
merges this plugin's entry into the aggregated `catalog.json` on `main`
(without touching any other plugin's entry there). The site's plugin list
reads that file from `main` directly.

## Installing this plugin

In DevTool: **Settings → Extensions**, paste the manifest URL (from
`catalog.json`'s `pluginManifestUrl` on `main`), install, then do the same
with `serviceManifestUrl` for its sidecar, and restart the app.
