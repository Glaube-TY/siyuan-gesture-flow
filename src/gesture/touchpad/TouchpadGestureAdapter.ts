import {
    TouchpadProvider,
    TouchpadProviderEvents,
    TouchpadCapabilities,
    TouchpadFrame,
} from "@/touchpad/types";
import {
    TouchpadGestureSpec,
    TouchpadGestureKind,
} from "@/gesture/touchpad/types";
import { touchpadSignature, GestureSignatureKey } from "@/gesture/signature";
import {
    TouchpadGestureTracker,
    TouchpadRecognitionResult,
    TouchpadLiveState,
    TouchpadTrackerConfig,
} from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
import {
    recognizeGestureEventFrame,
    gestureEventLabel,
    gestureEventDetail,
} from "@/gesture/touchpad/recognition/GestureEventRecognizer";
import { isTouchpadRecording } from "@/runtime/TouchpadRuntimeState";

/** Device-loss watchdog while POSSIBLE / TRACKING (contacts vanish mid-gesture). */
const GESTURE_WATCHDOG_MS = 3000;
/**
 * Release-recovery watchdog while WAIT_RELEASE: if no new frame arrives for
 * this long, the physical release is treated as finished even without an
 * explicit empty frame (devices may stop reporting after the last finger
 * lifts).
 */
const RELEASE_WATCHDOG_MS = 450;

/** Adapter-to-runtime callbacks. */
export interface TouchpadAdapterEvents {
    /**
     * A physical gesture ended (terminal signal).  The result may be VALID or
     * INVALID — the visual lifecycle must terminate in both cases.  Whether
     * an action executes is decided later by the runtime (binding gates), NOT
     * by this callback.
     */
    onTerminal?(result: TouchpadRecognitionResult): void;
    /** Live state changed (feedback / diagnostics). */
    onLive?(live: TouchpadLiveState): void;
    /** Provider capabilities/status changed. */
    onStatus?(capabilities: TouchpadCapabilities): void;
    /**
     * Every raw frame received from the provider, BEFORE recognition.  This
     * includes staggered releases and the final empty frame — nothing is
     * dropped here.  Used by the settings recorder's raw-frame bus.
     */
    onFrame?(frame: TouchpadFrame): void;
    /** Provider error (rare, concise). */
    onError?(err: { label: string }): void;
}

/**
 * Translates a {@link TouchpadProvider}'s low-level frames into gesture
 * descriptors and reports completed gestures via {@link onComplete}.
 *
 * - Raw-contact frames feed the {@link TouchpadGestureTracker}.
 * - Gesture-event frames (observer mode) feed the gesture-event recognizer.
 *
 * The adapter constructs its provider lazily in {@link attach} (so the
 * provider's frame callback can be bound to the adapter) and stops it in
 * {@link detach} — the lifecycle is fully reversible.  A watchdog aborts a
 * run whose contacts vanish without an explicit empty frame (device loss).
 *
 * Safe-mode / conflict-policy / recorder gating is enforced by the runtime;
 * this adapter only ever reports the raw recognition result.
 */
export class TouchpadGestureAdapter {
    private readonly factory: (events: TouchpadProviderEvents) => TouchpadProvider;
    private readonly events: TouchpadAdapterEvents;
    private readonly tracker: TouchpadGestureTracker;
    private provider: TouchpadProvider | null = null;
    private attached = false;
    /** Latest gesture-event label (observer provider) for diagnostics. */
    private lastEventLabel: string | null = null;
    /** Latest structured event detail (observer / native action). */
    private lastEventDetail: ReturnType<typeof gestureEventDetail> = null;
    /** Latest controller contact-count sample. */
    private lastContactCount: number | null = null;

    /** Device-loss watchdog while a gesture is actively being drawn. */
    private gestureWatchdogHandle: ReturnType<typeof setTimeout> | null = null;
    /** Release-recovery watchdog while the release tail is being awaited. */
    private releaseWatchdogHandle: ReturnType<typeof setTimeout> | null = null;
    private _releaseWatchdogActive = false;

    constructor(
        providerFactory: (events: TouchpadProviderEvents) => TouchpadProvider,
        events: TouchpadAdapterEvents = {},
        trackerConfig?: Partial<TouchpadTrackerConfig>,
    ) {
        this.factory = providerFactory;
        this.events = events;
        this.tracker = new TouchpadGestureTracker(trackerConfig);
    }

    /** Whether a gesture is currently being drawn (POSSIBLE / TRACKING). */
    get active(): boolean {
        const stage = this.tracker.getLiveState().stage;
        return stage === "POSSIBLE" || stage === "TRACKING";
    }

    /**
     * Whether the recognizer is busy with a gesture OR its release tail
     * (POSSIBLE / TRACKING / WAIT_RELEASE).  WAIT_RELEASE is NOT idle.
     */
    get busy(): boolean {
        const stage = this.tracker.getLiveState().stage;
        return stage === "POSSIBLE" || stage === "TRACKING" || stage === "WAIT_RELEASE";
    }

    /** Whether the recognizer is awaiting the physical release to finish. */
    get awaitingRelease(): boolean {
        return this.tracker.getLiveState().stage === "WAIT_RELEASE";
    }

    /** Whether the release-recovery watchdog is currently armed. */
    get releaseWatchdogActive(): boolean {
        return this._releaseWatchdogActive;
    }

    /** Set which gesture kinds are analysed (from the registered bindings). */
    setEnabledKinds(
        kinds: Set<TouchpadGestureKind>,
        minFingerCount: number,
        allowedFingerCounts?: Set<number>,
    ): void {
        this.tracker.setEnabledKinds(kinds);
        this.tracker.updateConfig({
            minFingerCount,
            ...(allowedFingerCounts ? { allowedFingerCounts } : {}),
        });
    }

    /** Set the tracker thresholds from settings. */
    updateConfig(config: Partial<TouchpadTrackerConfig>): void {
        this.tracker.updateConfig(config);
    }

    /** Current provider capabilities (null before attach). */
    get capabilities() {
        return this.provider?.capabilities ?? null;
    }

    /** Live recognizer state (diagnostics UI / feedback). */
    getLiveState(): TouchpadLiveState {
        return this.tracker.getLiveState();
    }

    /** Start the provider and begin delivering frames.  Idempotent. */
    attach(): void {
        if (this.attached) return;
        this.attached = true;
        const providerEvents: TouchpadProviderEvents = {
            onFrame: (frame) => this.handleFrame(frame),
            onStatus: (capabilities) => {
                this.events.onStatus?.(capabilities);
            },
            onError: (err) => this.events.onError?.(err),
        };
        this.provider = this.factory(providerEvents);
        this.provider.start();
        // Publish capabilities immediately — the provider emits onStatus
        // synchronously during start(), but double-publish is harmless.
        this.events.onStatus?.(this.provider.capabilities);
    }

    /** Stop the provider and release everything.  Idempotent. */
    detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.clearGestureWatchdog();
        this.clearReleaseWatchdog();
        this.tracker.abort();
        if (this.provider) {
            this.provider.stop();
            this.provider = null;
        }
    }

    /** Abort an in-progress gesture (window blur / escape). */
    abort(): void {
        this.tracker.abort();
        this.clearGestureWatchdog();
        this.clearReleaseWatchdog();
        this.events.onLive?.(this.tracker.getLiveState());
    }

    // --------------------------------------------------------------- internals

    private handleFrame(frame: Parameters<TouchpadGestureTracker["feed"]>[0]): void {
        if (!this.attached) return;
        // Controller pointer samples carry no per-contact geometry — they are
        // diagnostics only and must NOT reach the settings recorder's raw
        // frame bus (contacts would be empty / contactCount inconsistent).
        if (!frame.pointer) {
            this.events.onFrame?.(frame);
        }
        this.lastEventLabel = TouchpadGestureAdapter.eventLabelFor(frame);
        this.lastEventDetail = TouchpadGestureAdapter.eventDetailFor(frame);
        if (typeof frame.contactCount === "number") {
            this.lastContactCount = frame.contactCount;
        }
        const result = this.processFrame(frame);
        this.refreshWatchdogs();
        if (result) {
            this.onRecognized(result);
        } else {
            this.events.onLive?.(this.tracker.getLiveState());
        }
    }

    /** Latest gesture-event label (for the diagnostics UI). */
    get eventLabel(): string | null {
        return this.lastEventLabel;
    }

    /** Latest structured event detail (for the diagnostics UI). */
    get eventDetail(): ReturnType<typeof gestureEventDetail> {
        return this.lastEventDetail;
    }

    /** Latest controller contact-count sample (for the diagnostics UI). */
    get contactCount(): number | null {
        return this.lastContactCount;
    }

    private processFrame(frame: Parameters<TouchpadGestureTracker["feed"]>[0]): TouchpadRecognitionResult | null {
        // Real 3/4/5-finger actions from the native TouchpadGesturesController
        // map directly to tap/press descriptors (the OS recognised them).
        if (frame.nativeAction) {
            return resultFromNativeAction(frame.nativeAction, this.tracker.enabledKindsSet);
        }
        // Controller pointer samples carry no per-contact geometry — they are
        // diagnostics only (contact count) and must NOT be fed to the tracker
        // (an empty contact array would look like "all fingers lifted").
        if (frame.pointer) {
            return null;
        }
        if (frame.source === "gesture-events") {
            const cfg = this.tracker.currentConfig;
            return recognizeGestureEventFrame(
                frame,
                { swipeMinDistance: cfg.swipeMinDistance, pinchThreshold: cfg.pinchThreshold },
                this.tracker.enabledKindsSet,
            );
        }
        return this.tracker.feed(frame);
    }

    private onRecognized(result: TouchpadRecognitionResult): void {
        // Recorder gate: while the settings recorder is active it owns its own
        // trail rendering AND its own recognition — never show the shared
        // overlay nor dispatch a real command.
        if (isTouchpadRecording()) {
            return;
        }
        // Forward EVERY terminal result, valid or invalid.  The feedback layer
        // must learn the gesture ended (to hide the trail) regardless of
        // validity; only dispatch decisions depend on validity.
        this.events.onTerminal?.(result);
    }

    /** Convert a result into a config-layer descriptor (null when invalid). */
    static resultToDescriptor(result: TouchpadRecognitionResult): TouchpadGestureSpec | null {
        if (!result.valid) return null;
        switch (result.kind) {
            case "tap":
                return { kind: "tap", fingerCount: result.fingerCount };
            case "press":
                return { kind: "press", fingerCount: result.fingerCount };
            case "hold":
                return { kind: "hold", fingerCount: result.fingerCount };
            case "swipe":
                if (result.directions.length !== 1) return null;
                return { kind: "swipe", fingerCount: result.fingerCount, direction: result.directions[0] };
            case "shape":
                if (result.directions.length === 0) return null;
                return { kind: "shape", fingerCount: result.fingerCount, directions: result.directions.slice() };
            case "anchorDraw":
                if (result.directions.length === 0) return null;
                return {
                    kind: "anchorDraw",
                    fingerCount: result.fingerCount,
                    anchorCount: result.anchorCount ?? 1,
                    directions: result.directions.slice(),
                };
            case "pinch":
                if (!result.pinchDirection) return null;
                return { kind: "pinch", fingerCount: result.fingerCount, direction: result.pinchDirection };
            case "rotate":
                if (!result.rotateDirection) return null;
                return { kind: "rotate", fingerCount: result.fingerCount, direction: result.rotateDirection };
            default:
                return null;
        }
    }

    /** Canonical signature of a completed result (null when invalid). */
    static resultSignature(result: TouchpadRecognitionResult): GestureSignatureKey | null {
        const descriptor = TouchpadGestureAdapter.resultToDescriptor(result);
        if (!descriptor) return null;
        return touchpadSignature(descriptor);
    }

    /** Gesture-event label for diagnostics (observer mode). */
    static eventLabelFor(frame: { source: string; gesture?: unknown; nativeAction?: unknown }): string | null {
        if (frame.source !== "gesture-events") {
            const action = frame.nativeAction as { kind?: string; fingerCount?: number } | undefined;
            if (action) {
                return `${action.kind ?? ""}:${action.fingerCount ?? 0}`;
            }
            return null;
        }
        return gestureEventLabel(frame as Parameters<typeof gestureEventLabel>[0]);
    }

    /** Structured event detail for diagnostics (observer / native action). */
    static eventDetailFor(frame: { source: string; gesture?: unknown; nativeAction?: unknown }): ReturnType<typeof gestureEventDetail> {
        if (frame.source !== "gesture-events") {
            const action = frame.nativeAction as { kind?: string; fingerCount?: number } | undefined;
            if (action) {
                return {
                    type: `native-action:${action.kind ?? ""}`,
                    fingerCount: typeof action.fingerCount === "number" ? action.fingerCount : undefined,
                };
            }
            return null;
        }
        return gestureEventDetail(frame as Parameters<typeof gestureEventDetail>[0]);
    }

    // --------------------------------------------------------------- watchdogs

    /**
     * Reconcile the two watchdog timers with the tracker's current stage
     * (called after every processed frame):
     *
     *   POSSIBLE / TRACKING → device-loss gesture watchdog (3 s).
     *   WAIT_RELEASE        → release-recovery watchdog (450 ms), reset on
     *                         every release-tail frame.
     *   otherwise           → both disarmed.
     */
    private refreshWatchdogs(): void {
        const stage = this.tracker.getLiveState().stage;
        if (stage === "POSSIBLE" || stage === "TRACKING") {
            this.clearReleaseWatchdog();
            this.clearGestureWatchdog();
            this.armGestureWatchdog();
        } else if (stage === "WAIT_RELEASE") {
            this.clearGestureWatchdog();
            this.clearReleaseWatchdog();
            this.armReleaseWatchdog();
        } else {
            this.clearGestureWatchdog();
            this.clearReleaseWatchdog();
        }
    }

    /** Arm the device-loss watchdog (no-op when already armed). */
    private armGestureWatchdog(): void {
        if (this.gestureWatchdogHandle !== null) return;
        this.gestureWatchdogHandle = setTimeout(() => {
            this.gestureWatchdogHandle = null;
            const stage = this.tracker.getLiveState().stage;
            if (stage === "POSSIBLE" || stage === "TRACKING") {
                this.tracker.abort();
                this.events.onLive?.(this.tracker.getLiveState());
            }
        }, GESTURE_WATCHDOG_MS);
    }

    private clearGestureWatchdog(): void {
        if (this.gestureWatchdogHandle !== null) {
            clearTimeout(this.gestureWatchdogHandle);
            this.gestureWatchdogHandle = null;
        }
    }

    /**
     * Arm the release-recovery watchdog (no-op when already armed).  It is
     * reset (clear + arm) by {@link refreshWatchdogs} on every WAIT_RELEASE
     * frame.  When it fires, the physical release is treated as finished even
     * without an explicit empty frame, and the tracker recovers via
     * {@link TouchpadGestureTracker.releaseTimedOut}.
     */
    private armReleaseWatchdog(): void {
        if (this.releaseWatchdogHandle !== null) return;
        this._releaseWatchdogActive = true;
        this.releaseWatchdogHandle = setTimeout(() => {
            this.releaseWatchdogHandle = null;
            this._releaseWatchdogActive = false;
            if (this.tracker.getLiveState().stage === "WAIT_RELEASE") {
                this.tracker.releaseTimedOut();
                this.events.onLive?.(this.tracker.getLiveState());
            }
        }, RELEASE_WATCHDOG_MS);
    }

    private clearReleaseWatchdog(): void {
        if (this.releaseWatchdogHandle !== null) {
            clearTimeout(this.releaseWatchdogHandle);
            this.releaseWatchdogHandle = null;
        }
        this._releaseWatchdogActive = false;
    }
}

/**
 * Convert a real native action (3/4/5-finger tap/press from the
 * TouchpadGesturesController) into a recognition result.
 *
 * The gesture was already recognised by Windows — this only maps it to the
 * descriptor vocabulary.  A `release` ends a press and never dispatches.
 * Exported for the smoke tests and the settings recorder.
 */
export function resultFromNativeAction(
    action: { kind: "tap" | "press" | "release"; fingerCount: number },
    enabledKinds: Set<TouchpadGestureKind> | null,
): TouchpadRecognitionResult | null {
    if (action.kind === "release") {
        return null;
    }
    const all = enabledKinds === null;
    if (!all && !enabledKinds.has(action.kind)) {
        return null;
    }
    if (action.kind === "tap") {
        return { valid: true, kind: "tap", fingerCount: action.fingerCount, directions: [] };
    }
    return { valid: true, kind: "press", fingerCount: action.fingerCount, directions: [] };
}
