import { GestureCancelReason, GestureState, GestureTriggerConfig } from "../types";
import { GestureSession } from "../GestureSession";
import { GestureAdapterEvents, InputAdapter } from "./InputAdapter";

/**
 * Mouse gesture adapter based on PointerEvent.
 *
 * Listeners are attached to a single target (typically `document`) plus
 * `document`/`window` for visibilitychange and Escape. `setPointerCapture` is
 * used on the pointerdown target so the gesture keeps receiving events even
 * when the pointer leaves the original element.
 *
 * The native context menu is only suppressed once TRACKING is reached, so a
 * right-click that does not move past the activation distance still shows
 * SiYuan's native menu.
 */
export class MouseGestureAdapter extends InputAdapter {
    private target: EventTarget | null = null;
    private capturedElement: Element | null = null;
    private pointerId: number | null = null;
    /**
     * Set true when TRACKING is entered so the imminent contextmenu event can
     * be suppressed. Reset to false on the next pointerdown or once consumed.
     */
    private suppressContextMenu = false;
    private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    // Bound handlers (stable references so removeEventListener matches).
    private readonly onPointerDown = this.handlePointerDown.bind(this);
    private readonly onPointerMove = this.handlePointerMove.bind(this);
    private readonly onPointerUp = this.handlePointerUp.bind(this);
    private readonly onPointerCancel = this.handlePointerCancel.bind(this);
    private readonly onContextMenu = this.handleContextMenu.bind(this);
    private readonly onVisibilityChange = this.handleVisibilityChange.bind(this);
    private readonly onKeyDown = this.handleKeyDown.bind(this);

    constructor(config: GestureTriggerConfig, events: GestureAdapterEvents) {
        super(config, events);
    }

    attach(target: EventTarget): void {
        if (this.target !== null) {
            return; // already attached
        }
        this.target = target;
        target.addEventListener("pointerdown", this.onPointerDown);
        target.addEventListener("pointermove", this.onPointerMove);
        target.addEventListener("pointerup", this.onPointerUp);
        target.addEventListener("pointercancel", this.onPointerCancel);
        // Capture phase so we can block the menu before SiYuan renders it.
        target.addEventListener("contextmenu", this.onContextMenu, true);
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        // Capture phase so Escape is observed even if SiYuan stops propagation.
        window.addEventListener("keydown", this.onKeyDown, true);
    }

    detach(): void {
        const target = this.target;
        if (target !== null) {
            target.removeEventListener("pointerdown", this.onPointerDown);
            target.removeEventListener("pointermove", this.onPointerMove);
            target.removeEventListener("pointerup", this.onPointerUp);
            target.removeEventListener("pointercancel", this.onPointerCancel);
            target.removeEventListener("contextmenu", this.onContextMenu, true);
        }
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        window.removeEventListener("keydown", this.onKeyDown, true);
        this.abort("manual");
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
