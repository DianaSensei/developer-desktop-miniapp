// Runs in CI (release.yml, `publish` job) after every plugin bundle and every
// sidecar binary has been built and downloaded into `downloaded/`. Computes
// SHA-256 for each artifact, fills in the manifest templates checked into
// each plugin's folder (manifest.plugin.json / manifest.service.json) with
// real version/URL/integrity, and writes everything CI needs to upload —
// renamed bundles, the filled manifests, and one aggregated catalog.json —
// into `release-assets/`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.TAG;
const version = tag.replace(/^v/, '');
if (!repo || !tag) throw new Error('GITHUB_REPOSITORY and TAG env vars are required');

const releaseUrl = (asset) => `https://github.com/${repo}/releases/download/${tag}/${asset}`;
const sha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');

mkdirSync('release-assets', { recursive: true });

const PLUGINS = [
  { id: 'redis-client', bin: 'devtool-svc-redis' },
  { id: 'rabbit-client', bin: 'devtool-svc-rabbit' },
  { id: 'container-manager', bin: 'devtool-svc-container' },
];

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

  // --- kind: "service" (sidecar binary), one target per file found ---
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

  catalog.plugins.push({
    id,
    label: pluginManifest.label,
    description: pluginManifest.description,
    icon: pluginManifest.icon,
    keywords: pluginManifest.keywords,
    version,
    pluginManifestUrl: releaseUrl(pluginManifestAsset),
    serviceManifestUrl: releaseUrl(serviceManifestAsset),
    targets: Object.keys(serviceManifest.targets),
  });
}

writeFileSync('release-assets/catalog.json', JSON.stringify(catalog, null, 2));
console.log(`Staged ${readdirSync('release-assets').length} release assets.`);
