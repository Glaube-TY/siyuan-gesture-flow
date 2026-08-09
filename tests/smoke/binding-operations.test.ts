import { describe, it, expect, vi } from "vitest";
import { createDefaultConfig } from "../../src/config/defaults";
import { GestureFlowConfig, ConfigBinding } from "../../src/config/types";
import { validateConfig } from "../../src/config/validate";
import {
    addBinding,
    updateBinding,
    removeBinding,
    BindingDraft,
    validateBindingDraft,
} from "../../src/config/bindingOperations";

/**
 * Binding operations smoke tests (version-2 descriptor shape).
 *
 * Persistable-binding logic (add / edit / delete / duplicate-signature /
 * id-collision / shortcut-title rules, both builtin and shortcut actions)
 * plus the current config structure — a small permanent core suite.
 */

const opts = {
    maximumSegments: 6,
    directionMode: 4 as const,
    availableCommandIds: new Set(["tabs.previous", "tabs.next", "scroll.top", "scroll.bottom"]),
    bindings: [] as ConfigBinding[],
};

function makeConfig(): GestureFlowConfig {
    return createDefaultConfig();
}

const builtinDraft: BindingDraft = {
    enabled: true,
    source: "mouse",
    gesture: { kind: "shape", button: 2, directions: ["R", "D"] },
    action: { type: "builtin", commandId: "tabs.next", commandParams: {} },
};

const shortcutDraft: BindingDraft = {
    enabled: true,
    source: "mouse",
    gesture: { kind: "shape", button: 2, directions: ["D", "L"] },
    action: {
        type: "shortcut",
        title: "打开全局搜索",
        shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
    },
};

const touchpadDraft: BindingDraft = {
    enabled: true,
    source: "touchpad",
    gesture: { kind: "tap", fingerCount: 3 },
    action: { type: "builtin", commandId: "tabs.previous", commandParams: {} },
};

function dirs(b: ConfigBinding): string[] {
    if (b.source === "mouse") {
        return (b.gesture as Extract<ConfigBinding["gesture"], { kind: "shape" }>).directions;
    }
    return [];
}

describe("binding-operations smoke (v2)", () => {
    it("新增 builtin 绑定", () => {
        const r = addBinding(makeConfig(), builtinDraft, opts);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.bindings).toHaveLength(5);
            expect(r.bindings[4].action.type).toBe("builtin");
        }
    });

    it("新增 shortcut 绑定", () => {
        const r = addBinding(makeConfig(), shortcutDraft, opts);
        expect(r.ok).toBe(true);
        if (r.ok) {
            const added = r.bindings[r.bindings.length - 1];
            expect(added.action.type).toBe("shortcut");
        }
    });

    it("新增触控板绑定（source=touchpad）", () => {
        const r = addBinding(makeConfig(), touchpadDraft, opts);
        expect(r.ok).toBe(true);
        if (r.ok) {
            const added = r.bindings[r.bindings.length - 1];
            expect(added.source).toBe("touchpad");
            expect((added.gesture as { kind: string }).kind).toBe("tap");
            expect((added.gesture as { fingerCount: number }).fingerCount).toBe(3);
        }
    });

    it("编辑绑定保留 id 并更新 action", () => {
        const cfg = makeConfig();
        const r = updateBinding(cfg, "default-L", builtinDraft, { ...opts, excludeId: "default-L" });
        expect(r.ok).toBe(true);
        if (r.ok) {
            const updated = r.bindings.find((b: ConfigBinding) => b.id === "default-L");
            expect(dirs(updated as ConfigBinding)).toEqual(["R", "D"]);
        }
    });

    it("删除绑定", () => {
        const cfg = makeConfig();
        const r = removeBinding(cfg, "default-R");
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.bindings).toHaveLength(3);
            expect(r.bindings.find((b) => b.id === "default-R")).toBeUndefined();
        }
    });

    it("重复方向序列被拒绝（鼠标签名冲突）", () => {
        const cfg = makeConfig(); // 已含 ["L"] 默认绑定
        const dup = { ...builtinDraft, gesture: { kind: "shape" as const, button: 2, directions: ["L"] } };
        const r = addBinding(cfg, dup, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("duplicate-directions");
    });

    it("鼠标与触控板手势互不冲突（不同签名）", () => {
        const cfg = makeConfig(); // 含 mouse:2:shape:L
        const mouseDup = { ...touchpadDraft, gesture: { kind: "swipe" as const, fingerCount: 3, direction: "L" as const } };
        const r = addBinding(cfg, mouseDup, opts);
        expect(r.ok).toBe(true);
    });

    it("相同触控板手势重复被拒绝", () => {
        const cfg = makeConfig();
        const first = addBinding(cfg, touchpadDraft, opts);
        if (!first.ok) throw new Error("first add failed");
        const second = addBinding({ ...cfg, bindings: first.bindings }, touchpadDraft, opts);
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.error).toBe("duplicate-directions");
    });

    it("ID 冲突时重试生成唯一 ID", () => {
        const cfg = makeConfig();
        const spy = viRandomOnce("default-L");
        const r = addBinding(cfg, builtinDraft, opts);
        expect(r.ok).toBe(true);
        spy.mockRestore();
    });

    it("builtin 与 shortcut 均可保存（校验通过）", () => {
        const r1 = addBinding(makeConfig(), builtinDraft, opts);
        const r2 = addBinding(makeConfig(), shortcutDraft, opts);
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
    });

    it("快捷键动作缺少操作名称时草稿被拒绝", () => {
        const noTitle = {
            ...shortcutDraft,
            action: { type: "shortcut" as const, title: "   ", shortcut: shortcutDraft.action.shortcut },
        };
        const r = validateBindingDraft(noTitle, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("invalid-shortcut");
    });

    it("anchorDraw 需要 1 ≤ anchorCount < fingerCount", () => {
        const bad = {
            ...touchpadDraft,
            gesture: { kind: "anchorDraw" as const, fingerCount: 2, anchorCount: 2, directions: ["U"] },
        };
        const r = validateBindingDraft(bad, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("invalid-gesture");
    });

    it("当前默认配置有效（版本 2）", () => {
        const result = validateConfig(createDefaultConfig());
        expect(result.status).toBe("valid");
        expect(result.config.version).toBe(2);
    });

    it("旧开发结构被拒绝（顶层 commandId / 未来版本）", () => {
        const legacyTopLevel = {
            ...createDefaultConfig(),
            bindings: [
                { id: "x", enabled: true, directions: ["L"], commandId: "tabs.previous", commandParams: {} },
            ],
        };
        expect(validateConfig(legacyTopLevel).status).toBe("invalid");
        expect(validateConfig({ ...createDefaultConfig(), version: 3 }).status).toBe("invalid");
        expect(validateConfig({ ...createDefaultConfig(), bindings: [{ id: "x", enabled: true, directions: ["L"] }] }).status).toBe("invalid");
    });
});

/** Force crypto.randomUUID to return a colliding id once (black-box). */
function viRandomOnce(value: string) {
    return vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(value as never);
}
