// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createDefaultConfig } from "./defaults";
import { GestureFlowConfig, ConfigBinding } from "./types";
import {
    addBinding,
    updateBinding,
    removeBinding,
    toggleBinding,
    findDuplicateDirections,
    generateBindingId,
    validateBindingDraft,
    directionsKey,
    BindingDraft,
} from "./bindingOperations";

function makeConfig(bindings: ConfigBinding[] = createDefaultConfig().bindings): GestureFlowConfig {
    return { ...createDefaultConfig(), bindings: bindings.map((b) => ({ ...b, directions: b.directions.slice(), commandParams: { ...b.commandParams } })) };
}

const opts = {
    maximumSegments: 6,
    directionMode: 4 as const,
    availableCommandIds: new Set(["tabs.previous", "tabs.next", "scroll.top", "scroll.bottom"]),
};

const draftRD: BindingDraft = {
    enabled: true,
    directions: ["R", "D"],
    commandId: "tabs.next",
};

describe("bindingOperations — 生成 id", () => {
    it("generateBindingId 生成唯一且安全的 id", () => {
        const a = generateBindingId();
        const b = generateBindingId();
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[a-zA-Z0-9-]+$/);
        expect(b).toMatch(/^[a-zA-Z0-9-]+$/);
        expect(a.length).toBeGreaterThan(0);
    });
});

describe("bindingOperations — 校验", () => {
    const config = makeConfig();

    it("空方向序列被拒绝", () => {
        const r = validateBindingDraft({ ...draftRD, directions: [] }, { bindings: config.bindings, ...opts });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("empty-directions");
    });

    it("超过 maximumSegments 被拒绝", () => {
        const r = validateBindingDraft(
            { ...draftRD, directions: ["R", "D", "L", "U", "R", "D", "L"] },
            { bindings: config.bindings, maximumSegments: 6, directionMode: 4, availableCommandIds: opts.availableCommandIds },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("too-many-segments");
    });

    it("4 方向模式下斜向被拒绝", () => {
        const r = validateBindingDraft(
            { ...draftRD, directions: ["UR"] },
            { bindings: config.bindings, maximumSegments: 6, directionMode: 4, availableCommandIds: opts.availableCommandIds },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("direction-not-allowed");
    });

    it("8 方向模式允许斜向", () => {
        const r = validateBindingDraft(
            { ...draftRD, directions: ["UR", "DL"] },
            { bindings: config.bindings, maximumSegments: 6, directionMode: 8, availableCommandIds: opts.availableCommandIds },
        );
        expect(r.ok).toBe(true);
    });

    it("未知命令被拒绝", () => {
        const r = validateBindingDraft(
            { ...draftRD, commandId: "tabs.close" },
            { bindings: config.bindings, ...opts },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("unknown-command");
    });

    it("commandParams 必须是普通对象", () => {
        const r = validateBindingDraft(
            { ...draftRD, commandParams: [1, 2] as unknown as Record<string, unknown> },
            { bindings: config.bindings, ...opts },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("invalid-command-params");
    });

    it("与现有绑定方向序列重复被拒绝", () => {
        // Defaults contain ["L"] — a new binding with ["L"] must fail.
        const r = validateBindingDraft(
            { ...draftRD, directions: ["L"] },
            { bindings: config.bindings, ...opts },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("duplicate-directions");
    });

    it("编辑时排除自身 id，同方向不判重复", () => {
        const config = makeConfig();
        const existing = config.bindings[0]; // id default-L, ["L"]
        const r = validateBindingDraft(
            { ...draftRD, directions: ["L"] },
            { bindings: config.bindings, excludeId: existing.id, ...opts },
        );
        expect(r.ok).toBe(true);
    });

    it("findDuplicateDirections 返回冲突绑定并支持排除", () => {
        const config = makeConfig();
        const dup = findDuplicateDirections(config.bindings, ["L"]);
        expect(dup?.id).toBe("default-L");
        expect(findDuplicateDirections(config.bindings, ["L"], "default-L")).toBeNull();
        expect(findDuplicateDirections(config.bindings, ["R", "D"])).toBeNull();
    });
});

describe("bindingOperations — 增删改启停", () => {
    it("addBinding 追加新绑定并生成新 id", () => {
        const config = makeConfig();
        const before = config.bindings;
        const r = addBinding(config, draftRD, opts);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.bindings).toHaveLength(before.length + 1);
        const added = r.bindings[r.bindings.length - 1];
        expect(added.directions).toEqual(["R", "D"]);
        expect(added.commandId).toBe("tabs.next");
        expect(added.commandParams).toEqual({});
        // 输入未被修改
        expect(config.bindings).toHaveLength(before.length);
        expect(config.bindings[0].directions).toEqual(["L"]);
    });

    it("updateBinding 保留原 id 并替换字段", () => {
        const config = makeConfig();
        const target = config.bindings[0]; // default-L
        const r = updateBinding(config, target.id, { ...draftRD, directions: ["D", "R"] }, opts);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const updated = r.bindings.find((b) => b.id === target.id);
        expect(updated?.directions).toEqual(["D", "R"]);
        expect(updated?.commandId).toBe("tabs.next");
        expect(r.bindings).toHaveLength(config.bindings.length);
        // 其它绑定不变
        expect(r.bindings.find((b) => b.id === "default-R")?.directions).toEqual(["R"]);
        expect(config.bindings[0].directions).toEqual(["L"]); // 原输入未动
    });

    it("updateBinding 编辑为他人重复方向被拒绝", () => {
        const config = makeConfig();
        const target = config.bindings[0];
        const r = updateBinding(config, target.id, { ...draftRD, directions: ["R"] }, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("duplicate-directions");
    });

    it("updateBinding 未知 id 返回 not-found", () => {
        const config = makeConfig();
        const r = updateBinding(config, "nope", draftRD, opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("not-found");
    });

    it("removeBinding 删除指定绑定", () => {
        const config = makeConfig();
        const r = removeBinding(config, "default-R");
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.bindings.some((b) => b.id === "default-R")).toBe(false);
        expect(r.bindings).toHaveLength(config.bindings.length - 1);
    });

    it("删除最后一个绑定合法（明确空数组）", () => {
        let config = makeConfig();
        for (const b of [...config.bindings]) {
            const r = removeBinding(config, b.id);
            expect(r.ok).toBe(true);
            if (r.ok) config = { ...config, bindings: r.bindings };
        }
        expect(config.bindings).toEqual([]);
    });

    it("removeBinding 未知 id 返回 not-found", () => {
        const config = makeConfig();
        const r = removeBinding(config, "nope");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("not-found");
    });

    it("toggleBinding 启停指定绑定", () => {
        const config = makeConfig();
        const r = toggleBinding(config, "default-U", false);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.bindings.find((b) => b.id === "default-U")?.enabled).toBe(false);
        expect(r.bindings.find((b) => b.id === "default-L")?.enabled).toBe(true);
        // 原输入未动
        expect(config.bindings.find((b) => b.id === "default-U")?.enabled).toBe(true);
    });

    it("toggleBinding 未知 id 返回 not-found", () => {
        const config = makeConfig();
        const r = toggleBinding(config, "nope", false);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("not-found");
    });

    it("所有操作不修改输入对象（深层）", () => {
        const config = makeConfig();
        const snapshot = JSON.stringify(config);
        addBinding(config, draftRD, opts);
        updateBinding(config, "default-L", draftRD, opts);
        removeBinding(config, "default-D");
        toggleBinding(config, "default-U", false);
        expect(JSON.stringify(config)).toBe(snapshot);
    });
});

describe("bindingOperations — directionsKey", () => {
    it("生成稳定序列键", () => {
        expect(directionsKey(["R", "D"])).toBe("R-D");
        expect(directionsKey(["UL"])).toBe("UL");
    });
});

