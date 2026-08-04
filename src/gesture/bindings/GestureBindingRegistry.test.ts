import { describe, it, expect } from "vitest";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "./defaultBindings";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";

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
