/**
 * Ambient types for the host's vendor bridge (`window.__DEVTOOL_VENDOR__`),
 * set by DevTool's `src/main.tsx` before any plugin bundle can load. See
 * `docs/plugin-sdk/05-external-install.md` in developer-desktop-utils for
 * the authoritative contract; this file only exists so plugin code in this
 * repo type-checks against the same shape without depending on that repo.
 *
 * `PluginSdk` is intentionally loose (`Record<string, any>`-ish, not a
 * structural copy of the real `PluginSdk` interface in
 * `src/platform/sdk.ts`): keeping two hand-maintained copies of that
 * interface in sync across repos is a worse failure mode than losing some
 * autocomplete here. The real shape enforcement happens at runtime, in the
 * host's own `sdk.ts` — a plugin calling a method that doesn't exist fails
 * loudly in the browser console during development, same as any other JS
 * duck-typing gap.
 */
export {};

export interface PluginSdk {
  readonly id: string;
  readonly sdkVersion: string;
  readonly permissions: readonly string[];
  readonly env: { isTauri: boolean };
  files: Record<string, (...args: any[]) => any>;
  openExternal(url: string): Promise<void>;
  storage: {
    get<T>(key: string, fallback: T): T;
    set<T>(key: string, value: T): void;
    remove(key: string): void;
  };
  secrets: Record<string, (...args: any[]) => any>;
  clipboard: {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
    readImage(): Promise<string | null>;
    writeImage(source: Blob | string): Promise<void>;
  };
  http: { fetch(input: string, init?: RequestInit): Promise<Response> };
  native: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    channel<T>(onMessage: (message: T) => void, label?: string): Promise<unknown>;
    listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
    onFileDrop(handler: (event: { paths: string[] }) => void): Promise<() => void>;
  };
  service: {
    call<T>(method: string, params?: unknown): Promise<T>;
    streamStart<T>(method: string, params: unknown, onMessage: (msg: T) => void): Promise<string>;
    streamStop(streamId: string): Promise<void>;
  };
  log(message: string, detail?: string): void;
}

declare global {
  interface Window {
    __DEVTOOL_VENDOR__: {
      react: typeof import('react');
      reactDom: typeof import('react-dom/client');
      reactDomFull: typeof import('react-dom');
      jsxRuntime: { jsx: unknown; jsxs: unknown; Fragment: unknown };
      platform: {
        usePluginSdk(): PluginSdk;
        usePluginSdkFor(id: string): PluginSdk;
        getPluginSdk(id: string): PluginSdk;
        usePluginState<T>(
          sdk: PluginSdk,
          key: string,
          initial: T,
          opts?: { debounceMs?: number },
        ): [T, (value: T | ((prev: T) => T)) => void];
        migrateLegacyKey(sdk: PluginSdk, key: string, legacyKey: string): void;
        usePluginConfig(): Record<string, any>;
        useLiveConnection(sdk: PluginSdk, connected: boolean): void;
        usePluginMcpBridgeActive(sdk: PluginSdk): boolean;
      };
    };
  }
}
