#!/usr/bin/env node
// Bootstraps a new plugin end to end: run this FROM `main`, with a clean
// working tree. It creates `app/<id>/main`, scaffolds plugins/<id>/ (entry,
// ui/, manifest templates, sidecar/ if --sidecar), points package.json/
// tsconfig.json/vitest.config.ts/ci.yml/release.yml at this plugin, commits
// that on the new branch, runs the same verify steps CI runs (reporting —
// not blocking — failures, since a fresh plugin has 0 tests and a
// placeholder UI), then switches to `main`, adds this plugin's dependabot.yml
// entries there (target-branch), and commits that too. It leaves you
// checked out on the new plugin branch with both commits made locally —
// review, then push both yourself (printed at the end): nothing here pushes
// or tags on its own.
//
// Interactive (like `npm create`/`cargo generate`): run with no args and it
// prompts for whatever's missing. Or pass everything upfront for scripted/CI
// use — any flag given on the command line is used as-is, never prompted for:
//   node scripts/create-plugin.mjs <id> --label "Label" --description "..." [--sidecar]
//
// <id> must be kebab-case (letters/digits/hyphens, matching what
// lint-manifests.mjs enforces).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
let id = args[0]?.startsWith('--') ? null : (args[0] ?? null);
let label = flag('--label');
let description = flag('--description');
let sidecar = args.includes('--sidecar') ? true : args.includes('--no-sidecar') ? false : null;

function git(gitArgs, opts = {}) {
  execFileSync('git', gitArgs, { stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
}
function gitCapture(gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf-8' }).trim();
}

const currentBranch = gitCapture(['branch', '--show-current']);
if (currentBranch !== 'main') {
  console.error(`Run this from main, not "${currentBranch}" — it creates app/${id}/main from main's current HEAD.`);
  process.exit(1);
}
if (gitCapture(['status', '--porcelain'])) {
  console.error('main has uncommitted changes — commit or stash them first.');
  process.exit(1);
}

// ── Interactive prompts for whatever wasn't passed as a flag — like `npm
// create`/`cargo generate`. Nothing here runs (no branch, no files) until
// every value is collected. ─────────────────────────────────────────────
// Sequential rl.question() calls are unreliable once stdin isn't a live TTY
// (piped multi-line input can arrive as one chunk before the second
// question() is even registered, so it never resolves) — confirmed the hard
// way with a 2-line piped test that hung until Node killed it with
// "Detected unsettled top-level await". Pulling from the interface's own
// async iterator instead works in both piped and real-terminal use.
const rl = createInterface({ input: stdin, output: stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (prompt, { default: def } = {}) => {
  const suffix = def ? ` (${def})` : '';
  stdout.write(`${prompt}${suffix}: `);
  const { value, done } = await lines.next();
  const answer = done ? '' : value.trim();
  return answer || def || '';
};

if (!id) {
  while (true) {
    const answer = (await ask('Plugin id (kebab-case, e.g. redis-client)')).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(answer)) {
      console.log('  Must be kebab-case: lowercase letters, digits, hyphens, starting with a letter or digit.');
      continue;
    }
    if (gitCapture(['branch', '--list', `app/${answer}/main`]) || gitCapture(['branch', '--list', '-r', `origin/app/${answer}/main`])) {
      console.log(`  app/${answer}/main already exists — pick a different id.`);
      continue;
    }
    id = answer;
    break;
  }
} else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error(`"${id}" is not kebab-case (lowercase letters, digits, hyphens).`);
  rl.close();
  process.exit(1);
}
if (label === null) label = await ask('Label (shown in the app sidebar)', { default: id });
if (description === null) description = await ask('Description', { default: `TODO: describe the ${id} plugin.` });
if (sidecar === null) {
  const answer = (await ask('Does this plugin need a native sidecar (Rust binary)? [y/N]')).toLowerCase();
  sidecar = answer === 'y' || answer === 'yes';
}
rl.close();

if (
  gitCapture(['branch', '--list', `app/${id}/main`]) ||
  gitCapture(['branch', '--list', '-r', `origin/app/${id}/main`])
) {
  console.error(`app/${id}/main already exists (locally or on origin) — refusing to overwrite.`);
  process.exit(1);
}

const newBranch = `app/${id}/main`;
console.log(`Creating ${newBranch} from main...`);
git(['checkout', '-b', newBranch]);

if (existsSync(`plugins/${id}`)) {
  console.error(`plugins/${id} already exists — refusing to overwrite.`);
  process.exit(1);
}

const bin = `devtool-svc-${id.replace(/-client$|-explorer$|-manager$/, '')}`;
const pascal = id.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

mkdirSync(`plugins/${id}/ui`, { recursive: true });

writeFileSync(
  `plugins/${id}/entry.tsx`,
  `import { ${pascal} } from './ui/${pascal}';\n\nexport default ${pascal};\n`,
);

writeFileSync(
  `plugins/${id}/ui/${pascal}.tsx`,
  `export function ${pascal}() {\n  return <div>TODO: build the ${id} UI.</div>;\n}\n`,
);

writeFileSync(
  `plugins/${id}/vite.config.ts`,
  `import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { makePluginConfig } from '../../scripts/makePluginConfig.mjs';\n\nexport default makePluginConfig(path.dirname(fileURLToPath(import.meta.url)));\n`,
);

const pluginManifest = {
  kind: 'plugin',
  id,
  version: '0.0.0',
  sdk: '^1.0.0',
  entry: 'REPLACED_BY_CI',
  integrity: 'REPLACED_BY_CI',
  label,
  description,
  icon: 'puzzle',
  keywords: [id],
  route: `/${id}`,
  permissions: sidecar ? ['storage', 'native', 'service'] : ['storage'],
  commands: ['mcp_'],
  hosts: [],
  ...(sidecar ? { service: { bin, methods: [] } } : {}),
};
writeFileSync(`plugins/${id}/manifest.plugin.json`, JSON.stringify(pluginManifest, null, 2) + '\n');

if (sidecar) {
  writeFileSync(
    `plugins/${id}/manifest.service.json`,
    JSON.stringify({ kind: 'service', bin, version: '0.0.0', protocol: 1, targets: {} }, null, 2) + '\n',
  );
  mkdirSync(`plugins/${id}/sidecar/src`, { recursive: true });
  writeFileSync(
    `plugins/${id}/sidecar/Cargo.toml`,
    `[package]\nname = "${bin}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\ndescription = "DevTool Tier-B sidecar for the ${id} plugin — JSONL over stdio, see docs/plugin-sdk/04-tier-b-sidecars.md in developer-desktop-utils."\n\n[[bin]]\nname = "${bin}"\npath = "src/main.rs"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\nserde_json = "1.0"\ntokio = { version = "1", features = ["full"] }\n\n[profile.release]\nopt-level = "z"\nlto = "thin"\nstrip = true\npanic = "abort"\n`,
  );
  writeFileSync(
    `plugins/${id}/sidecar/src/main.rs`,
    `// TODO: implement the ${id} sidecar — JSONL-over-stdio, one line in, one line out.\n// See docs/plugin-sdk/04-tier-b-sidecars.md in developer-desktop-utils for the protocol.\nfn main() {\n    todo!("${bin}")\n}\n`,
  );
}

// ── scripts/lint-manifests.mjs: main removed this (no plugins/ to lint on
// the skeleton) — a real plugin branch needs it back. ──────────────────────
writeFileSync(
  'scripts/lint-manifests.mjs',
  `// Validates the manifest TEMPLATES checked into each plugin's folder
// (manifest.plugin.json / manifest.service.json) — not the filled-in ones
// release.yml generates at tag time. Catches the class of mistake that only
// otherwise surfaces as a rejected install in the app days later: a typo'd
// \`kind\`, a \`service.bin\` that doesn't match the folder's sidecar name, a
// method list that's empty (silently means "no service permission" to
// validateManifest() on the app side), or a manifest.json that doesn't even
// parse.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PLUGINS_DIR = 'plugins';
let failed = false;

function fail(msg) {
  console.error(\`✗ \${msg}\`);
  failed = true;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(\`\${path}: invalid JSON (\${e.message})\`);
    return null;
  }
}

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

for (const id of readdirSync(PLUGINS_DIR)) {
  const dir = join(PLUGINS_DIR, id);

  const pluginManifest = readJson(join(dir, 'manifest.plugin.json'));
  if (pluginManifest) {
    if (pluginManifest.kind !== 'plugin') fail(\`\${id}: manifest.plugin.json kind must be "plugin"\`);
    if (pluginManifest.id !== id) fail(\`\${id}: manifest.plugin.json id "\${pluginManifest.id}" != folder name\`);
    for (const field of ['sdk', 'label', 'description', 'icon', 'route', 'permissions']) {
      if (pluginManifest[field] === undefined) fail(\`\${id}: manifest.plugin.json missing "\${field}"\`);
    }
    if (!KEBAB.test(id)) fail(\`\${id}: folder name is not kebab-case\`);
  }

  const servicePath = join(dir, 'manifest.service.json');
  try {
    readFileSync(servicePath);
  } catch {
    continue; // Tier-A-only plugin, no sidecar — nothing more to check
  }
  const serviceManifest = readJson(servicePath);
  if (serviceManifest) {
    if (serviceManifest.kind !== 'service') fail(\`\${id}: manifest.service.json kind must be "service"\`);
    if (!serviceManifest.bin) fail(\`\${id}: manifest.service.json missing "bin"\`);
    const cargoToml = readFileSync(join(dir, 'sidecar', 'Cargo.toml'), 'utf-8');
    const binNameMatch = cargoToml.match(/\\[\\[bin\\]\\][^[]*name\\s*=\\s*"([^"]+)"/);
    if (binNameMatch && binNameMatch[1] !== serviceManifest.bin) {
      fail(\`\${id}: manifest.service.json's bin "\${serviceManifest.bin}" != Cargo.toml's [[bin]] name "\${binNameMatch[1]}"\`);
    }
    if (pluginManifest && !Array.isArray(pluginManifest.service?.methods)) {
      fail(\`\${id}: manifest.plugin.json's service.methods must be an array\`);
    } else if (pluginManifest && pluginManifest.service.methods.length === 0) {
      fail(\`\${id}: manifest.plugin.json's service.methods is empty\`);
    }
  }
}

if (failed) {
  console.error('\\nManifest lint failed.');
  process.exit(1);
}
console.log('Manifest lint passed.');
`,
);

// ── tsconfig.json / vitest.config.ts: main's copies only scan shared/ (no
// plugins/ dir exists there) — widen them back to include plugins/**. ──────
const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf-8'));
if (!tsconfig.include.includes('plugins/**/*.ts')) {
  tsconfig.include.unshift('plugins/**/*.ts', 'plugins/**/*.tsx');
}
if (!tsconfig.exclude.includes('plugins/*/vite.config.ts')) {
  tsconfig.exclude.unshift('plugins/*/vite.config.ts');
}
writeFileSync('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');

let vitestConfig = readFileSync('vitest.config.ts', 'utf-8');
vitestConfig = vitestConfig.replace(
  "include: ['shared/**/*.test.{ts,tsx}'],",
  "include: ['plugins/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}'],",
);
// Drop the skeleton-only passWithNoTests escape hatch (and its comment) — a
// real plugin branch finding zero tests IS a regression, not the expected
// steady state main is in.
vitestConfig = vitestConfig.replace(
  /\n\s*\/\/ main is the skeleton[\s\S]*?passWithNoTests: true,\n/,
  '\n',
);
writeFileSync('vitest.config.ts', vitestConfig);

// ── package.json: skeleton has no build script (no plugin to build) ────────
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
pkg.description = `${id} plugin for DevTool — installable at runtime from developer-desktop-utils's Settings → Extensions instead of being compiled into the app. Forked from the devtool-plugins skeleton (main); see README.md.`;
pkg.scripts.build = `vite build --config plugins/${id}/vite.config.ts`;
pkg.scripts['lint:manifests'] = 'node scripts/lint-manifests.mjs';
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// ── ci.yml ───────────────────────────────────────────────────────────────
writeFileSync(
  '.github/workflows/ci.yml',
  `name: CI

# Fast feedback on every push/PR — catches a broken plugin bundle${sidecar ? ' or sidecar' : ''}
# before anyone pushes a release tag. release.yml (tag push) does the real
${sidecar ? '# cross-platform sidecar build/publish; this' : '# publish; this'} just proves things build and pass on Linux, quickly.
on:
  push:
    branches: ['**']
  pull_request:

permissions:
  contents: read

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: lts/*
          cache: npm

      - run: npm ci
      - run: npm run lint:manifests
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
${
  sidecar
    ? `
  sidecars:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable branch

      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: |
            plugins/${id}/sidecar -> target

      - name: Build every sidecar (native target, debug — full cross-compile matrix is release.yml's job)
        shell: bash
        run: |
          set -euo pipefail
          for dir in plugins/*/sidecar; do
            [ -f "$dir/Cargo.toml" ] || continue
            echo "== $dir =="
            (cd "$dir" && cargo build)
          done

      - name: Run sidecar unit tests (non-#[ignore]'d only — no live broker/daemon in CI)
        shell: bash
        run: |
          set -euo pipefail
          for dir in plugins/*/sidecar; do
            [ -f "$dir/Cargo.toml" ] || continue
            echo "== $dir =="
            (cd "$dir" && cargo test)
          done
`
    : ''
}`,
);

// ── release.yml ──────────────────────────────────────────────────────────
writeFileSync(
  '.github/workflows/release.yml',
  `name: Release ${id}

# This branch (app/${id}/main) releases ONLY the ${id} plugin — forked
# from the devtool-plugins skeleton (main); see that branch's README.md
# for why plugins live on their own branches instead of one monorepo tree
# (fault isolation + independent versioning per plugin).
#
# Tag push (${id}-v*) builds the plugin bundle (kind="plugin")${sidecar ? ' and its sidecar\n# binary (kind="service") for the target triples below,' : ','} computes SHA-256
# for each artifact, fills the manifest templates with real URLs/integrity,
# and publishes everything as assets on a GitHub Release — then merges
# just this plugin's entry into the aggregated catalog.json living on
# \`main\` (see the \`publish\` job's last steps), never touching any other
# plugin's entry there.
#
# Also runnable manually (workflow_dispatch) for environments that can drive
# the GitHub Actions API but can't push a tag ref (e.g. a scoped CI bot
# token). \`gh release create\` below creates the tag itself, pointed at
# whatever ref the manual run used, if it doesn't already exist.
env:
  PLUGIN_ID: ${id}

on:
  push:
    tags:
      - '${id}-v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Release tag to create (e.g. ${id}-v0.1.0)'
        required: true
        type: string

permissions:
  contents: read

jobs:
  build-plugins:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: lts/*
          cache: npm

      - run: npm ci
      - run: npm run lint:manifests
      - run: npm run typecheck
      - run: npm test

      - name: Build every plugin bundle
        run: npm run build

      - name: Upload bundle artifacts for the sidecar job to attach manifests to
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: plugin-bundles
          path: |
            plugins/*/dist/bundle.mjs
${
  sidecar
    ? `
  build-sidecars:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            rust-target: x86_64-unknown-linux-gnu
          - platform: macos-latest
            rust-target: aarch64-apple-darwin
          - platform: windows-latest
            rust-target: x86_64-pc-windows-msvc
    runs-on: \${{ matrix.platform }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable branch
        with:
          toolchain: stable
          targets: \${{ matrix.rust-target }}

      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: |
            plugins/${id}/sidecar -> target

      - name: Build every sidecar
        shell: bash
        run: |
          set -euo pipefail
          for dir in plugins/*/sidecar; do
            [ -f "$dir/Cargo.toml" ] || continue
            echo "== $dir =="
            (cd "$dir" && cargo build --release --target \${{ matrix.rust-target }})
          done

      - name: Collect binaries (rename with target triple, add .exe on Windows)
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p out
          EXT=""
          if [ "\${{ runner.os }}" = "Windows" ]; then EXT=".exe"; fi
          for dir in plugins/*/sidecar; do
            [ -f "$dir/Cargo.toml" ] || continue
            bin=$(grep -m1 '^name = ' "$dir/Cargo.toml" | sed -E 's/name = "(.*)"/\\1/')
            cp "$dir/target/\${{ matrix.rust-target }}/release/\${bin}\${EXT}" \\
               "out/\${bin}-\${{ matrix.rust-target }}\${EXT}"
          done

      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: sidecars-\${{ matrix.rust-target }}
          path: out/*
`
    : ''
}
  publish:
    needs: [build-plugins${sidecar ? ', build-sidecars' : ''}]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v6.0.0
        with:
          pattern: 'plugin-bundles'
          path: downloaded/bundles
          merge-multiple: true
${
  sidecar
    ? `
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v6.0.0
        with:
          pattern: 'sidecars-*'
          path: downloaded/sidecars
          merge-multiple: true
`
    : ''
}
      - name: Resolve release tag (workflow_dispatch input, or the pushed tag)
        run: echo "RELEASE_TAG=\${{ github.event_name == 'workflow_dispatch' && inputs.version || github.ref_name }}" >> "$GITHUB_ENV"

      - name: Build manifests + catalog.json and stage release assets
        run: node scripts/build-release.mjs
        env:
          GITHUB_REPOSITORY: \${{ github.repository }}
          TAG: \${{ env.RELEASE_TAG }}

      # --draft: everything past this point can still fail, and a draft is
      # invisible to anything reading the release — so a failure here leaves
      # an unfinished DRAFT, not a broken live release.
      - name: Publish GitHub Release (draft)
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          gh release create "\${RELEASE_TAG}" \\
            --repo "\${GITHUB_REPOSITORY}" \\
            --title "\${RELEASE_TAG}" \\
            --notes "Automated build of the \${PLUGIN_ID} plugin${sidecar ? '/sidecar' : ''}." \\
            --target "\${{ github.sha }}" \\
            --draft \\
            release-assets/*

      # catalog.json lives as a committed file on \`main\` (the skeleton
      # branch), not a release asset (release-asset storage doesn't send
      # CORS headers, which starlight-site's fetch needs). This branch only
      # builds/releases ONE plugin, so release-assets/catalog.json above has
      # exactly one entry — merge it into main's copy instead of overwriting,
      # so every other plugin's entry survives untouched.
      - name: Merge this plugin's entry into main's catalog.json and commit
        run: |
          set -euo pipefail
          git fetch origin main
          git show origin/main:catalog.json > /tmp/base-catalog.json 2>/dev/null || echo '{"plugins":[]}' > /tmp/base-catalog.json
          node scripts/merge-catalog-entry.mjs /tmp/base-catalog.json release-assets/catalog.json /tmp/merged-catalog.json

          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git switch -c catalog-sync origin/main
          cp /tmp/merged-catalog.json catalog.json
          git add catalog.json
          git diff --cached --quiet && exit 0
          git commit -m "catalog: update \${PLUGIN_ID} to \${RELEASE_TAG}"
          git push origin HEAD:main

      # The point of no return: everything above succeeded, so this is the
      # first point the release becomes visible to anything reading it.
      - name: Publish the release (flip draft -> published)
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release edit "\${RELEASE_TAG}" --draft=false --repo "\${GITHUB_REPOSITORY}"
`,
);

console.log(`Scaffolded plugins/${id}/ (sidecar: ${sidecar}).`);

// ── Commit the scaffold on the new branch ───────────────────────────────
git(['add', '-A']);
git(['commit', '-m', `Scaffold ${id} plugin`]);

// ── Run the same checks CI runs — reported, not enforced: a brand-new
// plugin has 0 tests (a real plugin branch failing on 0 tests is by
// design, see vitest.config.ts's comment above) and a placeholder UI, so
// failing here is expected until you've actually built the thing. ────────
console.log(
  '\nRunning verify steps (failures below are expected on a fresh scaffold — 0 tests, an empty UI, and (if --sidecar) an empty manifest.plugin.json service.methods list are all placeholders that fail on purpose until you fill them in):',
);
const checks = [
  ['lint:manifests', ['npm', 'run', 'lint:manifests']],
  ['typecheck', ['npm', 'run', 'typecheck']],
  ['test', ['npm', 'test']],
  ['build', ['npm', 'run', 'build']],
];
const results = [];
for (const [label, [cmd, ...cmdArgs]] of checks) {
  try {
    execFileSync(cmd, cmdArgs, { stdio: 'pipe' });
    results.push([label, true]);
  } catch {
    results.push([label, false]);
  }
}
for (const [label, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${label}`);

// ── dependabot.yml lives on main, not this branch — Dependabot only ever
// reads it from the default branch (see that file's own header comment).
// Switch there, append this plugin's entries, commit, switch back. ───────
console.log(`\nAdding dependabot.yml entries for ${newBranch} on main...`);
git(['checkout', 'main']);

let dependabot = readFileSync('.github/dependabot.yml', 'utf-8');
const npmBlock = `
  # ── ${id} (${newBranch}) ──────────────────────────────
  - package-ecosystem: npm
    directory: /
    target-branch: ${newBranch}
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types: [minor, patch]

  - package-ecosystem: github-actions
    directory: /
    target-branch: ${newBranch}
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
`;
const cargoBlock = sidecar
  ? `
  - package-ecosystem: cargo
    directory: /plugins/${id}/sidecar
    target-branch: ${newBranch}
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types: [minor, patch]
`
  : '';
dependabot = dependabot.replace(/\n$/, '') + '\n' + npmBlock + cargoBlock;
writeFileSync('.github/dependabot.yml', dependabot);

git(['add', '.github/dependabot.yml']);
git(['commit', '-m', `dependabot: add ${newBranch} entries`]);

console.log(`\nSwitching back to ${newBranch}...`);
git(['checkout', newBranch]);

console.log('\nDone. Both commits are LOCAL ONLY — nothing pushed. Next steps:');
const nextSteps = [
  `Fill in plugins/${id}/ui/${pascal}.tsx and manifest.plugin.json's keywords/permissions/icon.`,
  ...(sidecar ? [`Implement plugins/${id}/sidecar/src/main.rs and its manifest.service.json's methods.`] : []),
  'Add a real test, then re-run: npm run lint:manifests && npm run typecheck && npm test && npm run build',
  `git push -u origin main && git push -u origin ${newBranch}`,
  `git tag ${id}-v0.1.0 && git push origin ${id}-v0.1.0`,
];
nextSteps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
