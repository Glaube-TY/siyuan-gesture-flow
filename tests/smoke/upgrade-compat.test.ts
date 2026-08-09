import { describe, it, expect } from "vitest";
import { ConfigManager } from "../../src/config/ConfigManager";
import { registerBuiltinCommands } from "../../src/commands/registerBuiltinCommands";
import { CommandRegistry } from "../../src/commands/CommandRegistry";
import { SiyuanActionBridge } from "../../src/commands/SiyuanActionBridge";
import { CommandExecutor } from "../../src/commands/CommandExecutor";
import type { CommandContext } from "../../src/commands/types";
import { validateConfig } from "../../src/config/validate";

const registry = new CommandRegistry();
registerBuiltinCommands(registry, new SiyuanActionBridge());

// A realistic v0.1.0 released user config persisted on disk (schema v1):
// default L/R/U/D bindings + a custom builtin binding + a shortcut binding.
const v1Config = {
    version: 1,
    enabled: true,
    trigger: { button: 2, activationDistance: 20, suppressionKey: "Alt", timeoutMs: 2500 },
    recognizer: {
        sampleDistance: 3,
        simplifyTolerance: 2.0,
        minimumSegmentLength: 15,
        turnAngleThreshold: 45,
        maximumSegments: 5,
        directionMode: 8,
    },
    overlay: { showTrail: true, showHint: true, lineWidth: 4 },
    bindings: [
        { id: "default-L", enabled: true, directions: ["L"], action: { type: "builtin", commandId: "tabs.previous", commandParams: {} } },
        { id: "default-R", enabled: true, directions: ["R"], action: { type: "builtin", commandId: "tabs.next", commandParams: {} } },
        { id: "default-U", enabled: true, directions: ["U"], action: { type: "builtin", commandId: "scroll.top", commandParams: {} } },
        { id: "default-D", enabled: true, directions: ["D"], action: { type: "builtin", commandId: "scroll.bottom", commandParams: {} } },
        { id: "custom-close", enabled: true, directions: ["R", "L"], action: { type: "builtin", commandId: "tabs.close", commandParams: {} } },
        { id: "custom-reload", enabled: true, directions: ["D", "U"], action: { type: "builtin", commandId: "document.reload", commandParams: {} } },
        { id: "custom-shortcut", enabled: true, directions: ["U", "R"], action: { type: "shortcut", title: "打开全局搜索", shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } } },
    ],
};

describe("v1 -> v2 schema migration", () => {
    it("loads a v1 config and migrates bindings to mouse:shape without losing actions", async () => {
        const manager = new ConfigManager({
            host: {
                loadData: async () => JSON.parse(JSON.stringify(v1Config)),
                saveData: async () => undefined,
                removeData: async () => undefined,
            },
        });
        const result = await manager.load();
        expect(result.ok).toBe(true);
        expect(result.config.version).toBe(2);
        // Migration reported as normalized.
        expect(["normalized", "valid"]).toContain(result.source);
        // All 7 bindings survive.
        expect(result.config.bindings).toHaveLength(7);
        const byId = new Map(result.config.bindings.map((b) => [b.id, b]));
        // Default binding converted to mouse shape, directions preserved.
        const defL = byId.get("default-L");
        expect(defL?.source).toBe("mouse");
        if (defL?.source === "mouse") {
            const g = defL.gesture as Extract<typeof defL.gesture, { kind: "shape" }>;
            expect(g.directions).toEqual(["L"]);
            expect(g.button).toBe(2);
        }
        // Actions preserved byte-for-byte.
        expect(byId.get("default-D")?.action).toEqual({ type: "builtin", commandId: "scroll.bottom", commandParams: {} });
        expect(byId.get("custom-close")?.action).toEqual({ type: "builtin", commandId: "tabs.close", commandParams: {} });
        const sc = byId.get("custom-shortcut");
        expect(sc?.action.type).toBe("shortcut");
        if (sc && sc.action.type === "shortcut") {
            expect(sc.action.title).toBe("打开全局搜索");
            expect(sc.action.shortcut.ctrlKey).toBe(true);
        }
        // Non-default settings preserved.
        expect(result.config.recognizer.directionMode).toBe(8);
        expect(result.config.trigger.activationDistance).toBe(20);
    });

    it("migration is idempotent: re-validating the migrated config is clean", () => {
        const first = validateConfig(JSON.parse(JSON.stringify(v1Config)));
        expect(first.status).toBe("normalized");
        // Validate the *migrated* output again — it must be valid, not
        // normalized, and stay version 2.
        const second = validateConfig(JSON.parse(JSON.stringify(first.config)));
        expect(second.status).toBe("valid");
        expect(second.config.version).toBe(2);
    });

    it("never overwrites an incompatible (future-version) config on disk", async () => {
        // A future v3.0.0 config the current version cannot read.
        const future = { ...JSON.parse(JSON.stringify(v1Config)), version: 3 };
        let saveCalls = 0;
        let removeCalls = 0;
        const manager = new ConfigManager({
            host: {
                loadData: async () => future,
                saveData: async () => {
                    saveCalls++;
                    return undefined;
                },
                removeData: async () => {
                    removeCalls++;
                    return undefined;
                },
            },
        });
        const result = await manager.load();
        expect(result.source).toBe("fallback");
        expect(result.ok).toBe(true);
        expect(result.config.version).toBe(2);
        expect(saveCalls).toBe(0);
        expect(removeCalls).toBe(0);
    });

    it("preserves bindings to commands unknown to the current version (v2 structure)", async () => {
        // A current-version v2 config that binds a command this version does
        // not register: structure understood → loaded, disk untouched.
        const v2 = JSON.parse(JSON.stringify(v1Config)) as typeof v1Config & { version: number };
        v2.version = 2;
        v2.bindings = v2.bindings.map((b: { id: string; enabled: boolean; directions: string[]; action: unknown }) => ({
            id: b.id,
            enabled: b.enabled,
            source: "mouse",
            gesture: { kind: "shape", button: 2, directions: b.directions },
            action: b.action,
        }));
        (v2 as unknown as Record<string, unknown>).touchpad = {
            enabled: false,
            safeMode: true,
            tapMaxDurationMs: 220,
            tapMaxMovement: 0.03,
            holdDurationMs: 500,
            holdMaxMovement: 0.04,
            swipeMinDistance: 0.15,
            shapeMinPathLength: 0.15,
            anchorMaxDrift: 0.02,
            anchorDrawActivation: 0.12,
            pinchThreshold: 0.15,
            rotateThresholdDeg: 25,
            cooldownMs: 120,
        };
        v2.bindings.push({
            id: "future-binding",
            enabled: true,
            source: "mouse",
            gesture: { kind: "shape", button: 2, directions: ["L", "R"] },
            action: { type: "builtin", commandId: "future.newAction", commandParams: { mark: true } },
        });
        let saveCalls = 0;
        let removeCalls = 0;
        const manager = new ConfigManager({
            host: {
                loadData: async () => v2,
                saveData: async () => {
                    saveCalls++;
                    return undefined;
                },
                removeData: async () => {
                    removeCalls++;
                    return undefined;
                },
            },
        });
        const result = await manager.load();
        expect(result.ok).toBe(true);
        expect(result.source).toBe("loaded");
        const binding = result.config.bindings.find((b) => b.id === "future-binding");
        expect(binding).toBeDefined();
        expect(binding?.enabled).toBe(true);
        if (binding?.source === "mouse") {
            const g = binding.gesture as Extract<typeof binding.gesture, { kind: "shape" }>;
            expect(g.directions).toEqual(["L", "R"]);
        }
        if (binding && binding.action.type === "builtin") {
            expect(binding.action.commandId).toBe("future.newAction");
            expect(binding.action.commandParams).toEqual({ mark: true });
        }
        expect(saveCalls).toBe(0);
        expect(removeCalls).toBe(0);
    });

    it("executing a command unknown to the registry returns unavailable", async () => {
        const executor = new CommandExecutor(registry);
        const context: CommandContext = {
            sessionId: 999,
            directions: ["L", "R"],
            start: { x: 0, y: 0 },
            end: { x: 2, y: 2 },
            points: [],
            durationMs: 100,
            recognition: {
                valid: true,
                invalidReason: null,
                rawPointCount: 0,
                sampledPointCount: 0,
                simplifiedPointCount: 0,
            },
        };
        const result = await executor.execute("future.newAction", context);
        expect(result.status).toBe("unavailable");
    });
});
