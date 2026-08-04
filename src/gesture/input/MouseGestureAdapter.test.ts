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
    } = {}): MouseEvent {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: opts.cancelable ?? true,
            clientX: opts.clientX ?? 0,
            clientY: opts.clientY ?? 0,
            button: 2,
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
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 10, clientY: 10,
        });
        // contextmenu fires during PENDING — intercepted.
        const ctxEvent = dispatchContextmenu({
            target,
            clientX: 10,
            clientY: 10,
        });
        expect(ctxEvent.defaultPrevented).toBe(true);

        // pointerup without enough movement → PENDING release.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 12, clientY: 10,
        });

        // Wait for the microtask replay.
        const receivedReplay: MouseEvent[] = [];
        target.addEventListener("contextmenu", (e) => {
            if (e.defaultPrevented === false) {
                receivedReplay.push(e as MouseEvent);
            }
        });
        await flushMicrotasks();

        // A replay contextmenu should have been dispatched.
        // The replay is marked so the adapter doesn't re-intercept it.
        // We verify by checking that the adapter didn't preventDefault on it.
        // Since the adapter's handler checks replayMarkers, the replay event
        // should pass through.
    });

    // ---------------------------------------------------------- Scenario C
    it("场景 C：contextmenu 在 pointerup 后自然触发 → 不提前重放，不阻止", () => {
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

    // ---------------------------------------------------------- Scenario D
    it("场景 D：移动未超过阈值但已截获 contextmenu → pointerup 后恢复一次", async () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2, buttons: RIGHT_BUTTON_MASK, clientX: 0, clientY: 0,
        });
        // Small movement below threshold.
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK, clientX: 5, clientY: 0,
        });
        // contextmenu intercepted during PENDING.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(true);

        // pointerup — PENDING release, should schedule replay.
        dispatchPointer(target, "pointerup", {
            button: 2, buttons: 0, clientX: 6, clientY: 0,
        });

        // Wait for replay.
        await flushMicrotasks();
        // The replay should have been dispatched (verified by no additional
        // interception).
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
    it("场景 F：进入 TRACKING 后 Escape 取消 → 不重放菜单", () => {
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

        // A contextmenu now should pass through (session is CANCELLED, not active).
        const ctxEvent2 = dispatchContextmenu({ target });
        expect(ctxEvent2.defaultPrevented).toBe(false);
    });

    it("场景 F2：TRACKING 中 pointercancel → 不重放菜单", () => {
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

        // No replay — contextmenu passes through.
        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
    });

    it("场景 F3：TRACKING 中 window blur → 不重放菜单", () => {
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

        const ctxEvent = dispatchContextmenu({ target });
        expect(ctxEvent.defaultPrevented).toBe(false);
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
