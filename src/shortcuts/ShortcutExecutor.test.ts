// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShortcutExecutor } from "./ShortcutExecutor";
import type { ShortcutSpec } from "./types";

const CTRL_P: ShortcutSpec = {
    key: "p",
    code: "KeyP",
    keyCode: 80,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
};

const ALT_LEFT: ShortcutSpec = {
    key: "ArrowLeft",
    code: "ArrowLeft",
    keyCode: 37,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    metaKey: false,
};

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("ShortcutExecutor — 分发目标", () => {
    it("从 activeElement 分发", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        expect(document.activeElement).toBe(input);

        const listener = vi.fn();
        input.addEventListener("keydown", listener);
        const result = executor.dispatch(CTRL_P);
        expect(result.status).toBe("dispatched");
        expect(listener).toHaveBeenCalledTimes(1);
        input.remove();
    });

    it("无 activeElement 时回退到 document", () => {
        const executor = new ShortcutExecutor();
        // Force activeElement to be unusable: happy-dom's activeElement
        // is document.body by default — blur it to null.
        (document.activeElement as HTMLElement | null)?.blur?.();

        const docListener = vi.fn();
        document.addEventListener("keydown", docListener);
        const result = executor.dispatch(CTRL_P);
        expect(result.status).toBe("dispatched");
        // The event bubbles to document even when dispatched on body.
        expect(docListener).toHaveBeenCalledTimes(1);
        document.removeEventListener("keydown", docListener);
    });
});

describe("ShortcutExecutor — 事件字段", () => {
    it("keydown 事件 bubbles / cancelable / 字段正确", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();

        let captured: KeyboardEvent | null = null;
        input.addEventListener("keydown", (e) => {
            captured = e as KeyboardEvent;
        });
        executor.dispatch(ALT_LEFT);

        expect(captured).not.toBeNull();
        expect(captured!.type).toBe("keydown");
        expect(captured!.bubbles).toBe(true);
        expect(captured!.cancelable).toBe(true);
        expect(captured!.key).toBe("ArrowLeft");
        expect(captured!.code).toBe("ArrowLeft");
        expect(captured!.keyCode).toBe(37);
        expect(captured!.which).toBe(37);
        expect(captured!.altKey).toBe(true);
        expect(captured!.ctrlKey).toBe(false);
        expect(captured!.shiftKey).toBe(false);
        expect(captured!.metaKey).toBe(false);
        expect(captured!.isTrusted ?? false).toBe(false); // never forged
        input.remove();
    });

    it("Shift 字母事件 key 用显示形式（大写）", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        let captured: KeyboardEvent | null = null;
        input.addEventListener("keydown", (e) => {
            captured = e as KeyboardEvent;
        });
        executor.dispatch({ ...CTRL_P, shiftKey: true });
        expect(captured!.key).toBe("P");
        expect(captured!.shiftKey).toBe(true);
        expect(captured!.keyCode).toBe(80);
        input.remove();
    });
});

describe("ShortcutExecutor — 一次 dispatch 只发一个 keydown", () => {
    it("每次调用只发送一次 keydown，不发 click", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();

        const keydowns = vi.fn();
        const clicks = vi.fn();
        input.addEventListener("keydown", keydowns);
        input.addEventListener("click", clicks);

        executor.dispatch(CTRL_P);
        executor.dispatch(CTRL_P); // 用户连续点击测试按钮 → 按次数执行

        expect(keydowns).toHaveBeenCalledTimes(2);
        expect(clicks).not.toHaveBeenCalled();
        input.remove();
    });

    it("不发送 keyup", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const keyups = vi.fn();
        input.addEventListener("keyup", keyups);
        executor.dispatch(CTRL_P);
        expect(keyups).not.toHaveBeenCalled();
        input.remove();
    });
});

describe("ShortcutExecutor — 全局无副作用", () => {
    it("不修改 KeyboardEvent.prototype 的 keyCode/which", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();

        const before = Object.getOwnPropertyDescriptor(KeyboardEvent.prototype, "keyCode");
        executor.dispatch(CTRL_P);
        const after = Object.getOwnPropertyDescriptor(KeyboardEvent.prototype, "keyCode");
        expect(after).toEqual(before);
        input.remove();
    });

    it("事件只在实例上补齐 keyCode（原型不被污染）", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        executor.dispatch(CTRL_P);
        input.remove();

        // A fresh, unrelated KeyboardEvent must NOT carry our injected
        // keyCode (80) — it keeps the platform default (0).
        const fresh = new KeyboardEvent("keydown", { key: "p", code: "KeyP" });
        expect(fresh.keyCode).not.toBe(80);
    });
});

describe("ShortcutExecutor — 错误处理", () => {
    it("dispatch 异常转换为 failed，不向外抛", () => {
        const executor = new ShortcutExecutor();
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        // A listener that throws makes dispatchEvent throw → the
        // executor converts it to a `failed` result, never rethrowing.
        input.addEventListener("keydown", () => {
            throw new Error("listener boom");
        });
        const result = executor.dispatch(CTRL_P);
        expect(result.status).toBe("failed");
        if (result.status === "failed") {
            expect(result.error).toContain("listener boom");
        }
        input.remove();
    });

    it("构造异常（非法 spec）不抛到调用方", () => {
        const executor = new ShortcutExecutor();
        const result = executor.dispatch({
            key: "p",
            code: "KeyP",
            keyCode: Number.NaN,
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        });
        expect(result.status).toBe("dispatched"); // 数值无效但构造不抛
    });
});
