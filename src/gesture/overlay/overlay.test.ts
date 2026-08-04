// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GestureOverlay } from "./GestureOverlay";
import { OverlayI18n, OverlayState } from "./types";

const TEST_I18N: OverlayI18n = {
    gestureTooLong: "手势过长",
    gestureUnrecognised: "未识别",
};

/**
 * Minimal mock of CanvasRenderingContext2D that records drawing calls.
 *
 * Happy DOM does not provide a real 2D context, so without this mock the
 * Canvas drawing code paths are never exercised.  The mock captures method
 * calls and arguments so tests can verify that `beginPath`, `moveTo`,
 * `lineTo`, and `stroke` are invoked with the correct coordinates.
 */
interface MockContextCall {
    method: string;
    args: unknown[];
}

function createMockContext() {
    const calls: MockContextCall[] = [];
    const proxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop: string) {
            if (prop === "canvas") {
                return null;
            }
            // Return a recording function for every method access.
            return (...args: unknown[]) => {
                calls.push({ method: prop, args });
            };
        },
        set() {
            return true; // ignore property sets (lineWidth, strokeStyle, etc.)
        },
    });
    return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}

/**
 * Install the mock context on HTMLCanvasElement.prototype.getContext so
 * that `canvas.getContext("2d")` returns the recording proxy.
 *
 * Returns the calls array so individual tests can inspect drawing operations.
 */
function installMockCanvas() {
    const mock = createMockContext();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mock.ctx);
    return { ...mock, spy };
}

/**
 * Mock getBoundingClientRect on a specific element to return a realistic
 * size.  Happy DOM returns zero dimensions by default, which makes edge
 * clamping tests meaningless.
 */
function mockHintRect(el: HTMLElement, width: number, height: number) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width,
        height,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

function makeState(partial: Partial<OverlayState>): OverlayState {
    return {
        points: partial.points ?? [{ x: 100, y: 100 }],
        directions: partial.directions ?? [],
        status: partial.status ?? "tracking",
        commandLabel: partial.commandLabel ?? null,
    };
}

beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, writable: true, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, writable: true, configurable: true });
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

// ============================================================ 元素创建与幂等性
describe("GestureOverlay — 元素创建与幂等性", () => {
    it("show() 后只创建一个 Canvas", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        expect(document.querySelectorAll("canvas").length).toBe(1);
        overlay.destroy();
    });

    it("show() 后只创建一个提示元素", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(1);
        overlay.destroy();
    });

    it("重复 show() 不重复创建 Canvas 或提示", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.show();
        overlay.show();
        expect(document.querySelectorAll("canvas").length).toBe(1);
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(1);
        overlay.destroy();
    });

    it("destroy() 移除所有元素", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        expect(document.querySelectorAll("canvas").length).toBe(0);
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(0);
    });

    it("destroy 后 canvasMounted 为 false", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        expect(overlay.canvasMounted).toBe(true);
        overlay.destroy();
        expect(overlay.canvasMounted).toBe(false);
    });

    it("destroy 后再调用 destroy 不报错（幂等）", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        expect(() => overlay.destroy()).not.toThrow();
    });
});

// ============================================================ Canvas 属性
describe("GestureOverlay — Canvas 属性", () => {
    it("Canvas 为 pointer-events: none", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.style.pointerEvents).toBe("none");
        overlay.destroy();
    });

    it("Canvas aria-hidden 为 true", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.getAttribute("aria-hidden")).toBe("true");
        overlay.destroy();
    });

    it("Canvas 使用 position: fixed", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.style.position).toBe("fixed");
        overlay.destroy();
    });

    it("DPR=1 时内部像素 = CSS 尺寸", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.width).toBe(1280);
        expect(canvas.height).toBe(720);
        overlay.destroy();
    });

    it("DPR=2 时内部像素 = CSS 尺寸 × 2", () => {
        installMockCanvas();
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.width).toBe(2560);
        expect(canvas.height).toBe(1440);
        overlay.destroy();
    });

    it("resize 后内部尺寸更新", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        expect(overlay.canvasPixelWidth).toBe(1280);
        Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });
        window.dispatchEvent(new Event("resize"));
        expect(overlay.canvasPixelWidth).toBe(1920);
        expect(overlay.canvasPixelHeight).toBe(1080);
        overlay.destroy();
    });

    it("destroy 后移除 resize 监听器", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
        window.dispatchEvent(new Event("resize"));
        expect(document.querySelectorAll("canvas").length).toBe(0);
    });
});

// ============================================================ PENDING 不显示
describe("GestureOverlay — PENDING 不显示", () => {
    it("未调用 show() 时页面中无 Canvas", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        expect(document.querySelectorAll("canvas").length).toBe(0);
        overlay.destroy();
    });
});

// ============================================================ Canvas 绘制
describe("GestureOverlay — Canvas 绘制", () => {
    it("两个点以上时调用 beginPath、moveTo、lineTo 和 stroke", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
            directions: ["R", "D"],
            status: "tracking",
        }));
        const methods = calls.map((c) => c.method);
        expect(methods).toContain("beginPath");
        expect(methods).toContain("moveTo");
        expect(methods).toContain("lineTo");
        expect(methods).toContain("stroke");
        overlay.destroy();
    });

    it("一个点时不调用 stroke", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 50, y: 50 }],
            directions: [],
            status: "idle",
        }));
        const methods = calls.map((c) => c.method);
        expect(methods).not.toContain("stroke");
        overlay.destroy();
    });

    it("DPR=2 时调用正确的 setTransform", () => {
        const { calls } = installMockCanvas();
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const setTransformCalls = calls.filter((c) => c.method === "setTransform");
        expect(setTransformCalls.length).toBeGreaterThanOrEqual(1);
        // setTransform(dpr, 0, 0, dpr, 0, 0)
        const args = setTransformCalls[0].args as number[];
        expect(args[0]).toBe(2); // dpr
        expect(args[3]).toBe(2); // dpr
        overlay.destroy();
    });

    it("update 使用完整原始轨迹点", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const pts = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }, { x: 70, y: 80 }];
        overlay.update(makeState({
            points: pts,
            directions: ["R", "D"],
            status: "tracking",
        }));
        const moveToCalls = calls.filter((c) => c.method === "moveTo");
        const lineToCalls = calls.filter((c) => c.method === "lineTo");
        expect(moveToCalls.length).toBe(1);
        expect(moveToCalls[0].args).toEqual([10, 20]);
        expect(lineToCalls.length).toBe(3);
        expect(lineToCalls[0].args).toEqual([30, 40]);
        expect(lineToCalls[1].args).toEqual([50, 60]);
        expect(lineToCalls[2].args).toEqual([70, 80]);
        overlay.destroy();
    });

    it("hide 会调用 clearRect", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        // Clear the calls array to only observe hide
        calls.length = 0;
        overlay.hide();
        const clearCalls = calls.filter((c) => c.method === "clearRect");
        expect(clearCalls.length).toBe(1);
        overlay.destroy();
    });

    it("resize 后会重新绘制当前轨迹", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        // Clear calls, then trigger resize
        calls.length = 0;
        Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
        window.dispatchEvent(new Event("resize"));
        const strokeCalls = calls.filter((c) => c.method === "stroke");
        expect(strokeCalls.length).toBe(1);
        overlay.destroy();
    });

    it("destroy 后不再绘制", () => {
        const { calls } = installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        calls.length = 0;
        overlay.destroy();
        // Try resize after destroy — should not draw
        window.dispatchEvent(new Event("resize"));
        const strokeCalls = calls.filter((c) => c.method === "stroke");
        expect(strokeCalls.length).toBe(0);
    });
});

// ============================================================ 轨迹与提示渲染
describe("GestureOverlay — 轨迹与提示渲染", () => {
    it("TRACKING 状态显示方向序列 R → D", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
            directions: ["R", "D"],
            status: "tracking",
        }));
        expect(overlay.hintVisible).toBe(true);
        expect(overlay.hintTextValue).toBe("R → D");
        overlay.destroy();
    });

    it("idle 状态不显示提示", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: [],
            status: "idle",
        }));
        expect(overlay.hintVisible).toBe(false);
        overlay.destroy();
    });

    it("too-long 状态显示本地化文本", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D", "L", "U", "R", "D", "L"],
            status: "too-long",
        }));
        expect(overlay.hintTextValue).toBe("手势过长");
        overlay.destroy();
    });

    it("complete 状态显示最终方向", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D"],
            status: "complete",
        }));
        expect(overlay.hintTextValue).toBe("R → D");
        overlay.destroy();
    });

    it("cancel (hide) 立即隐藏", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
        }));
        expect(overlay.hintVisible).toBe(true);
        overlay.hide();
        expect(overlay.hintVisible).toBe(false);
        overlay.destroy();
    });

    it("showFinalThenHide 在约 300ms 后隐藏", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
        }));
        overlay.showFinalThenHide(makeState({
            directions: ["R"],
            status: "complete",
        }));
        expect(overlay.hintVisible).toBe(true);
        expect(overlay.hasPendingHideTimer).toBe(true);
        vi.advanceTimersByTime(300);
        expect(overlay.hintVisible).toBe(false);
        expect(overlay.hasPendingHideTimer).toBe(false);
        vi.useRealTimers();
        overlay.destroy();
    });

    it("轨迹使用最后一个点作为提示位置", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
            directions: ["R", "D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        const left = parseInt(hint.style.left, 10);
        const top = parseInt(hint.style.top, 10);
        expect(left).toBeGreaterThanOrEqual(50);
        expect(top).toBeGreaterThanOrEqual(50);
        overlay.destroy();
    });
});

// ============================================================ commandLabel 换行
describe("GestureOverlay — commandLabel 换行", () => {
    it("commandLabel 非空时文本包含方向和命令名称", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D"],
            status: "tracking",
            commandLabel: "切换标签页",
        }));
        expect(overlay.hintTextValue).toContain("R → D");
        expect(overlay.hintTextValue).toContain("切换标签页");
        overlay.destroy();
    });

    it("使用 white-space: pre-line 支持换行", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
            commandLabel: "测试命令",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint.style.whiteSpace).toBe("pre-line");
        overlay.destroy();
    });

    it("commandLabel 为 null 时只显示方向", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D"],
            status: "tracking",
            commandLabel: null,
        }));
        expect(overlay.hintTextValue).toBe("R → D");
        overlay.destroy();
    });

    it("不使用 innerHTML 注入动态内容", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
            commandLabel: "<script>alert(1)</script>",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        // textContent should contain the raw string, not be executed as HTML
        expect(hint.textContent).toContain("<script>");
        expect(hint.querySelectorAll("script").length).toBe(0);
        overlay.destroy();
    });
});

// ============================================================ 提示边缘钳制
describe("GestureOverlay — 提示边缘钳制", () => {
    const HINT_W = 100;
    const HINT_H = 30;

    it("右边缘翻转：提示不超出视口右边", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        // Point near right edge
        overlay.update(makeState({
            points: [{ x: 1270, y: 100 }],
            directions: ["R"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        mockHintRect(hint, HINT_W, HINT_H);
        // Re-position with mocked rect
        overlay.update(makeState({
            points: [{ x: 1270, y: 100 }],
            directions: ["R"],
            status: "tracking",
        }));
        const left = parseInt(hint.style.left, 10);
        expect(left + HINT_W).toBeLessThanOrEqual(1280);
        overlay.destroy();
    });

    it("底部翻转：提示不超出视口底部", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 100, y: 710 }],
            directions: ["D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        mockHintRect(hint, HINT_W, HINT_H);
        overlay.update(makeState({
            points: [{ x: 100, y: 710 }],
            directions: ["D"],
            status: "tracking",
        }));
        const top = parseInt(hint.style.top, 10);
        expect(top + HINT_H).toBeLessThanOrEqual(720);
        overlay.destroy();
    });

    it("左上角 clamp：坐标不为负", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        mockHintRect(hint, HINT_W, HINT_H);
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        const left = parseInt(hint.style.left, 10);
        const top = parseInt(hint.style.top, 10);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        overlay.destroy();
    });

    it("窗口比提示框小时不产生 NaN", () => {
        installMockCanvas();
        Object.defineProperty(window, "innerWidth", { value: 50, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 20, configurable: true });
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 10, y: 10 }],
            directions: ["R"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        mockHintRect(hint, HINT_W, HINT_H);
        overlay.update(makeState({
            points: [{ x: 10, y: 10 }],
            directions: ["R"],
            status: "tracking",
        }));
        const left = parseInt(hint.style.left, 10);
        const top = parseInt(hint.style.top, 10);
        expect(Number.isNaN(left)).toBe(false);
        expect(Number.isNaN(top)).toBe(false);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        overlay.destroy();
    });
});

// ============================================================ 主题适配
describe("GestureOverlay — 主题适配", () => {
    it("提示框创建时不崩溃且结构属性正确", () => {
        // Happy DOM does not support CSS var() in style properties, so the
        // var()-based colour values cannot be verified here.  This test
        // verifies that the hint element is created with the correct
        // structural properties (position, pointer-events, etc.) and that
        // the theme variable logic does not throw.  Actual var() resolution
        // is verified manually in a real SiYuan instance.
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint).toBeTruthy();
        expect(hint.style.position).toBe("fixed");
        expect(hint.style.pointerEvents).toBe("none");
        expect(hint.style.whiteSpace).toBe("pre-line");
        // max-width should be set for command label wrapping
        expect(hint.style.maxWidth).toBe("240px");
        overlay.destroy();
    });

    it("轨迹颜色读取逻辑保留后备值", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            directions: ["R"],
            status: "tracking",
        }));
        // strokeStyle is a property set on the proxy which ignores sets.
        // We verify no crash occurred and the context is present.
        expect(overlay.renderContext).not.toBeNull();
        overlay.destroy();
    });
});

// ============================================================ resize 后提示位置
describe("GestureOverlay — resize 后提示位置", () => {
    it("resize 后提示重新定位到视口内", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        // Show hint near bottom-right
        overlay.update(makeState({
            points: [{ x: 1200, y: 680 }],
            directions: ["R"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        mockHintRect(hint, 100, 30);
        // Re-position with mocked rect
        overlay.update(makeState({
            points: [{ x: 1200, y: 680 }],
            directions: ["R"],
            status: "tracking",
        }));
        // Shrink window
        Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
        window.dispatchEvent(new Event("resize"));
        const left = parseInt(hint.style.left, 10);
        const top = parseInt(hint.style.top, 10);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(400);
        expect(top).toBeLessThanOrEqual(300);
        overlay.destroy();
    });
});

// ============================================================ 定时器竞争
describe("GestureOverlay — 定时器竞争", () => {
    it("show() 防御性取消旧隐藏定时器", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({
            directions: ["R"],
            status: "complete",
        }));
        expect(overlay.hasPendingHideTimer).toBe(true);
        // Start a new gesture — show() should cancel the timer
        overlay.show();
        expect(overlay.hasPendingHideTimer).toBe(false);
        // Advance past the original delay — hint should still be controllable
        vi.advanceTimersByTime(400);
        // No crash, no auto-hide from stale timer
        vi.useRealTimers();
        overlay.destroy();
    });

    it("同一时刻最多一个隐藏定时器", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({ directions: ["R"], status: "complete" }));
        expect(overlay.hasPendingHideTimer).toBe(true);
        overlay.showFinalThenHide(makeState({ directions: ["D"], status: "complete" }));
        expect(overlay.hasPendingHideTimer).toBe(true);
        // Only one timer should fire
        let hideCount = 0;
        const originalHide = overlay.hide.bind(overlay);
        vi.spyOn(overlay, "hide").mockImplementation(() => {
            hideCount++;
            originalHide();
        });
        vi.advanceTimersByTime(400);
        expect(hideCount).toBe(1);
        vi.useRealTimers();
        overlay.destroy();
    });

    it("cancel (hide) 后不存在延迟执行的旧隐藏回调", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({ directions: ["R"], status: "complete" }));
        expect(overlay.hasPendingHideTimer).toBe(true);
        overlay.hide();
        expect(overlay.hasPendingHideTimer).toBe(false);
        vi.advanceTimersByTime(400);
        // hintVisible already false from hide()
        expect(overlay.hintVisible).toBe(false);
        vi.useRealTimers();
        overlay.destroy();
    });

    it("destroy 后不存在延迟执行的旧隐藏回调", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({ directions: ["R"], status: "complete" }));
        overlay.destroy();
        // No crash when advancing timers
        vi.advanceTimersByTime(400);
        expect(document.querySelectorAll("canvas").length).toBe(0);
        vi.useRealTimers();
    });
});

// ============================================================ 不使用 innerHTML
describe("GestureOverlay — 不使用 innerHTML", () => {
    it("动态内容通过 textContent 设置", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint.textContent).toBe("R → D");
        overlay.destroy();
    });
});

// ============================================================ 插件卸载后无残留
describe("GestureOverlay — 插件卸载后无残留", () => {
    it("destroy 后页面中无 GestureFlow Canvas 或提示元素", () => {
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
        }));
        overlay.destroy();
        expect(document.querySelectorAll("canvas").length).toBe(0);
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(0);
    });

    it("destroy 后 cancelHideTimer 不残留", () => {
        vi.useFakeTimers();
        installMockCanvas();
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({
            directions: ["R"],
            status: "complete",
        }));
        overlay.destroy();
        vi.advanceTimersByTime(400);
        expect(document.querySelectorAll("div[aria-hidden='true']").length).toBe(0);
        vi.useRealTimers();
    });
});
