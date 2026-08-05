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
    it("初始状态没有迁移步骤", () => {
        expect(hasMigrations()).toBe(false);
    });

    it("registerMigration 注册迁移步骤", () => {
        // Stage 5A has no real migrations, but we can verify the
        // registration path works.  Since CURRENT_CONFIG_VERSION is 1,
        // we cannot register a migration from version 1 (it would be
        // out of range).  This test just verifies the guard works.
        expect(() => registerMigration(0, (x) => x)).toThrow();
        expect(() => registerMigration(CURRENT_CONFIG_VERSION, (x) => x)).toThrow();
    });
});
