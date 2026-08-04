import { GestureSession } from "./GestureSession";
import { GestureEngine, RecognitionResult } from "./GestureEngine";
import { GestureState } from "./types";
import { GestureOverlay } from "./overlay/GestureOverlay";
import { OverlayI18n, OverlayState, OverlayStatus } from "./overlay/types";

/**
 * Coordinates the mouse gesture adapter, recognition engine, and visual
 * overlay.
 *
 * The controller subscribes to adapter callbacks and drives the overlay,
 * coalescing high-frequency `onUpdate` events into a single
 * `requestAnimationFrame` per frame.  This avoids redundant DOM/Canvas
 * work when pointer events fire faster than the display refresh rate.
 *
 * Lifecycle:
 *
 * - `onStateChange(PENDING)` → cancel stale hide timer, hide old trail,
 *   cancel pending RAF.  No visible feedback is shown.
 * - `onStateChange(TRACKING)` → `overlay.show()`, schedule first frame.
 * - `onUpdate(session)` → save latest snapshot, schedule RAF.
 * - RAF callback → run `engine.recognize()`, build `OverlayState`,
 *   `overlay.update()`.
 * - `onComplete(session)` → flush pending RAF, run final recognition,
 *   `overlay.showFinalThenHide()`.
 * - `onCancel(session)` → cancel RAF, `overlay.hide()`.
 *
 * **Timer competition**: when a new gesture starts (PENDING) while the
 * previous gesture's `showFinalThenHide` timer is still pending, the
 * controller immediately hides the old trail and cancels the timer via
 * `overlay.hide()`.  This prevents the stale timer from hiding the new
 * gesture's trail.
 *
 * The controller does **not** own the adapter; the caller (index.ts) is
 * responsible for attaching/detaching it.  The controller does own the
 * overlay and engine references it receives.
 */
export class GestureFeedbackController {
    private readonly engine: GestureEngine;
    private readonly overlay: GestureOverlay;
    private latestSession: GestureSession | null = null;
    private rafId: number | null = null;

    constructor(engine: GestureEngine, overlay: GestureOverlay) {
        this.engine = engine;
        this.overlay = overlay;
    }

    // --------------------------------------------------------- adapter bridge

    /**
     * Called when the adapter reports a state change.
     *
     * PENDING: a new gesture has started (pointerdown).  Cancel any stale
     * hide timer and clear the old trail so it does not bleed into the new
     * gesture.  No visible feedback is shown until TRACKING.
     *
     * TRACKING: the gesture has exceeded the activation distance.  Show the
     * overlay and start rendering frames.
     */
    onStateChange(session: GestureSession): void {
        if (session.state === GestureState.PENDING) {
            // New gesture started — cancel stale hide timer and clear old
            // trail/hint from the previous gesture's showFinalThenHide().
            this.cancelFrame();
            this.overlay.hide();
            this.latestSession = session;
            return;
        }
        if (session.state === GestureState.TRACKING) {
            // overlay.show() defensively cancels any remaining hide timer.
            this.overlay.show();
            this.latestSession = session;
            this.scheduleFrame();
        }
    }

    /** Called on each pointermove during TRACKING. */
    onUpdate(session: GestureSession): void {
        this.latestSession = session;
        this.scheduleFrame();
    }

    /** Called when the gesture completes normally. */
    onComplete(session: GestureSession): void {
        // Flush any pending frame so the final pointerup point is drawn.
        this.latestSession = session;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        const result = this.engine.recognize(session);
        const state = this.buildState(session, result);
        this.overlay.showFinalThenHide(state);
        this.latestSession = null;
    }

    /** Called when the gesture is cancelled. */
    onCancel(_session: GestureSession): void {
        this.cancelFrame();
        this.overlay.hide();
        this.latestSession = null;
    }

    // --------------------------------------------------------------- lifecycle

    /** Tear down: cancel RAF and destroy the overlay. */
    destroy(): void {
        this.cancelFrame();
        this.overlay.destroy();
        this.latestSession = null;
    }

    // --------------------------------------------------------------- internals

    /**
     * Schedule a single RAF for the current frame.  If a frame is already
     * pending, do nothing — the latest session reference is already updated.
     */
    private scheduleFrame(): void {
        if (this.rafId !== null) {
            return;
        }
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.renderFrame();
        });
    }

    private cancelFrame(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /** RAF callback: recognise the latest session and update the overlay. */
    private renderFrame(): void {
        const session = this.latestSession;
        if (!session || session.state !== GestureState.TRACKING) {
            return;
        }
        const result = this.engine.recognize(session);
        const state = this.buildState(session, result);
        this.overlay.update(state);
    }

    /**
     * Build an {@link OverlayState} from the session and recognition result.
     */
    private buildState(session: GestureSession, result: RecognitionResult): OverlayState {
        const points = session.points.map((p) => ({ x: p.x, y: p.y }));
        let status: OverlayStatus;
        if (session.state === GestureState.COMPLETED) {
            status = result.valid ? "complete" : (result.invalidReason === "too-many-segments" ? "too-long" : "empty");
        } else if (result.invalidReason === "too-many-segments") {
            status = "too-long";
        } else if (result.directions.length === 0) {
            status = "idle";
        } else {
            status = "tracking";
        }
        return {
            points,
            directions: result.directions,
            status,
            commandLabel: null,
        };
    }
}

/**
 * Convenience factory: build a controller with the given engine and i18n.
 */
export function createFeedbackController(
    engine: GestureEngine,
    i18n: OverlayI18n,
): GestureFeedbackController {
    const overlay = new GestureOverlay(i18n);
    return new GestureFeedbackController(engine, overlay);
}
