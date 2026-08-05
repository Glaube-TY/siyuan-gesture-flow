import { describe, it, expect } from "vitest";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "./defaultBindings";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBinding } from "./types";

/** Extract the builtin commandId (' for shortcuts/unknown). */
function cmdIdOf(action: GestureBinding["action"] | undefined): string {
    return action && action.type === "builtin" ? action.commandId : "";
}

/** Builtin binding helper. */
function builtin(id: string, dirs: Direction[], commandId: string): GestureBinding {
    return {
        id,
        enabled: true,
        directions: dirs,
        action: { type: "builtin", commandId, commandParams: {} },
    };
}

describe("GestureBindingRegistry — 默认绑定", () => {
    it("注册四个默认绑定", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.list().length).toBe(4);
    });

    it("L → tabs.previous", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["L" as Direction]);
        expect(resolved?.binding.action).toEqual({ type: "builtin", commandId: "tabs.previous", commandParams: {} });
    });

    it("R → tabs.next", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["R" as Direction]);
        expect(cmdIdOf(resolved?.binding.action)).toBe("tabs.next");
    });

    it("U → scroll.top", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["U" as Direction]);
        expect(cmdIdOf(resolved?.binding.action)).toBe("scroll.top");
    });

    it("D → scroll.bottom", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["D" as Direction]);
        expect(cmdIdOf(resolved?.binding.action)).toBe("scroll.bottom");
    });
});

describe("GestureBindingRegistry — 严格方向匹配", () => {
    it("复合方向不误匹配单方向", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.resolve(["R" as Direction, "D" as Direction])).toBeNull();
    });

    it("单方向不误匹配复合方向", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register(builtin("test-rd", ["R" as Direction, "D" as Direction], "tabs.next"));
        expect(bindings.resolve(["R" as Direction])).toBeNull();
    });
});

describe("GestureBindingRegistry — 重复方向拒绝", () => {
    it("重复方向序列抛出错误", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register(builtin("test-l", ["L" as Direction], "tabs.previous"));
        expect(() => {
            bindings.register(builtin("test-l-2", ["L" as Direction], "tabs.next"));
        }).toThrow();
    });
});

describe("GestureBindingRegistry — 空方向拒绝", () => {
    it("空方向抛出错误", () => {
        const bindings = new GestureBindingRegistry();
        expect(() => {
            bindings.register(builtin("test-empty", [], "tabs.next"));
        }).toThrow();
    });
});

describe("GestureBindingRegistry — 动作无关（不校验命令存在性）", () => {
    it("引用未注册命令的绑定仍可注册（执行期由 ActionExecutor 决定）", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register(builtin("test-missing", ["L" as Direction], "nonexistent.command"));
        const resolved = bindings.resolve(["L" as Direction]);
        expect(cmdIdOf(resolved?.binding.action)).toBe("nonexistent.command");
    });

    it("快捷键动作绑定同样注册并解析", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register({
            id: "sc-L",
            enabled: true,
            directions: ["L" as Direction],
            action: { type: "shortcut", shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } },
        });
        const resolved = bindings.resolve(["L" as Direction]);
        expect(resolved?.binding.action.type).toBe("shortcut");
    });
});

describe("GestureBindingRegistry — disabled 不解析", () => {
    it("disabled 绑定 resolve 返回 null", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        bindings.setEnabled(["L" as Direction], false);
        expect(bindings.resolve(["L" as Direction])).toBeNull();
    });

    it("重新 enable 后可以解析", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        bindings.setEnabled(["L" as Direction], false);
        bindings.setEnabled(["L" as Direction], true);
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });
});

// ============================================================ ID 管理
describe("GestureBindingRegistry — ID 管理", () => {
    it("ID 不得为空", () => {
        const bindings = new GestureBindingRegistry();
        expect(() => {
            bindings.register(builtin("", ["L" as Direction], "tabs.previous"));
        }).toThrow();
    });

    it("ID 去除首尾空格后仍不得为空", () => {
        const bindings = new GestureBindingRegistry();
        expect(() => {
            bindings.register(builtin("   ", ["L" as Direction], "tabs.previous"));
        }).toThrow();
    });

    it("重复 ID 必须拒绝", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register(builtin("my-binding", ["L" as Direction], "tabs.previous"));
        expect(() => {
            bindings.register(builtin("my-binding", ["R" as Direction], "tabs.next"));
        }).toThrow(/Duplicate binding id/);
    });

    it("ID 和方向键分别维护（相同 ID 不同方向仍唯一）", () => {
        const bindings = new GestureBindingRegistry();
        bindings.register(builtin("unique-id", ["L" as Direction], "tabs.previous"));
        expect(() => {
            bindings.register(builtin("unique-id", ["R" as Direction], "tabs.next"));
        }).toThrow(/Duplicate binding id/);
    });

    it("getById 返回绑定", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const binding = bindings.getById("default-L");
        expect(binding).not.toBeNull();
        expect(cmdIdOf(binding?.action)).toBe("tabs.previous");
    });

    it("getById 返回不存在的 ID 时返回 null", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.getById("nonexistent")).toBeNull();
    });

    it("setEnabledById 修改启用状态", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.setEnabledById("default-L", false)).toBe(true);
        expect(bindings.resolve(["L" as Direction])).toBeNull();
        expect(bindings.setEnabledById("default-L", true)).toBe(true);
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });

    it("setEnabledById 不存在的 ID 返回 false", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.setEnabledById("nonexistent", false)).toBe(false);
    });

    it("setEnabled 和 setEnabledById 修改同一记录", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        bindings.setEnabled(["L" as Direction], false);
        expect(bindings.getById("default-L")?.enabled).toBe(false);
        bindings.setEnabledById("default-L", true);
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });
});

// ============================================================ 不可变性
describe("GestureBindingRegistry — 不可变性", () => {
    it("list 返回的数组修改不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        list.length = 0;
        expect(bindings.list().length).toBe(4);
    });

    it("list 返回的 binding 修改 enabled 不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding) lBinding.enabled = false;
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });

    it("list 返回的 binding 修改 directions 不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding) (lBinding.directions as Direction[]).push("R" as Direction);
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
        expect(bindings.resolve(["L" as Direction, "R" as Direction])).toBeNull();
    });

    it("list 返回的 binding 修改 action.commandParams 不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding && lBinding.action.type === "builtin") {
            (lBinding.action.commandParams as Record<string, unknown>).injected = true;
        }
        const internal = bindings.getById("default-L");
        expect(internal && internal.action.type === "builtin" ? internal.action.commandParams : null).toEqual({});
    });

    it("resolve 返回的 binding 修改不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["L" as Direction]);
        expect(resolved).not.toBeNull();
        if (resolved) {
            resolved.binding.enabled = false;
            (resolved.binding.directions as Direction[]).push("R" as Direction);
        }
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });

    it("getById 返回的 binding 修改不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        bindings.registerMany(DEFAULT_BINDINGS);
        const binding = bindings.getById("default-L");
        expect(binding).not.toBeNull();
        if (binding) {
            binding.enabled = false;
            (binding.directions as Direction[]).push("R" as Direction);
        }
        expect(cmdIdOf(bindings.resolve(["L" as Direction])?.binding.action)).toBe("tabs.previous");
    });

    it("register 时传入的 binding 修改不影响注册表", () => {
        const bindings = new GestureBindingRegistry();
        const input: GestureBinding = {
            id: "input-binding",
            enabled: true,
            directions: ["L" as Direction],
            action: { type: "builtin", commandId: "tabs.previous", commandParams: { foo: "bar" } },
        };
        bindings.register(input);
        input.enabled = false;
        (input.directions as Direction[]).push("R" as Direction);
        if (input.action.type === "builtin") {
            input.action.commandParams.foo = "mutated";
        }
        const stored = bindings.getById("input-binding");
        expect(stored?.enabled).toBe(true);
        expect(stored?.directions).toEqual(["L"]);
        if (stored?.action.type === "builtin") {
            expect(stored.action.commandParams).toEqual({ foo: "bar" });
        }
    });
});

// ============================================================ registerMany 原子性
describe("GestureBindingRegistry — registerMany 原子性", () => {
    it("批量中某项失败时不留下前面已注册的部分", () => {
        const bindings = new GestureBindingRegistry();
        const batch: GestureBinding[] = [
            builtin("batch-1", ["L" as Direction], "tabs.previous"),
            builtin("batch-2", ["R" as Direction], "tabs.next"),
            { id: "batch-3", enabled: true, directions: [], action: { type: "builtin", commandId: "scroll.top", commandParams: {} } },
        ];
        expect(() => bindings.registerMany(batch)).toThrow();
        expect(bindings.getById("batch-1")).toBeNull();
        expect(bindings.getById("batch-2")).toBeNull();
        expect(bindings.getById("batch-3")).toBeNull();
    });

    it("批量中重复 ID 失败时不留下前面已注册的部分", () => {
        const bindings = new GestureBindingRegistry();
        const batch: GestureBinding[] = [
            builtin("dup-id", ["L" as Direction], "tabs.previous"),
            builtin("dup-id", ["R" as Direction], "tabs.next"),
        ];
        expect(() => bindings.registerMany(batch)).toThrow();
        expect(bindings.getById("dup-id")).toBeNull();
    });
});
