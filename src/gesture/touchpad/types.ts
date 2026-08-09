import { Direction } from "@/gesture/recognition/DirectionVectorizer";

/**
 * Touchpad gesture descriptors (config + signature layer).
 *
 * These are the **persisted, serialisable** shapes that describe a single
 * touchpad gesture a binding can trigger.  They are deliberately separate
 * from the low-level {@link TouchpadFrame} contact data: a descriptor
 * answers "what gesture", a frame answers "what is happening right now".
 *
 * Every descriptor carries the exact number of fingers it requires
 * (`fingerCount`).  Finger counts are never inferred from "this looks like
 * a two-finger gesture" — they come from the hardware contact frame (or, in
 * the compatibility observer mode, from the OS gesture recognizer, which
 * knows the count).
 *
 * Note: the direction-bearing kinds (swipe / shape / anchorDraw) reuse the
 * exact {@link Direction} vocabulary and the same GestureEngine pipeline as
 * the mouse so recognition stays consistent across input sources.
 */

/** Gesture kinds implemented by the touchpad recognizer. */
export type TouchpadGestureKind =
    | "tap"
    | "press"
    | "hold"
    | "swipe"
    | "shape"
    | "anchorDraw"
    | "pinch"
    | "rotate";

/** Pinch direction. */
export type PinchDirection = "in" | "out";

/** Rotate direction. */
export type RotateDirection = "cw" | "ccw";

/** Tap: all fingers land and lift within a short window, movement below threshold. */
export interface TapGestureSpec {
    readonly kind: "tap";
    readonly fingerCount: number;
}

/** Press: the physical touchpad surface button is pressed with `fingerCount` fingers. */
export interface PressGestureSpec {
    readonly kind: "press";
    readonly fingerCount: number;
}

/** Hold: fingers stay still for longer than the hold duration. */
export interface HoldGestureSpec {
    readonly kind: "hold";
    readonly fingerCount: number;
}

/** Swipe: all active fingers move together in one direction (centroid motion). */
export interface SwipeGestureSpec {
    readonly kind: "swipe";
    readonly fingerCount: number;
    readonly direction: Direction;
}

/** Shape: multi-finger centroid path is run through the GestureEngine. */
export interface ShapeGestureSpec {
    readonly kind: "shape";
    readonly fingerCount: number;
    readonly directions: Direction[];
}

/**
 * AnchorDraw: one or more fingers stay roughly stationary (anchors) while
 * another finger draws a path.  The tracer path is recognised by the
 * GestureEngine.
 */
export interface AnchorDrawGestureSpec {
    readonly kind: "anchorDraw";
    readonly fingerCount: number;
    readonly anchorCount: number;
    readonly directions: Direction[];
}

/** Pinch: fingers move towards / away from each other. */
export interface PinchGestureSpec {
    readonly kind: "pinch";
    readonly fingerCount: number;
    readonly direction: PinchDirection;
}

/** Rotate: fingers rotate around a common centre. */
export interface RotateGestureSpec {
    readonly kind: "rotate";
    readonly fingerCount: number;
    readonly direction: RotateDirection;
}

/** Union of all touchpad gesture descriptors. */
export type TouchpadGestureSpec =
    | TapGestureSpec
    | PressGestureSpec
    | HoldGestureSpec
    | SwipeGestureSpec
    | ShapeGestureSpec
    | AnchorDrawGestureSpec
    | PinchGestureSpec
    | RotateGestureSpec;

/** Maximum finger count a binding may declare (hard UI/validation ceiling). */
export const MAX_TOUCHPAD_FINGERS = 10;

/** Minimum finger count a binding may declare. */
export const MIN_TOUCHPAD_FINGERS = 1;

/** Whether the descriptor carries a direction sequence (reuses GestureEngine). */
export function hasDirections(
    spec: TouchpadGestureSpec,
): spec is SwipeGestureSpec | ShapeGestureSpec | AnchorDrawGestureSpec {
    return (
        spec.kind === "swipe" ||
        spec.kind === "shape" ||
        spec.kind === "anchorDraw"
    );
}

/** Directions of a direction-bearing descriptor (empty otherwise). */
export function specDirections(spec: TouchpadGestureSpec): readonly Direction[] {
    if (spec.kind === "swipe") return [spec.direction];
    if (spec.kind === "shape" || spec.kind === "anchorDraw") return spec.directions;
    return [];
}
