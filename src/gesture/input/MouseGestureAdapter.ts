import { GestureCancelReason, GestureState } from "../types";
import { GestureSession } from "../GestureSession";
import { InputAdapter } from "./InputAdapter";

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
 * right-click session is active (PENDING or TRACKING):
 *
 * - If the session later reaches TRACKING and completes/cancels, the
 *   intercepted event is **discarded** — no menu is shown.
 * - If the session ends in PENDING (plain right-click, no gesture), the
 *   intercepted event is **replayed** exactly once via a microtask, so the
 *   user sees the normal SiYuan context menu.
 * - If no session is active (Alt-suppressed, non-mouse, different button),
 *   the `contextmenu` passes through untouched.
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

    /**
     * Snapshot of the intercepted `contextmenu` event, or `null` if no
     * contextmenu has been intercepted during the current session.
     */
    private contextmenuSnapshot: ContextmenuSnapshot | null = null;

    /**
     * Whether a contextmenu has been intercepted during the current session.
     * Used to decide whether to replay on pointerup-PENDING.
     */
    private contextmenuIntercepted = false;

    /**
     * Pending replay task id (microtask sentinel).  Used only for cleanup
     * tracking — the actual replay is scheduled via `queueMicrotask`.
     */
    private replayPending = false;

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
        this.contextmenuSnapshot = null;
        this.contextmenuIntercepted = false;
        this.replayPending = false;
        this.attached = false;
        this.target = null;
    }

    // ------------------------------------------------------------------ pointer

    private handlePointerDown(e: PointerEvent): void {
        if (this.active) {
            return; // a gesture is already in progress
        }
        if (e.button !== this.config.button) {
            return; // not the trigger button
        }
        // Stage 1: only handle mouse input.  Pen (including side keys) and
        // touch are not treated as mouse gestures.
        if (e.pointerType !== "mouse") {
            return;
        }
        if (this.isSuppressed(e)) {
            // Suppression key held: do not start a gesture, let right-click work.
            return;
        }

        const session = new GestureSession(this.config);
        this.session = session;
        this.contextmenuIntercepted = false;
        this.contextmenuSnapshot = null;
        this.replayPending = false;
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
            // Gesture completed — discard any intercepted contextmenu.
            // No menu should appear after a gesture.
            this.discardContextmenu();
            this.endGesture();
            this.events.onComplete?.(session);
        } else {
            // PENDING: released without enough movement → no gesture.
            // If we intercepted a contextmenu, replay it so the user gets
            // the normal right-click menu.
            const snapshot = this.contextmenuSnapshot;
            const wasIntercepted = this.contextmenuIntercepted;
            this.reset();
            if (wasIntercepted && snapshot) {
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
        // Don't intercept our own replayed events.
        if (MouseGestureAdapter.replayMarkers.has(e)) {
            return;
        }

        if (!this.active) {
            // No active session — let the contextmenu pass through.
            return;
        }

        // Active session (PENDING or TRACKING) — intercept the contextmenu.
        e.preventDefault();
        e.stopPropagation();
        // stopImmediatePropagation ensures SiYuan's own capture-phase
        // listeners (if any are on the same target) do not also run.
        e.stopImmediatePropagation();

        // Save a snapshot for potential replay.
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
        this.contextmenuIntercepted = true;
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
        // Cancelled gestures must not show a menu — discard any intercepted
        // contextmenu.
        this.discardContextmenu();
        this.endGesture();
        this.events.onCancel?.(session);
    }

    /**
     * Discard any intercepted contextmenu snapshot.  Called when a gesture
     * completes or is cancelled — the menu must not appear.
     */
    private discardContextmenu(): void {
        this.contextmenuSnapshot = null;
        this.contextmenuIntercepted = false;
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
     * The replay target is resolved in priority order:
     * 1. The original event target (if still connected to the document).
     * 2. `document.elementFromPoint(clientX, clientY)` (current element at
     *    the original coordinates).
     * 3. `document.body` (last resort).
     */
    private scheduleContextmenuReplay(snapshot: ContextmenuSnapshot): void {
        if (this.replayPending) {
            return; // prevent double replay
        }
        this.replayPending = true;
        const self = this;
        queueMicrotask(() => {
            self.replayPending = false;
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
