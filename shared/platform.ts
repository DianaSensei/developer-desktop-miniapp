/**
 * Drop-in shim for `@/platform` (aliased to this file by each plugin's
 * `vite.config.ts`) so plugin source copied verbatim from
 * developer-desktop-utils doesn't need its imports rewritten. Every export
 * here just forwards to the real implementation the host attaches to
 * `window.__DEVTOOL_VENDOR__.platform` before any plugin bundle can load —
 * see `vendor.d.ts` and developer-desktop-utils's `src/main.tsx`.
 *
 * Deliberately NOT a re-export (`export const usePluginSdk =
 * window.__DEVTOOL_VENDOR__.platform.usePluginSdk`): that would capture
 * `undefined` if this module happens to evaluate before `main.tsx` sets the
 * vendor object. Each wrapper reads through the global at CALL time instead.
 */
import type { PluginSdk } from './vendor';

export type { PluginSdk };

export function usePluginSdk(): PluginSdk {
  return window.__DEVTOOL_VENDOR__.platform.usePluginSdk();
}

export function usePluginSdkFor(id: string): PluginSdk {
  return window.__DEVTOOL_VENDOR__.platform.usePluginSdkFor(id);
}

export function getPluginSdk(id: string): PluginSdk {
  return window.__DEVTOOL_VENDOR__.platform.getPluginSdk(id);
}

export function usePluginState<T>(
  sdk: PluginSdk,
  key: string,
  initial: T,
  opts?: { debounceMs?: number },
): [T, (value: T | ((prev: T) => T)) => void] {
  return window.__DEVTOOL_VENDOR__.platform.usePluginState(sdk, key, initial, opts);
}

export function migrateLegacyKey(sdk: PluginSdk, key: string, legacyKey: string): void {
  return window.__DEVTOOL_VENDOR__.platform.migrateLegacyKey(sdk, key, legacyKey);
}

export function usePluginConfig(): Record<string, any> {
  return window.__DEVTOOL_VENDOR__.platform.usePluginConfig();
}

export function useLiveConnection(sdk: PluginSdk, connected: boolean): void {
  return window.__DEVTOOL_VENDOR__.platform.useLiveConnection(sdk, connected);
}

export function usePluginMcpBridgeActive(sdk: PluginSdk): boolean {
  return window.__DEVTOOL_VENDOR__.platform.usePluginMcpBridgeActive(sdk);
}
