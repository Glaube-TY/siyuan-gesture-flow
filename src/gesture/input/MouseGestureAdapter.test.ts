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

describe("MouseGestureAdapter — contextmenu 抑制", () => {
    it("达到阈值后阻止 contextmenu", () => {
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
        const ctxEvent = makePointerEvent("contextmenu", { cancelable: true });
        const preventDefault = vi.spyOn(ctxEvent, "preventDefault");
        target.dispatchEvent(ctxEvent);
        expect(preventDefault).toHaveBeenCalled();
    });

    it("未达到阈值不阻止 contextmenu", () => {
        adapter.attach(target);
        dispatchPointer(target, "pointerdown", {
            button: 2,
            buttons: RIGHT_BUTTON_MASK,
            clientX: 0,
            clientY: 0,
        });
        // Small movement — below activation distance
        dispatchPointer(target, "pointermove", {
            buttons: RIGHT_BUTTON_MASK,
            clientX: 5,
            clientY: 0,
        });
        const ctxEvent = makePointerEvent("contextmenu", { cancelable: true });
        const preventDefault = vi.spyOn(ctxEvent, "preventDefault");
        target.dispatchEvent(ctxEvent);
        expect(preventDefault).not.toHaveBeenCalled();
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
