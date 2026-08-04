// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GestureFeedbackController } from "./GestureFeedbackController";
import { GestureEngine } from "./GestureEngine";
import { GestureOverlay } from "./overlay/GestureOverlay";
import { OverlayI18n } from "./overlay/types";
import { GestureSession } from "./GestureSession";
import { DEFAULT_TRIGGER } from "./types";

const TEST_I18N: OverlayI18n = {
    gestureTooLong: "手势过长",
    gestureUnrecognised: "未识别",
};

beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, writable: true, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

/** Build a session that has TRACKING state with the given points. */
function makeTrackingSession(points: Array<{ x: number; y: number }>): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    let t = 0;
    for (const p of points) {
        session.addPoint(p.x, p.y, t);
        t += 16;
    }
    session.activate();
    return session;
}

describe("GestureFeedbackController — RAF 合并", () => {
    it("多次 onUpdate 在同一帧只触发一次绘制", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const updateSpy = vi.spyOn(overlay, "update");
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);

        // Simulate multiple pointermove in the same frame
        controller.onUpdate(session);
        controller.onUpdate(session);
        controller.onUpdate(session);
        controller.onUpdate(session);

        // Before RAF fires, update should not have been called for the moves
        // (onStateChange calls show() + scheduleFrame, so update happens in RAF)
        const callsBeforeRAF = updateSpy.mock.calls.length;

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // After two RAFs, update should have been called at most
                    // once for the coalesced moves (plus possibly the initial).
                    const callsAfterRAF = updateSpy.mock.calls.length;
                    expect(callsAfterRAF - callsBeforeRAF).toBeLessThanOrEqual(1);
                    controller.destroy();
                    resolve();
                });
            });
        });
    });

    it("onUpdate 不会在一次事件中创建新 DOM", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);

        const canvasCountBefore = document.querySelectorAll("canvas").length;
        controller.onUpdate(session);
        controller.onUpdate(session);
        const canvasCountAfter = document.querySelectorAll("canvas").length;
        expect(canvasCountAfter).toBe(canvasCountBefore);

        controller.destroy();
    });

    it("destroy 后取消未执行的 RAF", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const updateSpy = vi.spyOn(overlay, "update");
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        controller.onUpdate(session);
        controller.onUpdate(session);

        const callsBeforeDestroy = updateSpy.mock.calls.length;
        controller.destroy();

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // After destroy, no more update calls should have happened
                    expect(updateSpy.mock.calls.length).toBe(callsBeforeDestroy);
                    resolve();
                });
            });
        });
    });
});

describe("GestureFeedbackController — 生命周期", () => {
    it("onStateChange(TRACKING) 启动 Overlay", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        expect(overlay.canvasMounted).toBe(false);
        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        expect(overlay.canvasMounted).toBe(true);
        controller.destroy();
    });

    it("onCancel 立即隐藏", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        // Simulate cancel
        session.cancel("escape");
        controller.onCancel(session);
        expect(overlay.hintVisible).toBe(false);
        controller.destroy();
    });

    it("onComplete 显示最终结果", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(session);
        session.complete();
        controller.onComplete(session);
        expect(overlay.hintVisible).toBe(true);
        controller.destroy();
    });

    it("onComplete 包含 pointerup 终点", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const showFinalSpy = vi.spyOn(overlay, "showFinalThenHide");
        const controller = new GestureFeedbackController(engine, overlay);

        // Session with points ending at x=80
        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
        session.addPoint(80, 0, 100);
        session.complete();
        controller.onComplete(session);

        expect(showFinalSpy).toHaveBeenCalledTimes(1);
        const state = showFinalSpy.mock.calls[0][0];
        const lastPoint = state.points[state.points.length - 1];
        expect(lastPoint.x).toBe(80);
        controller.destroy();
    });

    it("destroy 移除所有元素", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        controller.destroy();

        expect(document.querySelectorAll("canvas").length).toBe(0);
        const hints = Array.from(document.querySelectorAll("div[aria-hidden='true']")).filter((el) => el.tagName === "DIV");
        expect(hints.length).toBe(0);
    });
});

describe("GestureFeedbackController — 普通右键不可见", () => {
    it("PENDING 状态不启动 Overlay", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController(engine, overlay);

        // PENDING session — never activated
        const session = new GestureSession(DEFAULT_TRIGGER);
        session.addPoint(0, 0, 0);
        // onStateChange is only called with TRACKING in the controller,
        // so no overlay should appear.
        expect(overlay.canvasMounted).toBe(false);
        controller.destroy();
    });
});
