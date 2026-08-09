import {
    TouchpadCapabilities,
    TouchpadContact,
    TouchpadFrame,
    TouchpadProvider,
    TouchpadProviderEvents,
} from "./types";
import { NativeTouchpadBridge } from "./nativeBridge";

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
    private started = false;
    /** Largest contact count observed in live frames (real data). */
    private observedMaxContacts = 0;
    /** Frames rejected by the second-layer invariant (diagnostics). */
    private invalidFrameDropCount = 0;
    /** Last published capability signature (to avoid redundant onStatus). */
    private lastStatusSignature = "";

    constructor(bridge: NativeTouchpadBridge | null, events: TouchpadProviderEvents, blockedReason: string | null = null) {
        super();
        this.events = events;
        this.bridge = bridge;
        this.blockedReason = blockedReason;
    }

    get capabilities(): TouchpadCapabilities {
        const bridge = this.bridge;
        if (!bridge) {
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
                    this.blockedReason ??
                        "native addon not loadable — run `pnpm native:build` on a machine with MSVC + Windows SDK",
                ],
            };
        }
        const caps = bridge.capabilities;
        // Authoritative hardware cap comes ONLY from the HID descriptor /
        // Feature report.  The observed max is just what we have seen so far.
        const hardwareMax = Math.max(0, caps.hardwareMaxContacts ?? 0);
        const observedMax = Math.max(0, caps.observedMaxContacts ?? 0);
        const maxContactsKnown = hardwareMax > 0;
        const maxContacts = Math.max(hardwareMax, observedMax);
        const rawContacts = caps.rawContacts;
        const multiContact = caps.multiContactGestures || (rawContacts && maxContacts > 0);
        const controllerEnabled = caps.gesturesControllerEnabled === true;
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
            supportsMultiFingerTap: true,
            // Press is only reported when a real, verified surface-press /
            // controller-press path exists.  It is not implemented yet.
            supportsPress: false,
            canOverrideSystemGestures: controllerEnabled,
            observerMode: false,
            notes: [
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
                controllerSupported: caps.gesturesControllerAvailable,
                controllerEnabled,
                rawContactsActive: rawContacts,
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

    start(): void {
        if (this.started) return;
        this.started = true;
        const bridge = this.bridge;
        if (!bridge) {
            this.events.onStatus?.(this.capabilities);
            return;
        }
        try {
            bridge.start((frame) => {
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
            });
        } catch (err) {
            this.started = false;
            const label = err instanceof Error ? err.message : String(err);
            this.events.onError?.({ label: `native touchpad bridge start failed (${label})` });
            this.events.onStatus?.(this.capabilities);
            return;
        }
        this.events.onStatus?.(this.capabilities);
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        const bridge = this.bridge;
        if (!bridge) return;
        try {
            bridge.stop();
        } catch {
            // Native teardown failures are non-fatal; the runtime is
            // shutting down anyway.
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
