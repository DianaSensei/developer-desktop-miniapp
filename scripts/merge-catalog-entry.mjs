// Each plugin now lives on its own branch (app/<id>/main) and releases
// independently — see main's README.md for why. build-release.mjs, run on
// a plugin branch, only ever sees ONE plugin directory, so its
// catalog.json output has exactly one entry. Overwriting the shared
// catalog.json on `main` with that would silently drop every other
// plugin's entry, so release.yml calls this instead: read main's current
// catalog.json, replace (or insert) only this plugin's entry, leave every
// other entry untouched.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [, , basePath, entryPath, outPath] = process.argv;
if (!basePath || !entryPath || !outPath) {
  throw new Error('usage: merge-catalog-entry.mjs <base-catalog.json> <this-plugin-catalog.json> <out.json>');
}

const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf-8')) : { plugins: [] };
const incoming = JSON.parse(readFileSync(entryPath, 'utf-8'));

const [entry] = incoming.plugins;
if (!entry) throw new Error(`Expected exactly one plugin entry in ${entryPath}, found ${incoming.plugins.length}`);

const plugins = (base.plugins ?? []).filter((p) => p.id !== entry.id);
plugins.push(entry);
plugins.sort((a, b) => a.id.localeCompare(b.id));

const merged = {
  // Top-level version/generatedAt are informational only (each plugin
  // entry carries its own real version) — just record when this file was
  // last touched and by which release.
  version: incoming.version,
  generatedAt: incoming.generatedAt,
  plugins,
};

writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`Merged ${entry.id}@${entry.version} into catalog.json (${plugins.length} plugin(s) total).`);
