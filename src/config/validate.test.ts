import { describe, it, expect } from "vitest";
import { validateConfig } from "./validate";
import { createDefaultConfig } from "./defaults";
import { CURRENT_CONFIG_VERSION } from "./types";

const AVAILABLE_COMMANDS = new Set([
    "tabs.previous",
    "tabs.next",
    "scroll.top",
    "scroll.bottom",
]);

describe("validateConfig — 有效配置", () => {
    it("完整有效的配置返回 valid", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig(cfg, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(CURRENT_CONFIG_VERSION);
    });

    it("默认配置自身通过校验", () => {
        const result = validateConfig(createDefaultConfig(), {
            availableCommandIds: AVAILABLE_COMMANDS,
        });
        expect(result.status).toBe("valid");
    });
});

describe("validateConfig — 缺失字段补默认值", () => {
    it("缺失 version 时规范化为当前版本", () => {
        const cfg = createDefaultConfig();
        const { version: _v, ...rest } = cfg;
        void _v;
        const result = validateConfig(rest, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("normalized");
        expect(result.config.version).toBe(CURRENT_CONFIG_VERSION);
    });

    it("缺失 trigger 时使用默认 trigger", () => {
        const cfg = createDefaultConfig();
        const { trigger: _t, ...rest } = cfg;
        void _t;
        const result = validateConfig(rest, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("normalized");
        expect(result.config.trigger.button).toBe(2);
        expect(result.config.trigger.activationDistance).toBe(16);
    });

    it("缺失 overlay 时使用默认 overlay", () => {
        const cfg = createDefaultConfig();
        const { overlay: _o, ...rest } = cfg;
        void _o;
        const result = validateConfig(rest, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("normalized");
        expect(result.config.overlay.showTrail).toBe(true);
        expect(result.config.overlay.lineWidth).toBe(3);
    });

    it("缺失 recognizer.directionMode 时使用默认值", () => {
        const cfg = createDefaultConfig();
        const recognizer = { ...cfg.recognizer };
        const { directionMode: _d, ...restRecognizer } = recognizer;
        void _d;
        const input = { ...cfg, recognizer: restRecognizer };
        const result = validateConfig(input, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("normalized");
        expect(result.config.recognizer.directionMode).toBe(4);
    });
});

describe("validateConfig — 类型错误拒绝", () => {
    it("根对象非对象时 invalid", () => {
        const result = validateConfig("not an object");
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
            expect(result.errors.length).toBeGreaterThan(0);
        }
        expect(result.config).toEqual(createDefaultConfig());
    });

    it("根对象为数组时 invalid", () => {
        const result = validateConfig([1, 2, 3]);
        expect(result.status).toBe("invalid");
    });

    it("enabled 非布尔时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({ ...cfg, enabled: "yes" });
        expect(result.status).toBe("invalid");
    });

    it("trigger.button 非 2 时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            trigger: { ...cfg.trigger, button: 0 },
        });
        expect(result.status).toBe("invalid");
    });

    it("suppressionKey 为未知字符串时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            trigger: { ...cfg.trigger, suppressionKey: "CapsLock" },
        });
        expect(result.status).toBe("invalid");
    });
});

describe("validateConfig — 越界值规范化", () => {
    it("activationDistance 低于最小值时规范化为 min", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            trigger: { ...cfg.trigger, activationDistance: 1 },
        });
        expect(result.status).toBe("normalized");
        expect(result.config.trigger.activationDistance).toBe(4);
    });

    it("activationDistance 高于最大值时规范化为 max", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            trigger: { ...cfg.trigger, activationDistance: 9999 },
        });
        expect(result.status).toBe("normalized");
        expect(result.config.trigger.activationDistance).toBe(100);
    });

    it("timeoutMs 低于 0 时规范化为 0", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            trigger: { ...cfg.trigger, timeoutMs: -100 },
        });
        expect(result.status).toBe("normalized");
        expect(result.config.trigger.timeoutMs).toBe(0);
    });

    it("directionMode 非 4 或 8 时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            recognizer: { ...cfg.recognizer, directionMode: 6 },
        });
        expect(result.status).toBe("invalid");
    });

    it("lineWidth 低于 1 时规范化", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({
            ...cfg,
            overlay: { ...cfg.overlay, lineWidth: 0 },
        });
        expect(result.status).toBe("normalized");
        expect(result.config.overlay.lineWidth).toBe(1);
    });
});

describe("validateConfig — 版本检查", () => {
    it("未知未来版本拒绝降级", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({ ...cfg, version: 999 });
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
            expect(result.errors[0]).toMatch(/unknown future config version/);
        }
    });

    it("version 为 0 时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({ ...cfg, version: 0 });
        expect(result.status).toBe("invalid");
    });

    it("version 为非整数时拒绝", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig({ ...cfg, version: 1.5 });
        expect(result.status).toBe("invalid");
    });
});

describe("validateConfig — 绑定校验", () => {
    it("未知 commandId 时禁用绑定并规范化", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 0 ? { ...b, commandId: "unknown.cmd" } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("normalized");
        expect(result.config.bindings[0].enabled).toBe(false);
        expect(result.config.bindings[0].commandId).toBe("unknown.cmd");
    });

    it("重复 binding id 拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 1 ? { ...b, id: cfg.bindings[0].id } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("重复方向序列拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 1 ? { ...b, directions: ["L" as const], id: "dup-L" } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("空方向序列拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 0 ? { ...b, directions: [] } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("未知方向拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 0 ? { ...b, directions: ["X" as never] } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("commandParams 非对象时拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = cfg.bindings.map((b, i) =>
            i === 0 ? { ...b, commandParams: "not an object" as never } : b,
        );
        const result = validateConfig(
            { ...cfg, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("bindings 明确为空数组时保持为空（合法，不复活默认绑定）", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig(
            { ...cfg, bindings: [] },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("valid");
        expect(result.config.bindings).toEqual([]);
    });

    it("缺少 bindings 字段时才使用默认绑定", () => {
        const cfg = createDefaultConfig();
        const { bindings: _omit, ...withoutBindings } = cfg;
        void _omit;
        const result = validateConfig(
            withoutBindings as typeof cfg,
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("normalized");
        expect(result.config.bindings.length).toBe(4);
        expect(result.config.bindings[0].id).toBe("default-L");
    });

    it("4 方向模式下含斜向的绑定被明确拒绝", () => {
        const cfg = createDefaultConfig();
        const bindings = [
            { id: "diag", enabled: true, directions: ["UR" as const], commandId: "tabs.next", commandParams: {} },
        ];
        const result = validateConfig(
            { ...cfg, recognizer: { ...cfg.recognizer, directionMode: 4 }, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("invalid");
    });

    it("8 方向模式下斜向绑定合法", () => {
        const cfg = createDefaultConfig();
        const bindings = [
            { id: "diag", enabled: true, directions: ["UR" as const, "DL" as const], commandId: "tabs.next", commandParams: {} },
        ];
        const result = validateConfig(
            { ...cfg, recognizer: { ...cfg.recognizer, directionMode: 8 }, bindings },
            { availableCommandIds: AVAILABLE_COMMANDS },
        );
        expect(result.status).toBe("valid");
        expect(result.config.bindings[0].directions).toEqual(["UR", "DL"]);
    });
});

describe("validateConfig — 不可变性", () => {
    it("valid 结果的 config 与输入不共享引用", () => {
        const cfg = createDefaultConfig();
        const result = validateConfig(cfg, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        if (result.status === "valid") {
            expect(result.config).not.toBe(cfg);
            expect(result.config.trigger).not.toBe(cfg.trigger);
            expect(result.config.bindings).not.toBe(cfg.bindings);
        }
    });

    it("normalized 结果的 config 是独立副本", () => {
        const cfg = createDefaultConfig();
        const input = { ...cfg, trigger: { ...cfg.trigger, activationDistance: 50 } };
        const result = validateConfig(input, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        if (result.status === "valid") {
            expect(result.config.trigger.activationDistance).toBe(50);
            // Mutating the result should not affect anything.
            result.config.trigger.activationDistance = 1;
            expect(input.trigger.activationDistance).toBe(50);
        }
    });
});
