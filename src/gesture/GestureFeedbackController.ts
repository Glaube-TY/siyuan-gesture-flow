import { GestureSession } from "./GestureSession";
import { GestureEngine, RecognitionResult } from "./GestureEngine";
import { GestureState } from "./types";
import { GestureOverlay } from "./overlay/GestureOverlay";
import { OverlayState, OverlayStatus } from "./overlay/types";
import { Direction } from "./recognition/DirectionVectorizer";
import { CommandLabelResolver } from "./bindings/CommandLabelResolver";

/** Options for constructing a GestureFeedbackController. */
export interface FeedbackControllerOptions {
    engine: GestureEngine;
    overlay: GestureOverlay;
    /** Resolver for live command labels (null = no command labels). */
    commandLabelResolver?: CommandLabelResolver | null;
    /**
     * Optional callback invoked once per completed gesture.
     *
     * May be sync (returning `void`) or async (returning `Promise<void>`).
     * The controller does **not** await the returned promise — the
     * overlay's final-frame feedback is shown immediately and never
     * blocks on command execution.  Rejections are caught internally so
     * they never surface as unhandled promise rejections or break the
     * feedback loop.
     */
    onGestureComplete?: (session: GestureSession, result: RecognitionResult) => void | Promise<void>;
    /**
     * Optional error handler invoked when the completion callback throws
     * (sync) or rejects (async).  Defaults to a concise `console.error`.
     * In production only a short label is logged; the error object is
     * never serialised.
     */
    onCallbackError?: (err: unknown) => void;
}

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
 * - `onComplete(session)` → flush pending RAF, run final recognition
 *   (returned to caller), `overlay.showFinalThenHide()`.
 * - `onCancel(session)` → cancel RAF, `overlay.hide()`.
 *
 * **Command label resolution**: if a {@link CommandLabelResolver} is
 * provided, the controller calls it during each frame to populate the
 * overlay's `commandLabel` field.  The controller does **not** access
 * the {@link CommandRegistry} or {@link GestureBindingRegistry} directly.
 *
 * **Completion callback**: {@link onComplete} returns the final
 * {@link RecognitionResult} so the caller (index.ts) can execute the
 * bound command without re-running recognition.
 */
export class GestureFeedbackController {
    private readonly engine: GestureEngine;
    private readonly overlay: GestureOverlay;
    private readonly commandLabelResolver: CommandLabelResolver | null;
    private readonly onGestureComplete:
        | ((session: GestureSession, result: RecognitionResult) => void | Promise<void>)
        | null;
    private readonly onCallbackError: (err: unknown) => void;
    private latestSession: GestureSession | null = null;
    private rafId: number | null = null;
    /** Tracks the last completed session id to prevent duplicate callbacks. */
    private lastCompletedSessionId: number | null = null;

    constructor(opts: FeedbackControllerOptions) {
        this.engine = opts.engine;
        this.overlay = opts.overlay;
        this.commandLabelResolver = opts.commandLabelResolver ?? null;
        this.onGestureComplete = opts.onGestureComplete ?? null;
        this.onCallbackError = opts.onCallbackError ?? defaultCallbackErrorHandler;
    }

    // --------------------------------------------------------- adapter bridge

    onStateChange(session: GestureSession): void {
        if (session.state === GestureState.PENDING) {
            this.cancelFrame();
            this.overlay.hide();
            this.latestSession = session;
            return;
        }
        if (session.state === GestureState.TRACKING) {
            this.overlay.show();
            this.latestSession = session;
            this.scheduleFrame();
        }
    }

    onUpdate(session: GestureSession): void {
        this.latestSession = session;
        this.scheduleFrame();
    }

    /**
     * Called when the gesture completes normally.
     *
     * Returns the final {@link RecognitionResult} so the caller can
     * execute the bound command.  Recognition is run exactly once here;
     * the caller must **not** call `engine.recognize(session)` again.
     *
     * The {@link onGestureComplete} callback (if provided) is invoked
     * exactly once per session id — duplicate `onComplete` calls for the
     * same session are silently ignored.
     *
     * The callback may be sync or async.  The controller does **not**
     * await async callbacks — the overlay's final-frame feedback is
     * shown immediately and never blocks on command execution.  Async
     * rejections are caught via `Promise.resolve(...).catch(...)` so
     * they never surface as unhandled promise rejections or break the
     * feedback loop.
     */
    onComplete(session: GestureSession): RecognitionResult {
        this.latestSession = session;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        const result = this.engine.recognize(session);
        const state = this.buildState(session, result);
        // Show the final frame immediately — command execution must not
        // delay the visual feedback.
        this.overlay.showFinalThenHide(state);
        this.latestSession = null;

        // De-duplicate: invoke the completion callback at most once per
        // session id.  This guards against adapter bugs or accidental
        // double-calls without growing an unbounded set.
        if (this.lastCompletedSessionId !== session.id) {
            this.lastCompletedSessionId = session.id;
            if (this.onGestureComplete) {
                this.invokeCompletionCallback(session, result);
            }
        }

        return result;
    }

    onCancel(_session: GestureSession): void {
        this.cancelFrame();
        this.overlay.hide();
        this.latestSession = null;
    }

    // --------------------------------------------------------------- lifecycle

    destroy(): void {
        this.cancelFrame();
        this.overlay.destroy();
        this.latestSession = null;
        this.lastCompletedSessionId = null;
    }

    // --------------------------------------------------------------- internals

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

    private renderFrame(): void {
        const session = this.latestSession;
        if (!session || session.state !== GestureState.TRACKING) {
            return;
        }
        const result = this.engine.recognize(session);
        const state = this.buildState(session, result);
        this.overlay.update(state);
    }

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

        // Resolve command label for the current directions.
        let commandLabel: string | null = null;
        if (this.commandLabelResolver && result.directions.length > 0) {
            commandLabel = this.commandLabelResolver(result.directions as readonly Direction[]);
        }

        return {
            points,
            directions: result.directions,
            status,
            commandLabel,
        };
    }

    /**
     * Invoke the completion callback, handling both sync and async
     * rejections safely.
     *
     * - Synchronous throws are caught immediately.
     * - Async rejections are caught via `Promise.resolve(...).catch(...)`.
     *
     * Either way, {@link onCallbackError} is invoked with the error so
     * the caller can log it concisely.  The error is never re-thrown,
     * so a failing callback cannot break the overlay or prevent
     * subsequent gestures.
     */
    private invokeCompletionCallback(
        session: GestureSession,
        result: RecognitionResult,
    ): void {
        try {
            const ret = this.onGestureComplete!(session, result);
            // Promise.resolve wraps both `void` and `Promise<void>` —
            // if the callback was sync, the promise is already resolved
            // and `.catch` is a no-op.
            if (ret && typeof (ret as Promise<void>).then === "function") {
                (ret as Promise<void>).catch((err) => {
                    this.onCallbackError(err);
                });
            }
        } catch (err) {
            // Synchronous throw — handle immediately.
            this.onCallbackError(err);
        }
    }
}

/**
 * Default error handler for the completion callback.
 *
 * Logs a short label without serialising the error object, so no
 * internal structures or user data leak to the console in production.
 */
function defaultCallbackErrorHandler(err: unknown): void {
    const label = err instanceof Error ? err.name : typeof err;
    console.error(`[GestureFlow] onGestureComplete callback failed (${label})`);
}
