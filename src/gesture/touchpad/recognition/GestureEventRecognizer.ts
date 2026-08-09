import { TouchpadFrame } from "@/touchpad/types";
import { TouchpadGestureKind } from "@/gesture/touchpad/types";
import { classifyDirection } from "./contactMath";
import { TouchpadRecognitionResult, TouchpadTrackerConfig } from "./TouchpadGestureTracker";

/**
 * Recognizer for gesture-event frames (Electron `webContents` `input-event`
 * observer source).
 *
 * The provider already accumulates per-session totals (scroll deltas, pinch
 * scale) into the `end` frames, so this recognizer is stateless: it turns one
 * complete gesture-event sequence into a {@link TouchpadRecognitionResult}.
 *
 * **Honesty contract**: the recognizer only emits results whose finger count
 * is *guaranteed by the OS gesture type*:
 *
 *   - `gestureScroll*`   → 2-finger swipe (touchpad scroll is two-finger)
 *   - `gesturePinch*`    → 2-finger pinch
 *   - `gestureTwoFingerTap` → 2-finger tap
 *   - `gestureTap`       → 1-finger tap (only when explicitly enabled)
 *
 * It never emits 3/4/5-finger results, never guesses a shape, and never
 * fabricates contacts.  `longPress` / `longTap` / `doubleTap` are surfaced to
 * the diagnostics UI but are NOT dispatched (their finger count is ambiguous).
 */
export function recognizeGestureEventFrame(
    frame: TouchpadFrame,
    config: Pick<TouchpadTrackerConfig, "swipeMinDistance" | "pinchThreshold">,
    enabledKinds: Set<TouchpadGestureKind> | null,
): TouchpadRecognitionResult | null {
    if (frame.source !== "gesture-events" || !frame.gesture) return null;
    const gesture = frame.gesture;
    const all = enabledKinds === null;
    const wants = (kind: TouchpadGestureKind): boolean => all || (enabledKinds?.has(kind) ?? false);

    switch (gesture.type) {
        case "scroll":
            if (gesture.state !== "end") return null;
            if (!wants("swipe")) return null;
            {
                const dx = gesture.deltaX;
                const dy = gesture.deltaY;
                const mag = Math.hypot(dx, dy);
                if (mag < config.swipeMinDistance) return null;
                // Map OS scroll deltas into a screen-ish direction (dy is
                // negative when content scrolls down / fingers move up).
                const dir = classifyDirection(-dx, -dy, 8);
                return { valid: true, kind: "swipe", fingerCount: 2, directions: [dir] };
            }
        case "pinch":
            if (gesture.state !== "end") return null;
            if (!wants("pinch")) return null;
            {
                const scale = gesture.scale;
                if (scale <= 0 || !Number.isFinite(scale)) return null;
                if (scale >= 1 + config.pinchThreshold) {
                    return { valid: true, kind: "pinch", fingerCount: 2, directions: [], pinchDirection: "out" };
                }
                if (scale <= 1 - config.pinchThreshold) {
                    return { valid: true, kind: "pinch", fingerCount: 2, directions: [], pinchDirection: "in" };
                }
                return null;
            }
        case "twoFingerTap":
            if (!wants("tap")) return null;
            return { valid: true, kind: "tap", fingerCount: 2, directions: [] };
        case "tap":
            // Single-finger tap conflicts with the system click; it is only
            // produced when the caller explicitly enables 1-finger taps
            // (safe mode off + a bound 1-finger tap).
            if (!all) return null;
            return { valid: true, kind: "tap", fingerCount: 1, directions: [] };
        default:
            // longPress / longTap / doubleTap — ambiguous finger count, never
            // dispatched.  The diagnostics UI still shows the raw event.
            return null;
    }
}

/** Map a gesture-event frame to a direction label for the diagnostics UI. */
export function gestureEventLabel(frame: TouchpadFrame): string | null {
    const g = frame.gesture;
    if (!g) return null;
    switch (g.type) {
        case "scroll":
            return `scroll:${g.state}`;
        case "pinch":
            return `pinch:${g.state}`;
        case "tap":
            return "tap";
        case "twoFingerTap":
            return "two-finger tap";
        case "longPress":
            return "long-press";
        case "longTap":
            return "long-tap";
        case "doubleTap":
            return "double-tap";
        default:
            return null;
    }
}

/** Structured event detail for the diagnostics UI (observer mode). */
export function gestureEventDetail(
    frame: TouchpadFrame,
): import("@/runtime/TouchpadRuntimeState").TouchpadEventDetail | null {
    const g = frame.gesture;
    if (!g) return null;
    switch (g.type) {
        case "scroll":
            return { type: `gestureScroll${capitalize(g.state)}`, state: g.state, deltaX: g.deltaX, deltaY: g.deltaY };
        case "pinch":
            return { type: `gesturePinch${capitalize(g.state)}`, state: g.state, scale: g.scale };
        case "tap":
            return { type: "gestureTap" };
        case "twoFingerTap":
            return { type: "gestureTwoFingerTap" };
        case "longPress":
            return { type: "gestureLongPress" };
        case "longTap":
            return { type: "gestureLongTap" };
        case "doubleTap":
            return { type: "gestureDoubleTap" };
        default:
            return null;
    }
}

function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
