// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { CommandExecutor } from "@/commands/CommandExecutor";
import { GestureActionExecutor } from "./GestureActionExecutor";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { GestureSession } from "@/gesture/GestureSession";
import { DEFAULT_TRIGGER } from "@/gesture/types";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { CommandContext } from "@/commands/types";
import type { ShortcutSpec } from "@/shortcuts/types";
import { ShortcutExecutor as ShortcutExecutorReal } from "@/shortcuts/ShortcutExecutor";

// --------------------------------------------------------------- helpers

function makeBuiltinBinding(id: string, dirs: Direction[], commandId: string) {
    return {
        id,
        enabled: true,
        directions: dirs,
        action: { type: "builtin" as const, commandId, commandParams: {} },
    };
}

function makeShortcutBinding(id: string, dirs: Direction[], shortcut: ShortcutSpec) {
    return {
        id,
        enabled: true,
        directions: dirs,
        action: { type: "shortcut" as const, shortcut },
    };
}

const CTRL_P: ShortcutSpec = {
    key: "p",
    code: "KeyP",
    keyCode: 80,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
};

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
    const bindingRegistry = new GestureBindingRegistry();
    bindingRegistry.registerMany([
        makeBuiltinBinding("default-L", ["L" as Direction], "tabs.previous"),
        makeBuiltinBinding("default-R", ["R" as Direction], "tabs.next"),
        makeBuiltinBinding("default-U", ["U" as Direction], "scroll.top"),
        makeBuiltinBinding("default-D", ["D" as Direction], "scroll.bottom"),
    ]);
    const executor = new CommandExecutor(commandRegistry);
    const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());
    return { commandRegistry, bindingRegistry, executor, dispatcher };
}

/** Stub ShortcutExecutor for the happy-path dispatch tests. */
class ShortcutExecutorStub extends ShortcutExecutorReal {
    dispatchCount = 0;
    override dispatch(spec: ShortcutSpec) {
        this.dispatchCount++;
        void spec;
        return { status: "dispatched" as const, target: "stub" };
    }
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

// ============================================================ dispatch — builtin happy path
describe("GestureActionExecutor — 内置动作：完成且有效且有绑定时执行一次", () => {
    it("R 方向执行 tabs.next", async () => {
        const { dispatcher } = setupRegistries();
        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed" && dispatchResult.actionType === "builtin") {
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
        if (dispatchResult.status === "executed" && dispatchResult.actionType === "builtin") {
            expect(dispatchResult.commandId).toBe("tabs.previous");
        }
    });
});

// ============================================================ dispatch — shortcut
describe("GestureActionExecutor — 快捷键动作", () => {
    it("快捷键绑定调用 ShortcutExecutor（每手势一次）", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "unused.cmd",
            title: "Unused",
            group: "Test",
            execute: () => ({ status: "executed" as const }),
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeShortcutBinding("sc-R", ["R" as Direction], CTRL_P));
        const executor = new CommandExecutor(commandRegistry);
        const shortcutExecutor = new ShortcutExecutorStub();
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, shortcutExecutor);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.actionType).toBe("shortcut");
            expect(dispatchResult.result.status).toBe("dispatched");
        }
        expect(shortcutExecutor.dispatchCount).toBe(1);
        // 同一 session 二次派发：跨类型去重 → shortcut 不再发送。
        const second = await dispatcher.dispatch(session, result);
        expect(second.status).toBe("skipped");
        expect(shortcutExecutor.dispatchCount).toBe(1);
    });

    it("无效 action（unknown type）不执行", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "unused.cmd",
            title: "Unused",
            group: "Test",
            execute: () => ({ status: "executed" as const }),
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register({
            id: "bad-R",
            enabled: true,
            directions: ["R" as Direction],
            // @ts-expect-error — unknown action type must never execute
            action: { type: "javascript", script: "..." },
        });
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());
        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        // The registry itself cannot know the type is invalid — the
        // action executor must never execute unknown actions.  Dispatch
        // skips silently.
        expect(dispatchResult.status).toBe("skipped");
    });
});

// ============================================================ dispatch — de-duplication
describe("GestureActionExecutor — 同一 session 重复派发最多执行一次", () => {
    it("builtin：第二次 dispatch 同一 session 命令实际只执行一次", async () => {
        let callCount = 0;
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "count.cmd",
            title: "Count",
            group: "Test",
            execute: () => { callCount++; return { status: "executed" as const }; },
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("count-R", ["R" as Direction], "count.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);

        const first = await dispatcher.dispatch(session, result);
        expect(first.status).toBe("executed");

        const second = await dispatcher.dispatch(session, result);
        expect(second.status).toBe("skipped");
        expect(callCount).toBe(1);
    });
});

// ============================================================ dispatch — state guards
describe("GestureActionExecutor — 状态守卫", () => {
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
describe("GestureActionExecutor — 识别结果守卫", () => {
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
describe("GestureActionExecutor — 绑定守卫", () => {
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

// ============================================================ dispatch — sync / async commands
describe("GestureActionExecutor — 同步和异步命令", () => {
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
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("async-R", ["R" as Direction], "async.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

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
describe("GestureActionExecutor — 命令抛错转换为 failed", () => {
    it("同步抛错", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "throw.cmd",
            title: "Throw",
            group: "Test",
            execute: () => { throw new Error("boom"); },
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("throw-R", ["R" as Direction], "throw.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

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
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("reject-R", ["R" as Direction], "reject.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);

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
            await new Promise((r) => setTimeout(r, 10));
            expect(unhandled.length).toBe(0);
        } finally {
            process.off("unhandledRejection", handler);
        }
    });
});

// ============================================================ dispatch — context snapshot
describe("GestureActionExecutor — context 是独立快照", () => {
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
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("capture-R", ["R" as Direction], "capture.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

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
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("capture-R", ["R" as Direction], "capture.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

        const originalPointCount = capturedContext!.points.length;
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
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("capture-R", ["R" as Direction], "capture.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession([{ x: 10, y: 20 }, { x: 110, y: 20 }]);
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);

        expect(capturedContext!.start).toEqual({ x: 10, y: 20 });
        expect(capturedContext!.end).toEqual({ x: 110, y: 20 });
        expect(capturedContext!.start).not.toBe(capturedContext!.end);
        expect(capturedContext!.start).not.toBe(session.points[0]);
        expect(capturedContext!.end).not.toBe(session.points[session.points.length - 1]);
    });
});

// ============================================================ dispatch — strict direction matching
describe("GestureActionExecutor — 严格方向匹配", () => {
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

// ============================================================ dispatch — reset clears history
describe("GestureActionExecutor — reset 清空历史", () => {
    it("reset 后同一 session 可再次执行", async () => {
        let callCount = 0;
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "count.cmd",
            title: "Count",
            group: "Test",
            execute: () => { callCount++; return { status: "executed" as const }; },
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeBuiltinBinding("count-R", ["R" as Direction], "count.cmd"));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorStub());

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        await dispatcher.dispatch(session, result);
        expect(callCount).toBe(1);

        // Both the action dispatcher and the command executor keep their
        // own dedup history — reset both to allow re-execution.
        dispatcher.reset();
        executor.reset();
        await dispatcher.dispatch(session, result);
        expect(callCount).toBe(2);
    });
});

// ============================================================ ShortcutExecutor real dispatch
describe("GestureActionExecutor — 真实 ShortcutExecutor 分发", () => {
    it("快捷键绑定把合成 keydown 派发到 activeElement", async () => {
        const commandRegistry = new CommandRegistry();
        commandRegistry.register({
            id: "unused.cmd",
            title: "Unused",
            group: "Test",
            execute: () => ({ status: "executed" as const }),
        });
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.register(makeShortcutBinding("sc-R", ["R" as Direction], CTRL_P));
        const executor = new CommandExecutor(commandRegistry);
        const dispatcher = new GestureActionExecutor(bindingRegistry, executor, new ShortcutExecutorReal());

        const listener = vi.fn();
        const target = document.createElement("input");
        document.body.appendChild(target);
        target.focus();
        target.addEventListener("keydown", listener);

        const session = makeCompletedSession();
        const result = makeValidResult(["R"]);
        const dispatchResult = await dispatcher.dispatch(session, result);
        expect(dispatchResult.status).toBe("executed");
        if (dispatchResult.status === "executed") {
            expect(dispatchResult.result.status).toBe("dispatched");
        }
        expect(listener).toHaveBeenCalledTimes(1);
        const event = listener.mock.calls[0][0] as KeyboardEvent;
        expect(event.type).toBe("keydown");
        expect(event.bubbles).toBe(true);
        expect(event.cancelable).toBe(true);
        expect(event.key).toBe("p");
        expect(event.code).toBe("KeyP");
        expect(event.keyCode).toBe(80);
        expect(event.which).toBe(80);
        expect(event.ctrlKey).toBe(true);
        expect(event.isTrusted ?? false).toBe(false); // never forged
        target.remove();
    });
});
