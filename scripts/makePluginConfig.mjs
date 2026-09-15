// Shared Vite config factory for every plugin's "single ESM file" build (see
// developer-desktop-utils's docs/plugin-sdk/05-external-install.md: the host
// loads the bundle through a `blob:` URL + dynamic `import()`, which has no
// containing "directory" to resolve a relative import against — so the
// build MUST inline everything except react/react-dom/jsx-runtime, which the
// host provides at `window.__DEVTOOL_VENDOR__` instead).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const vendorShim = {
  name: 'devtool-vendor-shim',
  resolveId(id) {
    return ['react', 'react-dom', 'react/jsx-runtime'].includes(id) ? id : null;
  },
  load(id) {
    if (id === 'react') return 'export default window.__DEVTOOL_VENDOR__.react;';
    if (id === 'react-dom') return 'export default window.__DEVTOOL_VENDOR__.reactDomFull;';
    if (id === 'react/jsx-runtime') {
      return `
        export const jsx = window.__DEVTOOL_VENDOR__.jsxRuntime.jsx;
        export const jsxs = window.__DEVTOOL_VENDOR__.jsxRuntime.jsxs;
        export const Fragment = window.__DEVTOOL_VENDOR__.jsxRuntime.Fragment;
      `;
    }
    return null;
  },
};

/**
 * @param {string} pluginDir absolute path to the plugin's own folder (has entry.tsx, ui/)
 * @param {string} extraAliasFrom optional extra self-referencing alias, e.g. '@/components/tools/container'
 */
export function makePluginConfig(pluginDir, extraAliasFrom) {
  const repoRoot = path.resolve(pluginDir, '..', '..');
  const alias = [];
  if (extraAliasFrom) {
    alias.push({ find: extraAliasFrom, replacement: path.join(pluginDir, 'ui') });
  }
  alias.push({ find: '@', replacement: path.join(repoRoot, 'shared') });

  return defineConfig({
    plugins: [vendorShim, react()],
    resolve: { alias },
    build: {
      outDir: path.join(pluginDir, 'dist'),
      emptyOutDir: true,
      lib: {
        entry: path.join(pluginDir, 'entry.tsx'),
        formats: ['es'],
        fileName: () => 'bundle.mjs',
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime'],
        output: { inlineDynamicImports: true },
      },
      minify: 'esbuild',
      target: 'es2022',
    },
  });
}
