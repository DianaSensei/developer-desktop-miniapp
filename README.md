# DevTool plugin: kafka-explorer

Optional plugin for [DevTool](https://github.com/DianaSensei/developer-desktop-utils),
installable at runtime (Settings → Extensions → paste a manifest URL) instead
of being compiled into the main app. Forked from the `devtool-plugins`
skeleton (`main` branch) — see that branch's README.md for the overall
branch layout and why plugins live on their own branch each.

- `plugins/kafka-explorer/ui/` — the plugin's React components.
- `plugins/kafka-explorer/entry.tsx` — the single default-export wrapper
  Vite builds into `dist/bundle.mjs` (the format `kind: "plugin"` manifests
  require — see developer-desktop-utils's `docs/plugin-sdk/05-external-install.md`).
- `plugins/kafka-explorer/sidecar/` — a standalone Rust binary crate
  (`devtool-svc-kafka`), speaking the same JSONL-over-stdio protocol as any
  other Tier-B DevTool sidecar.
- `plugins/kafka-explorer/manifest.plugin.json` / `manifest.service.json` —
  templates. CI (`.github/workflows/release.yml`) fills in
  `version`/`entry`/`integrity` (or `targets`) and publishes the filled
  versions as GitHub Release assets.
- `plugins/kafka-explorer/testing/` — docker-compose fixtures and
  producer/consumer scripts for manual testing against a real Kafka broker.
- `shared/` — vendored from `main`; pull skeleton updates with
  `git fetch origin main && git merge origin/main`.

## Building locally

```bash
npm install
npm run build            # -> plugins/kafka-explorer/dist/bundle.mjs
npm run typecheck
npm test
```

## Releasing

Push a tag matching `kafka-explorer-vX.Y.Z`. `.github/workflows/release.yml`
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
