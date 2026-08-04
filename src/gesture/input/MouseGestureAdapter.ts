import { GestureCancelReason, GestureState } from "../types";
import { GestureSession } from "../GestureSession";
import { InputAdapter } from "./InputAdapter";

/**
 * Mouse gesture adapter based on PointerEvent.
 *
 * All pointer listeners are registered in the **capture phase** so the
 * adapter observes events before SiYuan's own handlers can call
 * `stopPropagation()`.  `setPointerCapture` is used on the pointerdown target
 * so the gesture keeps receiving events even when the pointer leaves the
 * original element.
 *
 * The native context menu is only suppressed once TRACKING is reached, so a
 * right-click that does not move past the activation distance still shows
 * SiYuan's native menu.  No simulated clicks are dispatched and no DOM menus
 * are deleted — suppression is done solely via `preventDefault()` on the
 * `contextmenu` event.
 *
 * ---
 *
 * **contextmenu event order (Windows / Electron)**
 *
 * On Windows the typical sequence for a right-click that triggers a gesture is:
 *
 *   pointerdown → pointermove* → pointerup → contextmenu
 *
 * In this order `suppressContextMenu` is already `true` (set during TRACKING)
 * when `contextmenu` fires, so `preventDefault()` correctly hides the menu.
 *
 * A second possible order (observed on some setups / when the pointer is
 * released very quickly) is:
 *
 *   pointerdown → contextmenu → pointermove*
 *
 * In this order `contextmenu` fires during PENDING (before TRACKING), so
 * `suppressContextMenu` is `false` and the native menu shows.  This is
 * acceptable — the user has not moved far enough to start a gesture, so the
 * right-click menu should appear.  If a gesture is subsequently detected,
 * the menu is already gone and cannot be retroactively suppressed.  Stage 1
 * does **not** work around this with simulated clicks; the limitation is
 * documented here for future platform-specific handling.
 */
export class MouseGestureAdapter extends InputAdapter {
    private target: EventTarget | null = null;
    private capturedElement: Element | null = null;
    private pointerId: number | null = null;
    /**
     * Set true when TRACKING is entered so the imminent contextmenu event can
     * be suppressed.  Reset to false on the next pointerdown or once consumed.
     */
    private suppressContextMenu = false;
    private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    private attached = false;

    // Bound handlers (stable references so removeEventListener matches).
    // Typed as EventListener so they are assignable to addEventListener on
    // a generic EventTarget; the specific event type is narrowed inside each
    // handler via a safe cast.
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
        // Capture phase so we can block the menu before SiYuan renders it.
        target.addEventListener("contextmenu", this.onContextMenu, true);
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
            target.removeEventListener("contextmenu", this.onContextMenu, true);
        }
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("blur", this.onBlur);
        this.abort("manual");
        this.clearTimeout();
        this.releaseCapture();
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
        this.suppressContextMenu = false;
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
                this.suppressContextMenu = true;
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
            this.endGesture();
            this.events.onComplete?.(session);
        } else {
            // PENDING: released without enough movement -> no gesture.
            // The native context menu should still show, so do not suppress it.
            this.reset();
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

    private handleContextMenu(e: Event): void {
        // Only suppress the native menu once a gesture has reached TRACKING.
        if (this.suppressContextMenu) {
            e.preventDefault();
            this.suppressContextMenu = false;
        }
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
        this.endGesture();
        this.events.onCancel?.(session);
    }

    /** Common cleanup after a terminal state (COMPLETED/CANCELLED). */
    private endGesture(): void {
        this.clearTimeout();
        this.releaseCapture();
        // Keep `suppressContextMenu` so the following contextmenu is blocked.
        // The session reference is retained until the next pointerdown replaces
        // it; `active` correctly returns false for terminal states.
        this.pointerId = null;
    }

    /** Abandon a PENDING session that never activated (no gesture occurred). */
    private reset(): void {
        this.clearTimeout();
        this.releaseCapture();
        this.suppressContextMenu = false;
        this.session = null;
        this.pointerId = null;
    }
}
