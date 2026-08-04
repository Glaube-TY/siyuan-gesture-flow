import { Direction } from "../recognition/DirectionVectorizer";

/**
 * The visual status the overlay hint can display.
 *
 * - `idle`      — path too short / waiting; no hint shown.
 * - `tracking`  — showing the live direction sequence.
 * - `too-long`  — exceeded maximum segments; localised warning shown.
 * - `complete`  — final result shown briefly before hiding.
 * - `empty`     — no recognisable direction; brief "unrecognised" or hidden.
 */
export type OverlayStatus = "idle" | "tracking" | "too-long" | "complete" | "empty";

/**
 * Snapshot of the current feedback state, passed to the overlay for rendering.
 */
export interface OverlayState {
    /** Raw gesture points (CSS pixel coordinates). */
    points: { x: number; y: number }[];
    /** Current direction sequence (empty when not yet recognisable). */
    directions: Direction[];
    /** Visual status of the hint. */
    status: OverlayStatus;
    /** Localised label for the bound command (future use, currently null). */
    commandLabel: string | null;
}

/**
 * Localised strings used by the overlay hint.
 */
export interface OverlayI18n {
    gestureTooLong: string;
    gestureUnrecognised: string;
}
