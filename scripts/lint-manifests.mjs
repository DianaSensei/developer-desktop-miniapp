// Validates the manifest TEMPLATES checked into each plugin's folder
// (manifest.plugin.json / manifest.service.json) — not the filled-in ones
// release.yml generates at tag time. Catches the class of mistake that only
// otherwise surfaces as a rejected install in the app days later: a typo'd
// `kind`, a `service.bin` that doesn't match the folder's sidecar name, a
// method list that's empty (silently means "no service permission" to
// validateManifest() on the app side), or a manifest.json that doesn't even
// parse.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PLUGINS_DIR = 'plugins';
let failed = false;

function fail(msg) {
  console.error(`✗ ${msg}`);
  failed = true;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(`${path}: invalid JSON (${e.message})`);
    return null;
  }
}

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

for (const id of readdirSync(PLUGINS_DIR)) {
  const dir = join(PLUGINS_DIR, id);

  const pluginManifest = readJson(join(dir, 'manifest.plugin.json'));
  if (pluginManifest) {
    if (pluginManifest.kind !== 'plugin') fail(`${id}: manifest.plugin.json kind must be "plugin"`);
    if (pluginManifest.id !== id) fail(`${id}: manifest.plugin.json id "${pluginManifest.id}" != folder name`);
    for (const field of ['sdk', 'label', 'description', 'icon', 'route', 'permissions']) {
      if (pluginManifest[field] === undefined) fail(`${id}: manifest.plugin.json missing "${field}"`);
    }
    if (!pluginManifest.route?.startsWith('/')) fail(`${id}: manifest.plugin.json route must be absolute`);
    const hasServicePerm = pluginManifest.permissions?.includes('service') ?? false;
    const hasServiceField = pluginManifest.service !== undefined;
    if (hasServicePerm !== hasServiceField) {
      fail(`${id}: manifest.plugin.json "service" permission and "service" field must both be present or both absent (validateManifest() on the app side rejects a mismatch)`);
    }
    if (hasServiceField) {
      if (!KEBAB.test(pluginManifest.service.bin)) fail(`${id}: service.bin "${pluginManifest.service.bin}" must be kebab-case`);
      if (!Array.isArray(pluginManifest.service.methods) || pluginManifest.service.methods.length === 0) {
        fail(`${id}: service.methods must be a non-empty array`);
      }
    }
    const hasNativePerm = pluginManifest.permissions?.includes('native') ?? false;
    const hasCommands = (pluginManifest.commands?.length ?? 0) > 0;
    if (hasNativePerm !== hasCommands) {
      fail(`${id}: "native" permission and a non-empty "commands" list must both be present or both absent`);
    }
  }

  const serviceManifest = readJson(join(dir, 'manifest.service.json'));
  if (serviceManifest) {
    if (serviceManifest.kind !== 'service') fail(`${id}: manifest.service.json kind must be "service"`);
    if (!KEBAB.test(serviceManifest.bin)) fail(`${id}: manifest.service.json bin "${serviceManifest.bin}" must be kebab-case`);
    if (pluginManifest?.service && pluginManifest.service.bin !== serviceManifest.bin) {
      fail(`${id}: manifest.plugin.json service.bin "${pluginManifest.service.bin}" != manifest.service.json bin "${serviceManifest.bin}"`);
    }
    if (typeof serviceManifest.protocol !== 'number') fail(`${id}: manifest.service.json protocol must be a number`);
  }
}

if (failed) {
  console.error('\nManifest lint failed.');
  process.exit(1);
}
console.log('Manifest lint passed.');
