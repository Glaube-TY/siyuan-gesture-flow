import { describe, it, expect } from "vitest";
import { CommandRegistry } from "./CommandRegistry";
import { CommandDefinition, CommandContext, CommandExecutionResult } from "./types";

function makeCmd(id: string, group = "Test"): CommandDefinition {
    return {
        id,
        title: `cmd-${id}`,
        group,
        execute: () => ({ status: "executed" } as CommandExecutionResult),
    };
}

function makeContext(sessionId = 1): CommandContext {
    return {
        sessionId,
        directions: [],
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
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
}

describe("CommandRegistry — 注册和查询", () => {
    it("register 后可以通过 get 查询", () => {
        const reg = new CommandRegistry();
        const cmd = makeCmd("test.run");
        reg.register(cmd);
        expect(reg.get("test.run")).toBe(cmd);
    });

    it("has 返回是否已注册", () => {
        const reg = new CommandRegistry();
        reg.register(makeCmd("test.run"));
        expect(reg.has("test.run")).toBe(true);
        expect(reg.has("test.missing")).toBe(false);
    });
});

describe("CommandRegistry — 批量注册", () => {
    it("registerMany 注册多个命令", () => {
        const reg = new CommandRegistry();
        reg.registerMany([makeCmd("a.one"), makeCmd("a.two"), makeCmd("b.one")]);
        expect(reg.list().length).toBe(3);
    });

    it("registerMany 原子性：批量中某项失败时不留下前面已注册的部分", () => {
        const reg = new CommandRegistry();
        const batch = [
            makeCmd("a.one"),
            makeCmd("a.two"),
            makeCmd("a.one"), // duplicate id within batch
        ];
        expect(() => reg.registerMany(batch)).toThrow();
        // None of the batch should be registered.
        expect(reg.has("a.one")).toBe(false);
        expect(reg.has("a.two")).toBe(false);
    });

    it("registerMany 原子性：与已注册命令冲突时不影响批量", () => {
        const reg = new CommandRegistry();
        reg.register(makeCmd("existing.cmd"));
        const batch = [
            makeCmd("new.one"),
            makeCmd("existing.cmd"), // conflicts with already-registered
        ];
        expect(() => reg.registerMany(batch)).toThrow();
        // new.one should not be registered (atomic failure).
        expect(reg.has("new.one")).toBe(false);
        expect(reg.has("existing.cmd")).toBe(true);
    });

    it("registerMany 原子性：空 ID 在批量中导致整批失败", () => {
        const reg = new CommandRegistry();
        const batch = [
            makeCmd("valid.one"),
            makeCmd(""), // empty id
        ];
        expect(() => reg.registerMany(batch)).toThrow();
        expect(reg.has("valid.one")).toBe(false);
    });
});

describe("CommandRegistry — 重复 ID", () => {
    it("重复 ID 抛出错误", () => {
        const reg = new CommandRegistry();
        reg.register(makeCmd("test.run"));
        expect(() => reg.register(makeCmd("test.run"))).toThrow();
    });
});

describe("CommandRegistry — 空 ID", () => {
    it("空 ID 抛出错误", () => {
        const reg = new CommandRegistry();
        expect(() => reg.register(makeCmd(""))).toThrow();
    });

    it("空白 ID 抛出错误", () => {
        const reg = new CommandRegistry();
        expect(() => reg.register(makeCmd("   "))).toThrow();
    });
});

describe("CommandRegistry — 分组列表", () => {
    it("listByGroup 返回指定分组的命令", () => {
        const reg = new CommandRegistry();
        reg.registerMany([
            makeCmd("a.one", "GroupA"),
            makeCmd("a.two", "GroupA"),
            makeCmd("b.one", "GroupB"),
        ]);
        expect(reg.listByGroup("GroupA").length).toBe(2);
        expect(reg.listByGroup("GroupB").length).toBe(1);
        expect(reg.listByGroup("GroupC").length).toBe(0);
    });
});

describe("CommandRegistry — 外部修改不影响内部", () => {
    it("list 返回的数组修改不影响内部", () => {
        const reg = new CommandRegistry();
        reg.register(makeCmd("test.run"));
        const list = reg.list();
        list.length = 0;
        expect(reg.list().length).toBe(1);
    });

    it("listByGroup 返回的数组修改不影响内部", () => {
        const reg = new CommandRegistry();
        reg.register(makeCmd("a.one", "GroupA"));
        const list = reg.listByGroup("GroupA");
        list.length = 0;
        expect(reg.listByGroup("GroupA").length).toBe(1);
    });
});

describe("CommandRegistry — 同步和异步命令", () => {
    it("同步 execute 正常调用", () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "sync.cmd",
            title: "Sync",
            group: "Test",
            execute: () => ({ status: "executed" }),
        });
        const cmd = reg.get("sync.cmd")!;
        const result = cmd.execute(makeContext(), {});
        expect(result).toEqual({ status: "executed" });
    });

    it("异步 execute 正常调用", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "async.cmd",
            title: "Async",
            group: "Test",
            execute: async () => {
                await new Promise((r) => setTimeout(r, 10));
                return { status: "executed" };
            },
        });
        const cmd = reg.get("async.cmd")!;
        const result = await cmd.execute(makeContext(), {});
        expect(result).toEqual({ status: "executed" });
    });
});
