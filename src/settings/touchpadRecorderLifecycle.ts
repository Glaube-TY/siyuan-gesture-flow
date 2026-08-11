import type { TouchpadLiveState } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
import type { TouchpadFrame } from "@/touchpad/types";

/**
 * Some precision-touchpad drivers stop producing HID reports as soon as the
 * last finger lifts instead of emitting one final empty-contact report.
 * Continuous reports while fingers are down keep resetting this watchdog.
 */
export const RECORDER_RELEASE_IDLE_MS = 450;

/** A tiny but visible movement in normalised touchpad coordinates. */
export const RECORDER_TRAIL_MIN_MOVEMENT = 0.002;

/** A recorder result is committed only after every physical contact is up. */
export function shouldCommitRecorderResult(contactCount: number): boolean {
    return contactCount === 0;
}

/** Only infer release after real movement established an active gesture. */
export function shouldArmRecorderReleaseWatchdog(
    live: Pick<TouchpadLiveState, "stage" | "runActive" | "displayPath" | "displayContactPaths">,
    contactCount: number,
): boolean {
    if (!live.runActive || live.stage !== "TRACKING" || contactCount < 2) return false;
    return (
        live.displayPath.length >= 2 ||
        live.displayContactPaths.some((path) => path.points.length >= 2)
    );
}

/**
 * Whether recorder-owned per-contact trails contain real movement.
 *
 * The recorder keeps this raw-frame trail as a display/lifecycle fallback so
 * a delayed recognizer stage transition can never hide a valid physical
 * gesture or prevent missing-release-frame recovery.
 */
export function hasRecorderContactMovement(
    paths: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number }> }>,
    minimumMovement = RECORDER_TRAIL_MIN_MOVEMENT,
): boolean {
    const thresholdSquared = minimumMovement * minimumMovement;
    return paths.some((path) => {
        const first = path.points[0];
        if (!first || path.points.length < 2) return false;
        return path.points.some((point) => {
            const dx = point.x - first.x;
            const dy = point.y - first.y;
            return dx * dx + dy * dy >= thresholdSquared;
        });
    });
}

/**
 * Build the explicit zero-contact frame the Tracker normally receives from
 * hardware. Keeping this transformation pure makes the missing-tail recovery
 * independently testable.
 */
export function recorderReleaseFrameAfterIdle(
    lastFrame: TouchpadFrame,
    elapsedMs = RECORDER_RELEASE_IDLE_MS,
): TouchpadFrame {
    return {
        timestamp: lastFrame.timestamp + Math.max(1, elapsedMs),
        contacts: [],
        source: "raw-contacts",
        ...(lastFrame.deviceId ? { deviceId: lastFrame.deviceId } : {}),
    };
}
