import { describe, it, expect, vi } from "vitest";
import { createDefaultConfig } from "../../src/config/defaults";
import { GestureFlowConfig, ConfigBinding } from "../../src/config/types";
import {
    addBinding,
    updateBinding,
    removeBinding,
    BindingDraft,
} from "../../src/config/bindingOperations";

/**
 * Binding operations smoke tests.
 *
 * Persistable-binding logic (add / edit / delete / duplicate-direction /
 * id-collision, both builtin and shortcut actions) — a small permanent
 * core suite.  UI flows are verified in real SiYuan.
 */

const opts = {
    maximumSegments: 6,
    directionMode: 4 as const,
    availableCommandIds: new Set(["tabs.previous", "tabs.next", "scroll.top", "scroll.bottom"]),
};

function makeConfig(): GestureFlowConfig {
    return createDefaultConfig();
}

const builtinDraft: BindingDraft = {
    enabled: true,
    directions: ["R", "D"],
    action: { type: "builtin", commandId: "tabs.next", commandParams: {} },
};

const shortcutDraft: BindingDraft = {
    enabled: true,
    directions: ["D", "L"],
    action: {
        type: "shortcut",
        shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
    },
};

describe("binding-operations smoke", () => {
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

    it("编辑绑定保留 id 并更新 action", () => {
        const cfg = makeConfig();
        const r = updateBinding(cfg, "default-L", builtinDraft, { ...opts, excludeId: "default-L" });
        expect(r.ok).toBe(true);
        if (r.ok) {
            const updated = r.bindings.find((b: ConfigBinding) => b.id === "default-L");
            expect(updated?.directions).toEqual(["R", "D"]);
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

    it("重复方向序列被拒绝（无论动作类型）", () => {
        const cfg = makeConfig(); // 已含 ["L"] 默认绑定
        const dup = { ...builtinDraft, directions: ["L"] };
        const r = addBinding(cfg, dup, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("duplicate-directions");
    });

    it("ID 冲突时重试生成唯一 ID", () => {
        // 首次 randomUUID 返回已有 id → 内部有界重试仍成功
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
});

/** Force crypto.randomUUID to return a colliding id once (black-box). */
function viRandomOnce(value: string) {
    return vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(value as never);
}
