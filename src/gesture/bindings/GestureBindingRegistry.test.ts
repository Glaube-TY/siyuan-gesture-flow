import { describe, it, expect } from "vitest";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "./defaultBindings";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBinding } from "./types";

function setupRegistry(): CommandRegistry {
    const reg = new CommandRegistry();
    reg.registerMany([
        { id: "tabs.previous", title: "cmdTabsPrevious", group: "Tabs", execute: () => ({ status: "executed" }) },
        { id: "tabs.next", title: "cmdTabsNext", group: "Tabs", execute: () => ({ status: "executed" }) },
        { id: "scroll.top", title: "cmdScrollTop", group: "Scrolling", execute: () => ({ status: "executed" }) },
        { id: "scroll.bottom", title: "cmdScrollBottom", group: "Scrolling", execute: () => ({ status: "executed" }) },
    ]);
    return reg;
}

describe("GestureBindingRegistry — 默认绑定", () => {
    it("注册四个默认绑定", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.list().length).toBe(4);
    });

    it("L → tabs.previous", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["L" as Direction]);
        expect(resolved?.command.id).toBe("tabs.previous");
    });

    it("R → tabs.next", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["R" as Direction]);
        expect(resolved?.command.id).toBe("tabs.next");
    });

    it("U → scroll.top", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["U" as Direction]);
        expect(resolved?.command.id).toBe("scroll.top");
    });

    it("D → scroll.bottom", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["D" as Direction]);
        expect(resolved?.command.id).toBe("scroll.bottom");
    });
});

describe("GestureBindingRegistry — 严格方向匹配", () => {
    it("复合方向不误匹配单方向", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        // ["R", "D"] should NOT match ["R"]
        expect(bindings.resolve(["R" as Direction, "D" as Direction])).toBeNull();
    });

    it("单方向不误匹配复合方向", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.register({
            id: "test-rd",
            enabled: true,
            directions: ["R" as Direction, "D" as Direction],
            commandId: "tabs.next",
            commandParams: {},
        });
        // ["R"] should NOT match ["R", "D"]
        expect(bindings.resolve(["R" as Direction])).toBeNull();
    });
});

describe("GestureBindingRegistry — 重复方向拒绝", () => {
    it("重复方向序列抛出错误", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.register({
            id: "test-l",
            enabled: true,
            directions: ["L" as Direction],
            commandId: "tabs.previous",
            commandParams: {},
        });
        expect(() => {
            bindings.register({
                id: "test-l-2",
                enabled: true,
                directions: ["L" as Direction],
                commandId: "tabs.next",
                commandParams: {},
            });
        }).toThrow();
    });
});

describe("GestureBindingRegistry — 空方向拒绝", () => {
    it("空方向抛出错误", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        expect(() => {
            bindings.register({
                id: "test-empty",
                enabled: true,
                directions: [],
                commandId: "tabs.next",
                commandParams: {},
            });
        }).toThrow();
    });
});

describe("GestureBindingRegistry — 不存在的命令拒绝", () => {
    it("引用未注册命令抛出错误", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        expect(() => {
            bindings.register({
                id: "test-missing",
                enabled: true,
                directions: ["L" as Direction],
                commandId: "nonexistent.command",
                commandParams: {},
            });
        }).toThrow();
    });
});

describe("GestureBindingRegistry — disabled 不解析", () => {
    it("disabled 绑定 resolve 返回 null", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        bindings.setEnabled(["L" as Direction], false);
        expect(bindings.resolve(["L" as Direction])).toBeNull();
    });

    it("重新 enable 后可以解析", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        bindings.setEnabled(["L" as Direction], false);
        bindings.setEnabled(["L" as Direction], true);
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });
});

// ============================================================ ID 管理
describe("GestureBindingRegistry — ID 管理", () => {
    it("ID 不得为空", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        expect(() => {
            bindings.register({
                id: "",
                enabled: true,
                directions: ["L" as Direction],
                commandId: "tabs.previous",
                commandParams: {},
            });
        }).toThrow();
    });

    it("ID 去除首尾空格后仍不得为空", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        expect(() => {
            bindings.register({
                id: "   ",
                enabled: true,
                directions: ["L" as Direction],
                commandId: "tabs.previous",
                commandParams: {},
            });
        }).toThrow();
    });

    it("重复 ID 必须拒绝", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.register({
            id: "my-binding",
            enabled: true,
            directions: ["L" as Direction],
            commandId: "tabs.previous",
            commandParams: {},
        });
        expect(() => {
            bindings.register({
                id: "my-binding",
                enabled: true,
                directions: ["R" as Direction],
                commandId: "tabs.next",
                commandParams: {},
            });
        }).toThrow(/Duplicate binding id/);
    });

    it("ID 和方向键分别维护（相同 ID 不同方向仍唯一）", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.register({
            id: "unique-id",
            enabled: true,
            directions: ["L" as Direction],
            commandId: "tabs.previous",
            commandParams: {},
        });
        // Same id with different directions should still fail (duplicate id).
        expect(() => {
            bindings.register({
                id: "unique-id",
                enabled: true,
                directions: ["R" as Direction],
                commandId: "tabs.next",
                commandParams: {},
            });
        }).toThrow(/Duplicate binding id/);
    });

    it("getById 返回绑定", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const binding = bindings.getById("default-L");
        expect(binding).not.toBeNull();
        expect(binding?.commandId).toBe("tabs.previous");
    });

    it("getById 返回不存在的 ID 时返回 null", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.getById("nonexistent")).toBeNull();
    });

    it("setEnabledById 修改启用状态", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.setEnabledById("default-L", false)).toBe(true);
        expect(bindings.resolve(["L" as Direction])).toBeNull();
        expect(bindings.setEnabledById("default-L", true)).toBe(true);
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });

    it("setEnabledById 不存在的 ID 返回 false", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        expect(bindings.setEnabledById("nonexistent", false)).toBe(false);
    });

    it("setEnabled 和 setEnabledById 修改同一记录", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        // Disable via directions.
        bindings.setEnabled(["L" as Direction], false);
        // Verify via id that it's disabled.
        expect(bindings.getById("default-L")?.enabled).toBe(false);
        // Re-enable via id.
        bindings.setEnabledById("default-L", true);
        // Verify via directions that it's enabled.
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });
});

// ============================================================ 不可变性
describe("GestureBindingRegistry — 不可变性", () => {
    it("list 返回的数组修改不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        list.length = 0;
        expect(bindings.list().length).toBe(4);
    });

    it("list 返回的 binding 修改 enabled 不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding) {
            lBinding.enabled = false;
        }
        // Internal state should be unchanged.
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });

    it("list 返回的 binding 修改 directions 不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding) {
            (lBinding.directions as Direction[]).push("R" as Direction);
        }
        // Internal state should be unchanged — L still resolves.
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
        // L-R should not resolve (it was never registered).
        expect(bindings.resolve(["L" as Direction, "R" as Direction])).toBeNull();
    });

    it("list 返回的 binding 修改 commandParams 不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const list = bindings.list();
        const lBinding = list.find((b) => b.id === "default-L");
        if (lBinding) {
            (lBinding.commandParams as Record<string, unknown>).injected = true;
        }
        // Internal commandParams should not have the injected key.
        const internal = bindings.getById("default-L");
        expect(internal?.commandParams).toEqual({});
    });

    it("resolve 返回的 binding 修改不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const resolved = bindings.resolve(["L" as Direction]);
        expect(resolved).not.toBeNull();
        if (resolved) {
            resolved.binding.enabled = false;
            (resolved.binding.directions as Direction[]).push("R" as Direction);
        }
        // Internal state should be unchanged.
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });

    it("getById 返回的 binding 修改不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        bindings.registerMany(DEFAULT_BINDINGS);
        const binding = bindings.getById("default-L");
        expect(binding).not.toBeNull();
        if (binding) {
            binding.enabled = false;
            (binding.directions as Direction[]).push("R" as Direction);
        }
        // Internal state should be unchanged.
        expect(bindings.resolve(["L" as Direction])?.command.id).toBe("tabs.previous");
    });

    it("register 时传入的 binding 修改不影响注册表", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        const input: GestureBinding = {
            id: "input-binding",
            enabled: true,
            directions: ["L" as Direction],
            commandId: "tabs.previous",
            commandParams: { foo: "bar" },
        };
        bindings.register(input);
        // Mutate the input object after registration.
        input.enabled = false;
        (input.directions as Direction[]).push("R" as Direction);
        input.commandParams.foo = "mutated";
        // Internal state should reflect the original values.
        const stored = bindings.getById("input-binding");
        expect(stored?.enabled).toBe(true);
        expect(stored?.directions).toEqual(["L"]);
        expect(stored?.commandParams).toEqual({ foo: "bar" });
    });
});

// ============================================================ registerMany 原子性
describe("GestureBindingRegistry — registerMany 原子性", () => {
    it("批量中某项失败时不留下前面已注册的部分", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        const batch: GestureBinding[] = [
            { id: "batch-1", enabled: true, directions: ["L" as Direction], commandId: "tabs.previous", commandParams: {} },
            { id: "batch-2", enabled: true, directions: ["R" as Direction], commandId: "tabs.next", commandParams: {} },
            // Invalid: empty directions
            { id: "batch-3", enabled: true, directions: [], commandId: "scroll.top", commandParams: {} },
        ];
        expect(() => bindings.registerMany(batch)).toThrow();
        // None of the batch should be registered.
        expect(bindings.getById("batch-1")).toBeNull();
        expect(bindings.getById("batch-2")).toBeNull();
        expect(bindings.getById("batch-3")).toBeNull();
    });

    it("批量中重复 ID 失败时不留下前面已注册的部分", () => {
        const reg = setupRegistry();
        const bindings = new GestureBindingRegistry(reg);
        const batch: GestureBinding[] = [
            { id: "dup-id", enabled: true, directions: ["L" as Direction], commandId: "tabs.previous", commandParams: {} },
            { id: "dup-id", enabled: true, directions: ["R" as Direction], commandId: "tabs.next", commandParams: {} },
        ];
        expect(() => bindings.registerMany(batch)).toThrow();
        expect(bindings.getById("dup-id")).toBeNull();
    });
});
