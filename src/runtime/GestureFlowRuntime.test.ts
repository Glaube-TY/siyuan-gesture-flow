import { describe, it, expect } from "vitest";
import { GestureFlowRuntime } from "./GestureFlowRuntime";
import { createDefaultConfig as createDefaultConfigActual } from "@/config/defaults";

const overlayI18n = {
    gestureTooLong: "Gesture too long",
    gestureUnrecognised: "Unrecognised",
};
const i18n: Record<string, string> = {
    cmdTabsPrevious: "Previous tab",
    cmdTabsNext: "Next tab",
    cmdScrollTop: "Scroll to top",
    cmdScrollBottom: "Scroll to bottom",
};

function makeRuntime(target: EventTarget = new EventTarget()): GestureFlowRuntime {
    return new GestureFlowRuntime({
        target,
        overlayI18n,
        i18n,
        onLog: () => {},
    });
}

describe("GestureFlowRuntime — 状态机", () => {
    it("初始状态为 stopped", () => {
        const rt = makeRuntime();
        expect(rt.getState()).toBe("stopped");
    });

    it("start 后状态为 running（非 DOM 环境）", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        // In a Node test environment without happy-dom, document is
        // undefined so doStart short-circuits to running.
        expect(rt.getState()).toBe("running");
    });

    it("stop 后状态为 stopped", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        rt.stop();
        expect(rt.getState()).toBe("stopped");
    });

    it("重复 start 幂等", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        rt.start(createDefaultConfigActual());
        expect(rt.getState()).toBe("running");
    });

    it("重复 stop 幂等", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        rt.stop();
        rt.stop();
        expect(rt.getState()).toBe("stopped");
    });
});

describe("GestureFlowRuntime — enabled 开关", () => {
    it("enabled=false 时进入 disabled 状态", () => {
        const rt = makeRuntime();
        const cfg = createDefaultConfigActual();
        cfg.enabled = false;
        rt.start(cfg);
        expect(rt.getState()).toBe("disabled");
    });

    it("disabled 状态下 stop 后状态为 stopped", () => {
        const rt = makeRuntime();
        const cfg = createDefaultConfigActual();
        cfg.enabled = false;
        rt.start(cfg);
        rt.stop();
        expect(rt.getState()).toBe("stopped");
    });

    it("restart 从 disabled 切换到 running", () => {
        const rt = makeRuntime();
        const cfg = createDefaultConfigActual();
        cfg.enabled = false;
        rt.start(cfg);
        expect(rt.getState()).toBe("disabled");
        const enabled = createDefaultConfigActual();
        enabled.enabled = true;
        const result = rt.restart(enabled);
        expect(result.status).toBe("applied");
        expect(rt.getState()).toBe("running");
    });

    it("restart 从 running 切换到 disabled", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        expect(rt.getState()).toBe("running");
        const disabled = createDefaultConfigActual();
        disabled.enabled = false;
        const result = rt.restart(disabled);
        expect(result.status).toBe("applied");
        expect(rt.getState()).toBe("disabled");
    });
});

describe("GestureFlowRuntime — restart", () => {
    it("restart 先停后启", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        const cfg = createDefaultConfigActual();
        cfg.trigger.activationDistance = 30;
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
        expect(rt.getState()).toBe("running");
    });

    it("快速连续 restart 最终只有一套运行时", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        for (let i = 0; i < 5; i++) {
            const cfg = createDefaultConfigActual();
            cfg.trigger.activationDistance = 20 + i;
            rt.restart(cfg);
        }
        expect(rt.getState()).toBe("running");
    });

    it("restart 不会同时存在两套运行时（状态非双重）", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        rt.restart(createDefaultConfigActual());
        rt.restart(createDefaultConfigActual());
        expect(rt.getState()).toBe("running");
    });
});

describe("GestureFlowRuntime — 配置变更", () => {
    it("修改 activationDistance 后运行时仍可工作", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        const cfg = createDefaultConfigActual();
        cfg.trigger.activationDistance = 50;
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });

    it("修改 directionMode 后运行时仍可工作", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        const cfg = createDefaultConfigActual();
        cfg.recognizer.directionMode = 8;
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });

    it("修改 suppressionKey 后运行时仍可工作", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        const cfg = createDefaultConfigActual();
        cfg.trigger.suppressionKey = "Shift";
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });

    it("修改 overlay 配置后运行时仍可工作", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        const cfg = createDefaultConfigActual();
        cfg.overlay.showTrail = false;
        cfg.overlay.showHint = false;
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });
});

describe("GestureFlowRuntime — 绑定启停", () => {
    it("禁用某个绑定后运行时仍可工作", () => {
        const rt = makeRuntime();
        const cfg = createDefaultConfigActual();
        cfg.bindings[0].enabled = false;
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });

    it("全部绑定禁用后运行时仍可工作", () => {
        const rt = makeRuntime();
        const cfg = createDefaultConfigActual();
        cfg.bindings.forEach((b) => { b.enabled = false; });
        const result = rt.restart(cfg);
        expect(result.status).toBe("applied");
    });
});

describe("GestureFlowRuntime — 卸载", () => {
    it("stop 后可重新 start", () => {
        const rt = makeRuntime();
        rt.start(createDefaultConfigActual());
        rt.stop();
        expect(rt.getState()).toBe("stopped");
        rt.start(createDefaultConfigActual());
        expect(rt.getState()).toBe("running");
    });
});
