import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import {
    TouchpadGestureSpec,
    hasDirections,
    specDirections,
} from "@/gesture/touchpad/types";

/**
 * Gesture signatures — the stable, source-aware identity of a gesture.
 *
 * A signature is a canonical string that uniquely identifies *how* a gesture
 * is performed across every input source, so that bindings from different
 * inputs can never collide and the binding registry can resolve them
 * unambiguously:
 *
 *   mouse:2:shape:L-D
 *   touchpad:3:tap
 *   touchpad:4:swipe:L
 *   touchpad:3:shape:L-D-R
 *   touchpad:3:anchorDraw:2:U-R-D
 *   touchpad:2:pinch:in
 *   touchpad:3:rotate:cw
 *
 * The format is stable and parsed only for display/debugging — bindings are
 * always stored and matched by the full signature string, never by partial
 * fields.
 */

/** Canonical gesture signature string (see module docs for the format). */
export type GestureSignatureKey = string;

/** Input source of a gesture. */
export type GestureSource = "mouse" | "touchpad";

/**
 * Canonical signature for a mouse gesture: `mouse:<button>:shape:<dirs>`.
 *
 * @param button pointer button that triggers the gesture (2 = right).
 * @param directions the recognised direction sequence.
 */
export function mouseSignature(button: number, directions: readonly Direction[]): GestureSignatureKey {
    return `mouse:${button}:shape:${directions.join("-")}`;
}

/**
 * Canonical signature for a touchpad gesture descriptor.
 *
 * Direction-bearing kinds append their direction sequence; anchorDraw also
 * appends the anchor count so `2 fingers / 1 anchor` and
 * `3 fingers / 2 anchors` stay distinct.
 */
export function touchpadSignature(spec: TouchpadGestureSpec): GestureSignatureKey {
    const base = `touchpad:${spec.fingerCount}:${spec.kind}`;
    if (hasDirections(spec)) {
        const dirs = specDirections(spec).join("-");
        if (spec.kind === "anchorDraw") {
            return `${base}:${spec.anchorCount}:${dirs}`;
        }
        return `${base}:${dirs}`;
    }
    if (spec.kind === "pinch") {
        return `${base}:${spec.direction}`;
    }
    if (spec.kind === "rotate") {
        return `${base}:${spec.direction}`;
    }
    return base;
}
