/**
 * Test-only stand-in for the real `PluginSdk` (developer-desktop-utils's
 * `src/platform/sdk.ts`), which this repo doesn't have access to. Installed
 * onto `window.__DEVTOOL_VENDOR__.platform` by `vitest.setup.ts` so that
 * plugin source copied verbatim from the app — which calls
 * `usePluginSdkFor()`/`usePluginState()` for real, not through a mock —
 * keeps working under `npm test` here.
 *
 * Deliberately UNGATED (no permission checks, no audit log): the real
 * enforcement lives in the host and is exercised by developer-desktop-utils's
 * own test suite. This fake exists only to give copied test files something
 * that behaves plausibly for `sdk.native.listen`/`invoke` (backed by the
 * REAL `@tauri-apps/api/event`/`core`, which individual tests mock the way
 * they always have) and `sdk.storage` (a per-id in-memory map — good enough
 * for a test that reads back what it just wrote, not durable across module
 * reloads the way the app's real store is).
 */
import type { PluginSdk } from '../vendor';

// Dynamic, CALL-TIME imports (not top-level) — vitest.setup.ts builds this
// sdk once per test file, before that file's own `vi.mock('@tauri-apps/api/…')`
// is guaranteed active. A top-level import here would capture whichever
// module instance (real or mocked) existed at THAT moment; resolving lazily,
// inside each method, always sees the test file's own current mock.

const stores = new Map<string, Map<string, unknown>>();

function storeFor(id: string): Map<string, unknown> {
  let s = stores.get(id);
  if (!s) {
    s = new Map();
    stores.set(id, s);
  }
  return s;
}

export function resetFakeSdkStorage(): void {
  stores.clear();
}

export function makeFakeSdk(id: string): PluginSdk {
  return {
    id,
    sdkVersion: '1.0.0',
    permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native', 'http', 'service', 'files:write'],
    env: { isTauri: '__TAURI_INTERNALS__' in window },
    files: {},
    async openExternal() {},
    storage: {
      get(key: string): string | null {
        const s = storeFor(id);
        return s.has(key) ? (s.get(key) as string) : null;
      },
      set(key: string, value: string): void {
        storeFor(id).set(key, value);
      },
      remove(key: string): void {
        storeFor(id).delete(key);
      },
      key(key: string): string {
        return `devtool:${id}:${key}`;
      },
    },
    secrets: {},
    clipboard: {
      async readText() { return null; },
      async writeText() {},
      async readImage() { return null; },
      async writeImage() {},
    },
    http: { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
    native: {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<T>(command, args);
      },
      channel: async () => {
        throw new Error('fakeSdk: native.channel is not implemented for tests — mock the caller instead');
      },
      listen: async <T>(event: string, handler: (payload: T) => void) => {
        const { listen } = await import('@tauri-apps/api/event');
        return listen<T>(event, (e) => handler(e.payload));
      },
      onFileDrop: async () => () => {},
    },
    service: {
      call: () => {
        throw new Error('fakeSdk: service.call is not implemented — mock the plugin\'s own api layer instead');
      },
      stream: () => {
        throw new Error('fakeSdk: service.stream is not implemented — mock the plugin\'s own api layer instead');
      },
    },
    log() {},
  };
}
