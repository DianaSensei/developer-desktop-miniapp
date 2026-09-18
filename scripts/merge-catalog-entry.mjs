// Each plugin now lives on its own branch (app/<id>/main) and releases
// independently — see main's README.md for why. build-release.mjs, run on
// a plugin branch, only ever sees ONE plugin directory, so its
// catalog.json output has exactly one entry. Overwriting the shared
// catalog.json on `main` with that would silently drop every other
// plugin's entry, so release.yml calls this instead: read main's current
// catalog.json, replace (or insert) only this plugin's entry, leave every
// other entry untouched.
//
// Beta releases (build-release.mjs's `isBeta`) complicate "replace this
// plugin's entry": their entry carries ONLY a `beta` sub-object, no root
// version/pluginManifestUrl — publishing it standalone would either wipe
// out the existing STABLE entry (plain replace) or, if this is the
// plugin's first release ever, produce an entry developer-desktop-utils'
// `toMarketPlugin` rejects outright (it requires root fields to accept an
// entry at all — see market.ts). So a beta entry is GRAFTED onto whatever
// existing entry is already there instead of replacing it wholesale, and
// requires that entry to already exist.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [, , basePath, entryPath, outPath] = process.argv;
if (!basePath || !entryPath || !outPath) {
  throw new Error('usage: merge-catalog-entry.mjs <base-catalog.json> <this-plugin-catalog.json> <out.json>');
}

const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf-8')) : { plugins: [] };
const incoming = JSON.parse(readFileSync(entryPath, 'utf-8'));

const [entry] = incoming.plugins;
if (!entry) throw new Error(`Expected exactly one plugin entry in ${entryPath}, found ${incoming.plugins.length}`);

const existing = (base.plugins ?? []).find((p) => p.id === entry.id);

// `entry.version` at the ROOT is how a stable entry is told apart from a
// beta-only one (build-release.mjs never sets it for a beta release —
// see its own comment). A beta release grafts `entry.beta` onto the
// existing entry, keeping every existing root field (including a
// DIFFERENT existing `.beta`, if this plugin somehow published one before
// without ever going stable again — shouldn't happen, but grafting only
// touches `.beta`, never clobbers root fields either way). A stable
// release replaces the root fields but preserves whatever `.beta` was
// already there — a stable release must never silently erase an
// already-published beta option.
let mergedEntry;
if (entry.version === undefined) {
  if (!existing) {
    throw new Error(
      `"${entry.id}" has no existing stable entry in the catalog — a beta release needs a stable ` +
        `release to graft onto (developer-desktop-utils' market.ts requires root version/` +
        `pluginManifestUrl on every catalog entry, which a beta-only entry never has). Publish a ` +
        `stable release for "${entry.id}" first.`,
    );
  }
  mergedEntry = { ...existing, beta: entry.beta };
} else {
  mergedEntry = { ...entry, beta: existing?.beta };
}

const plugins = (base.plugins ?? []).filter((p) => p.id !== entry.id);
plugins.push(mergedEntry);
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
const loggedVersion = entry.version === undefined ? `beta ${entry.beta.version}` : entry.version;
console.log(`Merged ${entry.id}@${loggedVersion} into catalog.json (${plugins.length} plugin(s) total).`);
