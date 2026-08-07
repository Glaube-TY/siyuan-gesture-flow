import { describe, it, expect } from "vitest";
import { ConfigManager } from "../../src/config/ConfigManager";
import { registerBuiltinCommands } from "../../src/commands/registerBuiltinCommands";
import { CommandRegistry } from "../../src/commands/CommandRegistry";
import { SiyuanActionBridge } from "../../src/commands/SiyuanActionBridge";
import { validateConfig } from "../../src/config/validate";

const registry = new CommandRegistry();
registerBuiltinCommands(registry, new SiyuanActionBridge());
const commandIds = new Set(registry.list().map((c) => c.id));

// A realistic v0.1.0 released user config persisted on disk:
// default L/R/U/D bindings + a custom builtin binding + a shortcut
// binding with a user title, plus non-default settings.
const v010 = {
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

describe("v0.1.0 -> v0.2.0 upgrade simulation", () => {
    it("loads a released v0.1.0 config through ConfigManager without losing bindings or shortcut titles", async () => {
        const manager = new ConfigManager({
            host: {
                loadData: async () => JSON.parse(JSON.stringify(v010)),
                saveData: async () => undefined,
                removeData: async () => undefined,
            },
            availableCommandIds: () => commandIds,
        });
        const result = await manager.load();
        expect(result.ok).toBe(true);
        expect(result.config.version).toBe(1);
        // Config was NOT reset to defaults: all 7 bindings survive.
        expect(result.config.bindings).toHaveLength(7);
        const byId = new Map(result.config.bindings.map((b) => [b.id, b]));
        // Default bindings intact and still enabled.
        expect(byId.get("default-L")?.action).toEqual({ type: "builtin", commandId: "tabs.previous", commandParams: {} });
        expect(byId.get("default-D")?.action).toEqual({ type: "builtin", commandId: "scroll.bottom", commandParams: {} });
        // Custom builtin bindings intact.
        expect(byId.get("custom-close")?.action).toEqual({ type: "builtin", commandId: "tabs.close", commandParams: {} });
        expect(byId.get("custom-close")?.directions).toEqual(["R", "L"]);
        // Shortcut binding + user title intact.
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

    it("accepts bindings to the new v0.2.0 commands", () => {
        const config = JSON.parse(JSON.stringify(v010)) as ReturnType<typeof Object>;
        config.bindings.push(
            { id: "custom-search", enabled: true, directions: ["L", "D"], action: { type: "builtin", commandId: "search.global", commandParams: {} } },
            { id: "custom-split", enabled: true, directions: ["R", "U"], action: { type: "builtin", commandId: "layout.splitHorizontal", commandParams: {} } },
        );
        const result = validateConfig(config, { availableCommandIds: commandIds });
        expect(result.status).toBe("valid");
    });

    it("never overwrites an incompatible (future-version) config on disk", async () => {
        // A future v0.3.0 config (version 2) the current version cannot read.
        const future = { ...JSON.parse(JSON.stringify(v010)), version: 2 };
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
            availableCommandIds: () => commandIds,
        });
        const result = await manager.load();
        // Reported as a fallback, not a clean defaults load.
        expect(result.source).toBe("fallback");
        expect(result.ok).toBe(true);
        // The runtime may run on defaults temporarily…
        expect(result.config.version).toBe(1);
        // …but the disk data is preserved: no save, no remove.
        expect(saveCalls).toBe(0);
        expect(removeCalls).toBe(0);
    });
});
