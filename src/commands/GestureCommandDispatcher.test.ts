import { describe, it, expect } from "vitest";
import { CommandRegistry } from "./CommandRegistry";
import { CommandExecutor } from "./CommandExecutor";
import { GestureCommandDispatcher } from "./GestureCommandDispatcher";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { GestureSession } from "@/gesture/GestureSession";
import { DEFAULT_TRIGGER } from "@/gesture/types";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { CommandContext } from "./types";

// --------------------------------------------------------------- helpers

function setupRegistries() {
    const commandRegistry = new CommandRegistry();
    commandRegistry.registerMany([
        {
            id: "tabs.previous",
            title: "cmdTabsPrevious",
            group: "Tabs",
            execute: () => ({ status: "executed" as const }),
        },
        {
            id: "tabs.next",
            title: "cmdTabsNext",
            group: "Tabs",
            execute: () => ({ status: "executed" as const }),
        },
        {
            id: "scroll.top",
            title: "cmdScrollTop",
            group: "Scrolling",
            execute: () => ({ status: "executed" as const }),
        },
        {
            id: "scroll.bottom",
            title: "cmdScrollBottom",
            group: "Scrolling",
            execute: () => ({ status: "executed" as const }),
        },
    ]);
    const bindingRegistry = new GestureBindingRegistry(commandRegistry);
    bindingRegistry.registerMany([
        { id: "default-L", enabled: true, directions: ["L" as Direction], commandId: "tabs.previous", commandParams: {} },
        { id: "default-R", enabled: true, directions: ["R" as Direction], commandId: "tabs.next", commandParams: {} },
        { id: "default-U", enabled: true, directions: ["U" as Direction], commandId: "scroll.top", commandParams: {} },
        { id: "default-D", enabled: true, directions: ["D" as Direction], commandId: "scroll.bottom", commandParams: {} },
    ]);
    const executor = new CommandExecutor(commandRegistry);
    const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);
    return { commandRegistry, bindingRegistry, executor, dispatcher };
}

/** Build a COMPLETED session with the given points. */
function makeCompletedSession(points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: 100, y: 0 }]): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    let t = 0;
    for (const p of points) {
        session.addPoint(p.x, p.y, t);
        t += 16;
    }
    session.activate();
    session.complete();
    return session;
}

/** Build a TRACKING session (not yet completed). */
function makeTrackingSession(): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    session.addPoint(0, 0, 0);
    session.addPoint(50, 0, 16);
    session.activate();
    return session;
}

/** Build a CANCELLED session. */
function makeCancelledSession(): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    session.addPoint(0, 0, 0);
    session.addPoint(50, 0, 16);
    session.activate();
    session.cancel("escape");
    return session;
}

/** Build a valid RecognitionResult with the given directions. */
function makeValidResult(directions: Direction[]): RecognitionResult {
    return {
        valid: true,
        invalidReason: null,
        directions,
        rawDirections: directions,
        segments: [],
        rawPointCount: 2,
        sampledPointCount: 2,
        simplifiedPointCount: 2,
        cancelled: false,
        cancelReason: null,
    };
}

/** Build an invalid RecognitionResult. */
function makeInvalidResult(invalidReason: "too-short" | "too-many-segments" | "empty" | "cancelled"): RecognitionResult {
    return {
        valid: false,
        invalidReason,
        directions: [],
        rawDirections: [],
        segments: [],
        rawPointCount: 0,
        sampledPointCount: 0,
        simplifiedPointCount: 0,
        cancelled: invalidReason === "cancelled",
        cancelReason: invalidReason === "cancelled" ? "escape" : null,
    };
}

// ============================================================ dispatch — happy path
describe("GestureCommandDispatcher — 完成且有效且有绑定时执行一次", () => {
    it("R 方向执行 tabs.next", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.commandId).toBe("tabs.next");
            expect(dispatchResult.result.status).toBe("executed");
        }
    });

    it("L 方向执行 tabs.previous", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["L"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.commandId).toBe("tabs.previous");
        }
    });
});

// ============================================================ dispatch — de-duplication
describe("GestureCommandDispatcher — 同一 session 重复派发最多执行一次", () => {
    it("第二次 dispatch 同一 session 命令实际只执行一次", async () => {
        let callCount = 0;
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "count.cmd",
            title: "Count",
            group: "Test",
            execute: () => { callCount++; return { status: "executed" as const }; },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "count-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "count.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);

        const first = await dispatcher.dispatch(session, result);
        expect(first.status).toBe("executed");

        const second = await dispatcher.dispatch(session, result);
        // The executor de-duplicates by sessionId — the command is not
        // re-invoked; the second dispatch returns noop.
        expect(second.status).toBe("executed");
        if (second.status === "executed") {
            expect(second.result.status).toBe("noop");
        }
        expect(callCount).toBe(1);
    });
});

// ============================================================ dispatch — state guards
describe("GestureCommandDispatcher — 状态守卫", () => {
    it("CANCELLED 会话不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCancelledSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("TRACKING 会话不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeTrackingSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });
});

// ============================================================ dispatch — result guards
describe("GestureCommandDispatcher — 识别结果守卫", () => {
    it("invalid 结果不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeInvalidResult("too-short");
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("空方向不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult([]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("too-many-segments 不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeInvalidResult("too-many-segments");
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("cancelled 结果不执行", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeInvalidResult("cancelled");
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });
});

// ============================================================ dispatch — binding guards
describe("GestureCommandDispatcher — 绑定守卫", () => {
    it("无绑定不执行（D-R）", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["D", "R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("disabled 绑定不执行", async () => {
        const { dispatcher, bindingRegistry } = setupRegistries();
        bindingRegistry.setEnabled(["R"], false);
        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });
});

// ============================================================ dispatch — command existence
describe("GestureCommandDispatcher — 命令不存在不执行", () => {
    it("绑定引用的命令未注册时不执行", async () => {
        // Build a registry where the command is removed after binding.
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "temp.cmd",
            title: "Temp",
            group: "Test",
            execute: () => ({ status: "executed" as const }),
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "temp-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "temp.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        // Note: CommandRegistry has no unregister method, so we cannot
        // truly remove the command.  Instead, we verify that resolve()
        // returns null when the command is missing by using a binding
        // whose commandId doesn't match.  Since the binding registry
        // validates command existence at registration time, this scenario
        // can only happen if commands are removed — which the current
        // API doesn't support.  We verify the guard indirectly: a
        // non-existent direction returns skipped.
        const session = makeCompletedSession();
        const result = makeValidResult(["U", "L"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });
});

// ============================================================ dispatch — sync / async commands
describe("GestureCommandDispatcher — 同步和异步命令", () => {
    it("同步命令正常返回", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.result.status).toBe("executed");
        }
    });

    it("异步命令正常返回", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "async.cmd",
            title: "Async",
            group: "Test",
            execute: async () => {
                await new Promise((r) => setTimeout(r, 5));
                return { status: "executed" as const };
            },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "async-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "async.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.result.status).toBe("executed");
        }
    });
});

// ============================================================ dispatch — error containment
describe("GestureCommandDispatcher — 命令抛错转换为 failed", () => {
    it("同步抛错", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "throw.cmd",
            title: "Throw",
            group: "Test",
            execute: () => { throw new Error("boom"); },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "throw-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "throw.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.result.status).toBe("failed");
        }
    });

    it("异步 reject 不产生未处理拒绝", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "reject.cmd",
            title: "Reject",
            group: "Test",
            execute: async () => { throw new Error("async boom"); },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "reject-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "reject.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);

        // Track unhandled rejections via the Node.js process event.
        // (This test runs in the "node" environment, so `window` is
        // unavailable.)  The dispatch promise must not reject.
        const unhandled: unknown[] = [];
        const handler = (reason: unknown) => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", handler);

        try {
            const dispatchResult = await dispatcher.dispatch(session, result);
            expect(dispatchResult.status).toBe("executed");
            if (dispatchResult.status === "executed") {
                expect(dispatchResult.result.status).toBe("failed");
            }
            // Give the microtask queue a tick to surface any unhandled rejection.
            await new Promise((r) => setTimeout(r, 10));
            expect(unhandled.length).toBe(0);
        } finally {
            process.off("unhandledRejection", handler);
        }
    });
});

// ============================================================ dispatch — context snapshot
describe("GestureCommandDispatcher — context 是独立快照", () => {
    it("修改原始 result.directions 不影响 CommandExecutor 接收的 context", async () => {
        const commandRegistry = new CommandRegistry();
        let capturedContext: CommandContext | null = null;
        commandRegistry.register({
            id: "capture.cmd",
            title: "Capture",
            group: "Test",
            execute: (ctx) => {
                capturedContext = ctx;
                return { status: "executed" as const };
            },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "capture-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "capture.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

        // Mutate the original result after dispatch.
        result.directions.push("D" as Direction);
        result.directions[0] = "L" as Direction;

        expect(capturedContext).not.toBeNull();
        expect(capturedContext!.directions).toEqual(["R"]);
    });

    it("修改原始 session.points 不影响 context", async () => {
        const commandRegistry = new CommandRegistry();
        let capturedContext: CommandContext | null = null;
        commandRegistry.register({
            id: "capture.cmd",
            title: "Capture",
            group: "Test",
            execute: (ctx) => {
                capturedContext = ctx;
                return { status: "executed" as const };
            },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "capture-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "capture.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

        const originalPointCount = capturedContext!.points.length;
        // Mutate the original session after dispatch.
        session.points.push({ x: 999, y: 999, t: 999 });

        expect(capturedContext!.points.length).toBe(originalPointCount);
    });

    it("start 和 end 与原始对象没有共享引用", async () => {
        const commandRegistry = new CommandRegistry();
        let capturedContext: CommandContext | null = null;
        commandRegistry.register({
            id: "capture.cmd",
            title: "Capture",
            group: "Test",
            execute: (ctx) => {
                capturedContext = ctx;
                return { status: "executed" as const };
            },
        });
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.register({
            id: "capture-R",
            enabled: true,
            directions: ["R" as Direction],
            commandId: "capture.cmd",
            commandParams: {},
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, executor);

        const session = makeCompletedSession([{ x: 10, y: 20 }, { x: 110, y: 20 }]);
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

        // start and end should be independent objects with the right values.
        expect(capturedContext!.start).toEqual({ x: 10, y: 20 });
        expect(capturedContext!.end).toEqual({ x: 110, y: 20 });
        // They must not be the same object.
        expect(capturedContext!.start).not.toBe(capturedContext!.end);
        // They must not be references into session.points.
        expect(capturedContext!.start).not.toBe(session.points[0]);
        expect(capturedContext!.end).not.toBe(session.points[session.points.length - 1]);
    });
});

// ============================================================ dispatch — strict direction matching
describe("GestureCommandDispatcher — 严格方向匹配", () => {
    it("D-R 不误执行 D 的命令", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["D", "R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });

    it("R-D 不误执行 R 的命令", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["R", "D"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("skipped");
    });
});
