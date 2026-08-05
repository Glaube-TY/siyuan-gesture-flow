// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MouseGestureAdapter } from "./MouseGestureAdapter";
import { GestureAdapterEvents } from "./InputAdapter";
import { GestureSession } from "../GestureSession";
import { GestureState, GestureTriggerConfig } from "../types";

// ----------------------------------------------------------- test helpers

/**
 * Minimal trigger config for tests.  Timeout is long so it doesn't fire
 * unexpectedly during fast tests; the timeout-specific test uses its own
 * short config.
 */
const TEST_TRIGGER: GestureTriggerConfig = {
    button: 2,
    activationDistance: 16,
    suppressionKey: "Alt",
    timeoutMs: 10000,
};

/** Callbacks spy — records every invocation. */
interface SpyEvents {
    onStateChange: ReturnType<typeof vi.fn>;
    onUpdate: ReturnType<typeof vi.fn>;
    onComplete: ReturnType<typeof vi.fn>;
    onCancel: ReturnType<typeof vi.fn>;
}

function makeSpyEvents(): SpyEvents & GestureAdapterEvents {
    const onStateChange = vi.fn();
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    return { onStateChange, onUpdate, onComplete, onCancel };
}

/**
 * Create a PointerEvent with the properties the adapter reads.
 * happy-dom may not populate every field via the constructor, so we set
 * them explicitly on the instance.
 */
function makePointerEvent(
    type: string,
    init: {
        button?: number;
        buttons?: number;
        clientX?: number;
        clientY?: number;
        pointerId?: number;
        pointerType?: string;
        altKey?: boolean;
        ctrlKey?: boolean;
        shiftKey?: boolean;
        metaKey?: boolean;
        bubbles?: boolean;
        cancelable?: boolean;
    } = {},
): PointerEvent {
    const event = new PointerEvent(type, {
        bubbles: init.bubbles ?? true,
        cancelable: init.cancelable ?? true,
        button: init.button ?? 0,
        buttons: init.buttons ?? 0,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
        altKey: init.altKey ?? false,
        ctrlKey: init.ctrlKey ?? false,
        shiftKey: init.shiftKey ?? false,
        metaKey: init.metaKey ?? false,
    });
    // pointerId / pointerType are not always settable via constructor in
    // happy-dom, so assign directly.
    Object.defineProperty(event, "pointerId", {
        value: init.pointerId ?? 1,
        writable: false,
        configurable: true,
    });
    Object.defineProperty(event, "pointerType", {
        value: init.pointerType ?? "mouse",
        writable: false,
        configurable: true,
    });
    // getCoalescedEvents stub — returns [self] by default.
    (event as PointerEvent & {
        getCoalescedEvents?: () => PointerEvent[];
    }).getCoalescedEvents = () => [event];
    return event;
}

/** Dispatch a pointer event on a target and return it. */
function dispatchPointer(target: EventTarget, type: string, init?: Parameters<typeof makePointerEvent>[1]): PointerEvent {
    const event = makePointerEvent(type, init);
    target.dispatchEvent(event);
    return event;
}

/** Install setPointerCapture / releasePointerCapture stubs on Element if missing. */
function ensurePointerCaptureStubs(): void {
    const proto = Element.prototype as Element & {
        setPointerCapture?: (id: number) => void;
        releasePointerCapture?: (id: number) => void;
    };
    if (typeof proto.setPointerCapture !== "function") {
        proto.setPointerCapture = function (_id: number) { /* no-op */ };
    }
    if (typeof proto.releasePointerCapture !== "function") {
        proto.releasePointerCapture = function (_id: number) { /* no-op */ };
    }
}

/** Right-button buttons mask (button 2 → buttons bit 2). */
const RIGHT_BUTTON_MASK = 2;

// --------------------------------------------------------------- setup

let target: HTMLElement;
let adapter: MouseGestureAdapter;
let events: SpyEvents & GestureAdapterEvents;

beforeEach(() => {
    ensurePointerCaptureStubs();
    target = document.createElement("div");
    document.body.appendChild(target);
    events = makeSpyEvents();
    adapter = new MouseGestureAdapter(TEST_TRIGGER, events);
});

afterEach(() => {
    adapter.detach();
    target.remove();
    vi.restoreAllMocks();
});

// --------------------------------------------------------------- tests

describe("MouseGestureAdapter — 基础状态机", () => {
    it("普通右键未超过阈值：不创建会话，不触发回调", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        // pointerup without enough movement
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 2,
            clientY: 0,
        });
        expect(events.onStateChange).toHaveBeenCalledTimes(1); // PENDING created
        expect(events.onUpdate).not.toHaveBeenCalled();
        expect(events.onComplete).not.toHaveBeenCalled();
        expect(events.onCancel).not.toHaveBeenCalled();
    });

    it("超过阈值进入 TRACKING 并触发 onUpdate", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        expect(events.onStateChange).toHaveBeenCalledTimes(2); // PENDING + TRACKING
        expect(events.onUpdate).toHaveBeenCalledTimes(1);
    });

    it("完成手势触发 onComplete", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 40,
            clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
        const session = events.onComplete.mock.calls[0][0] as GestureSession;
        expect(session.state).toBe(GestureState.COMPLETED);
    });
});

describe("MouseGestureAdapter — contextmenu 协调（先截获、后决定）", () => {
    /** Dispatch a contextmenu event on window (capture-phase listener location). */
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
        cancelable?: boolean;
        altKey?: boolean;
        ctrlKey?: boolean;
        shiftKey?: boolean;
        metaKey?: boolean;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: opts.cancelable ?? true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
            altKey: opts.altKey ?? false,
            ctrlKey: opts.ctrlKey ?? false,
            shiftKey: opts.shiftKey ?? false,
            metaKey: opts.metaKey ?? false,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    /** Wait for the microtask queue to flush (for replay scheduling). */
    function flushMicrotasks(): Promise<void> {
        return Promise.resolve();
    }

    // ---------------------------------------------------------- Scenario A
    it("场景 A：contextmenu 早于移动，最终形成手势 → 阻止且不重放", async () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // contextmenu fires during PENDING — should be intercepted.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);

        // Move past threshold → TRACKING.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // pointerup → COMPLETED.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });

        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Wait for any potential replay — none should fire.
        await flushMicrotasks();
        // No new contextmenu should have been dispatched.
        // The gesture completed, so no replay.
        expect(events.onComplete).toHaveBeenCalledTimes(1);
    });

    // ---------------------------------------------------------- Scenario B
    it("场景 B：contextmenu 早于 pointerup，最终只是普通右键 → 重放一次", async () => {
        // Track click events to ensure no left-click is ever dispatched.
        const clickEvents: MouseEvent[] = [];
        target.addEventListener("click", (e) => clickEvents.push(e as MouseEvent));

        // Track all contextmenu events that reach the target without
        // being preventDefault'd by the adapter.
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) {
                receivedReplay.push(me);
            }
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 10, clientY: 10,
        });
        // contextmenu fires during PENDING — intercepted.
        const ctxEvent = dispatchContextmenu({
            target,
            clientX: 10,
            clientY: 10,
            cancelable: true,
        });
        expect(ctxEvent.defaultPrevented).toBe(true);
        expect(ctxEvent.stopPropagation).toBeDefined();

        // pointerup without enough movement → PENDING release.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 12, clientY: 10,
        });

        // Wait for the microtask replay.
        await flushMicrotasks();

        // Exactly one replay contextmenu should have reached the target.
        expect(receivedReplay.length).toBe(1);
        const replay = receivedReplay[0];
        expect(replay.defaultPrevented).toBe(false);
        expect(replay.button).toBe(2);
        expect(replay.clientX).toBe(10);
        expect(replay.clientY).toBe(10);
        // No click events should have been dispatched.
        expect(clickEvents.length).toBe(0);
        // No recursive replay (only one event).
        expect(receivedReplay.length).toBe(1);
    });

    // ---------------------------------------------------------- Scenario C1
    it("场景 C1：普通右键，contextmenu 在 pointerup 后到来 → 不阻止", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // pointerup without movement → PENDING release.
        // No contextmenu was intercepted, so no replay.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });

        // Natural contextmenu fires after pointerup — should pass through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    // ---------------------------------------------------------- Scenario C2
    it("场景 C2：有效手势完成后 contextmenu 晚到 → 阻止且不重放", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // Move past threshold → TRACKING.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // pointerup → COMPLETED.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Late contextmenu after pointerup — must be blocked by
        // post-gesture suppression (this is the core bug fix).
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);
    });

    // ---------------------------------------------------------- Scenario D
    it("场景 D：移动未超过阈值但已截获 contextmenu → pointerup 后恢复一次", async () => {
        // Track click events to ensure no left-click is ever dispatched.
        const clickEvents: MouseEvent[] = [];
        target.addEventListener("click", (e) => clickEvents.push(e as MouseEvent));

        // Track all contextmenu events that reach the target without
        // being preventDefault'd by the adapter (i.e. the replay).
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) {
                receivedReplay.push(me);
            }
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 30, clientY: 40,
        });
        // Small movement below threshold.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 35, clientY: 40,
        });
        // contextmenu intercepted during PENDING — carry modifier keys so
        // we can verify they are preserved on the replay.
        const ctxEvent = dispatchContextmenu({
            target,
            clientX: 30,
            clientY: 40,
            ctrlKey: true,
            shiftKey: true,
        });
        expect(ctxEvent.defaultPrevented).toBe(true);

        // pointerup — PENDING release, should schedule replay.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 36, clientY: 40,
        });

        // Wait for the microtask replay.
        await flushMicrotasks();

        // Exactly one replay contextmenu should have reached the target.
        expect(receivedReplay.length).toBe(1);
        const replay = receivedReplay[0];
        expect(replay.defaultPrevented).toBe(false);
        expect(replay.button).toBe(2);
        expect(replay.clientX).toBe(30);
        expect(replay.clientY).toBe(40);
        // Modifier keys must match the original intercepted event.
        expect(replay.ctrlKey).toBe(true);
        expect(replay.shiftKey).toBe(true);
        expect(replay.altKey).toBe(false);
        expect(replay.metaKey).toBe(false);
        // No click events should have been dispatched.
        expect(clickEvents.length).toBe(0);
        // No recursive replay (still exactly one event).
        expect(receivedReplay.length).toBe(1);

        // No residual snapshot: a bare pointerup with no preceding
        // pointerdown must not trigger a second replay from a stale snapshot.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 36, clientY: 40,
        });
        await flushMicrotasks();
        expect(receivedReplay.length).toBe(1);
    });

    // ---------------------------------------------------------- Scenario E
    it("场景 E：Alt 抑制 → 不创建会话，不截获 contextmenu", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 0, clientY: 0,
        });
        expect(events.onStateChange).not.toHaveBeenCalled();

        // contextmenu should pass through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    // ---------------------------------------------------------- Scenario F
    it("场景 F：进入 TRACKING 后 Escape 取消 → post-gesture suppress 阻止菜单", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // contextmenu intercepted during PENDING.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);

        // Move past threshold → TRACKING.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // Escape → cancel.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(events.onCancel).toHaveBeenCalledTimes(1);

        // Post-gesture suppression is active — contextmenu must be blocked.
        const ctxEvent2 = dispatchContextmenu({ target });
        expect(ctxEvent2.defaultPrevented).toBe(true);
    });

    it("场景 F2：TRACKING 中 pointercancel → post-gesture suppress 阻止菜单", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target }); // intercepted
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointercancel", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        expect(events.onCancel).toHaveBeenCalledTimes(1);

        // Post-gesture suppression is active — contextmenu must be blocked.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);
    });

    it("场景 F3：TRACKING 中 window blur → post-gesture suppress 阻止菜单", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target }); // intercepted
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        window.dispatchEvent(new Event("blur"));
        expect(events.onCancel).toHaveBeenCalledTimes(1);

        // Post-gesture suppression is active — contextmenu must be blocked.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);
    });

    // ---------------------------------------------------------- Scenario G
    it("场景 G：插件卸载后不残留 contextmenu 快照或重放任务", async () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target }); // intercepted

        // Detach while PENDING with intercepted contextmenu.
        adapter.detach();

        // After detach, no contextmenu should be intercepted.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);

        // Wait for any potential replay — nothing should fire.
        await flushMicrotasks();
    });

    // ---------------------------------------------------------- edge cases
    it("形成手势后 contextmenu 被完全阻止（L 方向）", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // contextmenu during TRACKING — intercepted.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);

        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
    });

    it("重放事件不被递归拦截", async () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 5, clientY: 5,
        });
        // Intercept contextmenu.
        dispatchContextmenu({ target, clientX: 5, clientY: 5 });
        // pointerup PENDING → schedule replay.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 6, clientY: 5,
        });

        // Track replay — add a listener that records non-prevented contextmenu.
        const replayReceived: MouseEvent[] = [];
        const listener = (e: Event) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) {
                replayReceived.push(me);
            }
        };
        target.addEventListener("contextmenu", listener);

        await flushMicrotasks();

        // The replay event should have reached the target without being
        // intercepted by the adapter.
        expect(replayReceived.length).toBe(1);
        expect(replayReceived[0].button).toBe(2);
        expect(replayReceived[0].clientX).toBe(5);

        target.removeEventListener("contextmenu", listener);
    });
});

// ============================================== direction-independence
describe("MouseGestureAdapter — 菜单屏蔽与方向无关", () => {
    /** Dispatch a contextmenu event on window. */
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    /**
     * Generate a confirmed gesture along the given waypoints and verify
     * that a late contextmenu (after pointerup) is blocked.
     *
     * The adapter must suppress the menu for ALL confirmed gestures
     * regardless of direction, segment count, or eventual command.
     */
    function expectLateContextmenuBlocked(
        waypoints: { x: number; y: number }[],
    ): void {
        adapter.attach(target);
        const start = { x: 100, y: 100 };
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            clientX: start.x, clientY: start.y,
        });
        for (const wp of waypoints) {
            dispatchPointer(target, "pointermove", {
                buttons: RIGHT_BUTTON_MASK, clientX: wp.x, clientY: wp.y,
            });
        }
        const last = waypoints[waypoints.length - 1] ?? start;
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: last.x, clientY: last.y,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Late contextmenu after pointerup — must be blocked.
        const ctxEvent = dispatchContextmenu({
            target,
            clientX: start.x,
            clientY: start.y,
        });
        expect(ctxEvent.defaultPrevented).toBe(true);
    }

    it("有效 U 完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([{ x: 100, y: 70 }]);
    });

    it("有效 D 完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([{ x: 100, y: 130 }]);
    });

    it("有效 L 完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([{ x: 70, y: 100 }]);
    });

    it("有效 R 完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([{ x: 130, y: 100 }]);
    });

    it("有效 U-D 复合手势完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([
            { x: 100, y: 70 },
            { x: 100, y: 130 },
        ]);
    });

    it("有效 L-R 复合手势完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([
            { x: 70, y: 100 },
            { x: 130, y: 100 },
        ]);
    });

    it("有效 R-D-L 复合手势完成后晚到 contextmenu 被阻止", () => {
        expectLateContextmenuBlocked([
            { x: 130, y: 100 },
            { x: 130, y: 130 },
            { x: 70, y: 130 },
        ]);
    });

    it("菜单屏蔽不依赖方向 — 所有方向行为一致", () => {
        // Quick smoke test: run U, D, L, R in sequence on the same adapter
        // and verify each blocks the late contextmenu.
        adapter.attach(target);
        const dirs = [
            { x: 130, y: 100 }, // R
            { x: 100, y: 70 },  // U
            { x: 70, y: 100 },  // L
            { x: 100, y: 130 }, // D
        ];
        for (const dir of dirs) {
            dispatchPointer(target, "pointerdown", {
                button: 2, buttons: RIGHT_BUTTON_MASK,
                clientX: 100, clientY: 100,
            });
            dispatchPointer(target, "pointermove", {
                buttons: RIGHT_BUTTON_MASK,
                clientX: dir.x, clientY: dir.y,
            });
            dispatchPointer(target, "pointerup", {
                button: 2, buttons: 0,
                clientX: dir.x, clientY: dir.y,
            });
            const ctxEvent = dispatchContextmenu({
                target, clientX: 100, clientY: 100,
            });
            expect(ctxEvent.defaultPrevented).toBe(true);
        }
        expect(events.onComplete).toHaveBeenCalledTimes(4);
    });

    it("菜单屏蔽不依赖命令结果 — 即使 onComplete 回调抛错也阻止菜单", () => {
        // Replace onComplete with a throwing function to prove the adapter's
        // menu suppression is independent of command execution.
        const throwingEvents = makeSpyEvents();
        throwingEvents.onComplete = vi.fn(() => {
            throw new Error("command failed");
        });
        const throwingAdapter = new MouseGestureAdapter(TEST_TRIGGER, throwingEvents);
        throwingAdapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // pointerup will call onComplete which throws — the adapter must
        // still enter post-gesture suppression.
        expect(() => {
            dispatchPointer(target, "pointerup", {
                button: 2, buttons: 0, clientX: 40, clientY: 0,
            });
        }).toThrow("command failed");

        // Late contextmenu must still be blocked.
        const event = new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, button: 2,
        });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        throwingAdapter.detach();
    });

    it("TRACKING 中 contextmenu 被阻止", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        // contextmenu during TRACKING — intercepted.
        const event = new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, button: 2,
        });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    // ------------------------------------------ direction regression (2 menus)
    /**
     * Verify that TWO consecutive late contextmenu events are both blocked
     * after a confirmed gesture in the given direction.  This guards against
     * the old "close suppression after eating one menu" regression.
     */
    function expectTwoLateContextmenusBlocked(
        waypoints: { x: number; y: number }[],
    ): void {
        adapter.attach(target);
        const start = { x: 100, y: 100 };
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            clientX: start.x, clientY: start.y,
        });
        for (const wp of waypoints) {
            dispatchPointer(target, "pointermove", {
                buttons: RIGHT_BUTTON_MASK, clientX: wp.x, clientY: wp.y,
            });
        }
        const last = waypoints[waypoints.length - 1] ?? start;
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: last.x, clientY: last.y,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Two late contextmenus — both must be blocked.
        const ctx1 = dispatchContextmenu({ target, clientX: start.x, clientY: start.y });
        expect(ctx1.defaultPrevented).toBe(true);
        const ctx2 = dispatchContextmenu({ target, clientX: start.x, clientY: start.y });
        expect(ctx2.defaultPrevented).toBe(true);
    }

    it("U 手势完成后两个延迟 contextmenu 都被阻止", () => {
        expectTwoLateContextmenusBlocked([{ x: 100, y: 70 }]);
    });

    it("D 手势完成后两个延迟 contextmenu 都被阻止", () => {
        expectTwoLateContextmenusBlocked([{ x: 100, y: 130 }]);
    });

    it("L 手势完成后两个延迟 contextmenu 都被阻止", () => {
        expectTwoLateContextmenusBlocked([{ x: 70, y: 100 }]);
    });

    it("R 手势完成后两个延迟 contextmenu 都被阻止", () => {
        expectTwoLateContextmenusBlocked([{ x: 130, y: 100 }]);
    });

    it("R-D-L 复合手势完成后两个延迟 contextmenu 都被阻止", () => {
        expectTwoLateContextmenusBlocked([
            { x: 130, y: 100 },
            { x: 130, y: 130 },
            { x: 70, y: 130 },
        ]);
    });

    it("命令返回 noop 时仍阻止菜单（onComplete 回调无影响）", () => {
        // The adapter's menu suppression is independent of what the
        // command layer does.  Simulate a "noop" by having onComplete
        // do nothing special — the menu must still be blocked.
        const noopEvents = makeSpyEvents();
        noopEvents.onComplete = vi.fn(() => { /* noop */ });
        const noopAdapter = new MouseGestureAdapter(TEST_TRIGGER, noopEvents);
        noopAdapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(noopEvents.onComplete).toHaveBeenCalledTimes(1);

        const event = new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, button: 2,
        });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        noopAdapter.detach();
    });

    it("命令返回 failed 时仍阻止菜单（onComplete 回调抛错）", () => {
        // Even if the command layer throws, the adapter's suppression
        // must hold.
        const failingEvents = makeSpyEvents();
        failingEvents.onComplete = vi.fn(() => {
            throw new Error("command failed");
        });
        const failingAdapter = new MouseGestureAdapter(TEST_TRIGGER, failingEvents);
        failingAdapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        expect(() => {
            dispatchPointer(target, "pointerup", {
                button: 2, buttons: 0, clientX: 40, clientY: 0,
            });
        }).toThrow("command failed");

        // Late contextmenu must still be blocked.
        const event = new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, button: 2,
        });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        failingAdapter.detach();
    });
});

// ============================================== post-gesture suppression timer
describe("MouseGestureAdapter — post-gesture suppression 计时器", () => {
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("保护期内连续 contextmenu 全部被阻止，超时后放行", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Within the suppression window — all blocked (no early close).
        const ctx1 = dispatchContextmenu({ target });
        expect(ctx1.defaultPrevented).toBe(true);
        const ctx2 = dispatchContextmenu({ target });
        expect(ctx2.defaultPrevented).toBe(true);
        const ctx3 = dispatchContextmenu({ target });
        expect(ctx3.defaultPrevented).toBe(true);

        // Advance past the 400ms suppression window.
        vi.advanceTimersByTime(500);

        // Suppression has expired — contextmenu passes through.
        const ctx4 = dispatchContextmenu({ target });
        expect(ctx4.defaultPrevented).toBe(false);
    });

    it("保护期超时后 contextmenu 正常放行", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Advance past the 400ms suppression window.
        vi.advanceTimersByTime(500);

        // Suppression has expired — contextmenu passes through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("保护期结束后新的普通右键不受影响", () => {
        adapter.attach(target);
        // First: a completed gesture.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });

        // Advance past suppression.
        vi.advanceTimersByTime(500);

        // New plain right-click — contextmenu should pass through.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("新 pointerdown 立即终止旧保护期", () => {
        adapter.attach(target);
        // First gesture completes → enters suppression.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });

        // Immediately start a new plain right-click (no time advance).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });
        // The new interaction's contextmenu should pass through — the
        // old suppression was terminated by the new pointerdown.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("快速连续两个手势不会相互污染", () => {
        adapter.attach(target);
        // First gesture.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Immediately start a second gesture (new pointerdown terminates
        // the first suppression, then a new one starts on completion).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(2);

        // Late contextmenu — blocked by the second gesture's suppression.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);
    });

    it("手势后立即普通右键 → 普通右键菜单正常出现一次", () => {
        adapter.attach(target);
        // First: a completed gesture.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Immediately do a plain right-click (new pointerdown terminates
        // the old suppression).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // No movement — PENDING release.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });

        // Natural contextmenu should pass through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("detach 清理保护定时器 — 无残留", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        // Suppression is active with a pending timer.
        adapter.detach();

        // Advance past the suppression window — the timer was cleared,
        // so no state changes occur.
        vi.advanceTimersByTime(500);

        // contextmenu passes through (adapter is detached).
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("旧保护定时器到期不能清除新手势的保护状态", () => {
        // This test verifies the generation guard in the timer callback.
        adapter.attach(target);
        // First gesture → enters suppression with generation G.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        // Suppression is active (generation G, timer pending).

        // Immediately start a second gesture — new pointerdown increments
        // the generation to G+1 and clears the old timer.  Then the second
        // gesture completes and enters its own suppression (G+1).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(2);

        // Advance past the 400ms window.  The second gesture's timer fires
        // and clears its own suppression.  The first gesture's timer was
        // cancelled (clearTimeout) so it cannot run.
        vi.advanceTimersByTime(500);

        // Suppression has expired — contextmenu passes through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("连续两个手势各自正确屏蔽延迟菜单", () => {
        adapter.attach(target);

        // First gesture.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        // Late contextmenu from first gesture — blocked.
        const ctx1 = dispatchContextmenu({ target });
        expect(ctx1.defaultPrevented).toBe(true);

        // Second gesture (new pointerdown terminates old suppression,
        // then starts its own on completion).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        // Late contextmenu from second gesture — blocked.
        const ctx2 = dispatchContextmenu({ target });
        expect(ctx2.defaultPrevented).toBe(true);

        // Advance past suppression — now passes through.
        vi.advanceTimersByTime(500);
        const ctx3 = dispatchContextmenu({ target });
        expect(ctx3.defaultPrevented).toBe(false);
    });
});

// ============================================== replay invalidation
describe("MouseGestureAdapter — contextmenu 重放安全失效", () => {
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    function flushMicrotasks(): Promise<void> {
        return Promise.resolve();
    }

    it("普通右键安排重放后立即 detach，重放不得执行", async () => {
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) receivedReplay.push(me);
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target, clientX: 0, clientY: 0 });
        // pointerup PENDING → schedules replay microtask.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });
        // Detach before the microtask runs.
        adapter.detach();

        await flushMicrotasks();
        // No replay should have fired — the lifecycle generation changed.
        expect(receivedReplay.length).toBe(0);
    });

    it("普通右键安排重放后立即开始新手势，旧重放不得执行", async () => {
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) receivedReplay.push(me);
        });

        adapter.attach(target);
        // First plain right-click → schedules replay (token=T1, interaction=I1).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target, clientX: 0, clientY: 0 });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });

        // Immediately start a new interaction (new pointerdown supersedes
        // the old replay token: interaction=I2, token=T2).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 10, clientY: 10,
        });
        // Second interaction also intercepts a contextmenu and schedules
        // its own replay (token=T3, interaction=I2).
        dispatchContextmenu({ target, clientX: 10, clientY: 10 });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 12, clientY: 10,
        });

        await flushMicrotasks();
        // Only the latest replay (from the second interaction) should fire.
        // The first interaction's replay was superseded by the new
        // pointerdown (interaction generation changed).
        expect(receivedReplay.length).toBe(1);
        expect(receivedReplay[0].clientX).toBe(10);
    });

    it("两个普通右键快速连续发生，只允许当前有效交互的菜单恢复", async () => {
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) receivedReplay.push(me);
        });

        adapter.attach(target);
        // First plain right-click (no contextmenu intercepted → no replay).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });

        // Second plain right-click with intercepted contextmenu.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 10, clientY: 10,
        });
        dispatchContextmenu({ target, clientX: 10, clientY: 10 });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 12, clientY: 10,
        });

        await flushMicrotasks();
        // Only one replay (from the second interaction).
        expect(receivedReplay.length).toBe(1);
        expect(receivedReplay[0].clientX).toBe(10);
    });

    it("进入 TRACKING 后任何已安排的普通菜单重放必须失效", async () => {
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) receivedReplay.push(me);
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // Intercept contextmenu during PENDING.
        dispatchContextmenu({ target, clientX: 0, clientY: 0 });
        // Move past threshold → TRACKING.  This invalidates any pending
        // replay token.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 20, clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 40, clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        await flushMicrotasks();
        // No replay — the gesture was confirmed.
        expect(receivedReplay.length).toBe(0);
    });

    it("重放完成后 snapshot 已清空（无残留）", async () => {
        // This is a white-box test: after the replay fires, the adapter's
        // contextmenuSnapshot must be null.  We verify indirectly by
        // checking that a second pointerup-PENDING does not trigger a
        // second replay from a stale snapshot.
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) receivedReplay.push(me);
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        dispatchContextmenu({ target, clientX: 0, clientY: 0 });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });

        await flushMicrotasks();
        expect(receivedReplay.length).toBe(1);

        // Now dispatch a bare pointerup with no preceding pointerdown —
        // the adapter should not replay anything from a stale snapshot.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 2, clientY: 0,
        });
        await flushMicrotasks();
        // Still only one replay — no stale snapshot.
        expect(receivedReplay.length).toBe(1);
    });
});

describe("MouseGestureAdapter — 取消场景", () => {
    function startGesture(): void {
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
    }

    it("手势进行中按 Alt 取消", () => {
        adapter.attach(target);
        startGesture();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        const session = events.onCancel.mock.calls[0][0] as GestureSession;
        expect(session.state).toBe(GestureState.CANCELLED);
        expect(session.cancelReason).toBe("suppression-key");
    });

    it("Escape 取消", () => {
        adapter.attach(target);
        startGesture();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("escape");
    });

    it("timeout 取消", () => {
        const shortTrigger = { ...TEST_TRIGGER, timeoutMs: 50 };
        const shortEvents = makeSpyEvents();
        const shortAdapter = new MouseGestureAdapter(shortTrigger, shortEvents);
        shortAdapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(shortEvents.onCancel).toHaveBeenCalledTimes(1);
                expect(shortEvents.onCancel.mock.calls[0][0].cancelReason).toBe("timeout");
                shortAdapter.detach();
                resolve();
            }, 120);
        });
    });

    it("visibilitychange 取消", () => {
        adapter.attach(target);
        startGesture();
        // Simulate document becoming hidden
        Object.defineProperty(document, "hidden", { value: true, configurable: true, writable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("visibilitychange");
        // Restore
        Object.defineProperty(document, "hidden", { value: false, configurable: true, writable: true });
    });

    it("window blur 取消", () => {
        adapter.attach(target);
        startGesture();
        window.dispatchEvent(new Event("blur"));
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("window-blur");
    });

    it("pointercancel 取消", () => {
        adapter.attach(target);
        startGesture();
        dispatchPointer(target, "pointercancel", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("pointercancel");
    });

    it("lostpointercapture 取消", () => {
        adapter.attach(target);
        startGesture();
        dispatchPointer(target, "lostpointercapture", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("lostpointercapture");
    });
});

describe("MouseGestureAdapter — Alt 抑制与 pointerType", () => {
    it("pointerdown 时按住 Alt 不创建会话", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            altKey: true,
            clientX: 0,
            clientY: 0,
        });
        expect(events.onStateChange).not.toHaveBeenCalled();
    });

    it("非鼠标 pointerType 不启动手势", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            pointerType: "touch",
            clientX: 0,
            clientY: 0,
        });
        expect(events.onStateChange).not.toHaveBeenCalled();
    });
});

// ============================================== stale suppression release
/**
 * Regression tests for the bug where a new trigger-button pointerdown that
 * bypasses the gesture system (Alt held, non-mouse pointerType) failed to
 * clear the stale post-gesture suppression from a previous gesture, causing
 * the bypassed right-click's contextmenu to be incorrectly blocked.
 *
 * The fix: when a new trigger-button pointerdown arrives with no active
 * session, clean up the previous interaction's leftover state BEFORE
 * checking pointerType / suppressionKey.
 */
describe("MouseGestureAdapter — 旧保护期在新右键输入前释放", () => {
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    /**
     * Run a confirmed gesture along the given waypoints so the adapter
     * enters the 400ms post-gesture suppression window.
     */
    function runConfirmedGesture(waypoints: { x: number; y: number }[]): void {
        const start = { x: 100, y: 100 };
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            clientX: start.x, clientY: start.y,
        });
        for (const wp of waypoints) {
            dispatchPointer(target, "pointermove", {
                buttons: RIGHT_BUTTON_MASK, clientX: wp.x, clientY: wp.y,
            });
        }
        const last = waypoints[waypoints.length - 1] ?? start;
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: last.x, clientY: last.y,
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ------------------------------------------ Alt + right-click after gesture
    it("完成 U 手势后，400ms 内 Alt + 右键，contextmenu 正常通过", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 100, y: 70 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        // Within the 400ms window: Alt + right-click.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        // No time advance — still within the 400ms window.
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    it("完成 D 手势后，400ms 内 Alt + 右键，contextmenu 正常通过", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 100, y: 130 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    it("完成 L 手势后，400ms 内 Alt + 右键，contextmenu 正常通过", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 70, y: 100 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    it("完成 R 手势后，400ms 内 Alt + 右键，contextmenu 正常通过", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    // ------------------------------------------ Alt + right-click side effects
    it("Alt + 右键不创建 GestureSession（无 onStateChange）", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        const stateChangeBefore = events.onStateChange.mock.calls.length;

        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        // No new onStateChange call (the gesture's PENDING onStateChange
        // already happened during runConfirmedGesture).
        expect(events.onStateChange.mock.calls.length).toBe(stateChangeBefore);
    });

    it("Alt + 右键不触发 onStateChange / onUpdate / onComplete / onCancel", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        const state = {
            onStateChange: events.onStateChange.mock.calls.length,
            onUpdate: events.onUpdate.mock.calls.length,
            onComplete: events.onComplete.mock.calls.length,
            onCancel: events.onCancel.mock.calls.length,
        };

        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        // Also dispatch a pointerup and pointermove to be sure none of them
        // trigger callbacks.
        dispatchPointer(target, "pointermove", {
            buttons: 0, clientX: 110, clientY: 100,
        });
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 110, clientY: 100,
        });

        expect(events.onStateChange.mock.calls.length).toBe(state.onStateChange);
        expect(events.onUpdate.mock.calls.length).toBe(state.onUpdate);
        expect(events.onComplete.mock.calls.length).toBe(state.onComplete);
        expect(events.onCancel.mock.calls.length).toBe(state.onCancel);
    });

    it("Alt + 右键不会安排合成菜单重放", async () => {
        // Track every non-prevented contextmenu that reaches the target.
        const received: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) received.push(me);
        });

        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);

        // Alt + right-click — clears suppression, no session created.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 100, clientY: 100,
        });
        // Dispatch one natural contextmenu — it passes through.
        dispatchContextmenu({ target, clientX: 100, clientY: 100 });

        // Flush microtasks — no synthetic replay should have been scheduled.
        await Promise.resolve();

        // Exactly one event (the natural one) — no replay.
        expect(received.length).toBe(1);
    });

    // ------------------------------------------ non-mouse pointerType after gesture
    it("完成手势后立即使用 pointerType pen 的右键输入，不创建会话且菜单正常通过", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        const stateChangeBefore = events.onStateChange.mock.calls.length;
        // pen pointerdown with trigger button — clears suppression, no session.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            pointerType: "pen", clientX: 100, clientY: 100,
        });
        expect(events.onStateChange.mock.calls.length).toBe(stateChangeBefore);

        // contextmenu must pass through (no stale suppression).
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    it("完成手势后立即使用 pointerType touch，不创建会话且不被旧保护期错误拦截", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        expect(events.onComplete).toHaveBeenCalledTimes(1);

        const stateChangeBefore = events.onStateChange.mock.calls.length;
        // touch pointerdown with trigger button — clears suppression, no session.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            pointerType: "touch", clientX: 100, clientY: 100,
        });
        expect(events.onStateChange.mock.calls.length).toBe(stateChangeBefore);

        // contextmenu must pass through (no stale suppression).
        const ctx = dispatchContextmenu({ target, clientX: 100, clientY: 100 });
        expect(ctx.defaultPrevented).toBe(false);
    });

    // ------------------------------------------ normal mouse right-click still works
    it("普通 mouse 右键仍能开始新的 PENDING 会话", () => {
        adapter.attach(target);
        runConfirmedGesture([{ x: 130, y: 100 }]);
        // The confirmed gesture produced PENDING + TRACKING onStateChange.
        const stateChangeBefore = events.onStateChange.mock.calls.length;

        // Normal mouse right-click (no Alt, pointerType mouse).
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            clientX: 100, clientY: 100,
        });
        // PENDING session created → exactly one more onStateChange call.
        expect(events.onStateChange.mock.calls.length).toBe(stateChangeBefore + 1);
    });

    // ------------------------------------------ active gesture not disturbed
    it("已有 TRACKING 会话时额外 Alt pointerdown 不会清理当前手势状态", () => {
        adapter.attach(target);
        // Start a gesture and reach TRACKING.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            clientX: 100, clientY: 100,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 130, clientY: 100,
        });
        expect(events.onStateChange).toHaveBeenCalledTimes(2); // PENDING + TRACKING
        const onUpdateAfterTracking = events.onUpdate.mock.calls.length;

        // An extra Alt + right-click pointerdown arrives while TRACKING.
        // The adapter must keep ignoring it and must NOT clean the current
        // session's state.
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK,
            altKey: true, clientX: 200, clientY: 200,
        });
        // No new onStateChange (still TRACKING, no new session).
        expect(events.onStateChange).toHaveBeenCalledTimes(2);

        // The original gesture must still be alive — a pointermove for the
        // original pointer continues to produce onUpdate.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 160, clientY: 100,
        });
        expect(events.onUpdate.mock.calls.length).toBe(onUpdateAfterTracking + 1);

        // pointerup completes the original gesture.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 160, clientY: 100,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
    });
});

describe("MouseGestureAdapter — pointerId 与按钮状态", () => {
    it("错误 pointerId 的 pointermove 不影响当前会话", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            pointerId: 1,
            clientX: 0,
            clientY: 0,
        });
        // Move with a different pointerId — should be ignored
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            pointerId: 99,
            clientX: 100,
            clientY: 0,
        });
        expect(events.onUpdate).not.toHaveBeenCalled();
        // Move with correct pointerId — should work
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            pointerId: 1,
            clientX: 20,
            clientY: 0,
        });
        expect(events.onUpdate).toHaveBeenCalled();
    });

    it("按钮释放（buttons 为 0）时取消手势", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        // Move with buttons=0 — button released without pointerup
        dispatchPointer(target, "pointermove", {
            buttons: 0,
            clientX: 25,
            clientY: 0,
        });
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        expect(events.onCancel.mock.calls[0][0].cancelReason).toBe("button-released");
    });
});

describe("MouseGestureAdapter — attach/detach 幂等性", () => {
    it("detach 后监听器不再响应", () => {
        adapter.attach(target);
        adapter.detach();
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        expect(events.onStateChange).not.toHaveBeenCalled();
    });

    it("重复 attach 不重复响应", () => {
        adapter.attach(target);
        adapter.attach(target); // idempotent
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        expect(events.onStateChange).toHaveBeenCalledTimes(1);
    });
});

describe("MouseGestureAdapter — 计时器清理", () => {
    it("detach 后 timeout 计时器不残留", () => {
        const shortTrigger = { ...TEST_TRIGGER, timeoutMs: 50 };
        const shortEvents = makeSpyEvents();
        const shortAdapter = new MouseGestureAdapter(shortTrigger, shortEvents);
        shortAdapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        shortAdapter.detach();
        // detach itself calls abort("manual") → onCancel fires exactly once.
        expect(shortEvents.onCancel).toHaveBeenCalledTimes(1);
        expect(shortEvents.onCancel.mock.calls[0][0].cancelReason).toBe("manual");
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                // After 120ms (well past the 50ms timeout), onCancel should
                // still have been called only once — the timeout timer was
                // cleared by detach and must NOT fire a second time.
                expect(shortEvents.onCancel).toHaveBeenCalledTimes(1);
                resolve();
            }, 120);
        });
    });
});

describe("MouseGestureAdapter — CANCELLED 不可执行", () => {
    it("CANCELLED 会话不能被视为可执行手势", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(events.onCancel).toHaveBeenCalledTimes(1);
        const session = events.onCancel.mock.calls[0][0] as GestureSession;
        expect(session.state).toBe(GestureState.CANCELLED);
        expect(session.cancelReason).toBe("escape");
        // onComplete must NOT have been called for a cancelled session
        expect(events.onComplete).not.toHaveBeenCalled();
    });
});

describe("MouseGestureAdapter — pointerup 终点记录", () => {
    it("pointermove 在 x=20, pointerup 在 x=40 → 最后一点为 x=40", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 20,
            clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 40,
            clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
        const session = events.onComplete.mock.calls[0][0] as GestureSession;
        const lastPoint = session.points[session.points.length - 1];
        expect(lastPoint.x).toBe(40);
    });

    it("pointermove 和 pointerup 坐标相同时不重复添加", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 40,
            clientY: 0,
        });
        const beforeCount = (events.onUpdate.mock.calls[0]?.[0] as GestureSession | undefined)?.points.length;
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 40,
            clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
        const session = events.onComplete.mock.calls[0][0] as GestureSession;
        // The last pointermove was at (40, 0), pointerup is also at (40, 0)
        // → no duplicate point should be added.
        if (beforeCount !== undefined) {
            expect(session.points.length).toBe(beforeCount);
        }
        const lastPoint = session.points[session.points.length - 1];
        expect(lastPoint.x).toBe(40);
        expect(lastPoint.y).toBe(0);
    });

    it("快速完成最后一个方向段时 pointerup 终点参与识别", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        // Move right past threshold
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 30,
            clientY: 0,
        });
        // pointerup at a significantly different position (x=80)
        // This tests that the pointerup endpoint is recorded and extends
        // the gesture path, ensuring the recognition pipeline sees the full
        // extent of the movement.
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 80,
            clientY: 0,
        });
        expect(events.onComplete).toHaveBeenCalledTimes(1);
        const session = events.onComplete.mock.calls[0][0] as GestureSession;
        const lastPoint = session.points[session.points.length - 1];
        expect(lastPoint.x).toBe(80);
    });

    it("普通右键未达到阈值时不触发 onComplete", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        // Small movement below threshold
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 5,
            clientY: 0,
        });
        dispatchPointer(target, "pointerup", {
            button: 2,
            buttons: 0,
            clientX: 8,
            clientY: 0,
        });
        expect(events.onComplete).not.toHaveBeenCalled();
    });
});

// ============================================== diagnostic: double contextmenu
/**
 * Diagnostic test for a hypothetical platform edge case:
 *
 *   pointerdown → contextmenu (before pointerup, intercepted)
 *                → pointerup (PENDING release, replay scheduled)
 *                → natural contextmenu (after pointerup)
 *
 * On Windows / Electron a single right-click typically fires only ONE
 * contextmenu event, either before or after pointerup — not both.  This
 * test simulates the hypothetical "both" ordering to document what the
 * current adapter would do if it ever occurred, so we can compare against
 * real SiYuan behaviour during manual testing.
 *
 * NO de-duplication state machine is added based on this hypothetical
 * scenario alone.  If real SiYuan manual testing confirms that a single
 * right-click produces two contextmenu events (one before pointerup and
 * one after), a targeted fix should be designed around the real event
 * ordering at that point.
 */
describe("MouseGestureAdapter — 诊断：普通右键双 contextmenu 假设顺序", () => {
    function dispatchContextmenu(opts: {
        clientX?: number;
        clientY?: number;
        target?: EventTarget;
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
        });
        (opts.target ?? window).dispatchEvent(event);
        return event;
    }

    it("模拟 pointerup 前后各一个 contextmenu — 记录当前行为", async () => {
        // Record every contextmenu that reaches the target without being
        // prevented by the adapter (i.e. visible to SiYuan).
        const visibleMenus: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            const me = e as MouseEvent;
            if (!me.defaultPrevented) visibleMenus.push(me);
        });

        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 50, clientY: 50,
        });

        // 1. contextmenu fires BEFORE pointerup (intercepted during PENDING).
        const ctx1 = dispatchContextmenu({ target, clientX: 50, clientY: 50 });
        expect(ctx1.defaultPrevented).toBe(true); // intercepted

        // 2. pointerup — PENDING release, replay scheduled via microtask.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 52, clientY: 50,
        });

        // 3. Flush microtasks — the replay fires now (one visible menu).
        await Promise.resolve();
        expect(visibleMenus.length).toBe(1);
        expect(visibleMenus[0].defaultPrevented).toBe(false);

        // 4. Hypothetical: platform ALSO dispatches a natural contextmenu
        //    after pointerup.  Since the session has ended (PENDING release
        //    does not enter post-gesture suppression) and postGestureSuppress
        //    is false, this natural contextmenu passes through untouched.
        const ctx2 = dispatchContextmenu({ target, clientX: 50, clientY: 50 });
        expect(ctx2.defaultPrevented).toBe(false);

        // Document the current behaviour: in this hypothetical ordering the
        // target would see TWO visible contextmenu events (the replay plus
        // the natural one).  This is recorded here so we can compare against
        // real SiYuan manual testing.  If real testing confirms that a single
        // right-click never produces this "both" ordering, no fix is needed.
        // If real testing reproduces double menus, a de-duplication fix
        // should be designed around the confirmed event ordering.
        expect(visibleMenus.length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Stage 5B: generic input-target exclusion (gesture recorder isolation).
// ---------------------------------------------------------------------------

describe("MouseGestureAdapter — 输入目标排除", () => {
    it("排除目标上的右键 pointerdown 不创建 GestureSession", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events, {
            shouldIgnoreTarget: (t) =>
                t instanceof Element && t.closest("[data-gesture-flow-recorder]") !== null,
        });
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        target.appendChild(recorder);
        adapter.attach(target);

        dispatchPointer(recorder, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        expect(events.onStateChange).not.toHaveBeenCalled();
        expect(adapter.active).toBe(false);
    });

    it("排除目标上完整右键拖拽不触发任何全局回调", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events, {
            shouldIgnoreTarget: (t) =>
                t instanceof Element && t.closest("[data-gesture-flow-recorder]") !== null,
        });
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        target.appendChild(recorder);
        adapter.attach(target);

        dispatchPointer(recorder, "pointerdown", { button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0 });
        dispatchPointer(recorder, "pointermove", { buttons: RIGHT_BUTTON_MASK, clientX: 40, clientY: 0 });
        dispatchPointer(recorder, "pointerup", { button: 2, buttons: 0, clientX: 40, clientY: 0 });

        expect(events.onStateChange).not.toHaveBeenCalled();
        expect(events.onUpdate).not.toHaveBeenCalled();
        expect(events.onComplete).not.toHaveBeenCalled();
        expect(events.onCancel).not.toHaveBeenCalled();
    });

    it("录制区外的普通手势完全不受影响", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events, {
            shouldIgnoreTarget: (t) =>
                t instanceof Element && t.closest("[data-gesture-flow-recorder]") !== null,
        });
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        target.appendChild(recorder);
        adapter.attach(target);

        dispatchPointer(target, "pointerdown", { button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0 });
        dispatchPointer(target, "pointermove", { buttons: RIGHT_BUTTON_MASK, clientX: 30, clientY: 0 });
        dispatchPointer(target, "pointerup", { button: 2, buttons: 0, clientX: 30, clientY: 0 });

        expect(events.onComplete).toHaveBeenCalledTimes(1);
    });

    it("录制区的 contextmenu 不被全局适配器截获", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events, {
            shouldIgnoreTarget: (t) =>
                t instanceof Element && t.closest("[data-gesture-flow-recorder]") !== null,
        });
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        target.appendChild(recorder);
        adapter.attach(target);

        const menuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 5 });
        recorder.dispatchEvent(menuEvent);

        // 未被 preventDefault / stopPropagation → 录制器自己可以处理
        expect(menuEvent.defaultPrevented).toBe(false);
    });

    it("移除标记后（录制器销毁）过滤不再生效，手势恢复", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events, {
            shouldIgnoreTarget: (t) =>
                t instanceof Element && t.closest("[data-gesture-flow-recorder]") !== null,
        });
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        target.appendChild(recorder);
        adapter.attach(target);

        // 录制器被销毁：标记元素从 DOM 移除
        recorder.remove();

        dispatchPointer(target, "pointerdown", { button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0 });
        dispatchPointer(target, "pointermove", { buttons: RIGHT_BUTTON_MASK, clientX: 30, clientY: 0 });
        dispatchPointer(target, "pointerup", { button: 2, buttons: 0, clientX: 30, clientY: 0 });

        expect(events.onComplete).toHaveBeenCalledTimes(1);
    });

    it("默认无过滤器时行为与旧版一致", () => {
        adapter = new MouseGestureAdapter(TEST_TRIGGER, events);
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", { button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0 });
        expect(events.onStateChange).toHaveBeenCalledTimes(1);
    });
});
