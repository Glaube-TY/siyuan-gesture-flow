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

/**
 * Minimal mock of CanvasRenderingContext2D so that the overlay can be
 * constructed in happy-dom without a real 2D context.
 */
function installMockCanvas() {
    const proxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop: string) {
            if (prop === "canvas") return null;
            return (..._args: unknown[]) => { /* no-op */ };
        },
        set() { return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        proxy as unknown as CanvasRenderingContext2D,
    );
}

beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, writable: true, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    installMockCanvas();
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
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

/** Build a PENDING session (pointerdown, not yet activated). */
function makePendingSession(): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    session.addPoint(0, 0, 0);
    return session;
}

describe("GestureFeedbackController — RAF 合并", () => {
    it("多次 onUpdate 在同一帧只触发一次绘制", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const updateSpy = vi.spyOn(overlay, "update");
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);

        controller.onUpdate(session);
        controller.onUpdate(session);
        controller.onUpdate(session);
        controller.onUpdate(session);

        const callsBeforeRAF = updateSpy.mock.calls.length;

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
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
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);

        const canvasCountBefore = document.querySelectorAll("canvas[data-gesture-flow-overlay='trail']").length;
        controller.onUpdate(session);
        controller.onUpdate(session);
        const canvasCountAfter = document.querySelectorAll("canvas[data-gesture-flow-overlay='trail']").length;
        expect(canvasCountAfter).toBe(canvasCountBefore);

        controller.destroy();
    });

    it("destroy 后取消未执行的 RAF", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const updateSpy = vi.spyOn(overlay, "update");
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        controller.onUpdate(session);
        controller.onUpdate(session);

        const callsBeforeDestroy = updateSpy.mock.calls.length;
        controller.destroy();

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
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
        const controller = new GestureFeedbackController({ engine, overlay });

        expect(overlay.canvasMounted).toBe(false);
        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        expect(overlay.canvasMounted).toBe(true);
        controller.destroy();
    });

    it("onCancel 立即隐藏", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        session.cancel("escape");
        controller.onCancel(session);
        expect(overlay.hintVisible).toBe(false);
        controller.destroy();
    });

    it("onComplete 显示最终结果", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(session);
        session.complete();
        controller.onComplete(session);
        expect(overlay.hintVisible).toBe(true);
        controller.destroy();
    });

    it("onComplete 包含 pointerup 终点", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const showFinalSpy = vi.spyOn(overlay, "showFinalThenHide");
        const controller = new GestureFeedbackController({ engine, overlay });

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
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
        controller.onStateChange(session);
        controller.destroy();

        expect(document.querySelectorAll("canvas[data-gesture-flow-overlay='trail']").length).toBe(0);
        const hints = document.querySelectorAll("div[data-gesture-flow-overlay='hint']");
        expect(hints.length).toBe(0);
    });
});

describe("GestureFeedbackController — 普通右键不可见", () => {
    it("PENDING 状态不启动 Overlay", () => {
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makePendingSession();
        controller.onStateChange(session);
        expect(overlay.canvasMounted).toBe(false);
        controller.destroy();
    });
});

// ============================================================ 定时器竞争
describe("GestureFeedbackController — 定时器竞争", () => {
    it("手势 A 完成后 300ms 内开始手势 B，B 仍然可见", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        // Gesture A: complete
        const sessionA = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(sessionA);
        sessionA.complete();
        controller.onComplete(sessionA);
        expect(overlay.hintVisible).toBe(true);
        expect(overlay.hasPendingHideTimer).toBe(true);

        // Within 300ms, start gesture B (PENDING)
        vi.advanceTimersByTime(100);
        const sessionB = makePendingSession();
        controller.onStateChange(sessionB); // PENDING
        // A's trail and hint should be immediately cleared
        expect(overlay.hintVisible).toBe(false);
        expect(overlay.hasPendingHideTimer).toBe(false);

        // B enters TRACKING
        sessionB.activate();
        controller.onStateChange(sessionB);
        controller.onUpdate(makeTrackingSession([{ x: 0, y: 0 }, { x: 50, y: 0 }]));

        // Advance past A's original 300ms hide delay
        vi.advanceTimersByTime(300);
        // B should still be controllable — not hidden by A's stale timer
        expect(overlay.hasPendingHideTimer).toBe(false);

        controller.destroy();
    });

    it("手势 A 完成后立即普通右键进入 PENDING，A 的反馈立即消失", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const sessionA = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(sessionA);
        sessionA.complete();
        controller.onComplete(sessionA);
        expect(overlay.hintVisible).toBe(true);

        // Immediately start a new PENDING (right-click without movement)
        const sessionB = makePendingSession();
        controller.onStateChange(sessionB);
        expect(overlay.hintVisible).toBe(false);
        expect(overlay.hasPendingHideTimer).toBe(false);

        controller.destroy();
    });

    it("连续完成三个手势，任何时刻只保留最后一个有效隐藏计时", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        for (let i = 0; i < 3; i++) {
            const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
            controller.onStateChange(session);
            session.complete();
            controller.onComplete(session);
            // Only one hide timer should exist at any time
            expect(overlay.hasPendingHideTimer).toBe(true);
            // Advance a bit but not past the delay
            vi.advanceTimersByTime(100);
        }

        // Advance past the final delay — should hide exactly once
        let hideCount = 0;
        const originalHide = overlay.hide.bind(overlay);
        vi.spyOn(overlay, "hide").mockImplementation(() => {
            hideCount++;
            originalHide();
        });
        vi.advanceTimersByTime(300);
        expect(hideCount).toBe(1);

        controller.destroy();
    });

    it("cancel 后不存在延迟执行的旧隐藏回调", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(session);
        session.complete();
        controller.onComplete(session);
        expect(overlay.hasPendingHideTimer).toBe(true);

        // Cancel — should clear the timer
        session.cancel("manual");
        controller.onCancel(session);
        expect(overlay.hasPendingHideTimer).toBe(false);

        // Advance past the original delay — no hide should occur
        vi.advanceTimersByTime(400);
        expect(overlay.hintVisible).toBe(false);

        controller.destroy();
    });

    it("destroy 后不存在延迟执行的旧隐藏回调", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        const session = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(session);
        session.complete();
        controller.onComplete(session);

        controller.destroy();
        // Advance past the delay — no crash, no elements
        vi.advanceTimersByTime(400);
        expect(document.querySelectorAll("canvas[data-gesture-flow-overlay='trail']").length).toBe(0);
    });

    it("新手势 PENDING 阶段没有可见轨迹和提示", () => {
        vi.useFakeTimers();
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay });

        // First gesture completes and shows final result
        const sessionA = makeTrackingSession([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
        controller.onStateChange(sessionA);
        sessionA.complete();
        controller.onComplete(sessionA);
        expect(overlay.hintVisible).toBe(true);

        // New gesture starts — PENDING
        const sessionB = makePendingSession();
        controller.onStateChange(sessionB);
        expect(overlay.hintVisible).toBe(false);
        // No Canvas content should be visible (hint is hidden, trail cleared)
        // The Canvas element may exist but trail is cleared by hide()

        controller.destroy();
    });
});
