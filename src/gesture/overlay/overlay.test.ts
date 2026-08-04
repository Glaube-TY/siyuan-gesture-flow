// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GestureOverlay } from "./GestureOverlay";
import { OverlayI18n, OverlayState } from "./types";

const TEST_I18N: OverlayI18n = {
    gestureTooLong: "手势过长",
    gestureUnrecognised: "未识别",
};

function makeState(partial: Partial<OverlayState>): OverlayState {
    return {
        points: partial.points ?? [{ x: 100, y: 100 }],
        directions: partial.directions ?? [],
        status: partial.status ?? "tracking",
        commandLabel: partial.commandLabel ?? null,
    };
}

beforeEach(() => {
    // Reset window dimensions
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, writable: true, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, writable: true, configurable: true });
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("GestureOverlay — 元素创建与幂等性", () => {
    it("show() 后只创建一个 Canvas", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvases = document.querySelectorAll("canvas");
        expect(canvases.length).toBe(1);
        overlay.destroy();
    });

    it("show() 后只创建一个提示元素", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const hints = document.querySelectorAll("div[aria-hidden='true']");
        // canvas also has aria-hidden, so filter divs
        const hintDivs = Array.from(hints).filter((el) => el.tagName === "DIV");
        expect(hintDivs.length).toBe(1);
        overlay.destroy();
    });

    it("重复 show() 不重复创建 Canvas 或提示", () => {
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
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        expect(document.querySelectorAll("canvas").length).toBe(0);
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(0);
    });

    it("destroy 后 canvasMounted 为 false", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        expect(overlay.canvasMounted).toBe(true);
        overlay.destroy();
        expect(overlay.canvasMounted).toBe(false);
    });

    it("destroy 后再调用 destroy 不报错（幂等）", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        expect(() => overlay.destroy()).not.toThrow();
    });
});

describe("GestureOverlay — Canvas 属性", () => {
    it("Canvas 为 pointer-events: none", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.style.pointerEvents).toBe("none");
        overlay.destroy();
    });

    it("Canvas aria-hidden 为 true", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.getAttribute("aria-hidden")).toBe("true");
        overlay.destroy();
    });

    it("Canvas 使用 position: fixed", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.style.position).toBe("fixed");
        overlay.destroy();
    });

    it("DPR=1 时内部像素 = CSS 尺寸", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.width).toBe(1280);
        expect(canvas.height).toBe(720);
        overlay.destroy();
    });

    it("DPR=2 时内部像素 = CSS 尺寸 × 2", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        const canvas = document.querySelector("canvas")!;
        expect(canvas.width).toBe(2560);
        expect(canvas.height).toBe(1440);
        overlay.destroy();
    });

    it("resize 后内部尺寸更新", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        expect(overlay.canvasPixelWidth).toBe(1280);
        // Simulate resize
        Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });
        window.dispatchEvent(new Event("resize"));
        expect(overlay.canvasPixelWidth).toBe(1920);
        expect(overlay.canvasPixelHeight).toBe(1080);
        overlay.destroy();
    });

    it("destroy 后移除 resize 监听器", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.destroy();
        // After destroy, resize should not create new elements
        Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
        window.dispatchEvent(new Event("resize"));
        expect(document.querySelectorAll("canvas").length).toBe(0);
    });
});

describe("GestureOverlay — PENDING 不显示", () => {
    it("未调用 show() 时页面中无 Canvas", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        expect(document.querySelectorAll("canvas").length).toBe(0);
        overlay.destroy();
    });
});

describe("GestureOverlay — 轨迹与提示渲染", () => {
    it("TRACKING 状态显示方向序列 R → D", () => {
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
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R"],
            status: "tracking",
        }));
        return new Promise<void>((resolve) => {
            overlay.showFinalThenHide(makeState({
                directions: ["R"],
                status: "complete",
            }));
            expect(overlay.hintVisible).toBe(true);
            setTimeout(() => {
                expect(overlay.hintVisible).toBe(false);
                overlay.destroy();
                resolve();
            }, 400);
        });
    });

    it("提示在窗口右边缘不溢出", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        // Point near right edge
        overlay.update(makeState({
            points: [{ x: 1270, y: 100 }],
            directions: ["R"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint).toBeTruthy();
        const rect = hint.getBoundingClientRect();
        expect(rect.right).toBeLessThanOrEqual(1280);
        overlay.destroy();
    });

    it("提示在窗口底部边缘不溢出", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 100, y: 710 }],
            directions: ["D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint).toBeTruthy();
        const rect = hint.getBoundingClientRect();
        expect(rect.bottom).toBeLessThanOrEqual(720);
        overlay.destroy();
    });

    it("轨迹使用最后一个点作为提示位置", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
            directions: ["R", "D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        // Hint should be near (50, 50) + offset
        const left = parseInt(hint.style.left, 10);
        const top = parseInt(hint.style.top, 10);
        expect(left).toBeGreaterThanOrEqual(50);
        expect(top).toBeGreaterThanOrEqual(50);
        overlay.destroy();
    });
});

describe("GestureOverlay — 不使用 innerHTML", () => {
    it("动态内容通过 textContent 设置", () => {
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.update(makeState({
            directions: ["R", "D"],
            status: "tracking",
        }));
        const hint = document.querySelector("div[aria-hidden='true']") as HTMLDivElement;
        expect(hint.textContent).toBe("R → D");
        // No script tags or HTML injection
        expect(hint.innerHTML).toBe("R → D");
        overlay.destroy();
    });
});

describe("GestureOverlay — 插件卸载后无残留", () => {
    it("destroy 后页面中无 GestureFlow Canvas 或提示元素", () => {
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
        const overlay = new GestureOverlay(TEST_I18N);
        overlay.show();
        overlay.showFinalThenHide(makeState({
            directions: ["R"],
            status: "complete",
        }));
        overlay.destroy();
        // After destroy, no hint should appear even after the timer would fire
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(document.querySelectorAll("div[aria-hidden='true']").length).toBe(0);
                resolve();
            }, 400);
        });
    });
});
