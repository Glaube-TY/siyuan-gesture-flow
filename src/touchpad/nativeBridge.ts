/**
 * Native Windows Precision Touchpad bridge.
 *
 * The native addon lives in this plugin's own directory:
 *
 *   <workspace>/data/plugins/siyuan-gesture-flow/native/gesture_flow_touchpad.node
 *
 * It is an N-API (ABI-stable) module that delivers TWO kinds of input:
 *
 *   1. **Raw contact frames** (Raw Input / WM_INPUT, RIDEV_INPUTSINK) —
 *      stable contact ids and per-contact normalised x/y, down / move / up.
 *      This is the only source of true multi-finger geometry.
 *
 *   2. **TouchpadGesturesController** (Windows.UI.Input) — real 3/4/5-finger
 *      actions (tap / press / release) and contact-count pointer samples, and
 *      the only path that can take over the Windows default 3/4/5-finger
 *      global gestures while SiYuan is the foreground app.
 *
 * The loader prefers the bundled addon, then falls back to the
 * `window.__GESTURE_FLOW_NATIVE__` dev/test injection hook.  It never throws:
 * when nothing is loadable the Windows native provider reports a precise
 * `blocked` capability instead.
 */

/** A single contact as reported by the native layer. */
export interface NativeBridgeContact {
    id: number;
    /** Normalised x on the touchpad surface (0..1) — done natively. */
    x: number;
    /** Normalised y on the touchpad surface (0..1) — done natively. */
    y: number;
    touching: boolean;
    pressure?: number;
    width?: number;
    height?: number;
}

/** A real 3/4/5-finger action from the TouchpadGesturesController. */
export interface NativeBridgeAction {
    kind: "tap" | "press" | "release";
    fingerCount: number;
}

/** A frame or event from the native layer. */
export interface NativeBridgeFrame {
    timestamp: number;
    /** Raw per-contact frames (Raw Input path). */
    contacts: NativeBridgeContact[];
    /** Controller contact-count sample (real, no per-contact geometry). */
    contactCount?: number;
    /** Controller pointer sample (single point, normalised). */
    pointer?: { x: number; y: number; state: "pressed" | "moved" | "released" };
    /** 3/4/5-finger action from the controller. */
    nativeAction?: NativeBridgeAction;
}

/** Native-layer capabilities (from real runtime probes). */
export interface NativeBridgeCapabilities {
    precisionTouchpad: boolean;
    /** Hardware maximum contact count from the descriptor / Feature report. */
    maxContacts: number;
    /** Largest contact count observed at runtime (diagnostic only). */
    observedMaxContacts?: number;
    canOverrideSystemGestures: boolean;
    gesturesControllerAvailable: boolean;
    /** True only when the controller really enabled (not just available). */
    gesturesControllerEnabled?: boolean;
    /** Finger counts the controller is actually configured for (e.g. 3/4/5). */
    supportedGestureFingerCounts?: number[];
    /** Whether Raw Input contact frames are being delivered. */
    rawContacts: boolean;
    /** Loader detail (module path / reason), shown in the settings page. */
    loadInfo?: string;
    /** Whether raw multi-contact input is available (independent of Win11). */
    multiContactGestures?: boolean;
    /** Hardware max contact count (alias; raw addon may expose it directly). */
    hardwareMaxContacts?: number;
}

/** Selective Windows system-gesture takeover requested by enabled bindings. */
export interface NativeTouchpadStartOptions {
    /** Finger counts whose manipulation gestures (swipe/shape/etc.) are owned. */
    manipulationFingerCounts: readonly number[];
    /** Finger counts whose tap/press actions are owned. */
    actionFingerCounts: readonly number[];
}

/** What a native bridge must export. */
export interface NativeTouchpadBridge {
    readonly id: string;
    readonly capabilities: NativeBridgeCapabilities;
    /** Start capture; frames/events are delivered to `onFrame`. */
    start(onFrame: (frame: NativeBridgeFrame) => void, options?: NativeTouchpadStartOptions): void;
    /**
     * Stop capture and release every native resource (raw input
     * registration, hidden window, thread, WinRT controller, callbacks).
     * Fully reversible.
     */
    stop(): void;
    /** Optional low-level parser diagnostics (descriptor map + assembler). */
    getDiagnostics?(): Record<string, unknown>;
}

/**
 * Discovery hook: a well-known global the SiYuan app / a companion script
 * can set to the native bridge module (dev/test injection).
 */
type NativeBridgeGlobals = Window & {
    __GESTURE_FLOW_NATIVE__?: unknown;
};

/**
 * Loader context set by index.ts (the plugin knows its own `name`).
 */
export interface NativeBridgeContext {
    pluginName?: string;
}

let nativeBridgeContext: NativeBridgeContext = {};

/** Set the loader context (plugin name) from the plugin entry point. */
export function setNativeBridgeContext(context: NativeBridgeContext): void {
    nativeBridgeContext = context;
}

/**
 * Lightweight loader diagnostics for the Touchpad dev panel.  Only paths and
 * short error labels are kept — never user data or tokens.
 */
export interface NativeLoaderDiagnostics {
    /** Every path / id the loader attempted to require. */
    attemptedPaths: string[];
    /** The path that actually produced a usable bridge (null on failure). */
    loadedPath: string | null;
    /** Short label for the most recent failure (error.name / code / message). */
    lastError: string | null;
    /** Why the loader declined to even try (e.g. unsupported architecture). */
    blockedReason: string | null;
}

let loaderDiagnostics: NativeLoaderDiagnostics = {
    attemptedPaths: [],
    loadedPath: null,
    lastError: null,
    blockedReason: null,
};

/** Read the latest loader diagnostics (dev panel). */
export function getNativeLoaderDiagnostics(): NativeLoaderDiagnostics {
    return { ...loaderDiagnostics, attemptedPaths: loaderDiagnostics.attemptedPaths.slice() };
}

/** Short, safe error label — name/code + a truncated message, no payload. */
function errorLabel(err: unknown): string {
    const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
    if (!e || typeof e !== "object") return String(err);
    const parts: string[] = [];
    if (typeof e.code === "string" && e.code) parts.push(e.code);
    if (typeof e.name === "string" && e.name) parts.push(e.name);
    if (typeof e.message === "string" && e.message) {
        parts.push(e.message.length > 120 ? `${e.message.slice(0, 120)}…` : e.message);
    }
    return parts.length > 0 ? parts.join(": ") : "load failed";
}

/** Current CPU architecture (undefined in a browser without process). */
function currentArch(): string | null {
    try {
        const arch = (globalThis as { process?: { arch?: string } }).process?.arch;
        return typeof arch === "string" && arch ? arch : null;
    } catch {
        return null;
    }
}

/**
 * Try to load the native touchpad bridge.
 *
 * Discovery order:
 *  1. `window.__GESTURE_FLOW_NATIVE__` (dev/test injection).
 *  2. The addon bundled with this plugin:
 *       <dataDir>/plugins/<name>/native/gesture_flow_touchpad.node
 *     loaded via `window.require(<absolute path>)`.  `dataDir` comes from
 *     `window.siyuan.config.system.dataDir` (absolute filesystem path).
 *  3. `window.require(process.env.GESTURE_FLOW_NATIVE_MODULE)` if set.
 *
 * Only x64 addons ship today — on another architecture the loader declines
 * with a precise reason (so the failure is never a vague MODULE_NOT_FOUND)
 * and the runtime falls back to the Electron observer.
 *
 * Returns `null` when nothing is loadable — the caller reports a precise
 * `blocked` status instead of throwing.
 */
export function loadNativeTouchpadBridge(): NativeTouchpadBridge | null {
    loaderDiagnostics = { attemptedPaths: [], loadedPath: null, lastError: null, blockedReason: null };
    const win = typeof window !== "undefined" ? (window as NativeBridgeGlobals) : undefined;
    if (!win) {
        loaderDiagnostics.blockedReason = "no window (non-renderer context)";
        return null;
    }

    const globals = win as NativeBridgeGlobals;
    if (globals.__GESTURE_FLOW_NATIVE__) {
        const bridge = normalizeBridge(globals.__GESTURE_FLOW_NATIVE__, "global-injection");
        if (bridge) {
            loaderDiagnostics.loadedPath = "global-injection";
            return bridge;
        }
        loaderDiagnostics.lastError = "global-injection module did not match the bridge shape";
    }

    // Native addons are currently built for x64 only — decline with a clear
    // reason on other architectures (observer fallback stays available).
    const arch = currentArch();
    if (arch !== null && arch !== "x64") {
        loaderDiagnostics.blockedReason = `unsupported native architecture (${arch}); addon is x64-only — falling back to the Electron observer`;
        return null;
    }

    const req = (win as unknown as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") {
        loaderDiagnostics.blockedReason = "window.require unavailable";
        return null;
    }

    // 2. Bundled addon path (no manual install into SiYuan node_modules).
    const bundled = bundledAddonPath();
    if (bundled) {
        loaderDiagnostics.attemptedPaths.push(bundled);
        try {
            const mod = req(bundled);
            if (mod) {
                const bridge = normalizeBridge(mod, bundled);
                if (bridge) {
                    loaderDiagnostics.loadedPath = bundled;
                    return bridge;
                }
            }
            loaderDiagnostics.lastError = "bundled addon did not match the bridge shape";
        } catch (err) {
            loaderDiagnostics.lastError = errorLabel(err);
        }
    }

    const candidates: string[] = [];
    try {
        const envModule = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
            ?.GESTURE_FLOW_NATIVE_MODULE;
        if (envModule) candidates.push(envModule);
    } catch {
        // env may be unavailable — skip the env candidate.
    }

    for (const id of candidates) {
        loaderDiagnostics.attemptedPaths.push(id);
        try {
            const mod = req(id);
            if (mod) {
                const bridge = normalizeBridge(mod, id);
                if (bridge) {
                    loaderDiagnostics.loadedPath = id;
                    return bridge;
                }
            }
            loaderDiagnostics.lastError = "env module did not match the bridge shape";
        } catch (err) {
            loaderDiagnostics.lastError = errorLabel(err);
        }
    }
    return null;
}

const BUNDLED_ADDON_NAME = "gesture_flow_touchpad.node";

/**
 * Compute the absolute path of the addon bundled with this plugin.
 *
 * `window.siyuan.config.system.dataDir` is the absolute workspace `data`
 * directory; plugins live under `<dataDir>/plugins/<name>/`.  Returns `null`
 * when the data dir or plugin name is unavailable.
 */
function bundledAddonPath(): string | null {
    const name = nativeBridgeContext.pluginName;
    if (!name) return null;
    const dataDir = readDataDir();
    if (!dataDir) return null;
    const pathMod = tryRequirePath();
    if (!pathMod || typeof pathMod.join !== "function") {
        return null;
    }
    try {
        return pathMod.join(dataDir, "plugins", name, "native", BUNDLED_ADDON_NAME);
    } catch {
        return null;
    }
}

function readDataDir(): string | null {
    try {
        const s = (globalThis as { siyuan?: { config?: { system?: { dataDir?: string } } } }).siyuan;
        const dir = s?.config?.system?.dataDir;
        return typeof dir === "string" && dir.length > 0 ? dir : null;
    } catch {
        return null;
    }
}

function tryRequirePath(): { join: (...parts: string[]) => string } | null {
    const win = typeof window !== "undefined" ? (window as unknown as { require?: (id: string) => unknown }) : undefined;
    if (!win || typeof win.require !== "function") return null;
    try {
        const pathMod = win.require("path") as { join?: (...parts: string[]) => string };
        return typeof pathMod?.join === "function" ? (pathMod as { join: (...parts: string[]) => string }) : null;
    } catch {
        return null;
    }
}

/**
 * Validate a raw loaded module against the bridge shape.
 *
 * IMPORTANT: `capabilities` must stay a live getter.  The native addon's
 * capabilities are dynamic (they change when start() activates Raw Input,
 * when the HID descriptor is parsed, and as contact frames are observed).
 * Snapshotting them once here would freeze `maxContacts` /
 * `multiContactGestures` / `rawContacts` at their pre-start values.
 */
function normalizeBridge(raw: unknown, id: string): NativeTouchpadBridge | null {
    const mod = raw as Partial<NativeTouchpadBridge> | null;
    if (!mod || typeof mod !== "object") return null;
    if (typeof mod.start !== "function" || typeof mod.stop !== "function") {
        return null;
    }
    const bridge: NativeTouchpadBridge = {
        id: typeof mod.id === "string" ? mod.id : id,
        get capabilities(): NativeBridgeCapabilities {
            return normalizeCapabilities(mod.capabilities, id);
        },
        // Wrappers keep `this` stable regardless of how the native module is
        // exported (e.g. a getter-backed object).
        start: (onFrame: (frame: NativeBridgeFrame) => void, options?: NativeTouchpadStartOptions): void => {
            mod.start!(onFrame, options);
        },
        stop: (): void => {
            mod.stop!();
        },
    };
    if (typeof mod.getDiagnostics === "function") {
        bridge.getDiagnostics = (): Record<string, unknown> => mod.getDiagnostics!();
    }
    return bridge;
}

/** Normalise a raw native capabilities object into the bridge shape. */
function normalizeCapabilities(
    raw: unknown,
    id: string,
): NativeBridgeCapabilities {
    const caps = raw as Partial<NativeBridgeCapabilities> | undefined;
    const hardwareMax =
        typeof caps?.hardwareMaxContacts === "number" && caps.hardwareMaxContacts > 0
            ? caps.hardwareMaxContacts
            : typeof caps?.maxContacts === "number" && caps.maxContacts > 0
              ? caps.maxContacts
              : 0;
    return {
        precisionTouchpad: caps?.precisionTouchpad === true,
        maxContacts: hardwareMax,
        hardwareMaxContacts: hardwareMax,
        observedMaxContacts:
            typeof caps?.observedMaxContacts === "number" && caps.observedMaxContacts > 0
                ? caps.observedMaxContacts
                : 0,
        canOverrideSystemGestures: caps?.canOverrideSystemGestures === true,
        gesturesControllerAvailable: caps?.gesturesControllerAvailable === true,
        gesturesControllerEnabled: caps?.gesturesControllerEnabled === true,
        supportedGestureFingerCounts:
            Array.isArray(caps?.supportedGestureFingerCounts)
                ? caps.supportedGestureFingerCounts
                : undefined,
        rawContacts: caps?.rawContacts === true,
        loadInfo: typeof caps?.loadInfo === "string" ? caps.loadInfo : id,
        multiContactGestures: caps?.multiContactGestures === true,
    };
}
