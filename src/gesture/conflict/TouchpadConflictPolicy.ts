import { TouchpadCapabilities } from "@/touchpad/types";
import { TouchpadGestureSpec } from "@/gesture/touchpad/types";

/**
 * Touchpad system-gesture conflict policy.
 *
 * GestureFlow never `preventDefault`s touchpad input (the providers are
 * observers) — so Windows' own 1/2-finger behaviours always keep working.
 * The policy instead classifies *how likely a GestureFlow gesture is to
 * collide with a default Windows touchpad action* so the UI can warn the
 * user honestly:
 *
 *   none      — GestureFlow can take over this system gesture (native
 *               controller), so no double-trigger is expected.
 *   possible  — may coexist with a system action (e.g. rotate has no
 *               Windows default, but the platform is not fully known).
 *   high      — the system also performs this gesture (1/2-finger click /
 *               scroll / right-click / zoom, or a 3/4/5-finger gesture the
 *               current provider cannot take over) — both may fire.
 *
 * Safe mode (default ON) additionally *blocks dispatch* of every 1/2-finger
 * gesture so ordinary clicks, scrolling, right-click and pinch-zoom stay
 * untouched.  Only 3+ finger gestures dispatch in safe mode.
 */

export type ConflictLevel = "none" | "possible" | "high";

/** Compute the conflict level of a gesture spec against the current provider. */
export function computeConflictLevel(
    spec: TouchpadGestureSpec,
    caps: TouchpadCapabilities,
): ConflictLevel {
    const fingerCount = spec.fingerCount;

    if (spec.kind === "rotate") {
        // Windows has no default rotate gesture on the touchpad.
        return "possible";
    }

    if (fingerCount <= 2) {
        // 1/2-finger tap/press/hold/swipe/shape/anchorDraw/pinch collide with
        // the system's own click / scroll / right-click / zoom.
        return "high";
    }

    // 3/4/5-finger gestures: only conflict-free when the native controller
    // can take the gesture over.
    if (caps.canOverrideSystemGestures) {
        return spec.kind === "anchorDraw" ? "possible" : "none";
    }

    if (spec.kind === "anchorDraw") {
        return "high";
    }

    // Without takeover the OS may still react (e.g. virtual-desktop switch).
    return "possible";
}

export interface DispatchDecision {
    allowed: boolean;
    reason: string | null;
}

/**
 * Whether a gesture may be dispatched given the current mode.
 *
 * Safe mode protects the system's 1/2-finger behaviours: only 3+ finger
 * gestures dispatch.  Turning safe mode off lets advanced users bind
 * 1/2-finger gestures (the conflict level still tells them the risk).
 */
export function dispatchAllowed(
    spec: TouchpadGestureSpec,
    safeMode: boolean,
): DispatchDecision {
    if (!safeMode) {
        return { allowed: true, reason: null };
    }
    if (spec.fingerCount >= 3) {
        return { allowed: true, reason: null };
    }
    return {
        allowed: false,
        reason: `blocked by safe mode (${spec.fingerCount}-finger gesture left to the system)`,
    };
}

/** Whether a provider can deliver the given gesture kind at all. */
export function providerSupportsKind(
    spec: TouchpadGestureSpec,
    caps: TouchpadCapabilities,
): boolean {
    if (spec.kind === "press") {
        return caps.supportsPress === true;
    }
    if (spec.kind === "shape" || spec.kind === "anchorDraw") {
        // Shape/anchorDraw need real contact frames (per-contact geometry).
        return caps.supportsRawContacts === true;
    }
    if (!caps.supportsRawContacts) {
        // Observer mode can only deliver 2-finger swipe / pinch / tap
        // (from the OS gesture recognizer).  It never fakes other counts.
        if (spec.fingerCount !== 2) return false;
        return spec.kind === "swipe" || spec.kind === "pinch" || spec.kind === "tap";
    }
    if (caps.maxContacts > 0 && spec.fingerCount > caps.maxContacts) {
        // More fingers than the device can track.
        return false;
    }
    return true;
}
