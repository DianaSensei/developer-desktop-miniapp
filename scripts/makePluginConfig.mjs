// Shared Vite config factory for every plugin's "single ESM file" build (see
// developer-desktop-utils's docs/plugin-sdk/05-external-install.md: the host
// loads the bundle through a `blob:` URL + dynamic `import()`, which has no
// containing "directory" to resolve a relative import against — so the
// build MUST inline everything except react/react-dom/jsx-runtime, which the
// host provides at `window.__DEVTOOL_VENDOR__` instead).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Re-exports every named export a plugin might pull from 'react'/'react-dom'
// (not just default) — a namespace import (`import * as R from 'react'`) or a
// named one (`import { useState } from 'react'`) both need the name to exist
// on this virtual module, not just a default export wrapping the object.
const REACT_NAMED_EXPORTS = [
  'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent', 'StrictMode', 'Suspense',
  'cloneElement', 'createContext', 'createElement', 'createRef', 'forwardRef', 'isValidElement',
  'lazy', 'memo', 'startTransition',
  'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect', 'useId',
  'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useReducer',
  'useRef', 'useState', 'useSyncExternalStore', 'useTransition', 'version',
];
const REACT_DOM_NAMED_EXPORTS = [
  'createPortal', 'findDOMNode', 'flushSync', 'unstable_batchedUpdates', 'render', 'hydrate',
  'unmountComponentAtNode', 'version',
];

const vendorShim = {
  name: 'devtool-vendor-shim',
  // Vite's own core resolver plugin (which resolves bare specifiers against
  // node_modules) runs before a "normal" user plugin's resolveId — without
  // `enforce: 'pre'` here, 'react' would resolve to the real npm package
  // installed for this repo's own tooling (@testing-library/react etc.)
  // before this shim ever sees it, silently bundling a second React copy.
  enforce: 'pre',
  // NOTE: do NOT also list these in build.rollupOptions.external — when a
  // plugin's resolveId returns a bare id (not `{ id, external: false }`)
  // AND that id is in `external`, Rollup treats it as external and never
  // calls `load()`, leaving an unresolved `import ... from "react"` in the
  // output. That bundle then fails in the browser ("does not resolve to a
  // valid URL") once loaded via blob: URL + dynamic import(), which has no
  // import map to resolve a bare specifier against.
  resolveId(id) {
    return ['react', 'react-dom', 'react/jsx-runtime'].includes(id) ? id : null;
  },
  load(id) {
    if (id === 'react') {
      return `
        const _react = window.__DEVTOOL_VENDOR__.react;
        export default _react.default ?? _react;
        export const { ${REACT_NAMED_EXPORTS.join(', ')} } = _react;
      `;
    }
    if (id === 'react-dom') {
      return `
        const _dom = window.__DEVTOOL_VENDOR__.reactDomFull;
        export default _dom.default ?? _dom;
        export const { ${REACT_DOM_NAMED_EXPORTS.join(', ')} } = _dom;
      `;
    }
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
        output: { inlineDynamicImports: true },
      },
      minify: 'esbuild',
      target: 'es2022',
    },
  });
}
