import { describe, it, expect } from "vitest";
import { GestureSession } from "../../src/gesture/GestureSession";
import { DEFAULT_TRIGGER, GesturePoint } from "../../src/gesture/types";
import {
    GestureEngine,
    DEFAULT_RECOGNIZER_CONFIG,
    RecognizerConfig,
} from "../../src/gesture/GestureEngine";

/**
 * Core recognition smoke tests (pure algorithm — high regression risk).
 *
 * Kept deliberately small: typical single / composite / zig-zag gestures,
 * a smooth turn, a too-short trail, and the maximum-segments rejection.
 * Everything else (pointer input, overlay, UI) is verified in real SiYuan.
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

function recognizeWith(waypoints: [number, number][], config?: Partial<RecognizerConfig>): string[] {
    const merged = { ...DEFAULT_RECOGNIZER_CONFIG, ...config };
    const engine = new GestureEngine(merged);
    const session = new GestureSession(DEFAULT_TRIGGER);
    for (const p of buildPath(waypoints)) {
        session.addPoint(p.x, p.y, p.t);
    }
    session.activate();
    session.complete();
    return engine.recognize(session).directions;
}

/** Smooth quarter-circle turn: R → D with a rounded corner. */
function smoothTurnPoints(
    start: [number, number],
    corner: [number, number],
    end: [number, number],
    arcPoints: number,
    radius: number,
): GesturePoint[] {
    const points: GesturePoint[] = [];
    let t = 0;
    const [sx, sy] = start;
    const [cx, cy] = corner;
    const [ex, ey] = end;

    const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.ceil(len / 2));
        for (let s = 0; s <= steps; s++) {
            const f = s / steps;
            points.push({ x: x1 + dx * f, y: y1 + dy * f, t });
            t += 16;
        }
    };

    const dInX = (sx - cx) / Math.hypot(sx - cx, sy - cy);
    const dInY = (sy - cy) / Math.hypot(sx - cx, sy - cy);
    const dOutX = (ex - cx) / Math.hypot(ex - cx, ey - cy);
    const dOutY = (ey - cy) / Math.hypot(ex - cx, ey - cy);
    const entryX = cx + dInX * radius;
    const entryY = cy + dInY * radius;
    const exitX = cx + dOutX * radius;
    const exitY = cy + dOutY * radius;
    const centerX = cx + (dInX + dOutX) * radius;
    const centerY = cy + (dInY + dOutY) * radius;

    pushLine(sx, sy, entryX, entryY);
    const startAngle = Math.atan2(entryY - centerY, entryX - centerX);
    const endAngle = Math.atan2(exitY - centerY, exitX - centerX);
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    for (let i = 1; i < arcPoints; i++) {
        const f = i / arcPoints;
        const angle = startAngle + delta * f;
        points.push({ x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, t });
        t += 16;
    }
    pushLine(exitX, exitY, ex, ey);
    return points;
}

function recognizeSmooth(directions: string[]): string[] {
    const engine = new GestureEngine();
    const session = new GestureSession(DEFAULT_TRIGGER);
    const pts = smoothTurnPoints([0, 100], [200, 100], [200, 300], 45, 60);
    for (const p of pts) {
        session.addPoint(p.x, p.y, p.t);
    }
    session.activate();
    session.complete();
    void directions;
    return engine.recognize(session).directions;
}

describe("recognition smoke", () => {
    it("直线 R 识别为 [R]", () => {
        expect(recognizeWith([[0, 0], [200, 0]])).toEqual(["R"]);
    });

    it("复合手势 R-D 识别为 [R, D]", () => {
        expect(recognizeWith([[0, 0], [200, 0], [200, 200]])).toEqual(["R", "D"]);
    });

    it("折返 U-D-U 识别为 [U, D, U]", () => {
        expect(recognizeWith([[0, 200], [0, 0], [0, 200], [0, 0]])).toEqual(["U", "D", "U"]);
    });

    it("圆滑转弯仍识别为复合方向 [R, D]", () => {
        expect(recognizeSmooth(["R", "D"])).toEqual(["R", "D"]);
    });

    it("短轨迹（不足最小段长）返回空方向", () => {
        expect(recognizeWith([[0, 0], [10, 0]])).toEqual([]);
    });

    it("超过最大段数时手势无效", () => {
        const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, maximumSegments: 3 });
        const session = new GestureSession(DEFAULT_TRIGGER);
        for (const p of buildPath([
            [0, 0], [100, 0], [100, 100],
            [200, 100], [200, 0],
            [300, 0], [300, 100],
            [400, 100], [400, 0],
            [500, 0],
        ])) {
            session.addPoint(p.x, p.y, p.t);
        }
        session.activate();
        session.complete();
        const result = engine.recognize(session);
        expect(result.valid).toBe(false);
        expect(result.invalidReason).toBe("too-many-segments");
    });
});
