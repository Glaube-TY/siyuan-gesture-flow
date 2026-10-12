import {
    TouchpadCapabilities,
    TouchpadContact,
    TouchpadFrame,
    TouchpadProvider,
    TouchpadProviderEvents,
    TouchpadProviderStartResult,
} from "./types";
import { NativeBridgeCapabilities, NativeTouchpadBridge, NativeTouchpadStartOptions } from "./nativeBridge";

// Tokens prevent a discarded pending provider from stopping its replacement.
const captureOwners = new WeakMap<NativeTouchpadBridge, object>();

/**
 * Windows Precision Touchpad provider (Windows 10 base + Windows 11
 * enhancement).
 *
 * The base input path is Raw Input (WM_INPUT) -> HID descriptor parsing ->
 * contact frames, which works on Windows 10.  The Windows 11
 * TouchpadGesturesController is treated as an OPTIONAL enhancement that only
 * adds system-gesture takeover (canOverrideSystemGestures); it is NOT a
 * prerequisite for raw multi-contact recognition.
 *
 * When a bridge is present this provider converts {@link NativeBridgeFrame}s
 * into normalised {@link TouchpadFrame}s and forwards them.  When no bridge
 * is loadable it reports an honest, precise `blocked` capability.
 *
 * Start/stop are fully reversible: `stop()` forwards to the bridge's `stop()`.
 */
export class WindowsNativeTouchpadProvider extends TouchpadProvider {
    readonly id = "windows-native" as const;

    private readonly events: TouchpadProviderEvents;
    private readonly bridge: NativeTouchpadBridge | null;
    private readonly blockedReason: string | null;
    private readonly startOptions: NativeTouchpadStartOptions;
    private started = false;
    private stopPending = false;
    private readonly ownershipToken = {};
    private startFailure: string | null = null;
    /** Largest contact count observed in live frames (real data). */
    private observedMaxContacts = 0;
    /** Frames rejected by the second-layer invariant (diagnostics). */
    private invalidFrameDropCount = 0;
    /** Last published capability signature (to avoid redundant onStatus). */
    private lastStatusSignature = "";

    constructor(
        bridge: NativeTouchpadBridge | null,
        events: TouchpadProviderEvents,
        blockedReason: string | null = null,
        startOptions: NativeTouchpadStartOptions = { manipulationFingerCounts: [], actionFingerCounts: [] },
    ) {
        super();
        this.events = events;
        this.bridge = bridge;
        this.blockedReason = blockedReason;
        this.startOptions = startOptions;
    }

    get capabilities(): TouchpadCapabilities {
        let caps: NativeBridgeCapabilities | undefined;
        try { caps = this.bridge?.capabilities; } catch { /* diagnostics must not prevent fallback */ }
        if (!caps) {
            return {
                providerType: "windows-native",
                platform: platformLabel(),
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
                notes: [
                    this.startFailure ?? this.blockedReason ??
                        "native addon not loadable — run `pnpm native:build` on a machine with MSVC + Windows SDK",
                ],
            };
        }
        // Authoritative hardware cap comes ONLY from the HID descriptor /
        // Feature report.  The observed max is just what we have seen so far.
        const hardwareMax = Math.max(0, caps.hardwareMaxContacts ?? 0);
        const observedMax = Math.max(0, caps.observedMaxContacts ?? 0, this.observedMaxContacts);
        const maxContactsKnown = hardwareMax > 0;
        const maxContacts = Math.max(hardwareMax, observedMax);
        const rawCaptureActive = this.started && caps.rawContacts;
        const multiContact = this.started && (caps.multiContactGestures || (rawCaptureActive && maxContacts > 0));
        // Registration alone is not enough: until the HID contact map parses,
        // the provider cannot actually deliver the raw-contact contract.
        const rawContacts = rawCaptureActive && multiContact;
        const controllerEnabled = this.started && caps.gesturesControllerEnabled === true;
        const overriddenGestureFingerCounts = [...new Set([
            ...this.startOptions.manipulationFingerCounts,
            ...this.startOptions.actionFingerCounts,
        ])].filter((count) => count >= 3 && count <= 5).sort((a, b) => a - b);
        return {
            providerType: "windows-native",
            platform: platformLabel(),
            precisionTouchpad: caps.precisionTouchpad,
            supportsRawContacts: rawContacts,
            multiContactGestures: multiContact,
            maxContacts,
            hardwareMaxContacts: hardwareMax,
            observedMaxContacts: observedMax,
            maxContactsKnown,
            supportsMultiFingerTap: rawContacts || controllerEnabled,
            // Press is only reported when a real, verified surface-press /
            // controller-press path exists.  It is not implemented yet.
            supportsPress: false,
            canOverrideSystemGestures: controllerEnabled && overriddenGestureFingerCounts.length > 0,
            overriddenGestureFingerCounts: controllerEnabled ? overriddenGestureFingerCounts : [],
            observerMode: !this.started,
            notes: [
                ...(this.startFailure ? [this.startFailure] : []),
                "raw multi-contact input via Precision Touchpad HID (Windows 10 base path)",
                ...(multiContact
                    ? [`raw contacts: ${maxContacts > 0 ? `${maxContacts} contacts` : "active"}`]
                    : ["waiting for the HID contact map (first frame)"]),
                ...(controllerEnabled
                    ? ["Windows 11 enhancement: system 3/4/5-finger gestures taken over by GestureFlow"]
                    : ["Windows 11 system-gesture takeover is NOT enabled (controller not confirmed active)"]),
                ...(caps.supportedGestureFingerCounts
                    ? [`Win11 controller supports ${caps.supportedGestureFingerCounts.join("/")}-finger`]
                    : []),
            ],
            diagnostics: {
                nativeAddonPath: caps.loadInfo,
                nativeModuleLoaded: true,
                lifecycleState: caps.lifecycleState,
                controllerSupported: caps.gesturesControllerAvailable,
                controllerEnabled,
                rawContactsActive: rawCaptureActive,
                parser: this.parserDiagnostics(),
                providerInvalidFrameDropCount: this.invalidFrameDropCount,
            },
        };
    }

    /** Low-level parser diagnostics from the native addon (best effort). */
    private parserDiagnostics(): Record<string, unknown> | undefined {
        const bridge = this.bridge;
        if (!bridge || typeof bridge.getDiagnostics !== "function") return undefined;
        try {
            const raw = bridge.getDiagnostics();
            if (!raw || typeof raw !== "object") return undefined;
            return raw as Record<string, unknown>;
        } catch {
            return undefined;
        }
    }

    start(): TouchpadProviderStartResult {
        if (this.started) return "started";
        const bridge = this.bridge;
        if (!bridge) return "unavailable";
        this.startFailure = null;
        try {
            const initialState = bridge.capabilities.lifecycleState;
            if (initialState === "stop-pending") {
                const stopped = bridge.stop();
                if ((stopped !== "stopped" && stopped !== "already-stopped") ||
                    bridge.capabilities.lifecycleState !== "stopped") {
                    return this.unavailable("native touchpad shutdown is incomplete; fully restart SiYuan if it persists");
                }
                captureOwners.delete(bridge);
                this.stopPending = false;
            }
            if (bridge.capabilities.lifecycleState === "running") {
                return this.unavailable("native touchpad capture belongs to another provider");
            }
        } catch {
            return this.unavailable("native touchpad lifecycle check failed; fully restart SiYuan if it persists");
        }
        let result;
        try {
            result = bridge.start((frame) => {
                if (!this.started) return;
                const converted = this.toFrame(frame);
                // Controller pointer / contact-count samples (no per-contact
                // geometry) are diagnostics only — the raw-contact invariant
                // does NOT apply to them and they must not be counted as
                // violations.  The adapter routes them to diagnostics only.
                const isControllerSample = converted.pointer !== undefined;
                if (isControllerSample) {
                    this.events.onFrame?.(converted);
                    this.maybePublishStatus();
                    return;
                }
                // Raw-contact frame: second-layer invariant (defensive).  The
                // native layer already guarantees contactCount == contacts.length
                // with finite, unique, in-range contacts.  A violating frame is
                // DROPPED here — never sent to the tracker/recorder.
                if (!this.frameInvariantValid(converted)) {
                    this.invalidFrameDropCount++;
                    this.maybePublishStatus();
                    return;
                }
                this.events.onFrame?.(converted);
                this.maybePublishStatus();
            }, this.startOptions);
        } catch {
            // A running capture was rejected before this attempt; roll back partial startup.
            captureOwners.set(bridge, this.ownershipToken);
            this.stopPending = true;
            this.stop();
            return this.unavailable(this.stopPending
                ? "native touchpad bridge start failed; shutdown is incomplete; fully restart SiYuan if it persists"
                : "native touchpad bridge start failed (Raw Input conflict or initialization error)");
        }
        if (result === "already-running") {
            return this.unavailable("native touchpad capture belongs to another provider");
        }
        if (result !== "started" && result !== undefined) {
            return this.unavailable("native touchpad bridge returned an invalid start status");
        }
        captureOwners.set(bridge, this.ownershipToken);
        this.started = true;
        this.stopPending = false;
        this.events.onStatus?.(this.capabilities);
        return "started";
    }

    private unavailable(label: string): "unavailable" {
        this.startFailure = label;
        this.events.onError?.({ label });
        this.events.onStatus?.(this.capabilities);
        return "unavailable";
    }

    stop(): void {
        if (!this.started && !this.stopPending) return;
        this.started = false;
        const bridge = this.bridge;
        if (!bridge || captureOwners.get(bridge) !== this.ownershipToken) {
            this.stopPending = false;
            return;
        }
        try {
            const result = bridge.stop();
            const state = bridge.capabilities.lifecycleState;
            // Legacy void bridges cannot confirm native release; accept only best-effort JS teardown.
            this.stopPending = result === "stop-pending" || state === "running" || state === "stop-pending" ||
                (result !== "stopped" && result !== "already-stopped" && result !== undefined);
            if (!this.stopPending) captureOwners.delete(bridge);
            if (this.stopPending) this.events.onError?.({ label: "native touchpad shutdown is incomplete; fully restart SiYuan if it persists" });
        } catch {
            this.stopPending = true;
            this.events.onError?.({ label: "native touchpad bridge stop failed" });
        }
    }

    /**
     * Publish updated capabilities when they change (e.g. the HID descriptor
     * contact map becomes available / maxContacts grows after the first
     * frames).  Uses a cheap signature to avoid redundant notifications.
     */
    private maybePublishStatus(): void {
        const caps = this.capabilities;
        const sig = [
            caps.supportsRawContacts,
            caps.multiContactGestures,
            caps.maxContacts,
            caps.canOverrideSystemGestures,
        ].join("|");
        if (sig !== this.lastStatusSignature) {
            this.lastStatusSignature = sig;
            this.events.onStatus?.(caps);
        }
    }

    /**
     * Second-layer invariant: a delivered raw-contact frame must have
     * `contactCount === contacts.length` (when present), finite coordinates in
     * [0,1], and unique contact ids.  Contact ID 0 is legal.
     */
    private frameInvariantValid(frame: TouchpadFrame): boolean {
        if (frame.source !== "raw-contacts") return true;
        if (frame.contacts.length === 0) {
            return typeof frame.contactCount !== "number" || frame.contactCount === 0;
        }
        if (typeof frame.contactCount === "number" && frame.contactCount !== frame.contacts.length) {
            return false;
        }
        const seen = new Set<number>();
        for (const c of frame.contacts) {
            if (!Number.isFinite(c.id) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return false;
            if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1) return false;
            if (seen.has(c.id)) return false;
            seen.add(c.id);
        }
        return true;
    }

    private toFrame(frame: NativeBridgeFrameLike): TouchpadFrame {
        if (frame.contactCount !== undefined && frame.contactCount > this.observedMaxContacts) {
            this.observedMaxContacts = frame.contactCount;
        }
        if (frame.contacts.length > this.observedMaxContacts) {
            this.observedMaxContacts = frame.contacts.length;
        }
        const contacts: TouchpadContact[] = [];
        for (const c of frame.contacts) {
            contacts.push({
                id: c.id,
                x: clamp01(c.x),
                y: clamp01(c.y),
                touching: c.touching !== false,
                ...(typeof c.pressure === "number" ? { pressure: clamp01(c.pressure) } : {}),
                ...(typeof c.width === "number" ? { width: Math.max(0, c.width) } : {}),
                ...(typeof c.height === "number" ? { height: Math.max(0, c.height) } : {}),
            });
        }
        const out: TouchpadFrame = {
            timestamp: frame.timestamp,
            contacts,
            source: "raw-contacts",
        };
        if (frame.contactCount !== undefined) {
            out.contactCount = frame.contactCount;
        }
        if (frame.nativeAction) {
            out.nativeAction = { kind: frame.nativeAction.kind, fingerCount: frame.nativeAction.fingerCount };
        }
        if (frame.pointer) {
            out.pointer = { x: clamp01(frame.pointer.x), y: clamp01(frame.pointer.y), state: frame.pointer.state };
        }
        return out;
    }
}

interface NativeBridgeContactLike {
    id: number;
    x: number;
    y: number;
    touching?: boolean;
    pressure?: number;
    width?: number;
    height?: number;
}

interface NativeBridgeFrameLike {
    timestamp: number;
    contacts: NativeBridgeContactLike[];
    contactCount?: number;
    nativeAction?: { kind: "tap" | "press" | "release"; fingerCount: number };
    pointer?: { x: number; y: number; state: "pressed" | "moved" | "released" };
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

function platformLabel(): string {
    try {
        const p = (globalThis as { process?: { platform?: string } }).process?.platform;
        return typeof p === "string" && p ? p : "unknown";
    } catch {
        return "unknown";
    }
}
