import {
    TouchpadCapabilities,
    TouchpadFrame,
    TouchpadGestureEventData,
    TouchpadProvider,
    TouchpadProviderEvents,
} from "./types";
import { RendererCapabilityProbe } from "./probe";

/**
 * Electron `webContents` `input-event` observer provider (compatibility mode).
 *
 * This is the real, working bridge on SiYuan desktop: the main window is
 * created with `nodeIntegration: true` / `contextIsolation: false` and
 * `@electron/remote` is enabled, so the renderer can subscribe to the main
 * process `webContents` `input-event` channel.  Chromium's gesture recognizer
 * turns OS touchpad input into gesture events:
 *
 *   gestureScrollBegin / Update / End   → 2-finger swipe/scroll
 *   gesturePinchBegin / Update / End    → 2-finger pinch
 *   gestureTwoFingerTap                 → 2-finger tap
 *   gestureTap                          → 1-finger tap
 *   gestureLongPress / LongTap          → long press
 *
 * **Honesty contract**: this provider has NO per-contact frames.  It reports
 * `supportsRawContacts: false`, `observerMode: true` and never fabricates a
 * finger count beyond what the OS gesture type guarantees (two-finger tap,
 * pinch, scroll).  It cannot detect 3/4/5-finger gestures or shapes, and it
 * is explicitly NOT a substitute for the native contact-frame provider.
 *
 * The provider never `preventDefault`s anything — it observes only, so the
 * system's own 1/2-finger behaviour is untouched by construction.
 */
export class ElectronInputEventProvider extends TouchpadProvider {
    readonly id = "electron-input-event" as const;

    private readonly events: TouchpadProviderEvents;
    private readonly probe: RendererCapabilityProbe;
    private webContents: unknown = null;
    private started = false;
    private listenerAttached = false;

    // Scroll / pinch accumulators (per gesture session).
    private scrollTotalX = 0;
    private scrollTotalY = 0;
    private pinchTotal = 1;

    constructor(events: TouchpadProviderEvents, probe: RendererCapabilityProbe) {
        super();
        this.events = events;
        this.probe = probe;
    }

    get capabilities(): TouchpadCapabilities {
        const ok = this.probe.platform === "win32" && this.probe.hasInputEventOnWebContents;
        return {
            providerType: "electron-input-event",
            platform: this.probe.platform,
            precisionTouchpad: false,
            supportsRawContacts: false,
            multiContactGestures: false,
            maxContacts: 0,
            hardwareMaxContacts: 0,
            observedMaxContacts: 0,
            maxContactsKnown: false,
            supportsMultiFingerTap: true,
            supportsPress: false,
            canOverrideSystemGestures: false,
            observerMode: true,
            notes: ok
                ? [
                      "observer mode: gesture-level events only (no per-contact frames)",
                      "reliable for 2-finger swipe / pinch / tap; 3/4/5-finger and shapes require the native provider",
                      "device precision-touchpad status is unknown from these events",
                  ]
                : [
                      this.probe.platform !== "win32"
                          ? "electron input-event observer is Windows-only in this build"
                          : "webContents input-event is not reachable (@electron/remote unavailable)",
                  ],
        };
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        if (!this.tryAttach()) {
            this.started = false;
            this.events.onError?.({ label: "electron input-event provider could not attach" });
        }
        this.events.onStatus?.(this.capabilities);
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        this.detach();
    }

    // --------------------------------------------------------------- internals

    private tryAttach(): boolean {
        const win = typeof window !== "undefined" ? (window as { require?: (id: string) => unknown }) : undefined;
        if (!win || typeof win.require !== "function") return false;
        let remote: { getCurrentWindow?: () => { webContents?: InputEventWebContents } };
        try {
            remote = win.require("@electron/remote") as typeof remote;
        } catch {
            return false;
        }
        if (!remote || typeof remote.getCurrentWindow !== "function") return false;
        let wc: InputEventWebContents | undefined;
        try {
            wc = remote.getCurrentWindow()?.webContents as InputEventWebContents | undefined;
        } catch {
            return false;
        }
        if (!wc || typeof wc.on !== "function") return false;
        this.webContents = wc;
        try {
            wc.on("input-event", this.onInputEvent);
            this.listenerAttached = true;
        } catch {
            return false;
        }
        return true;
    }

    private detach(): void {
        if (!this.listenerAttached) return;
        this.listenerAttached = false;
        const wc = this.webContents as InputEventWebContents | null;
        if (wc && typeof wc.removeListener === "function") {
            try {
                wc.removeListener("input-event", this.onInputEvent);
            } catch {
                // teardown best-effort
            }
        }
        this.webContents = null;
        this.resetAccumulators();
    }

    /**
     * Bound handler (stable reference so `removeListener` matches exactly).
     *
     * Electron's `webContents` `input-event` signature is
     * `(event, inputEvent)` — the WebContents event object is the first
     * argument and the actual InputEvent payload is the **second**.
     */
    private readonly onInputEvent = (
        _event: unknown,
        inputEvent: unknown,
    ): void => {
        if (!this.started) return;
        const frame = this.mapEvent(inputEvent);
        if (frame) {
            this.events.onFrame?.(frame);
        }
    };

    /** Map one input-event to a gesture-tagged frame (or null when ignored). */
    private mapEvent(ev: unknown): TouchpadFrame | null {
        const e = ev as Record<string, unknown> | null;
        if (!e || typeof e !== "object") return null;
        const type = e["type"];
        if (typeof type !== "string") return null;
        const timestamp = performance.now();

        switch (type) {
            case "gestureScrollBegin":
                this.resetAccumulators();
                return this.gestureFrame(timestamp, { type: "scroll", state: "begin", deltaX: 0, deltaY: 0, hasPrecise: this.precise(e) });
            case "gestureScrollUpdate": {
                this.scrollTotalX += num(e["deltaX"]);
                this.scrollTotalY += num(e["deltaY"]);
                return this.gestureFrame(timestamp, { type: "scroll", state: "update", deltaX: num(e["deltaX"]), deltaY: num(e["deltaY"]), hasPrecise: this.precise(e) });
            }
            case "gestureScrollEnd":
                return this.gestureFrame(timestamp, { type: "scroll", state: "end", deltaX: this.scrollTotalX, deltaY: this.scrollTotalY, hasPrecise: this.precise(e) });
            case "gesturePinchBegin":
                this.pinchTotal = 1;
                return this.gestureFrame(timestamp, { type: "pinch", state: "begin", scale: 1 });
            case "gesturePinchUpdate": {
                const scale = num(e["scale"]);
                if (scale > 0 && Number.isFinite(scale)) {
                    this.pinchTotal = scale;
                }
                return this.gestureFrame(timestamp, { type: "pinch", state: "update", scale: this.pinchTotal });
            }
            case "gesturePinchEnd":
                return this.gestureFrame(timestamp, { type: "pinch", state: "end", scale: this.pinchTotal });
            case "gestureTap":
                return this.gestureFrame(timestamp, { type: "tap" });
            case "gestureTwoFingerTap":
                return this.gestureFrame(timestamp, { type: "twoFingerTap" });
            case "gestureLongPress":
                return this.gestureFrame(timestamp, { type: "longPress" });
            case "gestureLongTap":
                return this.gestureFrame(timestamp, { type: "longTap" });
            case "gestureDoubleTap":
                return this.gestureFrame(timestamp, { type: "doubleTap" });
            default:
                // mouse/keyboard/char and other events are ignored.
                return null;
        }
    }

    private gestureFrame(timestamp: number, gesture: TouchpadGestureEventData): TouchpadFrame {
        return {
            timestamp,
            contacts: [],
            source: "gesture-events",
            gesture,
        };
    }

    private precise(e: Record<string, unknown>): boolean {
        return e["hasPreciseScrollingDeltas"] === true;
    }

    private resetAccumulators(): void {
        this.scrollTotalX = 0;
        this.scrollTotalY = 0;
        this.pinchTotal = 1;
    }
}

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Minimal shape of the `webContents` instance the provider subscribes to
 * (accessed through `@electron/remote`, so only `on`/`removeListener` are
 * needed).
 */
interface InputEventWebContents {
    on?(event: string, cb: (event: unknown, inputEvent: unknown) => void): void;
    removeListener?(event: string, cb: (event: unknown, inputEvent: unknown) => void): void;
}
