import { GestureCancelReason, GestureState } from "../types";
import { GestureSession } from "../GestureSession";
import { GestureTriggerConfig } from "../types";
import { InputAdapter, GestureAdapterEvents } from "./InputAdapter";

/**
 * Additional construction options for {@link MouseGestureAdapter}.
 */
export interface MouseGestureAdapterOptions {
    /**
     * Generic input-target exclusion predicate (stage 5B).
     *
     * When the predicate returns true for an event's target, the adapter
     * completely ignores that interaction: no GestureSession is created
     * and no `contextmenu` is intercepted (the target handles its own
     * right-click, e.g. the settings gesture recorder).
     *
     * The predicate is a general input filter — it must not hard-code
     * directions or commands.  The runtime supplies a default that
     * excludes elements marked with `data-gesture-flow-recorder`.
     */
    shouldIgnoreTarget?: (target: EventTarget | null) => boolean;
}

/**
 * A snapshot of an intercepted `contextmenu` event, retained for potential
 * replay if the right-click turns out to be a plain click (no gesture).
 */
interface ContextmenuSnapshot {
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    target: EventTarget | null;
}

/**
 * Mouse gesture adapter based on PointerEvent.
 *
 * All pointer listeners are registered in the **capture phase** so the
 * adapter observes events before SiYuan's own handlers can call
 * `stopPropagation()`.  `setPointerCapture` is used on the pointerdown target
 * so the gesture keeps receiving events even when the pointer leaves the
 * original element.
 *
 * ---
 *
 * **contextmenu coordination — "capture first, decide later"**
 *
 * On Windows / Electron the `contextmenu` event may fire at various points
 * relative to pointer events:
 *
 *   pointerdown → contextmenu → pointermove* → pointerup
 *   pointerdown → pointermove* → pointerup → contextmenu
 *   pointerdown → pointermove* → contextmenu → pointerup
 *
 * The previous approach (only suppress once TRACKING is reached) fails when
 * `contextmenu` fires before the pointer has moved past the activation
 * threshold — the menu appears mid-gesture and cannot be retroactively
 * hidden.
 *
 * The new model intercepts **every** `contextmenu` that arrives while a
 * right-click session is active (PENDING or TRACKING), **and** for a brief
 * suppression window after a confirmed gesture ends:
 *
 * - If the session later reaches TRACKING and completes/cancels, the
 *   intercepted event is **discarded** and a post-gesture suppression window
 *   is started — no menu is shown, even if the platform dispatches a trailing
 *   `contextmenu` after `pointerup`.
 * - If the session ends in PENDING (plain right-click, no gesture), the
 *   intercepted event is **replayed** exactly once via a microtask, so the
 *   user sees the normal SiYuan context menu.
 * - If no session is active and no suppression window is open
 *   (Alt-suppressed, non-mouse, different button, or idle), the
 *   `contextmenu` passes through untouched.
 * - The suppression window is short (~400 ms) and is terminated immediately
 *   by a new `pointerdown`, so the next independent right-click is never
 *   affected.
 *
 * Replayed events are marked with a private `WeakSet` so the adapter does
 * not re-intercept its own replay.
 *
 * The `contextmenu` listener is registered on `window` in the **capture
 * phase**, ensuring it runs before any `document`-level or element-level
 * SiYuan handlers.
 */
export class MouseGestureAdapter extends InputAdapter {
    private target: EventTarget | null = null;
    private capturedElement: Element | null = null;
    private pointerId: number | null = null;
    private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    private attached = false;
    private readonly shouldIgnoreTarget: (target: EventTarget | null) => boolean;

    constructor(
        config: GestureTriggerConfig,
        events: GestureAdapterEvents,
        options: MouseGestureAdapterOptions = {},
    ) {
        super(config, events);
        this.shouldIgnoreTarget = options.shouldIgnoreTarget ?? (() => false);
    }

    /**
     * Snapshot of the intercepted `contextmenu` event, or `null` if no
     * contextmenu has been intercepted during the current session.
     */
    private contextmenuSnapshot: ContextmenuSnapshot | null = null;

    /**
     * True once the session reached TRACKING.  Stays true until the next
     * pointerdown.  Used to distinguish gesture cancellations (suppress menu)
     * from plain-right-click cancellations (replay menu).
     */
    private gestureConfirmed = false;

    /**
     * True for a brief window after a confirmed gesture ends.  Any
     * `contextmenu` arriving during this window is intercepted and
     * discarded — this catches the trailing `contextmenu` that some
     * platforms (Windows / Electron) dispatch *after* `pointerup`, which
     * would otherwise appear after a completed or cancelled gesture.
     *
     * The window is short ({@link POST_GESTURE_SUPPRESS_MS}) so it does
     * not affect the next independent right-click.  Unlike the previous
     * implementation, the window is **not** closed early when a
     * `contextmenu` is eaten — it stays open until the timer expires, a
     * new `pointerdown` starts, or the adapter detaches.  This ensures
     * that a single right-click interaction cannot leak a second menu
     * through the tail of the suppression window.
     */
    private postGestureSuppress = false;

    /** Generation tag bound to the current suppression window. */
    private postGestureSuppressGeneration = 0;

    private postGestureSuppressTimer: ReturnType<typeof setTimeout> | null = null;

    /** Duration of the post-gesture suppression window (ms). */
    private static readonly POST_GESTURE_SUPPRESS_MS = 400;

    /**
     * Adapter lifecycle generation.  Incremented on `detach` so that any
     * pending microtask (e.g. contextmenu replay) can detect that the
     * adapter is no longer in the same lifecycle and abort safely.
     */
    private lifecycleGeneration = 0;

    /**
     * Interaction generation.  Incremented on every new right-click
     * `pointerdown` so that a pending replay from a previous interaction
     * can detect that a new interaction has started and abort safely.
     */
    private interactionGeneration = 0;

    /**
     * Token of the currently-allowed contextmenu replay.  Only the replay
     * microtask holding the latest token is allowed to execute; any
     * superseded token is silently discarded.
     */
    private replayToken = 0;

    /**
     * WeakSet of events created by this adapter for replay.  The contextmenu
     * handler checks this set to avoid re-intercepting its own replayed
     * events.
     */
    private static readonly replayMarkers = new WeakSet<Event>();

    // Bound handlers (stable references so removeEventListener matches).
    private readonly onPointerDown: EventListener = (e) => this.handlePointerDown(e as PointerEvent);
    private readonly onPointerMove: EventListener = (e) => this.handlePointerMove(e as PointerEvent);
    private readonly onPointerUp: EventListener = (e) => this.handlePointerUp(e as PointerEvent);
    private readonly onPointerCancel: EventListener = (e) => this.handlePointerCancel(e as PointerEvent);
    private readonly onLostPointerCapture: EventListener = (e) => this.handleLostPointerCapture(e as PointerEvent);
    private readonly onContextMenu: EventListener = (e) => this.handleContextMenu(e);
    private readonly onVisibilityChange: EventListener = () => this.handleVisibilityChange();
    private readonly onKeyDown: EventListener = (e) => this.handleKeyDown(e as KeyboardEvent);
    private readonly onBlur: EventListener = () => this.handleBlur();

    attach(target: EventTarget): void {
        if (this.attached) {
            return; // idempotent — no duplicate registration
        }
        this.attached = true;
        this.target = target;
        // Capture phase for all pointer events so the adapter sees them
        // before SiYuan's own handlers can stopPropagation.
        target.addEventListener("pointerdown", this.onPointerDown, true);
        target.addEventListener("pointermove", this.onPointerMove, true);
        target.addEventListener("pointerup", this.onPointerUp, true);
        target.addEventListener("pointercancel", this.onPointerCancel, true);
        target.addEventListener("lostpointercapture", this.onLostPointerCapture, true);
        // Register contextmenu on window (capture phase) so it fires
        // before document-level and element-level SiYuan handlers.
        window.addEventListener("contextmenu", this.onContextMenu, true);
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        // Capture phase so Escape is observed even if SiYuan stops propagation.
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("blur", this.onBlur);
    }

    detach(): void {
        if (!this.attached) {
            return;
        }
        const target = this.target;
        if (target !== null) {
            target.removeEventListener("pointerdown", this.onPointerDown, true);
            target.removeEventListener("pointermove", this.onPointerMove, true);
            target.removeEventListener("pointerup", this.onPointerUp, true);
            target.removeEventListener("pointercancel", this.onPointerCancel, true);
            target.removeEventListener("lostpointercapture", this.onLostPointerCapture, true);
        }
        window.removeEventListener("contextmenu", this.onContextMenu, true);
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("blur", this.onBlur);
        this.abort("manual");
        this.clearTimeout();
        this.releaseCapture();
        // Clear any pending contextmenu state so unload leaves nothing behind.
        // Increment lifecycle generation so any pending replay microtask
        // detects the lifecycle change and aborts safely.
        this.clearPostGestureSuppressTimer();
        this.postGestureSuppress = false;
        this.postGestureSuppressGeneration++;
        this.gestureConfirmed = false;
        this.contextmenuSnapshot = null;
        this.replayToken++; // invalidate any pending replay
        this.lifecycleGeneration++;
        this.attached = false;
        this.target = null;
    }

    // ------------------------------------------------------------------ pointer

    private handlePointerDown(e: PointerEvent): void {
        if (this.active) {
            return; // a gesture is already in progress — keep ignoring
        }
        if (e.button !== this.config.button) {
            return; // not the trigger button — do not disturb protection
        }
        // Stage 5B: generic input-target exclusion (e.g. the settings
        // gesture recorder).  No GestureSession is created, no gesture
        // state machine is entered — the target owns this interaction.
        if (this.shouldIgnoreTarget(e.target)) {
            return;
        }
        // A new trigger-button pointerdown with no active session: end the
        // previous interaction's leftover state BEFORE deciding whether this
        // pointerdown should bypass the gesture system (Alt held, non-mouse
        // pointerType).  Otherwise a stale post-gesture suppression window
        // from a previous gesture would shield the bypassed right-click's
        // contextmenu, causing the menu to be incorrectly blocked.
        //
        // This cleanup is safe because there is no PENDING/TRACKING session:
        //   - postGestureSuppressTimer: cancelled so its callback cannot fire.
        //   - postGestureSuppress: cleared so the next contextmenu passes.
        //   - postGestureSuppressGeneration: bumped so the cancelled timer's
        //     callback (if already queued) cannot reset newer state.
        //   - contextmenuSnapshot: cleared so no stale replay can fire.
        //   - replayToken: bumped so any pending replay microtask aborts.
        //   - interactionGeneration: bumped so pending replays detect the
        //     new interaction.
        //   - gestureConfirmed: cleared so a subsequent plain right-click in
        //     this interaction can replay its contextmenu.
        this.clearPostGestureSuppressTimer();
        this.postGestureSuppress = false;
        this.postGestureSuppressGeneration++;
        this.gestureConfirmed = false;
        this.contextmenuSnapshot = null;
        this.replayToken++;
        this.interactionGeneration++;

        // Stage 1: only handle mouse input.  Pen (including side keys) and
        // touch are not treated as mouse gestures.  The cleanup above
        // already released any stale suppression, so the contextmenu will
        // pass through to SiYuan untouched.
        if (e.pointerType !== "mouse") {
            return;
        }
        if (this.isSuppressed(e)) {
            // Suppression key held: do not start a gesture, let right-click
            // work.  The cleanup above already released any stale suppression.
            return;
        }

        const session = new GestureSession(this.config);
        this.session = session;
        this.pointerId = e.pointerId;
        session.addPoint(e.clientX, e.clientY, this.timestamp(e));
        this.capture(e);
        this.startTimeout();
        this.events.onStateChange?.(session);
    }

    private handlePointerMove(e: PointerEvent): void {
        const session = this.session;
        if (!session) {
            return;
        }
        if (this.pointerId !== null && e.pointerId !== this.pointerId) {
            return;
        }
        if (session.state !== GestureState.PENDING && session.state !== GestureState.TRACKING) {
            return;
        }

        // Check if the trigger button is still held.  If it was released
        // without a pointerup event (can happen on some platforms), cancel
        // the gesture safely.
        if ((e.buttons & this.buttonsMask(this.config.button)) === 0) {
            this.abort("button-released");
            return;
        }

        // Use coalesced events for higher-resolution sampling when available.
        for (const ev of this.getCoalesced(e)) {
            session.addPoint(ev.clientX, ev.clientY, this.timestamp(ev));
        }

        if (session.state === GestureState.PENDING) {
            const origin = session.points[0];
            const dx = e.clientX - origin.x;
            const dy = e.clientY - origin.y;
            const threshold = this.config.activationDistance;
            if (dx * dx + dy * dy >= threshold * threshold) {
                session.activate();
                // From this moment on, the interaction is a confirmed gesture.
                // Any contextmenu for this right-click must be discarded,
                // regardless of the final direction or command.
                this.gestureConfirmed = true;
                // Entering TRACKING invalidates any pending plain-right-click
                // replay — the interaction is no longer a plain click.
                this.replayToken++;
                this.events.onStateChange?.(session);
            }
        }

        if (session.state === GestureState.TRACKING) {
            this.events.onUpdate?.(session);
        }
    }

    private handlePointerUp(e: PointerEvent): void {
        const session = this.session;
        if (!session) {
            return;
        }
        if (this.pointerId !== null && e.pointerId !== this.pointerId) {
            return;
        }
        if (e.button !== this.config.button) {
            return; // only the trigger button ends the gesture
        }

        if (session.state === GestureState.TRACKING) {
            // Record the pointerup position as the final point so the
            // recognition pipeline sees the true end of the gesture.  If the
            // pointerup lands at the same coordinates as the last pointermove,
            // no duplicate is added.
            const last = session.points[session.points.length - 1];
            if (!last || last.x !== e.clientX || last.y !== e.clientY) {
                session.addPoint(e.clientX, e.clientY, this.timestamp(e));
            }
            session.complete();
            // Gesture completed — discard any intercepted contextmenu and
            // enter a brief suppression window to catch trailing contextmenu
            // events that some platforms dispatch after pointerup.
            this.discardContextmenu();
            this.enterPostGestureSuppress();
            this.endGesture();
            this.events.onComplete?.(session);
        } else {
            // PENDING: released without enough movement → no gesture.
            // If we intercepted a contextmenu, replay it so the user gets
            // the normal right-click menu.  If no contextmenu was intercepted,
            // the natural contextmenu (if any) will pass through untouched.
            const snapshot = this.contextmenuSnapshot;
            // Clear the snapshot immediately — the replay microtask uses
            // its own local copy and must not depend on mutable state.
            this.contextmenuSnapshot = null;
            this.reset();
            if (snapshot) {
                this.scheduleContextmenuReplay(snapshot);
            }
        }
    }

    private handlePointerCancel(e: PointerEvent): void {
        if (!this.session) {
            return;
        }
        if (this.pointerId !== null && e.pointerId !== this.pointerId) {
            return;
        }
        this.abort("pointercancel");
    }

    private handleLostPointerCapture(e: PointerEvent): void {
        if (!this.session) {
            return;
        }
        if (this.pointerId !== null && e.pointerId !== this.pointerId) {
            return;
        }
        this.abort("lostpointercapture");
    }

    // ------------------------------------------------------------------- cancel

    /**
     * Handle an incoming `contextmenu` event.
     *
     * If the event is a replay (marked by this adapter), let it pass through.
     *
     * If a right-click session is active (PENDING or TRACKING), intercept the
     * event: call `preventDefault`, `stopPropagation`, and
     * `stopImmediatePropagation`, then save a snapshot for potential replay.
     *
     * If no session is active, let the event pass through untouched.
     */
    private handleContextMenu(e: Event): void {
        // Always let our own replayed events through (recursion guard).
        if (MouseGestureAdapter.replayMarkers.has(e)) {
            return;
        }

        // Stage 5B: excluded targets (e.g. the gesture recorder) handle
        // their own right-click — the adapter neither intercepts nor
        // suppresses their contextmenu.  Checked before the post-gesture
        // suppression window so an excluded target is never shielded.
        if (this.shouldIgnoreTarget(e.target)) {
            return;
        }

        // Post-gesture suppression: a confirmed gesture just ended.  Eat
        // every trailing contextmenu that some platforms dispatch after
        // pointerup.  This is direction- and command-agnostic — it applies
        // to ALL confirmed gestures (U, D, L, R, compounds, cancelled, etc.).
        //
        // The suppression window is NOT closed early after eating one
        // contextmenu: a single right-click interaction may produce more
        // than one trailing contextmenu on some platforms, and closing
        // early would let the second one through.  The window only ends
        // when the timer expires, a new pointerdown starts, or the adapter
        // detaches.
        if (this.postGestureSuppress) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }

        if (!this.active) {
            // No active session — let the contextmenu pass through.
            return;
        }

        // Active session (PENDING or TRACKING) — intercept the contextmenu.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Save a snapshot for potential replay (only useful in PENDING;
        // if the session is already TRACKING the snapshot will be
        // discarded when the gesture completes/cancels).
        const me = e as MouseEvent;
        this.contextmenuSnapshot = {
            clientX: me.clientX,
            clientY: me.clientY,
            screenX: me.screenX,
            screenY: me.screenY,
            altKey: me.altKey,
            ctrlKey: me.ctrlKey,
            shiftKey: me.shiftKey,
            metaKey: me.metaKey,
            target: me.target,
        };
    }

    private handleVisibilityChange(): void {
        if (document.hidden && this.active) {
            this.abort("visibilitychange");
        }
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.active) {
            return;
        }
        if (e.key === "Escape") {
            this.abort("escape");
            return;
        }
        if (this.isSuppressionKey(e)) {
            this.abort("suppression-key");
        }
    }

    private handleBlur(): void {
        if (this.active) {
            this.abort("window-blur");
        }
    }

    // ------------------------------------------------------------------ helpers

    private isSuppressed(e: PointerEvent): boolean {
        switch (this.config.suppressionKey) {
            case "Alt": return e.altKey;
            case "Control": return e.ctrlKey;
            case "Shift": return e.shiftKey;
            case "Meta": return e.metaKey;
            default: return false;
        }
    }

    private isSuppressionKey(e: KeyboardEvent): boolean {
        const key = this.config.suppressionKey;
        return key !== null && e.key === key;
    }

    /**
     * Map a `MouseEvent.button` value to the corresponding `MouseEvent.buttons`
     * bitmask.
     *
     * The mapping is not `1 << button` — see the MDN documentation for
     * `MouseEvent.buttons`.
     */
    private buttonsMask(button: number): number {
        switch (button) {
            case 0: return 1;   // left
            case 1: return 4;   // middle / wheel
            case 2: return 2;   // right
            case 3: return 8;   // back
            case 4: return 16;  // forward
            default: return 0;
        }
    }

    private capture(e: PointerEvent): void {
        const el = e.target as Element | null;
        if (el && typeof el.setPointerCapture === "function") {
            try {
                el.setPointerCapture(e.pointerId);
                this.capturedElement = el;
            } catch {
                this.capturedElement = null;
            }
        }
    }

    private releaseCapture(): void {
        const el = this.capturedElement;
        const id = this.pointerId;
        if (el && id !== null && typeof el.releasePointerCapture === "function") {
            try {
                el.releasePointerCapture(id);
            } catch {
                /* pointer already released */
            }
        }
        this.capturedElement = null;
    }

    private getCoalesced(e: PointerEvent): PointerEvent[] {
        const fn = (e as PointerEvent & {
            getCoalescedEvents?: () => PointerEvent[];
        }).getCoalescedEvents;
        if (typeof fn === "function") {
            const list = fn.call(e);
            if (list && list.length > 0) {
                return list;
            }
        }
        return [e];
    }

    private timestamp(e: PointerEvent): number {
        return typeof performance !== "undefined" ? performance.now() : e.timeStamp;
    }

    private startTimeout(): void {
        this.clearTimeout();
        const ms = this.config.timeoutMs;
        if (ms > 0) {
            this.timeoutHandle = setTimeout(() => {
                if (this.active) {
                    this.abort("timeout");
                }
            }, ms);
        }
    }

    private clearTimeout(): void {
        if (this.timeoutHandle !== null) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
    }

    private abort(reason: GestureCancelReason): void {
        const session = this.session;
        if (!session) {
            return;
        }
        if (session.state === GestureState.COMPLETED || session.state === GestureState.CANCELLED) {
            return;
        }
        session.cancel(reason);

        if (reason === "manual") {
            // Detach — full cleanup, no protection needed.
            this.discardContextmenu();
        } else if (this.gestureConfirmed) {
            // Gesture was confirmed (TRACKING reached) — suppress the
            // trailing menu, just like a completed gesture.
            this.discardContextmenu();
            this.enterPostGestureSuppress();
        } else {
            // PENDING cancel — no gesture was formed.  If we intercepted a
            // contextmenu, replay it so the user gets the normal menu.
            const snapshot = this.contextmenuSnapshot;
            this.contextmenuSnapshot = null;
            if (snapshot) {
                this.scheduleContextmenuReplay(snapshot);
            }
        }

        this.endGesture();
        this.events.onCancel?.(session);
    }

    /**
     * Discard any intercepted contextmenu snapshot.  Called when a gesture
     * completes or is cancelled — the menu must not appear.
     */
    private discardContextmenu(): void {
        this.contextmenuSnapshot = null;
    }

    /**
     * Enter the post-gesture suppression window.  Any `contextmenu` arriving
     * during this window is intercepted and discarded.  This catches the
     * trailing `contextmenu` that some platforms (Windows / Electron)
     * dispatch after `pointerup`, which would otherwise appear after a
     * completed or cancelled gesture.
     *
     * The window is short ({@link POST_GESTURE_SUPPRESS_MS}) so it does not
     * affect the next independent right-click.  A new `pointerdown` also
     * terminates the suppression immediately.
     *
     * The timer callback captures the current
     * {@link postGestureSuppressGeneration} so that a stale timer (e.g. one
     * whose cleanup was raced by a new `pointerdown`) cannot clear a newer
     * gesture's suppression state.
     */
    private enterPostGestureSuppress(): void {
        this.clearPostGestureSuppressTimer();
        this.postGestureSuppress = true;
        const generation = this.postGestureSuppressGeneration;
        const self = this;
        this.postGestureSuppressTimer = setTimeout(() => {
            // Only clear if this timer is still the current generation —
            // a new pointerdown or detach has already incremented the
            // generation and handled cleanup itself.
            if (self.postGestureSuppressGeneration === generation) {
                self.postGestureSuppress = false;
                self.postGestureSuppressTimer = null;
            }
        }, MouseGestureAdapter.POST_GESTURE_SUPPRESS_MS);
    }

    private clearPostGestureSuppressTimer(): void {
        if (this.postGestureSuppressTimer !== null) {
            clearTimeout(this.postGestureSuppressTimer);
            this.postGestureSuppressTimer = null;
        }
    }

    /** Common cleanup after a terminal state (COMPLETED/CANCELLED). */
    private endGesture(): void {
        this.clearTimeout();
        this.releaseCapture();
        this.pointerId = null;
    }

    /**
     * Abandon a PENDING session that never activated (no gesture occurred).
     * Clears all session state except contextmenu info (which is consumed by
     * the caller before calling reset).
     */
    private reset(): void {
        this.clearTimeout();
        this.releaseCapture();
        this.session = null;
        this.pointerId = null;
    }

    /**
     * Schedule a replay of the intercepted contextmenu event via a microtask.
     *
     * The microtask runs after the current synchronous call stack completes,
     * avoiding races with `reset()` cleanup.  The replayed event is marked
     * with a `WeakSet` so the adapter does not re-intercept it.
     *
     * Because `queueMicrotask` cannot be cancelled, the microtask captures
     * the current lifecycle generation, interaction generation, and replay
     * token.  Before dispatching, it re-checks all three: if any has changed
     * (detach, new pointerdown, TRACKING reached, or a newer replay
     * superseded this one), the microtask aborts silently.
     *
     * The replay target is resolved in priority order:
     * 1. The original event target (if still connected to the document).
     * 2. `document.elementFromPoint(clientX, clientY)` (current element at
     *    the original coordinates).
     * 3. `document.body` (last resort).
     */
    private scheduleContextmenuReplay(snapshot: ContextmenuSnapshot): void {
        const lifecycle = this.lifecycleGeneration;
        const interaction = this.interactionGeneration;
        const token = ++this.replayToken;
        const self = this;
        queueMicrotask(() => {
            // Abort if the adapter detached, a new interaction started,
            // the session reached TRACKING, or a newer replay superseded
            // this one.
            if (!self.attached) return;
            if (self.lifecycleGeneration !== lifecycle) return;
            if (self.interactionGeneration !== interaction) return;
            if (self.replayToken !== token) return;
            if (self.gestureConfirmed) return;
            self.dispatchContextmenuReplay(snapshot);
        });
    }

    /**
     * Dispatch a synthetic `contextmenu` event to recreate the native
     * right-click menu.  The event is marked so the adapter does not
     * re-intercept it.
     */
    private dispatchContextmenuReplay(snapshot: ContextmenuSnapshot): void {
        // Resolve the replay target.
        let replayTarget: EventTarget | null = snapshot.target;
        // Check if the original target is still connected to the document.
        if (replayTarget instanceof Element && !document.contains(replayTarget)) {
            replayTarget = null;
        }
        if (!replayTarget) {
            // Fall back to the element currently at the original coordinates.
            replayTarget = document.elementFromPoint(snapshot.clientX, snapshot.clientY);
        }
        if (!replayTarget) {
            replayTarget = document.body;
        }

        const replayEvent = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            composed: true,
            screenX: snapshot.screenX,
            screenY: snapshot.screenY,
            clientX: snapshot.clientX,
            clientY: snapshot.clientY,
            ctrlKey: snapshot.ctrlKey,
            shiftKey: snapshot.shiftKey,
            altKey: snapshot.altKey,
            metaKey: snapshot.metaKey,
            button: 2,
            relatedTarget: null,
        });
        MouseGestureAdapter.replayMarkers.add(replayEvent);
        replayTarget.dispatchEvent(replayEvent);
    }
}
