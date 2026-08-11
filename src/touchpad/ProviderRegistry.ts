import {
    TouchpadCapabilities,
    TouchpadProvider,
    TouchpadProviderEvents,
} from "./types";
import { probeRendererCapabilities } from "./probe";
import { loadNativeTouchpadBridge } from "./nativeBridge";
import { WindowsNativeTouchpadProvider } from "./WindowsNativeTouchpadProvider";
import { ElectronInputEventProvider } from "./ElectronInputEventProvider";
import type { NativeTouchpadStartOptions } from "./nativeBridge";

export interface TouchpadProviderOptions {
    nativeStartOptions?: NativeTouchpadStartOptions;
}

/**
 * Provider selection.
 *
 * Order:
 *  1. Windows native bridge (Raw Input contact frames) — the only source
 *     that can deliver true multi-contact frames and optionally take over
 *     the system 3/4/5-finger gestures.
 *  2. Electron `webContents` `input-event` observer — real gesture-level
 *     events (2-finger swipe / pinch / tap) when the native bridge is not
 *     installed.
 *  3. A minimal "none" provider that honestly reports why nothing is
 *     available (non-Windows platform, no renderer bridge, etc.).
 *
 * Selecting a provider never throws and never breaks the mouse path.
 */
export function createTouchpadProvider(
    events: TouchpadProviderEvents,
    options: TouchpadProviderOptions = {},
): TouchpadProvider {
    const probe = probeRendererCapabilities();

    // Windows-only for the native path this round; macOS / Linux get the
    // honest "none" provider (their native providers are planned).
    if (probe.platform !== "win32") {
        return new NoneTouchpadProvider(events, [
            `advanced touchpad support is Windows-only in this build (current platform: ${probe.platform})`,
            "mouse gestures remain fully functional",
        ]);
    }

    // 1. Native bridge first.
    const bridge = loadNativeTouchpadBridge();
    if (bridge) {
        return new WindowsNativeTouchpadProvider(
            bridge,
            events,
            null,
            options.nativeStartOptions,
        );
    }
    const nativeBlockedReason =
        probe.hasInputEventOnWebContents
            ? null
            : "renderer cannot reach @electron/remote / webContents input-event";
    void nativeBlockedReason;

    // 2. Electron observer fallback.
    if (probe.hasInputEventOnWebContents) {
        return new ElectronInputEventProvider(events, probe);
    }

    // 3. Nothing usable.
    return new NoneTouchpadProvider(events, [
        "no native bridge and no @electron/remote input-event access in this renderer",
        "advanced multi-finger touchpad requires a native bridge (see docs)",
    ]);
}

/** Minimal provider used when no touchpad input source is available. */
class NoneTouchpadProvider extends TouchpadProvider {
    readonly id = "none" as const;

    private readonly events: TouchpadProviderEvents;
    private started = false;

    private readonly caps: TouchpadCapabilities;

    constructor(events: TouchpadProviderEvents, notes: string[]) {
        super();
        this.events = events;
        this.caps = {
            providerType: "none",
            platform: platformName(),
            precisionTouchpad: false,
            supportsRawContacts: false,
            multiContactGestures: false,
            maxContacts: 0,
            hardwareMaxContacts: 0,
            observedMaxContacts: 0,
            maxContactsKnown: false,
            supportsMultiFingerTap: false,
            supportsPress: false,
            canOverrideSystemGestures: false,
            observerMode: true,
            notes,
        };
    }

    get capabilities(): TouchpadCapabilities {
        return this.caps;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.events.onStatus?.(this.caps);
    }

    stop(): void {
        this.started = false;
    }
}

function platformName(): string {
    try {
        const p = (globalThis as { process?: { platform?: string } }).process?.platform;
        return typeof p === "string" && p ? p : "unknown";
    } catch {
        return "unknown";
    }
}
