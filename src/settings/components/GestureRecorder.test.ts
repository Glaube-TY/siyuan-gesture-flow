// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GestureRecorder from "./GestureRecorder.svelte";
import { GestureEngine, DEFAULT_RECOGNIZER_CONFIG } from "@/gesture/GestureEngine";
import type { GesturePoint } from "@/gesture/types";
import type { Direction } from "@/gesture/recognition/DirectionVectorizer";

// ----------------------------------------------------------- test helpers

/** Canvas 2D context stub (happy-dom has no real 2D context). */
function makeContextStub(): CanvasRenderingContext2D {
    const stub: Record<string, unknown> = {
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        setTransform: vi.fn(),
    };
    return stub as unknown as CanvasRenderingContext2D;
}

/** Dense points along a polyline (same generator as the recognition tests). */
function buildPath(waypoints: [number, number][], step = 4): GesturePoint[] {
    const points: GesturePoint[] = [];
    let t = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const [x1, y1] = waypoints[i];
        const [x2, y2] = waypoints[i + 1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(len / step));
        for (let s = 0; s <= steps; s++) {
            const f = s / steps;
            points.push({ x: x1 + dx * f, y: y1 + dy * f, t });
            t += 16;
        }
    }
    return points;
}

const RECT = { left: 10, top: 20, width: 300, height: 140, right: 310, bottom: 160, x: 10, y: 20, toJSON: () => ({}) };

interface Mounted {
    host: HTMLElement;
    component: GestureRecorder;
    updates: { directions: string[] }[];
    clears: { clears: number };
}

function mountRecorder(
    directionMode: 4 | 8 = 4,
    trigger: { activationDistance: number; timeoutMs: number } = { activationDistance: 16, timeoutMs: 10000 },
): Mounted {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, directionMode });
    const updates: { directions: string[] }[] = [];
    const state = { clears: 0 };
    const component = new GestureRecorder({
        target: host,
        props: { engine, i18n: {}, trigger },
    });
    component.$on("update", (e: CustomEvent<{ directions: string[] }>) => updates.push(e.detail));
    component.$on("clear", () => state.clears++);
    return { host, component, updates, clears: state };
}

function recorderEl(m: Mounted): HTMLElement {
    return m.host.querySelector(".gf-recorder") as HTMLElement;
}

/** Dispatch a pointer event with client coords relative to the RECT origin. */
function pointer(el: EventTarget, type: string, x: number, y: number, extra: Record<string, unknown> = {}): PointerEvent {
    const ev = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: RECT.left + x,
        clientY: RECT.top + y,
        pointerId: 7,
        pointerType: "mouse",
        ...extra,
    });
    el.dispatchEvent(ev);
    return ev;
}

function pointerUp(el: EventTarget, x: number, y: number): PointerEvent {
    return pointer(el, "pointerup", x, y, { buttons: 0 });
}

/** Draw a polyline: pointerdown at start, moves along waypoints, pointerup at end. */
function drawGesture(m: Mounted, waypoints: [number, number][]): void {
    const el = recorderEl(m);
    pointer(el, "pointerdown", waypoints[0][0], waypoints[0][1]);
    for (const p of buildPath(waypoints, 8)) {
        pointer(el, "pointermove", p.x, p.y);
    }
    const last = waypoints[waypoints.length - 1];
    pointerUp(el, last[0], last[1]);
}

let contextStub: CanvasRenderingContext2D;

beforeEach(() => {
    contextStub = makeContextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(contextStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT as DOMRect);
    // happy-dom lacks RAF / ResizeObserver — provide minimal stubs.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(0), 0) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
    // Pointer capture stubs.
    const proto = Element.prototype as Element & {
        setPointerCapture?: (id: number) => void;
        releasePointerCapture?: (id: number) => void;
    };
    if (typeof proto.setPointerCapture !== "function") {
        proto.setPointerCapture = function () {};
    }
    if (typeof proto.releasePointerCapture !== "function") {
        proto.releasePointerCapture = function () {};
    }
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ------------------------------------------------------------------- tests

describe("GestureRecorder — 基本录制", () => {
    it("录制区带有 data-gesture-flow-recorder 标记（全局 Adapter 排除依据）", () => {
        const m = mountRecorder();
        expect(recorderEl(m).hasAttribute("data-gesture-flow-recorder")).toBe(true);
        m.component.$destroy();
    });

    it("右键按下进入录制状态，松开后有效单方向被识别", async () => {
        const m = mountRecorder();
        drawGesture(m, [[0, 0], [120, 0]]); // R
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        expect(m.updates[0].directions).toEqual(["R"]);
        m.component.$destroy();
    });

    it("复合方向 R → D 被识别", async () => {
        const m = mountRecorder();
        drawGesture(m, [[0, 0], [120, 0], [120, 120]]);
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        expect(m.updates[0].directions).toEqual(["R", "D"]);
        m.component.$destroy();
    });

    it("圆滑转弯仍识别为复合方向", async () => {
        const m = mountRecorder();
        // Smooth arc from east to south (radius 30 around the corner).
        const arc: [number, number][] = [];
        for (let deg = 0; deg <= 90; deg += 3) {
            const rad = (deg * Math.PI) / 180;
            arc.push([120 - 30 + 30 * Math.cos(rad), 120 - 30 + 30 * Math.sin(rad)]);
        }
        const waypoints: [number, number][] = [[0, 0], [120, 0], ...arc, [120, 120], [120, 200]];
        drawGesture(m, waypoints);
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        const dirs = m.updates[0].directions;
        expect(dirs[0]).toBe("R");
        expect(dirs[dirs.length - 1]).toBe("D");
        m.component.$destroy();
    });

    it("8 方向模式识别右下斜线为 DR", async () => {
        const m = mountRecorder(8);
        drawGesture(m, [[0, 0], [120, 120]]); // from top-left to bottom-right
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        expect(m.updates[0].directions).toEqual(["DR"]);
        m.component.$destroy();
    });

    it("8 方向模式识别四种斜向（精确方向）", async () => {
        // Screen coords: y grows downward.  DirectionVectorizer maps
        // angle 0 = R (east), π/2 = D (south).
        const cases: [waypoints: [number, number][], expected: string][] = [
            [[[0, 0], [120, 120]], "DR"], // 右下
            [[[120, 120], [0, 0]], "UL"], // 左上
            [[[120, 0], [0, 120]], "DL"], // 左下
            [[[0, 120], [120, 0]], "UR"], // 右上
        ];
        for (const [waypoints, expected] of cases) {
            const m = mountRecorder(8);
            drawGesture(m, waypoints);
            await Promise.resolve();
            expect(m.updates).toHaveLength(1);
            expect(m.updates[0].directions, `expected ${expected}`).toEqual([expected]);
            m.component.$destroy();
        }
    });

    it("轨迹太短显示错误且不产生方向", async () => {
        const m = mountRecorder();
        drawGesture(m, [[0, 0], [8, 0]]); // way below minimumSegmentLength (18)
        await Promise.resolve();
        expect(m.updates).toHaveLength(0);
        const status = m.host.querySelector(".gf-recorder-status--error");
        expect(status).toBeTruthy();
        m.component.$destroy();
    });

    it("超过最大段数显示错误", async () => {
        const m = mountRecorder();
        // Zigzag with 8 segments (turn angle 59° > threshold 42°),
        // exceeding maximumSegments (6).
        const waypoints: [number, number][] = [[0, 0]];
        for (let i = 0; i < 8; i++) {
            waypoints.push([(i + 1) * 60, i % 2 === 0 ? 0 : 100]);
        }
        drawGesture(m, waypoints);
        await Promise.resolve();
        expect(m.updates).toHaveLength(0);
        const status = m.host.querySelector(".gf-recorder-status--error");
        expect(status).toBeTruthy();
        m.component.$destroy();
    });
});

describe("GestureRecorder — 取消与清理", () => {
    it("Escape 取消录制", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(m.updates).toHaveLength(0);
        // No recording status shown afterwards.
        expect(m.host.querySelector(".gf-recorder-status--recording")).toBeNull();
        m.component.$destroy();
    });

    it("pointercancel 取消录制", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
        expect(m.updates).toHaveLength(0);
        expect(m.host.querySelector(".gf-recorder-status--recording")).toBeNull();
        m.component.$destroy();
    });

    it("window blur 取消录制", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        window.dispatchEvent(new Event("blur"));
        expect(m.updates).toHaveLength(0);
        m.component.$destroy();
    });

    it("录制区 contextmenu 被局部阻止", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 20, clientY: 20 });
        el.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        m.component.$destroy();
    });

    it("销毁后不再响应录制事件（无残留监听）", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        m.component.$destroy();
        pointer(el, "pointerdown", 0, 0);
        pointerUp(el, 100, 0);
        expect(m.updates).toHaveLength(0);
    });
});

describe("GestureRecorder — 绘制与 DPR", () => {
    it("canvas 按 DPR 缩放尺寸", () => {
        window.devicePixelRatio = 2;
        const m = mountRecorder();
        const canvas = m.host.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.width).toBe(Math.round(300 * 2));
        expect(canvas.height).toBe(Math.round(140 * 2));
        expect(contextStub.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
        m.component.$destroy();
    });

    it("录制过程中在 canvas 上绘制轨迹", async () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        pointer(el, "pointermove", 40, 0);
        pointer(el, "pointermove", 80, 0);
        await new Promise((r) => setTimeout(r, 10)); // flush RAF draw
        expect(contextStub.beginPath).toHaveBeenCalled();
        expect(contextStub.stroke).toHaveBeenCalled();
        m.component.$destroy();
    });

    it("清除按钮清空方向并派发 clear", async () => {
        const m = mountRecorder();
        drawGesture(m, [[0, 0], [120, 0]]);
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        // The directions prop is controlled by the parent: feed the
        // recorded sequence back so the clear button appears.
        m.component.$set({ directions: m.updates[0].directions as Direction[] });
        await Promise.resolve();

        const clearBtn = m.host.querySelector(".gf-recorder-clear") as HTMLButtonElement;
        expect(clearBtn).toBeTruthy();
        clearBtn.click();
        expect(m.clears.clears).toBe(1);
        m.component.$destroy();
    });
});

describe("GestureRecorder — 激活距离（stage 5B 稳定化）", () => {
    it("activationDistance 40 时移动 30px 不产生录制结果", async () => {
        const m = mountRecorder(4, { activationDistance: 40, timeoutMs: 10000 });
        drawGesture(m, [[0, 0], [30, 0]]); // below activation
        await Promise.resolve();
        expect(m.updates).toHaveLength(0);
        expect(m.host.querySelector(".gf-recorder-status--error")).toBeTruthy();
        m.component.$destroy();
    });

    it("activationDistance 40 时移动超过 40px 可以识别", async () => {
        const m = mountRecorder(4, { activationDistance: 40, timeoutMs: 10000 });
        drawGesture(m, [[0, 0], [120, 0]]);
        await Promise.resolve();
        expect(m.updates).toHaveLength(1);
        expect(m.updates[0].directions).toEqual(["R"]);
        m.component.$destroy();
    });

    it("修改 activationDistance 后录制器立即使用新值", async () => {
        const m = mountRecorder(4, { activationDistance: 16, timeoutMs: 10000 });
        // 20px < 40px: with the old threshold this records, with the new
        // threshold it must not.
        m.component.$set({ trigger: { activationDistance: 40, timeoutMs: 10000 } });
        await Promise.resolve();
        drawGesture(m, [[0, 0], [20, 0]]);
        await Promise.resolve();
        expect(m.updates).toHaveLength(0);
        expect(m.host.querySelector(".gf-recorder-status--error")).toBeTruthy();
        m.component.$destroy();
    });

    it("未激活松开显示轨迹太短且不派发 update", async () => {
        const m = mountRecorder(4, { activationDistance: 100, timeoutMs: 10000 });
        drawGesture(m, [[0, 0], [50, 0]]);
        await Promise.resolve();
        expect(m.updates).toHaveLength(0);
        m.component.$destroy();
    });
});

describe("GestureRecorder — 录制超时（stage 5B 稳定化）", () => {
    it("timeoutMs 到点后取消录制", async () => {
        vi.useFakeTimers();
        try {
            const m = mountRecorder(4, { activationDistance: 16, timeoutMs: 100 });
            const el = recorderEl(m);
            pointer(el, "pointerdown", 0, 0);
            pointer(el, "pointermove", 60, 0); // pass activation
            await Promise.resolve(); // flush Svelte DOM update
            expect(m.host.querySelector(".gf-recorder-status--recording")).toBeTruthy();

            await vi.advanceTimersByTimeAsync(150);
            await Promise.resolve();
            expect(m.host.querySelector(".gf-recorder-status--recording")).toBeNull();
            // Cancel drops the trail — no update is dispatched.
            expect(m.updates).toHaveLength(0);
            m.component.$destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it("timeoutMs 为 0 时不设限制", async () => {
        vi.useFakeTimers();
        try {
            const m = mountRecorder(4, { activationDistance: 16, timeoutMs: 0 });
            const el = recorderEl(m);
            pointer(el, "pointerdown", 0, 0);
            await vi.advanceTimersByTimeAsync(5000);
            // Still recording (no timeout fired).
            expect(m.host.querySelector(".gf-recorder-status--recording")).toBeTruthy();
            pointerUp(el, 120, 0);
            await Promise.resolve();
            expect(m.updates).toHaveLength(1);
            m.component.$destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it("旧计时器不能取消新录制", async () => {
        vi.useFakeTimers();
        try {
            const m = mountRecorder(4, { activationDistance: 16, timeoutMs: 100 });
            const el = recorderEl(m);
            pointer(el, "pointerdown", 0, 0);
            // Finish the first recording quickly (before timeout).
            pointerUp(el, 120, 0);
            await Promise.resolve();
            expect(m.updates).toHaveLength(1);

            // Start a second recording; the first timer must not cancel it.
            pointer(el, "pointerdown", 0, 0);
            await vi.advanceTimersByTimeAsync(150);
            expect(m.host.querySelector(".gf-recorder-status--recording")).toBeNull(); // second recording times out on its own timer
            expect(m.updates).toHaveLength(1);
            m.component.$destroy();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("GestureRecorder — Pointer Capture 释放（stage 5B 稳定化）", () => {
    function releaseSpy(m: Mounted): ReturnType<typeof vi.spyOn> {
        const canvas = m.host.querySelector("canvas") as HTMLCanvasElement;
        return vi.spyOn(canvas, "releasePointerCapture").mockImplementation(() => {});
    }

    it("正常完成只释放一次", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        drawGesture(m, [[0, 0], [120, 0]]);
        expect(spy).toHaveBeenCalledTimes(1);
        m.component.$destroy();
    });

    it("Escape 取消时释放 Pointer Capture", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(spy).toHaveBeenCalledTimes(1);
        m.component.$destroy();
    });

    it("window blur 取消时释放 Pointer Capture", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        window.dispatchEvent(new Event("blur"));
        expect(spy).toHaveBeenCalledTimes(1);
        m.component.$destroy();
    });

    it("visibilitychange 取消时释放 Pointer Capture", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(spy).toHaveBeenCalledTimes(1);
        m.component.$destroy();
    });

    it("组件销毁时释放 Pointer Capture", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        m.component.$destroy();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("pointercancel 后 lostpointercapture 不递归重复取消", () => {
        const m = mountRecorder();
        const spy = releaseSpy(m);
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
        expect(spy).toHaveBeenCalledTimes(1); // endRecording released once
        // A late lostpointercapture must not cause a second cancel cycle.
        el.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 7 }));
        expect(spy).toHaveBeenCalledTimes(1);
        m.component.$destroy();
    });
});

describe("GestureRecorder — Escape 只取消录制（stage 5B 稳定化）", () => {
    it("录制中 Escape 被 defaultPrevented 且不传播", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);

        const bubbleListener = vi.fn();
        window.addEventListener("keydown", bubbleListener);
        const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        window.dispatchEvent(ev);

        expect(ev.defaultPrevented).toBe(true);
        // The recorder's capture listener stopped propagation, so a
        // window-level listener (e.g. dialog close handler) never fires.
        expect(bubbleListener).not.toHaveBeenCalled();
        window.removeEventListener("keydown", bubbleListener);
        m.component.$destroy();
    });

    it("录制中 Escape 后设置面板元素仍存在", () => {
        const m = mountRecorder();
        const el = recorderEl(m);
        pointer(el, "pointerdown", 0, 0);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(m.host.querySelector(".gf-recorder")).toBeTruthy();
        expect(m.host.querySelector(".gf-recorder-status--recording")).toBeNull();
        m.component.$destroy();
    });

    it("空闲时 Escape 不被录制器拦截", () => {
        const m = mountRecorder();
        const bubbleListener = vi.fn();
        window.addEventListener("keydown", bubbleListener);
        const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        window.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(bubbleListener).toHaveBeenCalledTimes(1);
        window.removeEventListener("keydown", bubbleListener);
        m.component.$destroy();
    });
});
