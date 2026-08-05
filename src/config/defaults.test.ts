import { describe, it, expect } from "vitest";
import { createDefaultConfig, deepCloneConfig, cloneBinding } from "./defaults";
import { CURRENT_CONFIG_VERSION } from "./types";

describe("defaults — 默认配置", () => {
    it("createDefaultConfig 返回当前版本", () => {
        const cfg = createDefaultConfig();
        expect(cfg.version).toBe(CURRENT_CONFIG_VERSION);
    });

    it("默认配置与现有行为一致", () => {
        const cfg = createDefaultConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.trigger.button).toBe(2);
        expect(cfg.trigger.activationDistance).toBe(16);
        expect(cfg.trigger.suppressionKey).toBe("Alt");
        expect(cfg.trigger.timeoutMs).toBe(2000);
        expect(cfg.recognizer.sampleDistance).toBe(4);
        expect(cfg.recognizer.simplifyTolerance).toBe(2.8);
        expect(cfg.recognizer.minimumSegmentLength).toBe(18);
        expect(cfg.recognizer.turnAngleThreshold).toBe(42);
        expect(cfg.recognizer.maximumSegments).toBe(6);
        expect(cfg.recognizer.directionMode).toBe(4);
        expect(cfg.overlay.showTrail).toBe(true);
        expect(cfg.overlay.showHint).toBe(true);
        expect(cfg.overlay.lineWidth).toBe(3);
        expect(cfg.bindings.length).toBe(4);
    });

    it("默认绑定 L/R/U/D 对应正确的命令", () => {
        const cfg = createDefaultConfig();
        const byDir = new Map(cfg.bindings.map((b) => [b.directions.join("-"), b.commandId]));
        expect(byDir.get("L")).toBe("tabs.previous");
        expect(byDir.get("R")).toBe("tabs.next");
        expect(byDir.get("U")).toBe("scroll.top");
        expect(byDir.get("D")).toBe("scroll.bottom");
    });
});

describe("defaults — 深拷贝不可变性", () => {
    it("createDefaultConfig 每次返回独立副本", () => {
        const a = createDefaultConfig();
        const b = createDefaultConfig();
        expect(a).not.toBe(b);
        expect(a.trigger).not.toBe(b.trigger);
        expect(a.recognizer).not.toBe(b.recognizer);
        expect(a.overlay).not.toBe(b.overlay);
        expect(a.bindings).not.toBe(b.bindings);
    });

    it("外部修改默认配置不得污染后续实例", () => {
        const a = createDefaultConfig();
        a.trigger.activationDistance = 999;
        a.recognizer.directionMode = 8;
        a.bindings[0].enabled = false;
        a.bindings[0].directions.push("U" as never);
        a.bindings[0].commandParams.foo = "bar";
        const b = createDefaultConfig();
        expect(b.trigger.activationDistance).toBe(16);
        expect(b.recognizer.directionMode).toBe(4);
        expect(b.bindings[0].enabled).toBe(true);
        expect(b.bindings[0].directions).toEqual(["L"]);
        expect(b.bindings[0].commandParams).toEqual({});
    });

    it("deepCloneConfig 返回的 bindings 是深度独立的", () => {
        const a = createDefaultConfig();
        const b = deepCloneConfig(a);
        expect(a.bindings).not.toBe(b.bindings);
        for (let i = 0; i < a.bindings.length; i++) {
            expect(a.bindings[i]).not.toBe(b.bindings[i]);
            expect(a.bindings[i].directions).not.toBe(b.bindings[i].directions);
            expect(a.bindings[i].commandParams).not.toBe(b.bindings[i].commandParams);
        }
    });

    it("cloneBinding 返回独立副本", () => {
        const src = createDefaultConfig().bindings[0];
        const copy = cloneBinding(src);
        expect(copy).not.toBe(src);
        expect(copy.directions).not.toBe(src.directions);
        expect(copy.commandParams).not.toBe(src.commandParams);
        copy.directions.push("U" as never);
        copy.commandParams.foo = "bar";
        expect(src.directions).toEqual(["L"]);
        expect(src.commandParams).toEqual({});
    });
});
