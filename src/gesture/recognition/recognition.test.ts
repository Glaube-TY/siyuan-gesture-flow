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

/**
 * Generate a smooth quarter-circle arc tangent to both the incoming and
 * outgoing straight segments.  The arc is inscribed in the corner at distance
 * `radius` from each segment.  `arcPoints` controls how many samples the arc
 * itself receives (higher = smoother).
 */
function buildSmoothTurnPath(
    start: [number, number],
    corner: [number, number],
    end: [number, number],
    arcPoints: number,
    radius: number,
    step = 2,
): GesturePoint[] {
    const points: GesturePoint[] = [];
    let t = 0;

    const [sx, sy] = start;
    const [cx, cy] = corner;
    const [ex, ey] = end;

    // Unit direction from corner toward start (reverse of incoming travel)
    const dxIn = sx - cx;
    const dyIn = sy - cy;
    const lenIn = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
    const dInX = dxIn / lenIn;
    const dInY = dyIn / lenIn;

    // Unit direction from corner toward end (outgoing travel)
    const dxOut = ex - cx;
    const dyOut = ey - cy;
    const lenOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut);
    const dOutX = dxOut / lenOut;
    const dOutY = dyOut / lenOut;

    // Arc entry / exit points (at distance `radius` from corner along each leg)
    const entryX = cx + dInX * radius;
    const entryY = cy + dInY * radius;
    const exitX = cx + dOutX * radius;
    const exitY = cy + dOutY * radius;

    // Arc centre — inscribed inside the corner, at distance `radius` from both legs
    const centerX = cx + (dInX + dOutX) * radius;
    const centerY = cy + (dInY + dOutY) * radius;

    // Helper to push interpolated points along a line
    const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(len / step));
        for (let s = 0; s <= steps; s++) {
            const f = s / steps;
            points.push({ x: x1 + dx * f, y: y1 + dy * f, t });
            t += 16;
        }
    };

    // Straight segment: start → arc entry
    pushLine(sx, sy, entryX, entryY);

    // Arc from entry to exit around the inscribed centre
    const startAngle = Math.atan2(entryY - centerY, entryX - centerX);
    const endAngle = Math.atan2(exitY - centerY, exitX - centerX);

    // Shortest arc
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    for (let i = 1; i < arcPoints; i++) {
        const f = i / arcPoints;
        const angle = startAngle + delta * f;
        points.push({
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
            t,
        });
        t += 16;
    }

    // Straight segment: arc exit → end
    pushLine(exitX, exitY, ex, ey);
    return points;
}

/** Build a completed session with a smooth turn. */
function makeSmoothTurnSession(
    start: [number, number],
    corner: [number, number],
    end: [number, number],
    arcPoints: number,
    radius: number,
    step = 2,
): GestureSession {
    const session = new GestureSession(DEFAULT_TRIGGER);
    for (const p of buildSmoothTurnPath(start, corner, end, arcPoints, radius, step)) {
        session.addPoint(p.x, p.y, p.t);
    }
    session.activate();
    session.complete();
    return session;
}

/**
 * Add small random-ish jitter (±amplitude px) to a path, simulating hand
 * tremor during mouse movement.
 */
function addJitter(points: GesturePoint[], amplitude: number, seed = 42): GesturePoint[] {
    let s = seed;
    const rng = () => {
        s = (s * 9301 + 49297) % 233280;
        return (s / 233280) * 2 - 1; // [-1, 1)
    };
    return points.map((p) => ({
        x: p.x + rng() * amplitude,
        y: p.y + rng() * amplitude,
        t: p.t,
    }));
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
        const result = recognizeWith([[0, 0], [10, 0]]);
        expect(result).toEqual([]);
    });

    it("取消状态：cancelled 标记为 true 并携带取消原因", () => {
        const engine = new GestureEngine();
        const session = makeCancelledSession([[0, 0], [200, 0], [200, 200]], "escape");
        const result = engine.recognize(session);
        expect(result.cancelled).toBe(true);
        expect(result.cancelReason).toBe("escape");
    });

    it("取消状态：valid 为 false, invalidReason 为 cancelled, directions 为空", () => {
        const engine = new GestureEngine();
        const session = makeCancelledSession([[0, 0], [200, 0], [200, 200]], "escape");
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("cancelled");
        expect(result.directions).toEqual([]);
        // rawDirections 仍然计算用于调试
        expect(result.rawDirections.length).toBeGreaterThan(0);
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

    it("maximumSegments: 超过最大段数时手势无效", () => {
        // 锯齿形：R-D-R-D-R-D-R-D，8 个方向
        const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, maximumSegments: 3 });
        const session = makeCompletedSession([
            [0, 0], [100, 0], [100, 100],
            [200, 100], [200, 0],
            [300, 0], [300, 100],
            [400, 100], [400, 0],
            [500, 0],
        ]);
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("too-many-segments");
        expect(result.directions).toEqual([]);
        // rawDirections 保留完整序列
        expect(result.rawDirections.length).toBeGreaterThan(3);
    });

    it("空路径返回空方向", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        session.activate();
        session.complete();
        const engine = new GestureEngine();
        const result = engine.recognize(session);
        expect(result.directions).toEqual([]);
        expect(result.valid).toBe(false);
    });

    it("单点路径返回空方向", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        session.addPoint(10, 10, 0);
        session.activate();
        session.complete();
        const engine = new GestureEngine();
        const result = engine.recognize(session);
        expect(result.directions).toEqual([]);
        expect(result.valid).toBe(false);
    });
});

// ----------------------------------------------------------- smooth turns

describe("GestureEngine — 平滑圆角转弯识别", () => {
    // 四种基本圆角转弯组合
    const turnCases: Array<{
        name: string;
        start: [number, number];
        corner: [number, number];
        end: [number, number];
        expected: string[];
    }> = [
        { name: "R→D", start: [0, 100], corner: [200, 100], end: [200, 300], expected: ["R", "D"] },
        { name: "R→U", start: [0, 300], corner: [200, 300], end: [200, 100], expected: ["R", "U"] },
        { name: "L→D", start: [400, 100], corner: [200, 100], end: [200, 300], expected: ["L", "D"] },
        { name: "L→U", start: [400, 300], corner: [200, 300], end: [200, 100], expected: ["L", "U"] },
    ];

    // 不同圆弧采样密度
    const arcPointCounts = [10, 20, 45, 90];
    // 不同圆角半径
    const radii = [30, 60, 100];

    for (const tc of turnCases) {
        for (const arcPoints of arcPointCounts) {
            for (const radius of radii) {
                it(`${tc.name}: ${arcPoints}点圆弧, 半径${radius}px → [${tc.expected.join(", ")}]`, () => {
                    const engine = new GestureEngine();
                    const session = makeSmoothTurnSession(
                        tc.start, tc.corner, tc.end, arcPoints, radius,
                    );
                    const result = engine.recognize(session);
                    expect(result.valid).toBe(true);
                    expect(result.directions).toEqual(tc.expected);
                });
            }
        }
    }

    it("不同鼠标速度（不同原始点密度）下圆角转弯仍正确", () => {
        // step=1（高密度，模拟慢速鼠标）和 step=5（低密度，模拟快速鼠标）
        for (const step of [1, 5]) {
            const engine = new GestureEngine();
            const session = makeSmoothTurnSession(
                [0, 100], [200, 100], [200, 300], 45, 60, step,
            );
            const result = engine.recognize(session);
            expect(result.valid).toBe(true);
            expect(result.directions).toEqual(["R", "D"]);
        }
    });

    it("2～5px 小幅抖动下圆角转弯仍正确", () => {
        for (const amplitude of [2, 3, 5]) {
            const engine = new GestureEngine();
            const session = new GestureSession(DEFAULT_TRIGGER);
            const path = buildSmoothTurnPath([0, 100], [200, 100], [200, 300], 45, 60);
            for (const p of addJitter(path, amplitude)) {
                session.addPoint(p.x, p.y, p.t);
            }
            session.activate();
            session.complete();
            const result = engine.recognize(session);
            expect(result.valid).toBe(true);
            expect(result.directions).toEqual(["R", "D"]);
        }
    });

    it("轻微越过方向边界（45°附近的圆弧）仍识别为两段", () => {
        // 圆弧从 R 到 D，但弧度刚好覆盖 90°转弯
        const engine = new GestureEngine();
        const session = makeSmoothTurnSession(
            [0, 200], [200, 200], [200, 400], 60, 80,
        );
        const result = engine.recognize(session);
        expect(result.valid).toBe(true);
        expect(result.directions).toEqual(["R", "D"]);
    });

    it("原有直线、尖锐折线、反向折返、短轨迹测试继续通过", () => {
        // 尖锐折线 R-D
        expect(recognizeWith([[0, 0], [200, 0], [200, 200]])).toEqual(["R", "D"]);
        // 反向折返 R-L
        expect(recognizeWith([[0, 0], [200, 0], [0, 0]])).toEqual(["R", "L"]);
        // 直线
        expect(recognizeWith([[0, 0], [200, 0]])).toEqual(["R"]);
        // 短轨迹
        expect(recognizeWith([[0, 0], [10, 0]])).toEqual([]);
    });
});

describe("PathSampler", () => {
    it("均匀采样：步长 4px 的水平线", () => {
        const sampler = new PathSampler(4);
        const points = buildPath([[0, 0], [20, 0]], 1);
        const sampled = sampler.sample(points);
        expect(sampled.length).toBeGreaterThanOrEqual(5);
        expect(sampled[0]).toEqual({ x: 0, y: 0 });
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
    it("RDP 简化：密集采样折线保留拐点", () => {
        const simplifier = new PathSimplifier(2.8, 18);
        // 密集采样的 R-D 折线
        const points = buildPath([[0, 0], [100, 0], [100, 100]], 1)
            .map((p) => ({ x: p.x, y: p.y }));
        const result = simplifier.simplify(points);
        // 应保留拐点 (100, 0)
        expect(result.length).toBeLessThan(points.length);
        expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it("RDP 简化：圆弧保留多个点而非压缩为对角线", () => {
        const simplifier = new PathSimplifier(2.8, 18);
        // 生成 90° 圆弧
        const arcPoints: { x: number; y: number }[] = [];
        const cx = 100, cy = 100, r = 60;
        for (let i = 0; i <= 45; i++) {
            const angle = (Math.PI / 2) * (i / 45) - Math.PI / 2;
            arcPoints.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        }
        const result = simplifier.simplify(arcPoints);
        // 圆弧不应被压缩为只有 2 个点
        expect(result.length).toBeGreaterThan(2);
    });

    it("合并短于 minimumSegmentLength 的线段", () => {
        const simplifier = new PathSimplifier(2.8, 18);
        // 三段：20, 5, 20 → 中间 5px 段应被合并
        const points = [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 25, y: 0 },
            { x: 45, y: 0 },
        ];
        const result = simplifier.simplify(points);
        expect(result.length).toBeLessThan(points.length);
    });

    it("保留足够长的线段", () => {
        const simplifier = new PathSimplifier(2.8, 18);
        const points = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
        ];
        const result = simplifier.simplify(points);
        expect(result).toEqual(points);
    });

    it("去除小幅往返抖动", () => {
        const simplifier = new PathSimplifier(2.8, 18);
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
        const matcher = new DirectionMatcher();
        const segs = [
            { direction: "R" as const, startX: 0, startY: 0, endX: 50, endY: 0, length: 50, angle: 0 },
            { direction: "R" as const, startX: 50, startY: 0, endX: 100, endY: 0, length: 50, angle: 0 },
            { direction: "D" as const, startX: 100, startY: 0, endX: 100, endY: 50, length: 50, angle: Math.PI / 2 },
        ];
        expect(matcher.match(segs)).toEqual(["R", "D"]);
    });

    it("不截断：返回完整序列", () => {
        const matcher = new DirectionMatcher();
        const segs = [
            { direction: "R" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "D" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "L" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
            { direction: "U" as const, startX: 0, startY: 0, endX: 1, endY: 0, length: 1, angle: 0 },
        ];
        // 不再截断，返回完整的 4 个方向
        expect(matcher.match(segs)).toEqual(["R", "D", "L", "U"]);
    });

    it("equals 严格比较", () => {
        const matcher = new DirectionMatcher();
        expect(matcher.equals(["R", "D"], ["R", "D"])).toBe(true);
        expect(matcher.equals(["R", "D"], ["R", "U"])).toBe(false);
        expect(matcher.equals(["R"], ["R", "D"])).toBe(false);
        expect(matcher.equals([], [])).toBe(true);
    });

    it("isEmpty 判断", () => {
        const matcher = new DirectionMatcher();
        expect(matcher.isEmpty([])).toBe(true);
        expect(matcher.isEmpty(["R"])).toBe(false);
    });
});

// ----------------------------------------------------------- reversal tests

describe("GestureEngine — 同直线反向手势保留", () => {
    /**
     * Build a reversal path along a single axis: go from `start` to `peak`,
     * then reverse to `end`.  All three points are collinear, so standard
     * RDP would delete the peak.
     */
    function buildReversalPath(
        start: [number, number],
        peak: [number, number],
        end: [number, number],
        step = 2,
    ): GesturePoint[] {
        return buildPath([start, peak, end], step);
    }

    /** Recognise a reversal gesture and return the direction sequence. */
    function recognizeReversal(
        start: [number, number],
        peak: [number, number],
        end: [number, number],
        step = 2,
    ): string[] {
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildReversalPath(start, peak, end, step)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        return new GestureEngine().recognize(session).directions;
    }

    // --- basic unequal-length reversals (the core bug)

    it("不等长 R-L: (0,0)→(200,0)→(80,0) → [R, L]", () => {
        expect(recognizeReversal([0, 0], [200, 0], [80, 0])).toEqual(["R", "L"]);
    });

    it("不等长 L-R: (200,0)→(0,0)→(120,0) → [L, R]", () => {
        expect(recognizeReversal([200, 0], [0, 0], [120, 0])).toEqual(["L", "R"]);
    });

    it("不等长 D-U: (0,0)→(0,200)→(0,80) → [D, U]", () => {
        expect(recognizeReversal([0, 0], [0, 200], [0, 80])).toEqual(["D", "U"]);
    });

    it("不等长 U-D: (0,200)→(0,0)→(0,120) → [U, D]", () => {
        expect(recognizeReversal([0, 200], [0, 0], [0, 120])).toEqual(["U", "D"]);
    });

    // --- triple reversals

    it("R-L-R: (0,0)→(200,0)→(50,0)→(150,0) → [R, L, R]", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildPath([[0, 0], [200, 0], [50, 0], [150, 0]], 2)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        expect(new GestureEngine().recognize(session).directions).toEqual(["R", "L", "R"]);
    });

    it("D-U-D: (0,0)→(0,200)→(0,50)→(0,150) → [D, U, D]", () => {
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildPath([[0, 0], [0, 200], [0, 50], [0, 150]], 2)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        expect(new GestureEngine().recognize(session).directions).toEqual(["D", "U", "D"]);
    });

    // --- jitter around reversal point

    it("反向点前后 2～5px 抖动仍正确识别 R-L", () => {
        for (const amplitude of [2, 3, 5]) {
            const path = buildReversalPath([0, 0], [200, 0], [80, 0]);
            const jittered = addJitter(path, amplitude);
            const session = new GestureSession(DEFAULT_TRIGGER);
            for (const p of jittered) {
                session.addPoint(p.x, p.y, p.t);
            }
            session.activate();
            session.complete();
            const result = new GestureEngine().recognize(session);
            expect(result.valid).toBe(true);
            expect(result.directions).toEqual(["R", "L"]);
        }
    });

    // --- asymmetric distances from start/end

    it("反向点距起点和终点不对称: (0,0)→(300,0)→(50,0) → [R, L]", () => {
        expect(recognizeReversal([0, 0], [300, 0], [50, 0])).toEqual(["R", "L"]);
    });

    // ---不完全返回原点

    it("不完全返回原点: (0,0)→(200,0)→(80,0) → [R, L] (终点非起点)", () => {
        const result = recognizeReversal([0, 0], [200, 0], [80, 0]);
        expect(result).toEqual(["R", "L"]);
    });

    // --- second segment length ratios: 30%, 60%, 120%

    it("第二段为第一段 30%: (0,0)→(200,0)→(140,0) → [R, L]", () => {
        // First segment 200px, second 60px (30% of 200)
        expect(recognizeReversal([0, 0], [200, 0], [140, 0])).toEqual(["R", "L"]);
    });

    it("第二段为第一段 60%: (0,0)→(200,0)→(80,0) → [R, L]", () => {
        // First segment 200px, second 120px (60% of 200)
        expect(recognizeReversal([0, 0], [200, 0], [80, 0])).toEqual(["R", "L"]);
    });

    it("第二段为第一段 120%: (0,0)→(200,0)→(-40,0) → [R, L]", () => {
        // First segment 200px, second 240px (120% of 200)
        expect(recognizeReversal([0, 0], [200, 0], [-40, 0])).toEqual(["R", "L"]);
    });

    // --- total length below threshold → invalid

    it("总长度不足阈值时仍判定无效", () => {
        // Total arc length = 12 + 8 = 20px, but simplified path may be shorter.
        // Use a path where the simplified length < minimumSegmentLength (18).
        // First segment 10px, second 5px → total 15px < 18.
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildReversalPath([0, 0], [10, 0], [5, 0], 1)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        const result = new GestureEngine().recognize(session);
        expect(result.valid).toBe(false);
        expect(result.directions).toEqual([]);
    });

    // --- smooth U-turn should NOT be just [R, L]

    it("平滑 U 形转弯识别为多方向而非直接反向", () => {
        // Semicircle U-turn: go right 100px, curve around (radius 40), come back left.
        // Path: (0, 100) → (100, 100) → semicircle → (100, 100) → (0, 100)
        // The semicircle goes from (100,100) up to (100,20) and back to (100,100).
        // Actually, a proper U-turn: go right, curve up and around, come back left.
        // Center of semicircle at (100, 60), radius 40.
        // Start of arc: (100, 100), end of arc: (100, 20)... no.
        //
        // Let's do: right from (0,60) to (100,60), then semicircle above
        // from (100,60) → (100,60) going through (140,60)→(140,20)→(100,20)→(60,20)→(60,60)→(100,60)
        // That's a full circle, not a U-turn.
        //
        // Simpler: right from (0, 50) to (100, 50), then semicircle from
        // (100, 50) curving up to (100, 50) on the other side... no.
        //
        // A U-turn: go right, curve 180°, come back left.
        // (0, 50) → right → (100, 50) → arc (center at (100, 0), r=50) → (100, -50) → left → (0, -50)
        // But negative y is off-screen. Let's use:
        // (0, 100) → right → (100, 100) → arc (center at (100, 50), r=50, from bottom to top) → (100, 0) → left → (0, 0)
        //
        // Arc from (100,100) to (100,0) around center (100,50):
        // start angle = atan2(100-50, 100-100) = atan2(50, 0) = π/2 (down)
        // end angle = atan2(0-50, 100-100) = atan2(-50, 0) = -π/2 (up)
        // Going clockwise (through x > 100): angle goes from π/2 to -π/2 via 0
        const points: GesturePoint[] = [];
        let t = 0;
        // Straight right: (0,100) → (100,100)
        for (let x = 0; x <= 100; x += 2) {
            points.push({ x, y: 100, t });
            t += 16;
        }
        // Semicircle: center (100, 50), radius 50, from angle π/2 to -π/2 via 0 (clockwise)
        const cx = 100, cy = 50, r = 50;
        const arcSteps = 60;
        for (let i = 1; i <= arcSteps; i++) {
            const f = i / arcSteps;
            const angle = Math.PI / 2 - f * Math.PI; // π/2 → -π/2
            points.push({
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r,
                t,
            });
            t += 16;
        }
        // Straight left: (100, 0) → (0, 0)
        for (let x = 100; x >= 0; x -= 2) {
            points.push({ x, y: 0, t });
            t += 16;
        }

        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of points) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        const result = new GestureEngine().recognize(session);
        expect(result.valid).toBe(true);
        // Should NOT be just [R, L] — the U-turn introduces D or U directions.
        expect(result.directions).not.toEqual(["R", "L"]);
        expect(result.directions.length).toBeGreaterThanOrEqual(3);
    });

    // --- existing symmetric reversals still work

    it("对称 R-L (返回原点) 仍然通过", () => {
        expect(recognizeReversal([0, 0], [200, 0], [0, 0])).toEqual(["R", "L"]);
    });

    it("对称 D-U (返回原点) 仍然通过", () => {
        expect(recognizeReversal([0, 0], [0, 200], [0, 0])).toEqual(["D", "U"]);
    });
});

// ----------------------------------------------------------- cancel semantics

describe("GestureEngine — 取消状态统一语义", () => {
    it("短路径取消: invalidReason 为 cancelled 而非 too-short", () => {
        const engine = new GestureEngine();
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildPath([[0, 0], [5, 0]], 1)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.cancel("escape");
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("cancelled");
        expect(result.directions).toEqual([]);
        expect(result.cancelled).toBe(true);
    });

    it("正常路径取消: invalidReason 为 cancelled, rawDirections 非空", () => {
        const engine = new GestureEngine();
        const session = makeCancelledSession([[0, 0], [200, 0], [200, 200]], "escape");
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("cancelled");
        expect(result.directions).toEqual([]);
        expect(result.rawDirections.length).toBeGreaterThan(0);
        expect(result.cancelled).toBe(true);
    });

    it("超多段取消: invalidReason 为 cancelled 而非 too-many-segments", () => {
        const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, maximumSegments: 3 });
        const session = new GestureSession(DEFAULT_TRIGGER);
        // 8-direction zigzag
        for (const p of buildPath([
            [0, 0], [100, 0], [100, 100],
            [200, 100], [200, 0],
            [300, 0], [300, 100],
            [400, 100], [400, 0],
            [500, 0],
        ], 2)) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.cancel("escape");
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("cancelled");
        expect(result.directions).toEqual([]);
        // rawDirections 保留完整序列用于调试
        expect(result.rawDirections.length).toBeGreaterThan(3);
        expect(result.cancelled).toBe(true);
    });
});

describe("GestureEngine — recognizePoints 纯数据入口一致性", () => {
    const cases: { name: string; waypoints: [number, number][] }[] = [
        { name: "单方向 R", waypoints: [[0, 0], [120, 0]] },
        { name: "单方向 D", waypoints: [[0, 0], [0, 120]] },
        { name: "复合 R → D", waypoints: [[0, 0], [120, 0], [120, 120]] },
        { name: "复合 R → D → L", waypoints: [[0, 0], [120, 0], [120, 120], [0, 120]] },
        { name: "短轨迹", waypoints: [[0, 0], [10, 0]] },
    ];

    for (const c of cases) {
        it(`${c.name}：recognizePoints 与 recognize 结果一致`, () => {
            const engine = new GestureEngine(DEFAULT_RECOGNIZER_CONFIG);
            const points = buildPath(c.waypoints);
            const session = makeCompletedSession(c.waypoints);

            const viaSession = engine.recognize(session);
            const viaPoints = engine.recognizePoints(points);

            expect(viaPoints.valid).toBe(viaSession.valid);
            expect(viaPoints.invalidReason).toBe(viaSession.invalidReason);
            expect(viaPoints.directions).toEqual(viaSession.directions);
            expect(viaPoints.rawDirections).toEqual(viaSession.rawDirections);
            expect(viaPoints.rawPointCount).toBe(viaSession.rawPointCount);
            expect(viaPoints.sampledPointCount).toBe(viaSession.sampledPointCount);
            expect(viaPoints.simplifiedPointCount).toBe(viaSession.simplifiedPointCount);
            expect(viaPoints.cancelled).toBe(false);
        });
    }

    it("8 方向模式下斜向轨迹一致", () => {
        const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, directionMode: 8 });
        const points = buildPath([[0, 0], [120, 120]]); // diagonal
        const session = makeCompletedSession([[0, 0], [120, 120]]);
        const viaSession = engine.recognize(session);
        const viaPoints = engine.recognizePoints(points);
        expect(viaPoints.valid).toBe(true);
        expect(viaPoints.directions).toEqual(viaSession.directions);
    });

    it("recognizePoints 从不报告 cancelled", () => {
        const engine = new GestureEngine(DEFAULT_RECOGNIZER_CONFIG);
        const result = engine.recognizePoints(buildPath([[0, 0], [120, 0]]));
        expect(result.cancelled).toBe(false);
        expect(result.cancelReason).toBeNull();
    });
});
