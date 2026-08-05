import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseNumber, DebouncedPatchScheduler } from "./settingsHelpers";
import type { GestureFlowConfig } from "@/config/types";

// --------------------------------------------------------------- parseNumber

describe("parseNumber — 有效输入", () => {
    it("整数范围内的合法值原样返回", () => {
        expect(parseNumber("16", 4, 100, true)).toBe(16);
    });

    it("浮点范围内的合法值原样返回", () => {
        expect(parseNumber("2.8", 0, 50, false)).toBe(2.8);
    });

    it("带空白的字符串会被 trim", () => {
        expect(parseNumber("  42  ", 1, 100, true)).toBe(42);
    });
});

describe("parseNumber — 边界钳制", () => {
    it("低于最小值时钳制为 min", () => {
        expect(parseNumber("1", 4, 100, true)).toBe(4);
    });

    it("高于最大值时钳制为 max", () => {
        expect(parseNumber("9999", 4, 100, true)).toBe(100);
    });

    it("恰好等于 min 时原样返回", () => {
        expect(parseNumber("4", 4, 100, true)).toBe(4);
    });

    it("恰好等于 max 时原样返回", () => {
        expect(parseNumber("100", 4, 100, true)).toBe(100);
    });
});

describe("parseNumber — 非法输入返回 null", () => {
    it("空字符串返回 null", () => {
        expect(parseNumber("", 4, 100, true)).toBeNull();
    });

    it("纯空白返回 null", () => {
        expect(parseNumber("   ", 4, 100, true)).toBeNull();
    });

    it("非数字字符串返回 null", () => {
        expect(parseNumber("abc", 4, 100, true)).toBeNull();
    });

    it("NaN 返回 null", () => {
        expect(parseNumber("NaN", 4, 100, true)).toBeNull();
    });

    it("Infinity 返回 null", () => {
        expect(parseNumber("Infinity", 4, 100, true)).toBeNull();
    });

    it("isInt=true 时浮点数返回 null", () => {
        expect(parseNumber("1.5", 4, 100, true)).toBeNull();
    });

    it("isInt=true 时 1.0 仍为合法整数", () => {
        expect(parseNumber("1.0", 0, 100, true)).toBe(1);
    });
});

// --------------------------------------------------------------- DebouncedPatchScheduler

describe("DebouncedPatchScheduler — 基本行为", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("初始状态无待处理 patch", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save);
        expect(s.hasPending).toBe(false);
        expect(s.isScheduled).toBe(false);
    });

    it("schedule 后 hasPending 为 true", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save);
        s.schedule({ enabled: false });
        expect(s.hasPending).toBe(true);
        expect(s.isScheduled).toBe(true);
    });

    it("延迟期内不调用 save", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        vi.advanceTimersByTime(399);
        expect(save).not.toHaveBeenCalled();
    });

    it("延迟到期后调用 save 一次", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        vi.advanceTimersByTime(400);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith({ enabled: false });
    });

    it("flush 后无待处理", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        void s.flush();
        expect(s.hasPending).toBe(false);
    });
});

describe("DebouncedPatchScheduler — 合并提交", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("快速连续 schedule 只合并为一次 save", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        s.schedule({ trigger: { activationDistance: 30 } });
        s.schedule({ overlay: { showTrail: false } });
        vi.advanceTimersByTime(400);
        expect(save).toHaveBeenCalledTimes(1);
        const patch = save.mock.calls[0][0];
        expect(patch.enabled).toBe(false);
        expect(patch.trigger?.activationDistance).toBe(30);
        expect(patch.overlay?.showTrail).toBe(false);
    });

    it("合并时同节段的字段不会互相覆盖", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ trigger: { activationDistance: 30 } });
        s.schedule({ trigger: { timeoutMs: 5000 } });
        vi.advanceTimersByTime(400);
        expect(save).toHaveBeenCalledTimes(1);
        const patch = save.mock.calls[0][0];
        expect(patch.trigger?.activationDistance).toBe(30);
        expect(patch.trigger?.timeoutMs).toBe(5000);
    });

    it("bindings 被整体替换", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        const bindings1 = [{ id: "a", enabled: false }] as unknown as GestureFlowConfig["bindings"];
        const bindings2 = [{ id: "b", enabled: true }] as unknown as GestureFlowConfig["bindings"];
        s.schedule({ bindings: bindings1 });
        s.schedule({ bindings: bindings2 });
        vi.advanceTimersByTime(400);
        const patch = save.mock.calls[0][0];
        expect(patch.bindings).toBe(bindings2);
    });
});

describe("DebouncedPatchScheduler — destroy", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("destroy 后不再调用 save", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        s.destroy();
        vi.advanceTimersByTime(1000);
        expect(save).not.toHaveBeenCalled();
    });

    it("destroy 后 schedule 无效", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.destroy();
        s.schedule({ enabled: false });
        vi.advanceTimersByTime(1000);
        expect(save).not.toHaveBeenCalled();
    });

    it("destroy 后 flush 无效", async () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        s.destroy();
        await s.flush();
        expect(save).not.toHaveBeenCalled();
    });

    it("destroy 取消待处理计时器", () => {
        const save = vi.fn();
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        expect(s.isScheduled).toBe(true);
        s.destroy();
        expect(s.isScheduled).toBe(false);
    });
});

describe("DebouncedPatchScheduler — flush", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("flush 在延迟到期前立即提交", () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        void s.flush();
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("flush 后计时器取消", () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        void s.flush();
        expect(s.isScheduled).toBe(false);
    });

    it("无待处理时 flush 不调用 save", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const s = new DebouncedPatchScheduler(save, 400);
        await s.flush();
        expect(save).not.toHaveBeenCalled();
    });

    it("flush 后再次 schedule 正常工作", () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const s = new DebouncedPatchScheduler(save, 400);
        s.schedule({ enabled: false });
        void s.flush();
        s.schedule({ enabled: true });
        vi.advanceTimersByTime(400);
        expect(save).toHaveBeenCalledTimes(2);
        expect(save.mock.calls[1][0]).toEqual({ enabled: true });
    });
});
