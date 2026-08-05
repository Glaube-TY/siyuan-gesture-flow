import { describe, it, expect } from "vitest";
import {
    migrateAndValidate,
    detectVersion,
    hasMigrations,
    registerMigration,
} from "./migrations";
import { createDefaultConfig } from "./defaults";
import { CURRENT_CONFIG_VERSION } from "./types";

const AVAILABLE_COMMANDS = new Set([
    "tabs.previous",
    "tabs.next",
    "scroll.top",
    "scroll.bottom",
]);

describe("migrations — 版本检测", () => {
    it("缺失 version 返回 null", () => {
        expect(detectVersion({ enabled: true })).toBeNull();
    });

    it("version 为当前版本返回该版本号", () => {
        expect(detectVersion({ version: 1 })).toBe(1);
    });

    it("version 大于当前版本返回 'future'", () => {
        expect(detectVersion({ version: 999 })).toBe("future");
    });

    it("version 为非整数返回 'invalid'", () => {
        expect(detectVersion({ version: 1.5 })).toBe("invalid");
    });

    it("version 为 0 返回 'invalid'", () => {
        expect(detectVersion({ version: 0 })).toBe("invalid");
    });

    it("根非对象返回 'invalid'", () => {
        expect(detectVersion("hello")).toBe("invalid");
        expect(detectVersion(null)).toBe("invalid");
        expect(detectVersion([1, 2])).toBe("invalid");
    });
});

describe("migrations — migrateAndValidate", () => {
    it("有效 v1 配置通过迁移与校验", () => {
        const cfg = createDefaultConfig();
        const result = migrateAndValidate(cfg, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(CURRENT_CONFIG_VERSION);
    });

    it("缺失 version 时由校验器补齐", () => {
        const cfg = createDefaultConfig();
        const { version: _v, ...rest } = cfg;
        void _v;
        const result = migrateAndValidate(rest, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("normalized");
        expect(result.config.version).toBe(CURRENT_CONFIG_VERSION);
    });

    it("未知未来版本拒绝降级", () => {
        const cfg = createDefaultConfig();
        const result = migrateAndValidate({ ...cfg, version: 999 });
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
            expect(result.errors[0]).toMatch(/unknown future config version/);
        }
    });

    it("无效版本号拒绝", () => {
        const cfg = createDefaultConfig();
        const result = migrateAndValidate({ ...cfg, version: -1 });
        expect(result.status).toBe("invalid");
    });

    it("迁移失败时回退默认配置", () => {
        const result = migrateAndValidate({ version: "bad" });
        expect(result.status).toBe("invalid");
        expect(result.config).toEqual(createDefaultConfig());
    });
});

describe("migrations — 框架", () => {
    it("已有 v1 → v2 迁移步骤（stage 6A）", () => {
        expect(hasMigrations()).toBe(true);
    });

    it("registerMigration 注册迁移步骤", () => {
        // 0 is out of range and CURRENT_CONFIG_VERSION is the latest —
        // both must be rejected.
        expect(() => registerMigration(0, (x) => x)).toThrow();
        expect(() => registerMigration(CURRENT_CONFIG_VERSION, (x) => x)).toThrow();
    });
});

// ============================================================ v1 → v2 (stage 6A)

/** A realistic version-1 config payload with top-level commandId fields. */
function makeV1Config() {
    return {
        version: 1,
        enabled: true,
        trigger: { button: 2, activationDistance: 16, suppressionKey: "Alt", timeoutMs: 2000 },
        recognizer: {
            sampleDistance: 4,
            simplifyTolerance: 2.8,
            minimumSegmentLength: 18,
            turnAngleThreshold: 42,
            maximumSegments: 6,
            directionMode: 4,
        },
        overlay: { showTrail: true, showHint: true, lineWidth: 3 },
        bindings: [
            { id: "default-L", enabled: true, directions: ["L"], commandId: "tabs.previous", commandParams: {} },
            { id: "default-R", enabled: true, directions: ["R"], commandId: "tabs.next", commandParams: { foo: 1 } },
            { id: "disabled-U", enabled: false, directions: ["U"], commandId: "scroll.top", commandParams: {} },
        ],
    };
}

describe("migrations — v1 → v2 迁移（stage 6A）", () => {
    it("旧内置绑定迁移为 v2 builtin action，id/enabled/directions 保持不变", () => {
        const result = migrateAndValidate(makeV1Config(), { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(2);
        expect(result.config.bindings).toHaveLength(3);

        const l = result.config.bindings[0];
        expect(l.id).toBe("default-L");
        expect(l.enabled).toBe(true);
        expect(l.directions).toEqual(["L"]);
        expect(l.action).toEqual({ type: "builtin", commandId: "tabs.previous", commandParams: {} });

        const r = result.config.bindings[1];
        expect(r.action).toEqual({ type: "builtin", commandId: "tabs.next", commandParams: { foo: 1 } });

        // 顶层 commandId / commandParams 不再存在
        expect("commandId" in l).toBe(false);
        expect("commandParams" in l).toBe(false);
    });

    it("空 bindings 迁移后仍为空", () => {
        const v1 = { ...makeV1Config(), bindings: [] };
        const result = migrateAndValidate(v1, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.bindings).toEqual([]);
    });

    it("迁移不直接调用 saveData（纯函数）", () => {
        // migrateAndValidate 是纯函数：输入不被修改，输出是新对象。
        const v1 = makeV1Config();
        const snapshot = JSON.stringify(v1);
        migrateAndValidate(v1, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(JSON.stringify(v1)).toBe(snapshot);
    });

    it("混合载荷：v1 数据中的 v2 形状绑定保留 action 并剥离遗留字段", () => {
        const v1 = {
            ...makeV1Config(),
            bindings: [
                // 已是 v2 形状但残留顶层 commandId（脏数据）
                {
                    id: "dirty",
                    enabled: true,
                    directions: ["R"],
                    commandId: "tabs.next",
                    action: { type: "builtin", commandId: "scroll.top", commandParams: {} },
                },
            ],
        };
        const result = migrateAndValidate(v1, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        const b = result.config.bindings[0];
        // action 保留，顶层 commandId 被剥离，校验通过
        expect(b.action).toEqual({ type: "builtin", commandId: "scroll.top", commandParams: {} });
        expect("commandId" in b).toBe(false);
    });

    it("v2 导入导出等价（JSON round-trip 只含 action）", () => {        const migrated = migrateAndValidate(makeV1Config(), { availableCommandIds: AVAILABLE_COMMANDS }).config;
        const roundTripped = JSON.parse(JSON.stringify(migrated));
        const result = migrateAndValidate(roundTripped, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.bindings[0].action).toEqual(
            { type: "builtin", commandId: "tabs.previous", commandParams: {} },
        );
        // 顶层绝无 commandId 字段（v2 只在 action 内携带）
        for (const b of roundTripped.bindings) {
            expect("commandId" in b).toBe(false);
            expect("commandParams" in b).toBe(false);
        }
    });

    it("未知 action.type 被拒绝（不静默转 builtin）", () => {
        const cfg = createDefaultConfig();
        const bad = {
            ...cfg,
            bindings: [
                { id: "x", enabled: true, directions: ["R"], action: { type: "mystery", payload: 1 } },
            ],
        };
        const result = migrateAndValidate(bad, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("invalid");
    });

    it("JavaScript action 被拒绝（导入无法绕过开发中限制）", () => {
        const cfg = createDefaultConfig();
        const bad = {
            ...cfg,
            bindings: [
                { id: "x", enabled: true, directions: ["R"], action: { type: "javascript", script: "alert(1)" } },
            ],
        };
        const result = migrateAndValidate(bad, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
            expect(result.errors.join(" ")).toContain("javascript");
        }
    });

    it("迁移后保存规范化的 v2 版本（经 ConfigManager 持久化）", async () => {
        // 走真实 ConfigManager 路径：load v1 数据 → 保存 → 重启读取仍是 v2 结构。
        const { ConfigManager } = await import("./ConfigManager");
        let stored: unknown = null;
        const host = {
            loadData: async () => stored,
            saveData: async (_name: string, data: unknown) => { stored = data; },
            removeData: async () => {},
        };
        // 初始 null → 默认 v2 配置。用 v1 载荷走迁移：直接写入 v1 数据。
        stored = makeV1Config();
        const mgr2 = new ConfigManager({
            host,
            storageName: "gesture-flow-config",
            availableCommandIds: () => AVAILABLE_COMMANDS,
        });
        const reloaded = await mgr2.load();
        expect(reloaded.ok).toBe(true);
        // 迁移对调用方透明：校验通过即 loaded；version 已是 2
        expect(reloaded.source).toBe("loaded");
        expect(reloaded.config.version).toBe(2);
        expect(reloaded.config.bindings[0].action.type).toBe("builtin");
        expect("commandId" in reloaded.config.bindings[0]).toBe(false);

        // 后续任意保存把规范化后的 v2 结构写入存储（无顶层 commandId）。
        await mgr2.updateConfig({ overlay: { showTrail: false } });
        const persisted = JSON.parse(JSON.stringify(stored));
        expect(persisted.version).toBe(2);
        for (const b of persisted.bindings) {
            expect("commandId" in b).toBe(false);
        }
    });
});
