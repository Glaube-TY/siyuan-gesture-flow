import {
    GestureCancelReason,
    GesturePoint,
    GestureSessionSnapshot,
    GestureState,
    GestureTriggerConfig,
} from "./types";

let nextSessionId = 1;

/**
 * Accumulates the data of a single gesture lifecycle.
 *
 * A GestureSession is created when the trigger button goes down (state PENDING)
 * and is mutated by the input adapter as the gesture progresses. Terminal
 * states are COMPLETED (pointerup while TRACKING) and CANCELLED.
 */
export class GestureSession {
    readonly id: number;
    state: GestureState = GestureState.PENDING;
    readonly trigger: GestureTriggerConfig;
    readonly points: GesturePoint[] = [];
    readonly startTime: number;
    endTime: number | null = null;
    cancelReason: GestureCancelReason | null = null;
    /** Set true once TRACKING has been reached, never reset afterwards. */
    private activatedOnce = false;

    constructor(trigger: GestureTriggerConfig) {
        this.id = nextSessionId++;
        this.trigger = { ...trigger };
        this.startTime = now();
    }

    /** Whether the gesture ever reached the TRACKING state. */
    get activated(): boolean {
        return this.activatedOnce;
    }

    get durationMs(): number | null {
        return this.endTime === null ? null : this.endTime - this.startTime;
    }

    get pointCount(): number {
        return this.points.length;
    }

    addPoint(x: number, y: number, t: number): void {
        this.points.push({ x, y, t });
    }

    /** Transition PENDING -> TRACKING. */
    activate(): void {
        this.activatedOnce = true;
        this.state = GestureState.TRACKING;
    }

    /** Mark the session as finished normally (TRACKING -> COMPLETED). */
    complete(): void {
        this.endTime = now();
        this.state = GestureState.COMPLETED;
    }

    /** Mark the session as cancelled. */
    cancel(reason: GestureCancelReason): void {
        this.endTime = now();
        this.state = GestureState.CANCELLED;
        this.cancelReason = reason;
    }

    toJSON(): GestureSessionSnapshot {
        return {
            id: this.id,
            state: this.state,
            trigger: this.trigger,
            points: this.points.slice(),
            startTime: this.startTime,
            endTime: this.endTime,
            durationMs: this.durationMs,
            activated: this.activatedOnce,
            cancelReason: this.cancelReason,
        };
    }
}

function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}
