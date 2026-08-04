import { describe, it, expect } from "vitest";
import { GestureSession } from "../GestureSession";
import { DEFAULT_TRIGGER, GestureCancelReason, GesturePoint } from "../types";
import {
    GestureEngine,
    DEFAULT_RECOGNIZER_CONFIG,
    RecognizerConfig,
} from "../GestureEngine";
import { PathSampler } from "./PathSampler";
import { PathSimplifier } from "./PathSimplifier";
import { DirectionVectorizer, DirectionMode } from "./DirectionVectorizer";
import { DirectionMatcher } from "./DirectionMatcher";

// ----------------------------------------------------------- test helpers

/**
 * Generate dense points along a polyline defined by waypoints, simulating
 * real pointermove events (many points per segment).
 */
function buildPath(waypoints: [number, number][], step = 2): GesturePoint[] {
    const points: GesturePoint[] = [];
    let t = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const [x1, y1] = waypoints[i];
        const [x2, y2] = waypoints[i + 1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(len / step));
        for (let s = 0; s <= steps; s++) {
            const f = s / steps;
            points.push({ x: x1 + dx * f, y: y1 + dy * f, t });
            t += 16;
        }
    }
    return points;
}

/** Build a completed gesture session from a set of waypoints. */
function makeCompletedSession(waypoints: [number, number][], step = 2): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    for (const p of buildPath(waypoints, step)) {
        session.addPoint(p.x, p.y, p.t);
    }
    session.activate();
    session.complete();
    return session;
}

/** Build a cancelled gesture session from a set of waypoints. */
function makeCancelledSession(
    waypoints: [number, number][],
    reason: GestureCancelReason = "escape",
    step = 2,
): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    for (const p of buildPath(waypoints, step)) {
        session.addPoint(p.x, p.y, p.t);
    }
    session.activate();
    session.cancel(reason);
    return session;
}

function recognizeWith(waypoints: [number, number][], config?: Partial<RecognizerConfig>): string[] {
    const merged = { ...DEFAULT_RECOGNIZER_CONFIG, ...config };
    const engine = new GestureEngine(merged);
    const session = makeCompletedSession(waypoints);
    return engine.recognize(session).directions;
}

// --------------------------------------------------------------- tests

describe("GestureEngine — full pipeline", () => {
    it("直线：纯右移识别为 [R]", () => {
        expect(recognizeWith([[0, 0], [200, 0]])).toEqual(["R"]);
    });

    it("直线：纯上移识别为 [U]", () => {
        expect(recognizeWith([[0, 200], [0, 0]])).toEqual(["U"]);
    });

    it("直线：纯下移识别为 [D]", () => {
        expect(recognizeWith([[0, 0], [0, 200]])).toEqual(["D"]);
    });

    it("直线：纯左移识别为 [L]", () => {
        expect(recognizeWith([[200, 0], [0, 0]])).toEqual(["L"]);
    });

    it("折线：R-D-L 三段折线", () => {
        expect(
            recognizeWith([[0, 0], [200, 0], [200, 200], [0, 200]]),
        ).toEqual(["R", "D", "L"]);
    });

    it("折线：R-D 复合手势（不限于两方向）", () => {
        expect(
            recognizeWith([[0, 0], [200, 0], [200, 200]]),
        ).toEqual(["R", "D"]);
    });

    it("折线：U-R-D-L 四段折线", () => {
        expect(
            recognizeWith([
                [100, 200],
                [100, 0],
                [300, 0],
                [300, 200],
                [0, 200],
            ]),
        ).toEqual(["U", "R", "D", "L"]);
    });

    it("轻微抖动：小幅上下抖动不产生多余方向", () => {
        // 主要向右，中间有 3px 的上下抖动（远小于 minimumSegmentLength=18）
        expect(
            recognizeWith([
                [0, 0],
                [50, 0],
                [50, 3],
                [100, 3],
                [100, 0],
                [150, 0],
                [150, -3],
                [200, -3],
                [200, 0],
                [250, 0],
            ]),
        ).toEqual(["R"]);
    });

    it("反向：R-L 折返", () => {
        expect(
            recognizeWith([[0, 0], [200, 0], [0, 0]]),
        ).toEqual(["R", "L"]);
    });

    it("反向：U-D 折返", () => {
        expect(
            recognizeWith([[0, 200], [0, 0], [0, 200]]),
        ).toEqual(["U", "D"]);
    });

    it("短轨迹：总长度不足 minimumSegmentLength 时返回空", () => {
        // 仅 10px，低于 minimumSegmentLength=18
        expect(recognizeWith([[0, 0], [10, 0]])).toEqual([]);
    });

    it("取消状态：cancelled 标记为 true 并携带取消原因", () => {
        const engine = new GestureEngine();
        const session = makeCancelledSession([[0, 0], [200, 0], [200, 200]], "escape");
        const result = engine.recognize(session);
        expect(result.cancelled).toBe(true);
        expect(result.cancelReason).toBe("escape");
    });

    it("取消状态：directions 仍然计算但 cancelled 为 true", () => {
        const engine = new GestureEngine();
        const session = makeCancelledSession([[0, 0], [200, 0], [200, 200]], "escape");
        const result = engine.recognize(session);
        expect(result.cancelled).toBe(true);
        // 被取消的手势仍然可以产生方向序列（用于调试）
        expect(result.directions.length).toBeGreaterThan(0);
    });

    it("合并相邻相同方向：连续 R 不产生重复", () => {
        // R → 小拐 → R → 小拐 → R，每次拐弯 < turnAngleThreshold
        expect(
            recognizeWith([
                [0, 0],
                [100, 0],
                [100, 10],
                [200, 10],
                [200, 0],
                [300, 0],
            ]),
        ).toEqual(["R"]);
    });

    it("maximumSegments 截断过长的方向序列", () => {
        // 锯齿形：R-D-R-D-R-D-R-D，8 个方向
        const result = recognizeWith(
            [
                [0, 0], [100, 0], [100, 100],
                [200, 100], [200, 0],
                [300, 0], [300, 100],
                [400, 100], [400, 0],
                [500, 0],
            ],
            { maximumSegments: 3 },
        );
        expect(result.length).toBeLessThanOrEqual(3);
    });

    it("空路径返回空方向", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        session.activate();
        session.complete();
        const engine = new GestureEngine();
        expect(engine.recognize(session).directions).toEqual([]);
    });

    it("单点路径返回空方向", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        session.addPoint(10, 10, 0);
        session.activate();
        session.complete();
        const engine = new GestureEngine();
        expect(engine.recognize(session).directions).toEqual([]);
    });
});

describe("PathSampler", () => {
    it("均匀采样：步长 4px 的水平线", () => {
        const sampler = new PathSampler(4);
        const points = buildPath([[0, 0], [20, 0]], 1);
        const sampled = sampler.sample(points);
        // 起点 0, 然后 4, 8, 12, 16, 20（终点）
        expect(sampled.length).toBeGreaterThanOrEqual(5);
        expect(sampled[0]).toEqual({ x: 0, y: 0 });
        // 最后一个点应接近 20
        const last = sampled[sampled.length - 1];
        expect(last.x).toBeCloseTo(20, 0);
    });

    it("空数组返回空数组", () => {
        expect(new PathSampler(4).sample([])).toEqual([]);
    });

    it("单点返回单点", () => {
        const sampler = new PathSampler(4);
        const result = sampler.sample([{ x: 5, y: 5, t: 0 }]);
        expect(result).toEqual([{ x: 5, y: 5 }]);
    });

    it("保留首尾点", () => {
        const sampler = new PathSampler(10);
        const points = buildPath([[0, 0], [25, 0]], 1);
        const sampled = sampler.sample(points);
        expect(sampled[0]).toEqual({ x: 0, y: 0 });
        expect(sampled[sampled.length - 1].x).toBeCloseTo(25, 0);
    });
});

describe("PathSimplifier", () => {
    it("合并短于 minimumSegmentLength 的线段", () => {
        const simplifier = new PathSimplifier(18);
        // 三段：20, 5, 20 → 中间 5px 段应被合并
        const points = [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 25, y: 0 },
            { x: 45, y: 0 },
        ];
        const result = simplifier.simplify(points);
        // 中间短段应被合并
        expect(result.length).toBeLessThan(points.length);
    });

    it("保留足够长的线段", () => {
        const simplifier = new PathSimplifier(18);
        const points = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
        ];
        const result = simplifier.simplify(points);
        expect(result).toEqual(points);
    });

    it("去除小幅往返抖动", () => {
        const simplifier = new PathSimplifier(18);
        // 右 50 → 下 3 → 右 50 → 上 3 → 右 50（3px 抖动应被消除）
        const points = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 3 },
            { x: 100, y: 3 },
            { x: 100, y: 0 },
            { x: 150, y: 0 },
        ];
        const result = simplifier.simplify(points);
        // 抖动点应被移除
        expect(result.length).toBeLessThan(points.length);
    });
});

describe("DirectionVectorizer", () => {
    it("四方向模式：右、下、左、上", () => {
        const v = new DirectionVectorizer(42, 4 as DirectionMode);
        const points = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            { x: 0, y: 0 },
        ];
        const segs = v.vectorize(points);
        const dirs = segs.map((s) => s.direction);
        expect(dirs).toEqual(["R", "D", "L", "U"]);
    });

    it("八方向模式：支持对角方向", () => {
        const v = new DirectionVectorizer(42, 8 as DirectionMode);
        const points = [
            { x: 0, y: 0 },
            { x: 100, y: 100 }, // 右下 = DR
        ];
        const segs = v.vectorize(points);
        expect(segs[0].direction).toBe("DR");
    });

    it("空路径返回空段", () => {
        const v = new DirectionVectorizer(42, 4 as DirectionMode);
        expect(v.vectorize([])).toEqual([]);
        expect(v.vectorize([{ x: 0, y: 0 }])).toEqual([]);
    });
});

describe("DirectionMatcher", () => {
    it("合并相邻相同方向", () => {
        const matcher = new DirectionMatcher(6);
        const segs = [
            { direction: "R" as const, startX: 0, startY: 0, endX: 50, endY: 0, length: 50, angle: 0 },
            { direction: "R" as const, startX: 50, startY: 0, endX: 100, endY: 0, length: 50, angle: 0 },
            { direction: "D" as const, startX: 100, startY: 0, endX: 100, endY: 50, length: 50, angle: Math.PI / 2 },
        ];
        expect(matcher.match(segs)).toEqual(["R", "D"]);
    });

    it("maximumSegments 截断", () => {
        const matcher = new DirectionMatcher(2);
        const segs = [
            { direction: "R" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "D" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "L" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "U" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
        ];
        expect(matcher.match(segs)).toEqual(["R", "D"]);
    });

    it("equals 严格比较", () => {
        const matcher = new DirectionMatcher(6);
        expect(matcher.equals(["R", "D"], ["R", "D"])).toBe(true);
        expect(matcher.equals(["R", "D"], ["R", "U"])).toBe(false);
        expect(matcher.equals(["R"], ["R", "D"])).toBe(false);
        expect(matcher.equals([], [])).toBe(true);
    });

    it("isEmpty 判断", () => {
        const matcher = new DirectionMatcher(6);
        expect(matcher.isEmpty([])).toBe(true);
        expect(matcher.isEmpty(["R"])).toBe(false);
    });
});
