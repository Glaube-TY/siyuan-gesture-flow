import { describe, it, expect } from "vitest";
import { CommandRegistry } from "./CommandRegistry";
import { CommandExecutor } from "./CommandExecutor";
import { CommandContext } from "./types";

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

describe("CommandExecutor — 有效命令执行一次", () => {
    it("执行已注册命令返回 executed", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.run",
            title: "Test",
            group: "Test",
            execute: () => ({ status: "executed" }),
        });
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("test.run", makeContext(1));
        expect(result.status).toBe("executed");
    });
});

describe("CommandExecutor — 同一 session 重复不执行", () => {
    it("同一 sessionId 第二次返回 noop", async () => {
        let callCount = 0;
        const reg = new CommandRegistry();
        reg.register({
            id: "test.run",
            title: "Test",
            group: "Test",
            execute: () => { callCount++; return { status: "executed" }; },
        });
        const executor = new CommandExecutor(reg);
        await executor.execute("test.run", makeContext(1));
        const result2 = await executor.execute("test.run", makeContext(1));
        expect(callCount).toBe(1);
        expect(result2.status).toBe("noop");
    });
});

describe("CommandExecutor — 不存在的命令", () => {
    it("返回 unavailable", async () => {
        const reg = new CommandRegistry();
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("missing.cmd", makeContext(1));
        expect(result.status).toBe("unavailable");
    });
});

describe("CommandExecutor — unavailable/noop/failed 正确返回", () => {
    it("命令返回 unavailable 时透传", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.unavail",
            title: "Test",
            group: "Test",
            execute: () => ({ status: "unavailable", reason: "no target" }),
        });
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("test.unavail", makeContext(1));
        expect(result.status).toBe("unavailable");
    });

    it("命令返回 noop 时透传", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.noop",
            title: "Test",
            group: "Test",
            execute: () => ({ status: "noop", reason: "at edge" }),
        });
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("test.noop", makeContext(1));
        expect(result.status).toBe("noop");
    });

    it("命令抛出同步错误时返回 failed", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.throw",
            title: "Test",
            group: "Test",
            execute: () => { throw new Error("boom"); },
        });
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("test.throw", makeContext(1));
        expect(result.status).toBe("failed");
        expect((result as { error?: string }).error).toContain("boom");
    });

    it("异步命令 reject 时返回 failed", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.reject",
            title: "Test",
            group: "Test",
            execute: async () => { throw new Error("async boom"); },
        });
        const executor = new CommandExecutor(reg);
        const result = await executor.execute("test.reject", makeContext(1));
        expect(result.status).toBe("failed");
    });

    it("不出现未处理 Promise rejection", async () => {
        const reg = new CommandRegistry();
        reg.register({
            id: "test.reject2",
            title: "Test",
            group: "Test",
            execute: async () => { throw new Error("unhandled"); },
        });
        const executor = new CommandExecutor(reg);
        // This should not throw an unhandled rejection
        const result = await executor.execute("test.reject2", makeContext(1));
        expect(result.status).toBe("failed");
    });
});

describe("CommandExecutor — reset", () => {
    it("reset 后同一 sessionId 可再次执行", async () => {
        let callCount = 0;
        const reg = new CommandRegistry();
        reg.register({
            id: "test.run",
            title: "Test",
            group: "Test",
            execute: () => { callCount++; return { status: "executed" }; },
        });
        const executor = new CommandExecutor(reg);
        await executor.execute("test.run", makeContext(1));
        executor.reset();
        const result = await executor.execute("test.run", makeContext(1));
        expect(callCount).toBe(2);
        expect(result.status).toBe("executed");
    });
});
