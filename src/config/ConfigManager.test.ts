import { describe, it, expect } from "vitest";
import { ConfigManager, ConfigPersistenceHost } from "./ConfigManager";
import { createDefaultConfig } from "./defaults";
import { GestureFlowConfig } from "./types";

const AVAILABLE_COMMANDS = new Set([
    "tabs.previous",
    "tabs.next",
    "scroll.top",
    "scroll.bottom",
]);

/**
 * In-memory mock of {@link ConfigPersistenceHost}.  Records every call
 * so tests can assert save/load behaviour and ordering.
 */
function createMockHost(initialData: unknown = null): {
    host: ConfigPersistenceHost;
    storage: Map<string, unknown>;
    loadDataCalls: number;
    saveDataCalls: number;
    saveDelay: number;
    saveShouldFail: boolean;
} {
    const storage = new Map<string, unknown>();
    if (initialData !== null) {
        storage.set("gesture-flow-config", initialData);
    }
    let loadDataCalls = 0;
    let saveDataCalls = 0;
    let saveDelay = 0;
    let saveShouldFail = false;
    const host: ConfigPersistenceHost = {
        loadData: async (name: string) => {
            loadDataCalls++;
            return storage.get(name) ?? null;
        },
        saveData: async (name: string, content: unknown) => {
            saveDataCalls++;
            if (saveDelay > 0) {
                await new Promise((r) => setTimeout(r, saveDelay));
            }
            if (saveShouldFail) {
                throw new Error("mock save failure");
            }
            storage.set(name, content);
        },
        removeData: async (name: string) => {
            storage.delete(name);
        },
    };
    return {
        host,
        storage,
        get loadDataCalls() { return loadDataCalls; },
        get saveDataCalls() { return saveDataCalls; },
        get saveDelay() { return saveDelay; },
        set saveDelay(v: number) { saveDelay = v; },
        get saveShouldFail() { return saveShouldFail; },
        set saveShouldFail(v: boolean) { saveShouldFail = v; },
    };
}

function createManager(host: ConfigPersistenceHost): ConfigManager {
    return new ConfigManager({
        host,
        storageName: "gesture-flow-config",
        availableCommandIds: () => AVAILABLE_COMMANDS,
    });
}

describe("ConfigManager — 加载", () => {
    it("无存储时使用默认配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        const result = await mgr.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("defaults");
        expect(result.config).toEqual(createDefaultConfig());
    });

    it("有效配置正常加载", async () => {
        const cfg = createDefaultConfig();
        const mock = createMockHost(cfg);
        const mgr = createManager(mock.host);
        const result = await mgr.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("loaded");
        expect(result.config.trigger.activationDistance).toBe(16);
    });

    it("部分字段缺失时规范化", async () => {
        const cfg = createDefaultConfig();
        const { version: _v, ...partial } = cfg;
        void _v;
        const mock = createMockHost(partial);
        const mgr = createManager(mock.host);
        const result = await mgr.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("normalized");
        expect(result.config.version).toBe(1);
    });

    it("无效数据回退默认配置", async () => {
        const mock = createMockHost({ version: 999 });
        const mgr = createManager(mock.host);
        const result = await mgr.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("error");
        expect(result.config).toEqual(createDefaultConfig());
    });

    it("load 是幂等的", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        const p1 = mgr.load();
        const p2 = mgr.load();
        expect(p1).toBe(p2);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(r2);
    });

    it("loadData 抛错时回退默认配置", async () => {
        const host: ConfigPersistenceHost = {
            loadData: async () => { throw new Error("read error"); },
            saveData: async () => {},
            removeData: async () => {},
        };
        const mgr = createManager(host);
        const result = await mgr.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("defaults");
        expect(result.config).toEqual(createDefaultConfig());
    });
});

describe("ConfigManager — getConfig 不可变性", () => {
    it("getConfig 返回独立副本", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const a = mgr.getConfig();
        const b = mgr.getConfig();
        expect(a).not.toBe(b);
        expect(a.trigger).not.toBe(b.trigger);
    });

    it("外部修改 getConfig 返回值不影响内部状态", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const a = mgr.getConfig();
        a.trigger.activationDistance = 999;
        a.bindings[0].enabled = false;
        const b = mgr.getConfig();
        expect(b.trigger.activationDistance).toBe(16);
        expect(b.bindings[0].enabled).toBe(true);
    });
});

describe("ConfigManager — replaceConfig / updateConfig", () => {
    it("replaceConfig 接受有效配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const cfg = createDefaultConfig();
        cfg.trigger.activationDistance = 50;
        const result = await mgr.replaceConfig(cfg);
        expect(result.status).toBe("saved");
        expect(mgr.getConfig().trigger.activationDistance).toBe(50);
    });

    it("replaceConfig 拒绝无效配置并保留旧配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const original = mgr.getConfig();
        const bad = createDefaultConfig();
        bad.trigger.button = 0;
        const result = await mgr.replaceConfig(bad);
        expect(result.status).toBe("error");
        expect(mgr.getConfig()).toEqual(original);
    });

    it("updateConfig 合并部分字段", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const result = await mgr.updateConfig({
            trigger: { activationDistance: 30 },
        });
        expect(result.status).toBe("saved");
        const cfg = mgr.getConfig();
        expect(cfg.trigger.activationDistance).toBe(30);
        // Sibling fields preserved.
        expect(cfg.trigger.button).toBe(2);
        expect(cfg.trigger.suppressionKey).toBe("Alt");
    });

    it("updateConfig 不擦除同级字段", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        await mgr.updateConfig({
            overlay: { showTrail: false },
        });
        const cfg = mgr.getConfig();
        expect(cfg.overlay.showTrail).toBe(false);
        expect(cfg.overlay.showHint).toBe(true);
        expect(cfg.overlay.lineWidth).toBe(3);
    });

    it("replaceConfig 失败时回滚内存状态", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const original = mgr.getConfig();
        mock.saveShouldFail = true;
        const cfg = createDefaultConfig();
        cfg.trigger.activationDistance = 50;
        const result = await mgr.replaceConfig(cfg);
        expect(result.status).toBe("error");
        expect(mgr.getConfig()).toEqual(original);
    });
});

describe("ConfigManager — reset", () => {
    it("reset 恢复默认配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        await mgr.updateConfig({ enabled: false });
        expect(mgr.getConfig().enabled).toBe(false);
        const result = await mgr.reset();
        expect(result.status).toBe("saved");
        expect(mgr.getConfig()).toEqual(createDefaultConfig());
    });
});

describe("ConfigManager — import / export", () => {
    it("exportJson 返回当前配置的独立副本", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const exported = mgr.exportJson();
        expect(exported).toEqual(createDefaultConfig());
        exported.trigger.activationDistance = 999;
        expect(mgr.getConfig().trigger.activationDistance).toBe(16);
    });

    it("importJson 接受有效配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const cfg = createDefaultConfig();
        cfg.trigger.timeoutMs = 5000;
        const result = await mgr.importJson(cfg);
        expect(result.status).toBe("imported");
        expect(mgr.getConfig().trigger.timeoutMs).toBe(5000);
    });

    it("importJson 拒绝无效配置且不覆盖当前配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const original = mgr.getConfig();
        const bad = createDefaultConfig();
        const result = await mgr.importJson({ ...bad, version: 999 });
        expect(result.status).toBe("error");
        expect(mgr.getConfig()).toEqual(original);
    });

    it("导出再导入保持等价", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        await mgr.updateConfig({ trigger: { activationDistance: 40 } });
        const exported = mgr.exportJson();
        const result = await mgr.importJson(exported);
        expect(result.status).toBe("imported");
        expect(mgr.getConfig()).toEqual(exported);
    });

    it("importJson 保存失败时不覆盖当前配置", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const original = mgr.getConfig();
        mock.saveShouldFail = true;
        const cfg = createDefaultConfig();
        cfg.trigger.activationDistance = 50;
        const result = await mgr.importJson(cfg);
        expect(result.status).toBe("error");
        expect(mgr.getConfig()).toEqual(original);
    });
});

describe("ConfigManager — 订阅", () => {
    it("subscribe 收到配置变更通知", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const calls: GestureFlowConfig[] = [];
        const unsub = mgr.subscribe((cfg) => calls.push(cfg));
        await mgr.updateConfig({ enabled: false });
        expect(calls.length).toBe(1);
        expect(calls[0].enabled).toBe(false);
        unsub();
    });

    it("unsubscribe 后不再收到通知", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const calls: GestureFlowConfig[] = [];
        const unsub = mgr.subscribe((cfg) => calls.push(cfg));
        unsub();
        await mgr.updateConfig({ enabled: false });
        expect(calls.length).toBe(0);
    });

    it("订阅者收到的是独立快照", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const received: GestureFlowConfig[] = [];
        mgr.subscribe((cfg) => { received.push(cfg); });
        await mgr.updateConfig({ enabled: false });
        expect(received.length).toBe(1);
        received[0].enabled = true;
        expect(mgr.getConfig().enabled).toBe(false);
    });
});

describe("ConfigManager — 串行保存", () => {
    it("连续多次 updateConfig 按顺序保存", async () => {
        const mock = createMockHost(null);
        mock.saveDelay = 20;
        const mgr = createManager(mock.host);
        await mgr.load();
        // Fire 3 updates rapidly.
        const p1 = mgr.updateConfig({ trigger: { activationDistance: 20 } });
        const p2 = mgr.updateConfig({ trigger: { activationDistance: 30 } });
        const p3 = mgr.updateConfig({ trigger: { activationDistance: 40 } });
        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        expect(r1.status).toBe("saved");
        expect(r2.status).toBe("saved");
        expect(r3.status).toBe("saved");
        expect(mock.saveDataCalls).toBe(3);
        // Last write wins — the final in-memory state reflects the
        // latest update.
        expect(mgr.getConfig().trigger.activationDistance).toBe(40);
    });

    it("保存失败不影响后续保存", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        mock.saveShouldFail = true;
        const r1 = await mgr.updateConfig({ enabled: false });
        expect(r1.status).toBe("error");
        mock.saveShouldFail = false;
        const r2 = await mgr.updateConfig({ enabled: true });
        expect(r2.status).toBe("saved");
    });
});

describe("ConfigManager — destroy", () => {
    it("destroy 后不再通知订阅者", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const calls: GestureFlowConfig[] = [];
        mgr.subscribe((cfg) => calls.push(cfg));
        mgr.destroy();
        await mgr.updateConfig({ enabled: false });
        expect(calls.length).toBe(0);
    });

    it("destroy 后 load 返回错误结果", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        mgr.destroy();
        const result = await mgr.load();
        expect(result.ok).toBe(false);
    });

    it("destroy 后 replaceConfig 返回错误结果", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        mgr.destroy();
        const result = await mgr.replaceConfig(createDefaultConfig());
        expect(result.status).toBe("error");
    });
});

describe("ConfigManager — 绑定深拷贝", () => {
    it("updateConfig bindings 返回深拷贝", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const cfg = mgr.getConfig();
        const origDirections = cfg.bindings[0].directions.slice();
        cfg.bindings[0].directions.push("U" as never);
        const cfg2 = mgr.getConfig();
        expect(cfg2.bindings[0].directions).toEqual(origDirections);
    });

    it("导入含未知命令的配置时禁用绑定", async () => {
        const mock = createMockHost(null);
        const mgr = createManager(mock.host);
        await mgr.load();
        const cfg = createDefaultConfig();
        cfg.bindings[0].commandId = "unknown.cmd";
        const result = await mgr.importJson(cfg);
        expect(result.status).toBe("imported");
        expect(mgr.getConfig().bindings[0].enabled).toBe(false);
    });
});
