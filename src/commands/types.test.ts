import { describe, it, expect } from "vitest";
import { buildCommandContext } from "./types";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GesturePoint, InvalidReason } from "@/gesture/types";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";

function makePoints(): GesturePoint[] {
    return [
        { x: 10, y: 20, t: 0 },
        { x: 50, y: 20, t: 16 },
        { x: 100, y: 60, t: 32 },
    ];
}

function makeValidResult(directions: Direction[] = ["R", "D"]): RecognitionResult {
    return {
        valid: true,
        invalidReason: null,
        directions,
        rawDirections: directions,
        segments: [],
        rawPointCount: 3,
        sampledPointCount: 3,
        simplifiedPointCount: 3,
        cancelled: false,
        cancelReason: null,
    };
}

describe("CommandContext — 只读快照", () => {
    it("构建后修改原始 points，不影响 context", () => {
        const points = makePoints();
        const result = makeValidResult();
        const ctx = buildCommandContext(1, points, result, 100);

        points.push({ x: 999, y: 999, t: 999 });
        points[0].x = -1;

        expect(ctx.points.length).toBe(3);
        expect(ctx.points[0]).toEqual({ x: 10, y: 20 });
    });

    it("修改原始 result.directions，不影响 context", () => {
        const points = makePoints();
        const result = makeValidResult(["R", "D"]);
        const ctx = buildCommandContext(1, points, result, 100);

        result.directions.push("L" as Direction);
        result.directions[0] = "U" as Direction;

        expect(ctx.directions).toEqual(["R", "D"]);
    });

    it("修改返回的外部数组不会改变原始识别结果", () => {
        const points = makePoints();
        const result = makeValidResult(["R", "D"]);
        const ctx = buildCommandContext(1, points, result, 100);

        // Mutate the context's directions array — TypeScript marks it
        // readonly, but at runtime we can still try via cast.
        (ctx.directions as Direction[]).push("L");
        (ctx.directions as Direction[])[0] = "U";

        // The original result should be unaffected.
        expect(result.directions).toEqual(["R", "D"]);
    });

    it("start 和 end 与原始对象没有共享引用", () => {
        const points = makePoints();
        const result = makeValidResult();
        const ctx = buildCommandContext(1, points, result, 100);

        expect(ctx.start).toEqual({ x: 10, y: 20 });
        expect(ctx.end).toEqual({ x: 100, y: 60 });
        // Must not be the same object.
        expect(ctx.start).not.toBe(ctx.end);
        // Must not be references into the original points array.
        expect(ctx.start).not.toBe(points[0]);
        expect(ctx.end).not.toBe(points[points.length - 1]);
        // Must not be references into the context's points array either.
        expect(ctx.start).not.toBe(ctx.points[0]);
        expect(ctx.end).not.toBe(ctx.points[ctx.points.length - 1]);
    });

    it("修改 start/end 不影响原始 points", () => {
        const points = makePoints();
        const result = makeValidResult();
        const ctx = buildCommandContext(1, points, result, 100);

        // Mutate via cast (readonly at type level, mutable at runtime).
        (ctx.start as { x: number; y: number }).x = -999;
        (ctx.end as { x: number; y: number }).y = -999;

        expect(points[0].x).toBe(10);
        expect(points[points.length - 1].y).toBe(60);
    });

    it("invalidReason 保持联合类型约束（too-short）", () => {
        const points = makePoints();
        const result: RecognitionResult = {
            valid: false,
            invalidReason: "too-short",
            directions: [],
            rawDirections: [],
            segments: [],
            rawPointCount: 1,
            sampledPointCount: 1,
            simplifiedPointCount: 1,
            cancelled: false,
            cancelReason: null,
        };
        const ctx = buildCommandContext(1, points, result, 100);
        // Type-level check: invalidReason should be InvalidReason | null.
        const reason: InvalidReason | null = ctx.recognition.invalidReason;
        expect(reason).toBe("too-short");
    });

    it("invalidReason 保持联合类型约束（null）", () => {
        const points = makePoints();
        const result = makeValidResult();
        const ctx = buildCommandContext(1, points, result, 100);
        const reason: InvalidReason | null = ctx.recognition.invalidReason;
        expect(reason).toBeNull();
    });

    it("空 points 数组时 start/end 有合理默认值", () => {
        const result = makeValidResult();
        const ctx = buildCommandContext(1, [], result, 0);
        expect(ctx.start).toEqual({ x: 0, y: 0 });
        expect(ctx.end).toEqual({ x: 0, y: 0 });
        expect(ctx.points).toEqual([]);
    });

    it("durationMs 透传", () => {
        const points = makePoints();
        const result = makeValidResult();
        const ctx = buildCommandContext(42, points, result, 1234);
        expect(ctx.sessionId).toBe(42);
        expect(ctx.durationMs).toBe(1234);
    });

    it("recognition 指标透传", () => {
        const points = makePoints();
        const result: RecognitionResult = {
            valid: true,
            invalidReason: null,
            directions: ["R"],
            rawDirections: ["R"],
            segments: [],
            rawPointCount: 10,
            sampledPointCount: 5,
            simplifiedPointCount: 3,
            cancelled: false,
            cancelReason: null,
        };
        const ctx = buildCommandContext(1, points, result, 100);
        expect(ctx.recognition.rawPointCount).toBe(10);
        expect(ctx.recognition.sampledPointCount).toBe(5);
        expect(ctx.recognition.simplifiedPointCount).toBe(3);
        expect(ctx.recognition.valid).toBe(true);
    });
});
