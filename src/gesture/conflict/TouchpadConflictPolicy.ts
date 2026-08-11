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
 *               scroll / right-click / zoom, or the observed 3-finger tap)
 *               — both may fire.
 *
 * Core system gestures are blocked by their actual motion semantics.  This
 * keeps one-finger pointing, two-finger tap/pan/zoom, and the locally observed
 * three-finger tap untouched. Merely being configurable in Windows Settings
 * is NOT enough to block a 3/4/5-finger gesture.
 */

export type ConflictLevel = "none" | "possible" | "high";

export type SystemGestureConflict =
    | "one-finger-pointer"
    | "two-finger-secondary-click"
    | "two-finger-pan"
    | "two-finger-zoom"
    | "system-multifinger-action";

const OPPOSITE_DIRECTION: Readonly<Record<string, string>> = {
    U: "D",
    D: "U",
    L: "R",
    R: "L",
    UL: "DR",
    DR: "UL",
    UR: "DL",
    DL: "UR",
};

function allContactPathsEqual(spec: TouchpadGestureSpec): boolean {
    if (spec.kind !== "multiShape" || spec.paths.length === 0) return false;
    const first = spec.paths[0].join("-");
    return spec.paths.every((path) => path.join("-") === first);
}

function isSimpleOpposingPair(spec: TouchpadGestureSpec): boolean {
    if (spec.kind !== "multiShape" || spec.paths.length !== 2) return false;
    const [a, b] = spec.paths;
    return a.length === 1 && b.length === 1 && OPPOSITE_DIRECTION[a[0]] === b[0];
}

/** Identify gestures reserved by the common Windows precision-touchpad language. */
export function systemGestureConflict(spec: TouchpadGestureSpec): SystemGestureConflict | null {
    if (spec.fingerCount <= 1) {
        return "one-finger-pointer";
    }
    if (spec.fingerCount === 2) {
        if (spec.kind === "tap" || spec.kind === "press") {
            return "two-finger-secondary-click";
        }
        if (spec.kind === "swipe" || spec.kind === "shape") {
            return "two-finger-pan";
        }
        if (spec.kind === "pinch") {
            return "two-finger-zoom";
        }
        if (allContactPathsEqual(spec)) {
            return "two-finger-pan";
        }
        if (isSimpleOpposingPair(spec)) {
            return "two-finger-zoom";
        }
        return null;
    }
    // On this machine 3/4-finger slides and 4-finger tap are disabled; they
    // are optional user mappings, not unavoidable built-ins.  Only the
    // physically observed 3-finger tap remains reserved.  Every 3+ finger
    // swipe/shape/multiShape/hold/pinch/rotate is available to GestureFlow.
    if (spec.fingerCount === 3 && spec.kind === "tap") {
        return "system-multifinger-action";
    }
    return null;
}

/** Compute the conflict level of a gesture spec against the current provider. */
export function computeConflictLevel(
    spec: TouchpadGestureSpec,
    caps: TouchpadCapabilities,
): ConflictLevel {
    const fingerCount = spec.fingerCount;

    if (systemGestureConflict(spec)) {
        return "high";
    }

    if (spec.kind === "rotate") {
        // Windows has no default rotate gesture on the touchpad.
        return "possible";
    }

    if (fingerCount <= 2) {
        // Independent per-contact paths, anchor drawing, and rotation are not
        // part of the core two-finger tap/pan/zoom vocabulary.
        return "possible";
    }

    // A native controller takeover removes even the possibility of an
    // optional user-mapped 3/4/5-finger action firing alongside the plugin.
    if (
        caps.canOverrideSystemGestures &&
        (!caps.overriddenGestureFingerCounts || caps.overriddenGestureFingerCounts.includes(fingerCount))
    ) {
        return spec.kind === "anchorDraw" ? "possible" : "none";
    }

    // Without takeover Windows or an OEM driver may have an optional custom
    // mapping, but that is not a reason to block the binding.
    return "possible";
}

export interface DispatchDecision {
    allowed: boolean;
    reason: string | null;
}

/**
 * Whether a gesture may be dispatched without duplicating a common system
 * action.  This is deliberately independent of a user-selectable mode.
 */
export function dispatchAllowed(spec: TouchpadGestureSpec): DispatchDecision {
    const conflict = systemGestureConflict(spec);
    if (!conflict) {
        return { allowed: true, reason: null };
    }
    return {
        allowed: false,
        reason: `blocked because it matches a built-in touchpad gesture (${conflict})`,
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
    if (spec.kind === "tap" && !caps.supportsMultiFingerTap) {
        return false;
    }
    if (spec.kind === "shape" || spec.kind === "multiShape" || spec.kind === "anchorDraw") {
        // Shape/anchorDraw need real contact frames (per-contact geometry).
        return caps.supportsRawContacts === true;
    }
    if (!caps.supportsRawContacts) {
        if (!caps.observerMode) return false;
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
