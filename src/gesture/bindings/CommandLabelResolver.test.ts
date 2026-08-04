// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "./defaultBindings";
import { createCommandLabelResolver } from "./CommandLabelResolver";
import { GestureEngine } from "@/gesture/GestureEngine";
import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { GestureFeedbackController } from "@/gesture/GestureFeedbackController";
import { OverlayI18n } from "@/gesture/overlay/types";

const TEST_I18N: OverlayI18n = {
    gestureTooLong: "手势过长",
    gestureUnrecognised: "未识别",
};

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

function setupRegistries(i18n: Record<string, string>) {
    const commandRegistry = new CommandRegistry();
    commandRegistry.registerMany([
        { id: "tabs.previous", title: "cmdTabsPrevious", group: "Tabs", execute: () => ({ status: "executed" }) },
        { id: "tabs.next", title: "cmdTabsNext", group: "Tabs", execute: () => ({ status: "executed" }) },
        { id: "scroll.top", title: "cmdScrollTop", group: "Scrolling", execute: () => ({ status: "executed" }) },
        { id: "scroll.bottom", title: "cmdScrollBottom", group: "Scrolling", execute: () => ({ status: "executed" }) },
    ]);
    const bindingRegistry = new GestureBindingRegistry(commandRegistry);
    bindingRegistry.registerMany(DEFAULT_BINDINGS);
    const resolver = createCommandLabelResolver(bindingRegistry, i18n);
    return { commandRegistry, bindingRegistry, resolver };
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
});

describe("CommandLabelResolver — 集成 Overlay 显示", () => {
    it("L 显示「上一个标签页」", () => {
        const i18n = { cmdTabsPrevious: "上一个标签页", cmdTabsNext: "下一个标签页", cmdScrollTop: "滚动到顶部", cmdScrollBottom: "滚动到底部" };
        const { resolver } = setupRegistries(i18n);
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay, commandLabelResolver: resolver });

        // Simulate TRACKING with directions ["L"]
        const session = {
            id: 1,
            state: "TRACKING" as const,
            points: [{ x: 100, y: 50 }, { x: 0, y: 50 }],
            durationMs: null,
            activated: true,
            cancelReason: null,
            trigger: { button: 2, activationDistance: 16, suppressionKey: "Alt", timeoutMs: 2000 },
            startTime: 0,
            endTime: null,
            toJSON: () => ({}),
        } as never;
        controller.onStateChange(session);
        controller.onUpdate(session);

        // Manually trigger render frame
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(overlay.hintTextValue).toContain("L");
                expect(overlay.hintTextValue).toContain("上一个标签页");
                controller.destroy();
                resolve();
            });
        });
    });

    it("R 显示「下一个标签页」", () => {
        const i18n = { cmdTabsPrevious: "上一个标签页", cmdTabsNext: "下一个标签页", cmdScrollTop: "滚动到顶部", cmdScrollBottom: "滚动到底部" };
        const { resolver } = setupRegistries(i18n);
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay, commandLabelResolver: resolver });

        const session = {
            id: 2,
            state: "TRACKING" as const,
            points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
            durationMs: null,
            activated: true,
            cancelReason: null,
            trigger: { button: 2, activationDistance: 16, suppressionKey: "Alt", timeoutMs: 2000 },
            startTime: 0,
            endTime: null,
            toJSON: () => ({}),
        } as never;
        controller.onStateChange(session);
        controller.onUpdate(session);

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(overlay.hintTextValue).toContain("R");
                expect(overlay.hintTextValue).toContain("下一个标签页");
                controller.destroy();
                resolve();
            });
        });
    });

    it("未绑定的 D-R 只显示方向", () => {
        const i18n = { cmdTabsPrevious: "上一个标签页", cmdTabsNext: "下一个标签页", cmdScrollTop: "滚动到顶部", cmdScrollBottom: "滚动到底部" };
        const { resolver } = setupRegistries(i18n);
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay, commandLabelResolver: resolver });

        // D-R has no binding, so commandLabel should be null
        const session = {
            id: 3,
            state: "TRACKING" as const,
            points: [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 150, y: 100 }],
            durationMs: null,
            activated: true,
            cancelReason: null,
            trigger: { button: 2, activationDistance: 16, suppressionKey: "Alt", timeoutMs: 2000 },
            startTime: 0,
            endTime: null,
            toJSON: () => ({}),
        } as never;
        controller.onStateChange(session);
        controller.onUpdate(session);

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                // Should contain directions but no command label
                expect(overlay.hintTextValue).not.toBeNull();
                expect(overlay.hintTextValue).toContain("D");
                // Should not contain any command label text
                expect(overlay.hintTextValue).not.toContain("标签页");
                expect(overlay.hintTextValue).not.toContain("滚动");
                controller.destroy();
                resolve();
            });
        });
    });

    it("commandLabel 仍通过 textContent 安全显示", () => {
        const i18n = { cmdTabsPrevious: "上一个标签页<script>alert(1)</script>", cmdTabsNext: "下一个标签页", cmdScrollTop: "滚动到顶部", cmdScrollBottom: "滚动到底部" };
        const { resolver } = setupRegistries(i18n);
        const engine = new GestureEngine();
        const overlay = new GestureOverlay(TEST_I18N);
        const controller = new GestureFeedbackController({ engine, overlay, commandLabelResolver: resolver });

        const session = {
            id: 4,
            state: "TRACKING" as const,
            points: [{ x: 100, y: 50 }, { x: 0, y: 50 }],
            durationMs: null,
            activated: true,
            cancelReason: null,
            trigger: { button: 2, activationDistance: 16, suppressionKey: "Alt", timeoutMs: 2000 },
            startTime: 0,
            endTime: null,
            toJSON: () => ({}),
        } as never;
        controller.onStateChange(session);
        controller.onUpdate(session);

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                const hint = document.querySelector("div[data-gesture-flow-overlay='hint']") as HTMLDivElement;
                expect(hint.querySelectorAll("script").length).toBe(0);
                controller.destroy();
                resolve();
            });
        });
    });
});
