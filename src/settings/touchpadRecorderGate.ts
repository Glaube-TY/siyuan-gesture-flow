/**
 * Pure release-gate logic for the touchpad recorder's PREPARING state.
 *
 * The recorder must ONLY arm (become ready to accept a new gesture) after a
 * CONFIRMED 0-contact frame plus a short quiet gate.  Mere frame inactivity
 * is never enough: a finger held still on the touchpad may produce no Raw
 * Input frames, so "no frames for a while" ≠ "no fingers".
 *
 * This helper keeps the decision logic dependency-free so it can be tested
 * directly (the actual 150 ms timer lives in the Recorder component).
 */

/** Quiet gate duration after a confirmed 0-contact frame (ms). */
export const RELEASE_QUIET_MS = 150;

export interface ReleaseGateState {
    /** A frame with 0 touching contacts arrived during PREPARING. */
    zeroContactConfirmed: boolean;
    /** Contact count from the most recent frame. */
    currentContactCount: number;
}

/** Initialise the gate for a PREPARING cycle. */
export function createReleaseGate(currentContactCount: number): ReleaseGateState {
    return {
        zeroContactConfirmed: currentContactCount === 0,
        currentContactCount,
    };
}

/** Feed one raw frame's contact count through the gate. */
export function onGateFrame(state: ReleaseGateState, contactCount: number): ReleaseGateState {
    return {
        zeroContactConfirmed: state.zeroContactConfirmed || contactCount === 0,
        currentContactCount: contactCount,
    };
}

/**
 * Whether the recorder may ARM.  Requires a confirmed 0-contact frame AND a
 * quiet gate that has elapsed — a bare inactivity timeout must never arm.
 */
export function canArmReleaseGate(state: ReleaseGateState, quietGateElapsedMs: number): boolean {
    return (
        state.zeroContactConfirmed &&
        state.currentContactCount === 0 &&
        quietGateElapsedMs >= RELEASE_QUIET_MS
    );
}
