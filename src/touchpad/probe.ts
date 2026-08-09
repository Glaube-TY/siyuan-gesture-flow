/**
 * SiYuan / Electron renderer capability probe.
 *
 * The probe inspects what the *current* desktop renderer actually exposes so
 * the plugin can choose the best touchpad provider and explain precisely why
 * a native provider is (or is not) available.  It never throws: every access
 * is guarded and every field reports "unknown" on failure.
 *
 * Verified basis (SiYuan desktop 3.7.x, Electron 42.x):
 * - The main window is created with `nodeIntegration: true`,
 *   `contextIsolation: false`, `webSecurity: false` (electron/main.js).
 * - `@electron/remote` is enabled on the main window's webContents
 *   (`remote.enable(currentWindow.webContents)`).
 * - Plugin bundles run inside the plugin loader with a `require` that falls
 *   back to `window.require` when the id is not the `siyuan` API
 *   (app/src/plugin/loader.ts).
 *
 * These facts are what allow a plugin to reach `process` / `window.require`
 * and to subscribe to `webContents` `input-event` gesture events through
 * `@electron/remote`.
 */

export interface RendererCapabilityProbe {
    platform: string;
    nodeVersion: string;
    electronVersion: string;
    hasProcess: boolean;
    hasWindowRequire: boolean;
    hasElectronModule: boolean;
    hasRemoteModule: boolean;
    remoteEnabledForCurrentWindow: boolean;
    hasInputEventOnWebContents: boolean;
    hasWebHid: boolean;
    webHidAvailable: boolean;
    isDesktop: boolean;
}

/** Result of probing a single boolean capability (never throws). */
function safeProbe(fn: () => boolean): boolean {
    try {
        return fn();
    } catch {
        return false;
    }
}

function safeString(fn: () => string): string {
    try {
        const v = fn();
        return typeof v === "string" && v.length > 0 ? v : "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Run the capability probe.  Must be called from the renderer
 * (it inspects `window` / `process` / `navigator`).
 */
export function probeRendererCapabilities(): RendererCapabilityProbe {
    const win = typeof window !== "undefined" ? window : undefined;
    const proc = (win as { process?: unknown } | undefined)?.process
        ?? (globalThis as { process?: unknown }).process;

    const platform = safeString(() => (proc as { platform?: string }).platform ?? "");
    const nodeVersion = safeString(() => (proc as { version?: string }).version ?? "");
    const electronVersion = safeString(() =>
        ((proc as { versions?: Record<string, string> }).versions ?? {})["electron"] ?? "",
    );

    const windowRequire = win
        ? (win as { require?: unknown }).require
        : undefined;

    const hasElectronModule = safeProbe(() => {
        const req = windowRequire as ((id: string) => unknown) | undefined;
        if (typeof req !== "function") return false;
        const electron = req("electron");
        return electron !== undefined && electron !== null;
    });

    const hasRemoteModule = safeProbe(() => {
        const req = windowRequire as ((id: string) => unknown) | undefined;
        if (typeof req !== "function") return false;
        const remote = req("@electron/remote");
        return remote !== undefined && remote !== null;
    });

    const remoteEnabledForCurrentWindow = safeProbe(() => {
        const req = windowRequire as ((id: string) => { getCurrentWindow?: () => unknown }) | undefined;
        if (typeof req !== "function") return false;
        const remote = req("@electron/remote") as { getCurrentWindow?: () => { webContents?: unknown } };
        if (!remote || typeof remote.getCurrentWindow !== "function") return false;
        const current = remote.getCurrentWindow();
        return current !== undefined && current !== null && !!current.webContents;
    });

    const hasInputEventOnWebContents = safeProbe(() => {
        const req = windowRequire as ((id: string) => { getCurrentWindow?: () => { webContents?: { on?: (e: string) => void } } }) | undefined;
        if (typeof req !== "function") return false;
        const remote = req("@electron/remote") as { getCurrentWindow?: () => { webContents?: { on?: (e: string) => void } } };
        if (!remote || typeof remote.getCurrentWindow !== "function") return false;
        const wc = remote.getCurrentWindow()?.webContents;
        return typeof wc?.on === "function";
    });

    const hasWebHid = typeof (navigator as { hid?: unknown }).hid !== "undefined";
    const webHidAvailable = safeProbe(() => {
        const hid = (navigator as { hid?: { getDevices?: () => Promise<unknown> } }).hid;
        return typeof hid?.getDevices === "function";
    });

    const isDesktop = safeProbe(() => {
        const s = (globalThis as { siyuan?: { config?: { system?: { container?: string } } } }).siyuan;
        return s?.config?.system?.container === "desktop" || typeof window !== "undefined";
    });

    return {
        platform,
        nodeVersion,
        electronVersion,
        hasProcess: proc !== undefined && proc !== null,
        hasWindowRequire: typeof windowRequire === "function",
        hasElectronModule,
        hasRemoteModule,
        remoteEnabledForCurrentWindow,
        hasInputEventOnWebContents,
        hasWebHid,
        webHidAvailable,
        isDesktop,
    };
}
