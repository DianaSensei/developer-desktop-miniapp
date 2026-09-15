// Runs in CI (release.yml, `publish` job) after every plugin bundle and every
// sidecar binary has been built and downloaded into `downloaded/`. Computes
// SHA-256 for each artifact, fills in the manifest templates checked into
// each plugin's folder (manifest.plugin.json / manifest.service.json) with
// real version/URL/integrity, and writes everything CI needs to upload —
// renamed bundles, the filled manifests, and one aggregated catalog.json —
// into `release-assets/`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.TAG;
const version = tag.replace(/^v/, '');
if (!repo || !tag) throw new Error('GITHUB_REPOSITORY and TAG env vars are required');

const releaseUrl = (asset) => `https://github.com/${repo}/releases/download/${tag}/${asset}`;
const sha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');

mkdirSync('release-assets', { recursive: true });

// Discovered from disk, not hardcoded — any `plugins/<id>/manifest.plugin.json`
// is a plugin this script packages. `bin` (for the optional service half)
// comes from that plugin's own manifest.service.json, when it has one — a
// Tier-A-only plugin with no sidecar simply skips that half.
const PLUGINS = readdirSync('plugins')
  .filter((id) => existsSync(`plugins/${id}/manifest.plugin.json`))
  .map((id) => {
    const servicePath = `plugins/${id}/manifest.service.json`;
    const bin = existsSync(servicePath) ? JSON.parse(readFileSync(servicePath, 'utf-8')).bin : null;
    return { id, bin };
  });

// developer-desktop-utils's `current_target_triple()` (src-tauri/src/artifact_installer.rs)
// only ever produces these six — anything else in `downloaded/sidecars` is ignored.
const TARGET_TRIPLES = [
  'x86_64-apple-darwin', 'aarch64-apple-darwin',
  'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu',
];

const catalog = { version, generatedAt: new Date().toISOString(), plugins: [] };

for (const { id, bin } of PLUGINS) {
  const dir = `plugins/${id}`;

  // --- kind: "plugin" (webview bundle) ---
  const bundleAsset = `${id}-bundle.mjs`;
  copyFileSync(`downloaded/bundles/plugins/${id}/dist/bundle.mjs`, `release-assets/${bundleAsset}`);
  const pluginManifest = JSON.parse(readFileSync(`${dir}/manifest.plugin.json`, 'utf-8'));
  pluginManifest.version = version;
  pluginManifest.entry = releaseUrl(bundleAsset);
  pluginManifest.integrity = sha256(`release-assets/${bundleAsset}`);
  const pluginManifestAsset = `${id}-plugin.manifest.json`;
  writeFileSync(`release-assets/${pluginManifestAsset}`, JSON.stringify(pluginManifest, null, 2));

  // --- kind: "service" (sidecar binary), one target per file found — only
  // when this plugin has one (Tier-A-only plugins don't). ---
  let serviceManifestUrl = null;
  let targets = [];
  if (bin) {
    const serviceManifest = JSON.parse(readFileSync(`${dir}/manifest.service.json`, 'utf-8'));
    serviceManifest.version = version;
    serviceManifest.targets = {};
    for (const triple of TARGET_TRIPLES) {
      const ext = triple.includes('windows') ? '.exe' : '';
      const srcName = `${bin}-${triple}${ext}`;
      const srcPath = `downloaded/sidecars/${srcName}`;
      try {
        readFileSync(srcPath);
      } catch {
        continue; // this release's matrix doesn't build every triple — see release.yml
      }
      copyFileSync(srcPath, `release-assets/${srcName}`);
      serviceManifest.targets[triple] = { url: releaseUrl(srcName), sha256: sha256(srcPath) };
    }
    const serviceManifestAsset = `${id}-service.manifest.json`;
    writeFileSync(`release-assets/${serviceManifestAsset}`, JSON.stringify(serviceManifest, null, 2));
    serviceManifestUrl = releaseUrl(serviceManifestAsset);
    targets = Object.keys(serviceManifest.targets);
  }

  catalog.plugins.push({
    id,
    label: pluginManifest.label,
    description: pluginManifest.description,
    icon: pluginManifest.icon,
    keywords: pluginManifest.keywords,
    version,
    pluginManifestUrl: releaseUrl(pluginManifestAsset),
    serviceManifestUrl,
    targets,
  });
}

writeFileSync('release-assets/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`Staged ${readdirSync('release-assets').length} release assets.`);
