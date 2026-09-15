import { useState } from 'react';
import { makeFakeSdk } from './shared/testUtils/fakeSdk';
import type { PluginSdk } from './shared/vendor';

// Same patch as developer-desktop-utils's vitest.setup.ts — jsdom has no
// ResizeObserver, and components vendored from that app's design system
// (Segmented, Tabs) use it for layout measurement.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Plugin source here calls `window.__DEVTOOL_VENDOR__.platform.*` for real
// (see shared/platform.ts) — tests copied verbatim from developer-desktop-utils
// expect that to work without mocking `@/platform` themselves, the same way
// it works there against the real registry. `fakeSdk.ts` has the reasoning
// for why this stand-in is safe for tests specifically.
window.__DEVTOOL_VENDOR__ = {
  ...window.__DEVTOOL_VENDOR__,
  platform: {
    usePluginSdk: () => {
      throw new Error('fake platform: usePluginSdk() needs a real PluginProvider — use usePluginSdkFor in tests instead');
    },
    usePluginSdkFor: (id: string) => makeFakeSdk(id),
    getPluginSdk: (id: string) => makeFakeSdk(id),
    usePluginState: <T,>(sdk: PluginSdk, key: string, initial: T | (() => T)) => {
      const [value, setValue] = useState<T>(() => {
        const raw = sdk.storage.get(key);
        if (raw === null) return typeof initial === 'function' ? (initial as () => T)() : initial;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return typeof initial === 'function' ? (initial as () => T)() : initial;
        }
      });
      return [
        value,
        (next: T | ((prev: T) => T)) => {
          setValue((prev) => {
            const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
            sdk.storage.set(key, JSON.stringify(resolved));
            return resolved;
          });
        },
      ] as const;
    },
    migrateLegacyKey: () => {},
    usePluginConfig: () => ({ editor: { historyDebounceMs: 400, copyFeedbackMs: 1500 }, generator: {}, kafka: {}, updates: {} }),
    useLiveConnection: () => {},
    usePluginMcpBridgeActive: () => false,
  },
} as typeof window.__DEVTOOL_VENDOR__;
