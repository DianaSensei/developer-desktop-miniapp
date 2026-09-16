# DevTool plugins — skeleton (`main`)

Optional plugins for [DevTool](https://github.com/DianaSensei/developer-desktop-utils),
installable at runtime (Settings → Extensions → paste a manifest URL) instead
of being compiled into the main app — see
`docs/decisions/architecture/platform-plugin-architecture.md` in the main
repo for the full reasoning.

## Branch layout

**This branch (`main`) has no plugin code.** It's the skeleton every plugin
branch builds on top of:

- `shared/` — a **vendored, trimmed copy** of the app's shadcn/ui kit and a
  few `src/lib/*` utilities. It's a deliberate duplication, not a shared
  package: an externally-installed plugin bundle can't import the app's own
  `src/components/ui/*` (only `react`/`react-dom`/`react/jsx-runtime` are
  shared, via `window.__DEVTOOL_VENDOR__` — see `shared/vendor.d.ts` and
  `shared/platform.ts`).
- `scripts/makePluginConfig.mjs` — the shared Vite config factory every
  plugin's `vite.config.ts` calls into.
- root `package.json`/`tsconfig.json`/`vitest.config.ts` — the toolchain
  versions and lint/type rules every plugin branch starts from.
- `catalog.json` — the aggregated, install-ready plugin list. Read by
  starlight-site's `/plugins` page via
  `raw.githubusercontent.com/.../main/catalog.json` (release-asset storage
  doesn't send CORS headers, so it has to be a committed file, not a release
  asset). **Nothing on `main` writes this file** — each plugin branch's own
  release updates only its own entry when it ships (see below), so this
  stays live without `main` ever needing a release of its own.

Each actual plugin lives on its own long-lived branch, **`app/<id>/main`**
(currently `app/redis-client/main`, `app/rabbit-client/main`,
`app/container-manager/main`, `app/kafka-explorer/main`), forked from this
skeleton. A plugin branch has:

- `plugins/<id>/` — that plugin's `ui/`, `entry.tsx`, `manifest.*.json`
  templates, and (if it has a sidecar) `sidecar/` — same layout as before,
  just one plugin per branch instead of all of them in one tree.
- Its own `package.json`/`ci.yml`/`release.yml`, trimmed to build/test/release
  only that one plugin.
- `scripts/merge-catalog-entry.mjs` — used by that branch's `release.yml` to
  update just its own entry in `main`'s `catalog.json` on release, without
  touching any other plugin's entry.

**Why branches instead of one monorepo tree:** the previous single-tree
design meant one plugin's broken build failed CI/release for every plugin at
once (a single `npm run build` chain and a single bash loop over every
sidecar, `set -e`'d together), and every release stamped every plugin with
the same repo-wide tag whether or not it had actually changed. Splitting
each plugin onto its own branch with its own CI/release/tag gives each one
real fault isolation and independent versioning — and a real place to
attach separate push permissions later, if that's ever needed, since GitHub
branch protection is per-branch.

To pull skeleton updates (a `shared/` fix, a toolchain bump) into a plugin
branch: `git fetch origin main && git merge origin/main` on that plugin
branch, same as merging any upstream change.

## Adding a new plugin

1. `git checkout -b app/<new-id>/main main`
2. Build out `plugins/<new-id>/` (copy the shape of an existing plugin
   branch: `ui/`, `entry.tsx`, `manifest.plugin.json`, `manifest.service.json`
   if it has a sidecar, `vite.config.ts` via `makePluginConfig`).
3. Copy that existing branch's `ci.yml`/`release.yml`/`package.json`
   `build`/`test` scripts and swap the plugin id.
4. Add `dependabot.yml` entries for the new branch in **this** branch
   (`main`) — Dependabot only ever reads `.github/dependabot.yml` from the
   repo's default branch, using each entry's `target-branch` to reach the
   others.
5. Push a `<new-id>-vX.Y.Z` tag to trigger its first release.

## Installing a plugin

In DevTool: **Settings → Extensions**, paste the plugin's manifest URL (from
`catalog.json`'s `pluginManifestUrl`), install, then do the same with
`serviceManifestUrl` for its sidecar, and restart the app.
