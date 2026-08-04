/**
 * Gesture input layer types (stage 1).
 *
 * Pure TypeScript, no runtime dependencies, no DOM access.
 *
 * State machine:
 *   IDLE --pointerdown(trigger button)--> PENDING
 *   PENDING --move > activationDistance--> TRACKING
 *   PENDING --pointerup--> IDLE            (native right-click menu shows)
 *   TRACKING --pointerup--> COMPLETED
 *   PENDING|TRACKING --cancel--> CANCELLED
 *
 * IDLE is represented by the absence of a session (adapter.session === null);
 * a GestureSession is only created once the pointer button goes down (PENDING).
 */

export enum GestureState {
    IDLE = "IDLE",
    PENDING = "PENDING",
    TRACKING = "TRACKING",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED",
}

/** A single sampled point on the gesture path. */
export interface GesturePoint {
    x: number;
    y: number;
    /** High-resolution timestamp (performance.now()). */
    t: number;
}

/** Reasons a gesture session ended in CANCELLED. */
export type GestureCancelReason =
    | "pointercancel"
    | "lostpointercapture"
    | "visibilitychange"
    | "window-blur"
    | "escape"
    | "suppression-key"
    | "timeout"
    | "manual"
    | "button-released";

/** Reasons a recognition result is marked invalid. */
export type InvalidReason =
    | "too-short"
    | "too-many-segments"
    | "cancelled"
    | "empty";

/** Modifier keys that can temporarily disable gestures while held. */
export type SuppressionKey = "Alt" | "Control" | "Shift" | "Meta";

/** Trigger configuration for an input adapter. */
export interface GestureTriggerConfig {
    /** Pointer button that starts a gesture. 2 = right button. */
    button: number;
    /** Movement in px required to transition PENDING -> TRACKING. */
    activationDistance: number;
    /** Modifier key that temporarily disables gestures while held. */
    suppressionKey: SuppressionKey | null;
    /** Maximum gesture duration in ms before auto-cancel. */
    timeoutMs: number;
}

/** Default trigger configuration (matches stage 1 requirements). */
export const DEFAULT_TRIGGER: GestureTriggerConfig = {
    button: 2,
    activationDistance: 16,
    suppressionKey: "Alt",
    timeoutMs: 2000,
};

/** Immutable snapshot of a gesture session, used for logging/serialisation. */
export interface GestureSessionSnapshot {
    id: number;
    state: GestureState;
    trigger: GestureTriggerConfig;
    points: GesturePoint[];
    startTime: number;
    endTime: number | null;
    durationMs: number | null;
    /** Whether the gesture ever reached TRACKING. */
    activated: boolean;
    cancelReason: GestureCancelReason | null;
}
