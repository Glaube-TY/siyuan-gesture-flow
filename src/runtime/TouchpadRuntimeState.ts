import { TouchpadCapabilities, TouchpadFrame } from "@/touchpad/types";

/**
 * Renderer-wide touchpad runtime state (shared by the runtime and the
 * settings UI).
 *
 * Two concerns live here:
 *
 *  1. **Recorder gate** — while the settings touchpad recorder is active, the
 *     runtime must not dispatch bound touchpad actions (a recorded gesture
 *     must never trigger a real command).  The recorder sets the flag; the
 *     runtime's adapter checks it before dispatching.
 *
 *  2. **Status bus** — the runtime publishes provider capabilities and the
 *     latest diagnostic snapshot here; the settings Touchpad tab subscribes
 *     to render them.
 *
 * **Capabilities are low-frequency state and are ALWAYS stored**, even when
 * no UI subscriber is listening.  This fixes the "provider shows 无" bug
 * where the runtime picked a provider before the settings page opened but the
 * capabilities were dropped because there was no listener yet.
 *
 * **Frames are high-frequency state** and their conversion (per-contact array
 * mapping) is gated on having at least one subscriber.
 */

/** Structured detail of the latest observer/native event (diagnostics only). */
export interface TouchpadEventDetail {
    /** Event type, e.g. "gestureScrollUpdate", "gesturePinchUpdate", "native-action". */
    type: string;
    /** Gesture state when applicable ("begin" | "update" | "end"). */
    state?: string;
    /** Scroll delta (observer). */
    deltaX?: number;
    deltaY?: number;
    /** Pinch scale (observer). */
    scale?: number;
    /** Finger count for native actions (3/4/5-finger tap/press). */
    fingerCount?: number;
}

/** Snapshot of live touchpad diagnostics for the settings test area. */
export interface TouchpadDiagnostics {
    capabilities: TouchpadCapabilities | null;
    /** Latest diagnostic snapshot (updated only while subscribed). */
    latest: {
        timestamp: number;
        contacts: Array<{ id: number; x: number; y: number; touching: boolean }>;
        /** Controller contact-count sample (native, no per-contact geometry). */
        contactCount?: number;
        /** Display-only visualisation trail (normalised 0..1). */
        displayPath: Array<{ x: number; y: number }>;
        /** Per-contact display trails (normalised 0..1). */
        displayContactPaths: Array<{ id: number; points: { x: number; y: number }[] }>;
        /** Structured event detail (observer / native action) or null. */
        event: TouchpadEventDetail | null;
        /** Short human label for the event, or null. */
        eventLabel: string | null;
        /** Current recognised gesture kind, if any. */
        currentKind: string | null;
        /** Current state-machine stage. */
        stage: string;
        /** Whether the adapter's release-recovery watchdog is armed (internal diagnostics). */
        releaseWatchdogActive?: boolean;
        /** Contact count of the most recent release-tail frame (internal diagnostics). */
        releaseTailCount?: number | null;
    } | null;
}

type DiagnosticsListener = (diag: TouchpadDiagnostics) => void;
type PollingListener = (active: boolean) => void;
type RawFrameListener = (frame: TouchpadFrame) => void;

const listeners = new Set<DiagnosticsListener>();
const pollingListeners = new Set<PollingListener>();
const rawFrameListeners = new Set<RawFrameListener>();

let recorderActive = false;
let pollingActive = false;
let current: TouchpadDiagnostics = { capabilities: null, latest: null };

/** Whether the touchpad gesture recorder is currently active. */
export function isTouchpadRecording(): boolean {
    return recorderActive;
}

/** Set/reset the recorder-active flag (see module docs). */
export function setTouchpadRecording(active: boolean): void {
    recorderActive = active;
}

/**
 * Publish provider capabilities.
 *
 * Always stored so a late-subscribing settings page shows the real provider
 * immediately; notification to existing listeners is a cheap no-op when none
 * are registered.
 */
export function publishTouchpadCapabilities(capabilities: TouchpadCapabilities | null): void {
    current = { ...current, capabilities };
    notify();
}

/**
 * Publish a live diagnostic snapshot.
 *
 * High-frequency; the per-contact conversion is gated on having at least one
 * subscriber so idle runtime never churns allocations.
 */
export function publishTouchpadFrame(frame: Exclude<TouchpadDiagnostics["latest"], null>): void {
    if (!hasTouchpadDiagnosticsListeners()) {
        return;
    }
    current = { ...current, latest: frame };
    notify();
}

/** Read the latest published snapshot (no subscription needed). */
export function getTouchpadDiagnostics(): TouchpadDiagnostics {
    return current;
}

/** Subscribe to diagnostics updates.  Returns an unsubscribe function. */
export function subscribeTouchpadDiagnostics(listener: DiagnosticsListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Whether any diagnostics subscriber is listening (cheap publisher gate). */
export function hasTouchpadDiagnosticsListeners(): boolean {
    return listeners.size > 0;
}

/**
 * Publish one RAW contact frame (only when a recorder subscriber exists).
 *
 * This is the authoritative recording input channel: it carries every frame
 * the native provider produced, including staggered releases and the final
 * empty frame.  Unlike {@link publishTouchpadFrame}, this is NOT throttled or
 * derived — recorders feed it straight into their own Tracker.
 */
export function publishTouchpadRawFrame(frame: TouchpadFrame): void {
    if (rawFrameListeners.size === 0) return;
    for (const listener of rawFrameListeners) {
        try {
            listener(frame);
        } catch {
            // a failing subscriber never breaks the bus
        }
    }
}

/** Whether a raw-frame subscriber (recorder) is active. */
export function hasTouchpadRawFrameListeners(): boolean {
    return rawFrameListeners.size > 0;
}

/** Subscribe to raw contact frames.  Returns an unsubscribe function. */
export function subscribeTouchpadRawFrames(listener: RawFrameListener): () => void {
    rawFrameListeners.add(listener);
    return () => {
        rawFrameListeners.delete(listener);
    };
}

/**
 * Enable/disable lightweight parser-diagnostics polling.
 *
 * While the Touchpad settings tab is open the runtime polls the native
 * provider's `getDiagnostics()` (~300 ms) so WM_INPUT / HID report /
 * descriptor state updates even when no complete contact frame has been
 * delivered yet.  The tab must turn this OFF on destroy.
 */
export function setTouchpadDiagnosticsPolling(active: boolean): void {
    if (pollingActive === active) return;
    pollingActive = active;
    for (const listener of pollingListeners) {
        try {
            listener(active);
        } catch {
            // a failing subscriber never breaks the bus
        }
    }
}

/** Subscribe to polling toggles.  Returns an unsubscribe function. */
export function subscribeTouchpadDiagnosticsPolling(listener: PollingListener): () => void {
    pollingListeners.add(listener);
    return () => {
        pollingListeners.delete(listener);
    };
}

function notify(): void {
    if (listeners.size === 0) {
        return;
    }
    for (const listener of listeners) {
        try {
            listener(current);
        } catch {
            // A failing subscriber never breaks the bus.
        }
    }
}
