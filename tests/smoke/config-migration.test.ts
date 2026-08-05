import { describe, it, expect } from "vitest";
import { migrateAndValidate, detectVersion } from "../../src/config/migrations";
import { createDefaultConfig } from "../../src/config/defaults";
import { CURRENT_CONFIG_VERSION } from "../../src/config/types";

/**
 * Config migration smoke tests.
 *
 * Migration can corrupt user data if it regresses, so these stay as a
 * permanent core suite: v1 → v2, builtin preservation, shortcut import /
 * export, empty bindings, and future-version rejection.
 */

const AVAILABLE_COMMANDS = new Set([
    "tabs.previous",
    "tabs.next",
    "scroll.top",
    "scroll.bottom",
]);

/** Realistic version-1 payload with top-level commandId fields. */
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
            { id: "default-R", enabled: true, directions: ["R"], commandId: "tabs.next", commandParams: {} },
        ],
    };
}

describe("config migration smoke", () => {
    it("version 1 迁移到 version 2，builtin action 不丢失", () => {
        const result = migrateAndValidate(makeV1Config(), { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(2);
        expect(result.config.bindings).toHaveLength(2);
        expect(result.config.bindings[0].action).toEqual({
            type: "builtin",
            commandId: "tabs.previous",
            commandParams: {},
        });
        expect("commandId" in result.config.bindings[0]).toBe(false);
    });

    it("shortcut action 导入导出等价", () => {
        const cfg = createDefaultConfig();
        const withShortcut = {
            ...cfg,
            bindings: [
                ...cfg.bindings,
                {
                    id: "sc-1",
                    enabled: true,
                    directions: ["R", "D"],
                    action: {
                        type: "shortcut",
                        shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
                    },
                },
            ],
        };
        const roundTripped = JSON.parse(JSON.stringify(withShortcut));
        const result = migrateAndValidate(roundTripped, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        const last = result.config.bindings[result.config.bindings.length - 1];
        expect(last.action.type).toBe("shortcut");
        if (last.action.type === "shortcut") {
            expect(last.action.shortcut).toEqual({
                key: "p", code: "KeyP", keyCode: 80,
                ctrlKey: true, altKey: false, shiftKey: false, metaKey: false,
            });
        }
    });

    it("空 bindings 迁移后保持为空", () => {
        const v1 = { ...makeV1Config(), bindings: [] };
        const result = migrateAndValidate(v1, { availableCommandIds: AVAILABLE_COMMANDS });
        expect(result.status).toBe("valid");
        expect(result.config.bindings).toEqual([]);
    });

    it("未来未知版本被拒绝降级", () => {
        const cfg = createDefaultConfig();
        const result = migrateAndValidate({ ...cfg, version: 999 });
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
            expect(result.errors[0]).toMatch(/unknown future config version/);
        }
    });

    it("detectVersion 对缺失/非法版本返回预期标记", () => {
        expect(detectVersion({ enabled: true })).toBeNull();
        expect(detectVersion({ version: CURRENT_CONFIG_VERSION })).toBe(2);
        expect(detectVersion({ version: 999 })).toBe("future");
        expect(detectVersion({ version: 1.5 })).toBe("invalid");
    });
});
