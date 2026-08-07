import { describe, it, expect } from "vitest";
import { CommandRegistry } from "../../src/commands/CommandRegistry";
import { SiyuanActionBridge } from "../../src/commands/SiyuanActionBridge";
import { registerBuiltinCommands } from "../../src/commands/registerBuiltinCommands";
import {
    OFFICIAL_GLOBAL_ACTIONS,
    createOfficialGlobalCommands,
} from "../../src/commands/builtin/global";
import { CommandDefinition } from "../../src/commands/types";
import { createDefaultConfig } from "../../src/config/defaults";
import { validateConfig } from "../../src/config/validate";

/**
 * Built-in command catalog smoke tests (v0.2.0).
 *
 * The command catalog must come from the real CommandRegistry.  These
 * tests verify the expanded v0.2.0 set: registration succeeds with no
 * duplicate ids, every group is present, the per-group ordering matches
 * the recommended picker order, every official-global action is wired
 * through the bridge (no-app → `unavailable`), and an existing v0.1.0
 * config still validates against the new command id set.
 *
 * The bridge is constructed without an App (probe bridge) so no action
 * ever touches SiYuan; `siyuan` is a type-only package, resolved to a
 * stub by vitest.config.ts.
 */
function buildRegistry(): CommandRegistry {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry, new SiyuanActionBridge());
    return registry;
}

describe("built-in command catalog (v0.2.0)", () => {
    it("registers every command with unique ids", () => {
        const registry = buildRegistry();
        const commands = registry.list();
        const ids = commands.map((c) => c.id);
        expect(ids.length).toBe(new Set(ids).size);
        expect(ids).toContain("tabs.previous");
        expect(ids).toContain("scroll.bottom");
    });

    it("contains all new v0.2.0 commands", () => {
        const ids = new Set(buildRegistry().list().map((c) => c.id));
        const expected = [
            // Search
            "search.global",
            "search.selection",
            // Documents
            "document.new",
            "document.dailyNote",
            "documents.recent",
            "document.history",
            "document.flashcards",
            // Panels & Views
            "panel.fileTree",
            "panel.outline",
            "panel.backlinks",
            "panel.bookmarks",
            "panel.tags",
            "panel.inbox",
            "view.graph",
            "view.globalGraph",
            "view.toggleDock",
            // Tabs
            "tabs.closeLeft",
            "tabs.closeRight",
            "tabs.closeOthers",
            "tabs.closeAll",
            // Layout
            "layout.splitHorizontal",
            "layout.splitVertical",
            "layout.unsplit",
            "layout.unsplitAll",
            // Application & System
            "app.settings",
            "app.sync",
            "editor.toggleReadonly",
            "app.lockScreen",
        ];
        for (const id of expected) {
            expect(ids.has(id), `missing command ${id}`).toBe(true);
        }
    });

    it("contains every unified group", () => {
        const groups = new Set(buildRegistry().list().map((c) => c.group));
        const expected = new Set([
            "Tabs",
            "Documents",
            "Search",
            "Navigation",
            "PanelsViews",
            "Layout",
            "ApplicationSystem",
            "Scrolling",
        ]);
        expect(groups).toEqual(expected);
    });

    it("orders groups and actions as recommended for the picker", () => {
        const ids = buildRegistry().list().map((c) => c.id);
        const groupFirstSeen: string[] = [];
        for (const cmd of buildRegistry().list()) {
            if (!groupFirstSeen.includes(cmd.group)) {
                groupFirstSeen.push(cmd.group);
            }
        }
        expect(groupFirstSeen).toEqual([
            "Tabs",
            "Documents",
            "Search",
            "Navigation",
            "PanelsViews",
            "Layout",
            "ApplicationSystem",
            "Scrolling",
        ]);

        const index = (id: string) => ids.indexOf(id);
        // Tabs
        expect(index("tabs.previous")).toBeLessThan(index("tabs.next"));
        expect(index("tabs.next")).toBeLessThan(index("tabs.close"));
        expect(index("tabs.close")).toBeLessThan(index("tabs.restoreRecent"));
        expect(index("tabs.restoreRecent")).toBeLessThan(index("tabs.closeLeft"));
        expect(index("tabs.closeLeft")).toBeLessThan(index("tabs.closeRight"));
        expect(index("tabs.closeRight")).toBeLessThan(index("tabs.closeOthers"));
        expect(index("tabs.closeOthers")).toBeLessThan(index("tabs.closeAll"));
        // Documents
        expect(index("document.reload")).toBeLessThan(index("document.new"));
        expect(index("document.new")).toBeLessThan(index("document.dailyNote"));
        expect(index("document.dailyNote")).toBeLessThan(index("documents.recent"));
        expect(index("documents.recent")).toBeLessThan(index("document.history"));
        expect(index("document.history")).toBeLessThan(index("document.flashcards"));
        // Search
        expect(index("search.global")).toBeLessThan(index("search.selection"));
        // Panels & Views
        expect(index("panel.fileTree")).toBeLessThan(index("panel.outline"));
        expect(index("panel.outline")).toBeLessThan(index("panel.backlinks"));
        expect(index("panel.backlinks")).toBeLessThan(index("panel.bookmarks"));
        expect(index("panel.bookmarks")).toBeLessThan(index("panel.tags"));
        expect(index("panel.tags")).toBeLessThan(index("panel.inbox"));
        expect(index("panel.inbox")).toBeLessThan(index("view.graph"));
        expect(index("view.graph")).toBeLessThan(index("view.globalGraph"));
        expect(index("view.globalGraph")).toBeLessThan(index("view.toggleDock"));
        // Layout
        expect(index("layout.splitHorizontal")).toBeLessThan(index("layout.splitVertical"));
        expect(index("layout.splitVertical")).toBeLessThan(index("layout.unsplit"));
        expect(index("layout.unsplit")).toBeLessThan(index("layout.unsplitAll"));
        // Application & System
        expect(index("app.settings")).toBeLessThan(index("app.sync"));
        expect(index("app.sync")).toBeLessThan(index("editor.toggleReadonly"));
        expect(index("editor.toggleReadonly")).toBeLessThan(index("app.lockScreen"));
    });

    it("declares a non-empty official globalCommand for every mapping", () => {
        expect(OFFICIAL_GLOBAL_ACTIONS.length).toBeGreaterThan(0);
        for (const spec of OFFICIAL_GLOBAL_ACTIONS) {
            expect(spec.globalCommand.trim().length).toBeGreaterThan(0);
            expect(spec.id.trim().length).toBeGreaterThan(0);
            expect(spec.title.trim().length).toBeGreaterThan(0);
        }
    });

    it("executes every official-global command through the bridge (unavailable without App)", async () => {
        // Probe bridge without an App: every global command must report
        // `unavailable` (never throw, never fake a success).
        const bridge = new SiyuanActionBridge();
        const commands: CommandDefinition[] = createOfficialGlobalCommands(bridge);
        for (const cmd of commands) {
            const result = await cmd.execute(
                {
                    sessionId: 1,
                    directions: ["R"],
                    start: { x: 0, y: 0 },
                    end: { x: 10, y: 0 },
                    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
                    durationMs: 200,
                    recognition: { valid: true, invalidReason: null, rawPointCount: 2, sampledPointCount: 2, simplifiedPointCount: 2 },
                },
                {},
            );
            expect(result.status).toBe("unavailable");
        }
    });

    it("bridge executeGlobalCommand returns unavailable without an App", () => {
        const result = new SiyuanActionBridge().executeGlobalCommand("globalSearch");
        expect(result.status).toBe("unavailable");
    });
});

describe("v0.1.0 config compatibility (v0.2.0)", () => {
    it("a released v0.1.0 config still validates against the new command id set", () => {
        const registry = buildRegistry();
        const availableCommandIds = new Set(registry.list().map((c) => c.id));

        const config = createDefaultConfig();
        config.bindings.push(
            // A custom builtin binding using a v0.1.0-era id.
            {
                id: "custom-close",
                enabled: true,
                directions: ["R", "L"],
                action: { type: "builtin", commandId: "tabs.close", commandParams: {} },
            },
            // A shortcut binding (v0.1.0 structure with user title).
            {
                id: "custom-shortcut",
                enabled: true,
                directions: ["U", "R"],
                action: {
                    type: "shortcut",
                    title: "打开全局搜索",
                    shortcut: {
                        key: "p",
                        code: "KeyP",
                        keyCode: 80,
                        ctrlKey: true,
                        altKey: false,
                        shiftKey: false,
                        metaKey: false,
                    },
                },
            },
        );

        const result = validateConfig(config, { availableCommandIds });
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(1);
    });
});
