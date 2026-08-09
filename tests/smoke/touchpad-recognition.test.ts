import { describe, it, expect } from "vitest";
import {
    TouchpadGestureTracker,
    TouchpadRecognitionResult,
    defaultRecognizeDirections,
    AUTO_RECORD_KINDS,
} from "../../src/gesture/touchpad/recognition/TouchpadGestureTracker";
import { TouchpadContact, TouchpadFrame } from "../../src/touchpad/types";
import { TouchpadGestureKind } from "../../src/gesture/touchpad/types";
import { resultFromNativeAction, TouchpadGestureAdapter } from "../../src/gesture/touchpad/TouchpadGestureAdapter";

/**
 * Touchpad recognition smoke tests (pure contact-frame logic).
 *
 * Synthetic contact frames in normalised [0,1] coordinates drive the same
 * tracker the runtime uses.  Only the core classifiers are exercised:
 * tap, hold, swipe, pinch, rotate, and the anchor/tracer split.
 */

const KINDS = new Set<TouchpadGestureKind>(["tap", "hold", "swipe", "shape", "anchorDraw", "pinch", "rotate"]);

let t = 0;
function contact(id: number, x: number, y: number): TouchpadContact {
    return { id, x, y, touching: true };
}
function frame(contacts: TouchpadContact[], delta = 16): TouchpadFrame {
    t += delta;
    return { timestamp: t, contacts, source: "raw-contacts" };
}
function empty(): TouchpadFrame {
    t += 16;
    return { timestamp: t, contacts: [], source: "raw-contacts" };
}

function track(contacts: TouchpadContact[][]): TouchpadRecognitionResult | null {
    const tracker = new TouchpadGestureTracker({}, KINDS);
    let result: TouchpadRecognitionResult | null = null;
    for (const c of contacts) {
        result = tracker.feed(frame(c));
    }
    result = tracker.feed(empty());
    return result;
}

describe("touchpad contact recognizer", () => {
    it("三指静止短按识别为 3-finger tap", () => {
        const result = track([
            [contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.6)],
            [contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.6)],
        ]);
        expect(result?.kind).toBe("tap");
        expect(result?.fingerCount).toBe(3);
        expect(result?.valid).toBe(true);
    });

    it("四指短暂按下识别为 4-finger tap", () => {
        const result = track([
            [contact(1, 0.4, 0.5), contact(2, 0.5, 0.5), contact(3, 0.6, 0.5), contact(4, 0.5, 0.4)],
            [contact(1, 0.4, 0.5), contact(2, 0.5, 0.5), contact(3, 0.6, 0.5), contact(4, 0.5, 0.4)],
        ]);
        expect(result?.kind).toBe("tap");
        expect(result?.fingerCount).toBe(4);
    });

    it("三指左滑识别为 swipe L", () => {
        const result = track([
            [contact(1, 0.7, 0.5), contact(2, 0.8, 0.5), contact(3, 0.75, 0.6)],
            [contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.55, 0.6)],
            [contact(1, 0.3, 0.5), contact(2, 0.4, 0.5), contact(3, 0.35, 0.6)],
        ]);
        expect(result?.kind).toBe("swipe");
        expect(result?.directions).toEqual(["L"]);
        expect(result?.fingerCount).toBe(3);
    });

    it("双指捏合识别为 pinch in", () => {
        const result = track([
            [contact(1, 0.3, 0.5), contact(2, 0.7, 0.5)],
            [contact(1, 0.4, 0.5), contact(2, 0.6, 0.5)],
            [contact(1, 0.45, 0.5), contact(2, 0.55, 0.5)],
        ]);
        expect(result?.kind).toBe("pinch");
        expect(result?.pinchDirection).toBe("in");
    });

    it("双指张开识别为 pinch out", () => {
        const result = track([
            [contact(1, 0.45, 0.5), contact(2, 0.55, 0.5)],
            [contact(1, 0.3, 0.5), contact(2, 0.7, 0.5)],
        ]);
        expect(result?.kind).toBe("pinch");
        expect(result?.pinchDirection).toBe("out");
    });

    it("双指顺时针旋转识别为 rotate cw", () => {
        // Rotate the pair of contacts clockwise around the centre.
        const result = track([
            [contact(1, 0.4, 0.5), contact(2, 0.6, 0.5)],
            [contact(1, 0.5, 0.4), contact(2, 0.5, 0.6)],
            [contact(1, 0.6, 0.5), contact(2, 0.4, 0.5)],
        ]);
        expect(result?.kind).toBe("rotate");
        expect(result?.rotateDirection).toBe("cw");
    });

    it("一指固定、一指绘制识别为 anchorDraw", () => {
        const result = track([
            [contact(1, 0.5, 0.5), contact(2, 0.5, 0.7)],
            [contact(1, 0.5, 0.5), contact(2, 0.6, 0.7)],
            [contact(1, 0.5, 0.5), contact(2, 0.7, 0.7)],
            [contact(1, 0.5, 0.5), contact(2, 0.7, 0.6)],
        ]);
        expect(result?.kind).toBe("anchorDraw");
        expect(result?.anchorCount).toBe(1);
        expect(result?.directions.length).toBeGreaterThan(0);
    });

    it("三指长时间保持识别为 hold", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        tracker.updateConfig({ holdDurationMs: 200, cooldownMs: 0 });
        // Simulate ~300ms of still contact.
        let result: TouchpadRecognitionResult | null = null;
        for (let i = 0; i < 20; i++) {
            result = tracker.feed(frame([
                contact(1, 0.5, 0.5),
                contact(2, 0.6, 0.5),
                contact(3, 0.5, 0.6),
            ], 16));
        }
        result = tracker.feed(empty());
        expect(result?.kind).toBe("hold");
        expect(result?.fingerCount).toBe(3);
    });

    it("单次物理手势只完成一次（cooldown 防止重复）", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        tracker.updateConfig({ cooldownMs: 1000 });
        let completions = 0;
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5)]));
        if (tracker.feed(empty())) completions++;
        // Immediately after completion, another gesture within cooldown is ignored.
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5)]));
        if (tracker.feed(empty())) completions++;
        expect(completions).toBe(1);
    });

    it("默认路径识别器把直线识别为方向序列", () => {
        const dirs = defaultRecognizeDirections(
            [{ x: 0.1, y: 0.5, t: 0 }, { x: 0.3, y: 0.5, t: 16 }, { x: 0.9, y: 0.5, t: 32 }],
            8,
        );
        expect(dirs).toContain("R");
    });

    it("native 3-finger tap action → 3-finger tap descriptor", () => {
        const result = resultFromNativeAction({ kind: "tap", fingerCount: 3 }, null);
        expect(result?.kind).toBe("tap");
        expect(result?.fingerCount).toBe(3);
        const signature = TouchpadGestureAdapter.resultSignature(result as TouchpadRecognitionResult);
        expect(signature).toBe("touchpad:3:tap");
    });

    it("native 4-finger press action → 4-finger press descriptor", () => {
        const result = resultFromNativeAction({ kind: "press", fingerCount: 4 }, null);
        expect(result?.kind).toBe("press");
        expect(result?.fingerCount).toBe(4);
        const signature = TouchpadGestureAdapter.resultSignature(result as TouchpadRecognitionResult);
        expect(signature).toBe("touchpad:4:press");
    });

    it("native release never dispatches", () => {
        expect(resultFromNativeAction({ kind: "release", fingerCount: 3 }, null)).toBeNull();
    });

    it("native action is gated by enabled kinds", () => {
        const kinds = new Set<TouchpadGestureKind>(["tap"]);
        expect(resultFromNativeAction({ kind: "press", fingerCount: 3 }, kinds)).toBeNull();
        expect(resultFromNativeAction({ kind: "tap", fingerCount: 3 }, kinds)?.kind).toBe("tap");
    });

    // --------------------------------------------------------- release lifecycle

    it("3指 Shape 在第一根手指抬起时完成（3→3→3→2→1→0 只完成一次，fingerCount=3）", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        let completions = 0;
        let completion: TouchpadRecognitionResult | null = null;
        tracker.feed(frame([contact(1, 0.5, 0.3), contact(2, 0.5, 0.4), contact(3, 0.5, 0.5)]));
        tracker.feed(frame([contact(1, 0.5, 0.6), contact(2, 0.5, 0.7), contact(3, 0.5, 0.8)]));
        tracker.feed(frame([contact(1, 0.3, 0.6), contact(2, 0.3, 0.7), contact(3, 0.3, 0.8)]));
        // first finger drops → completion
        const r = tracker.feed(frame([contact(1, 0.3, 0.6), contact(2, 0.3, 0.7)]));
        if (r) {
            completions++;
            completion = r;
        }
        // release tail 2→1→0 must NOT complete again
        if (tracker.feed(frame([contact(1, 0.3, 0.6)]))) completions++;
        if (tracker.feed(empty())) completions++;
        expect(completions).toBe(1);
        expect(completion?.fingerCount).toBe(3);
        expect((completion?.directions.length ?? 0)).toBeGreaterThan(0);
    });

    it("3指手势完成后单指大幅移动不改变方向", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        // 3-finger swipe L
        tracker.feed(frame([contact(1, 0.7, 0.5), contact(2, 0.8, 0.5), contact(3, 0.75, 0.6)]));
        tracker.feed(frame([contact(1, 0.3, 0.5), contact(2, 0.4, 0.5), contact(3, 0.35, 0.6)]));
        let completion: TouchpadRecognitionResult | null = null;
        const r = tracker.feed(frame([contact(1, 0.3, 0.5), contact(2, 0.4, 0.5)]));
        if (r) completion = r;
        // single finger tail moves far right
        tracker.feed(frame([contact(1, 0.6, 0.5)]));
        tracker.feed(frame([contact(1, 0.9, 0.5)]));
        tracker.feed(empty());
        expect(completion?.kind).toBe("swipe");
        expect(completion?.directions).toContain("L");
        expect(tracker.getLiveState().stage).toBe("COOLDOWN");
    });

    it("required=3：1→2→3 预滚动不进入轨迹", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        // single finger pre-roll left (must be ignored)
        tracker.feed(frame([contact(1, 0.8, 0.5)]));
        tracker.feed(frame([contact(1, 0.5, 0.5)]));
        // two fingers (ignored)
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.5, 0.6)]));
        // three fingers arrive and draw right
        tracker.feed(frame([contact(1, 0.4, 0.5), contact(2, 0.4, 0.6), contact(3, 0.4, 0.7)]));
        tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.6, 0.6), contact(3, 0.6, 0.7)]));
        tracker.feed(frame([contact(1, 0.8, 0.5), contact(2, 0.8, 0.6), contact(3, 0.8, 0.7)]));
        const result = tracker.feed(empty());
        expect(result?.fingerCount).toBe(3);
        expect(result?.directions).toContain("R"); // not L from the pre-roll
    });

    it("required=3：3→4 判为不匹配，不保存为 4 指", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.6)]));
        const result = tracker.feed(frame([
            contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.6), contact(4, 0.5, 0.4),
        ]));
        expect(result).toBeNull();
        expect(tracker.getLiveState().mismatch).toBe("too-many");
        // release all → cooldown, ready again
        tracker.feed(empty());
        expect(tracker.getLiveState().stage).toBe("COOLDOWN");
    });

    it("WAIT_RELEASE 收到 0 后，新的 3 指手势才能开始", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.4, 0.5), contact(2, 0.5, 0.5), contact(3, 0.4, 0.6)]));
        tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5), contact(3, 0.6, 0.6)]));
        const first = tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)])); // drop → completes
        expect(first).not.toBeNull();
        // tail ignored
        tracker.feed(frame([contact(1, 0.6, 0.5)]));
        // full release → cooldown
        tracker.feed(empty());
        // advance past cooldown
        for (let i = 0; i < 12; i++) tracker.feed(empty());
        expect(tracker.getLiveState().stage).toBe("IDLE");
        // a brand new 3-finger gesture works
        tracker.feed(frame([contact(5, 0.4, 0.5), contact(6, 0.5, 0.5), contact(7, 0.4, 0.6)]));
        tracker.feed(frame([contact(5, 0.6, 0.5), contact(6, 0.7, 0.5), contact(7, 0.6, 0.6)]));
        const second = tracker.feed(frame([contact(5, 0.6, 0.5), contact(6, 0.7, 0.5)]));
        expect(second).not.toBeNull();
        expect(second?.fingerCount).toBe(3);
    });

    it("第一次三指完成后无需 zero frame 也能连续第二次（release-tail progression）", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        let completions = 0;
        const draw = (dy: number) => {
            tracker.feed(frame([contact(1, 0.3, 0.3 + dy), contact(2, 0.4, 0.3 + dy), contact(3, 0.3, 0.4 + dy)]));
            tracker.feed(frame([contact(1, 0.6, 0.3 + dy), contact(2, 0.7, 0.3 + dy), contact(3, 0.6, 0.4 + dy)]));
        };
        // Gesture 1: acquire 3 → move → first drop (3 → 2) completes.
        draw(0);
        const r1 = tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3)]));
        if (r1?.valid) completions++;
        expect(tracker.getLiveState().stage).toBe("WAIT_RELEASE");
        // Release tail WITHOUT an explicit zero frame: 2 → 1.
        tracker.feed(frame([contact(1, 0.6, 0.3)]));
        // New acquisition detected by progression: 1 → 2 rises again.
        tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3)]));
        // Gesture 2: 3 → move → first drop completes again.
        draw(0.2);
        const r2 = tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)]));
        if (r2?.valid) completions++;
        expect(tracker.getLiveState().stage).toBe("WAIT_RELEASE");
        expect(completions).toBe(2);
    });

    it("releaseTimedOut 解除 WAIT_RELEASE，无需重建 Tracker 即可再识别", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.3, 0.3), contact(2, 0.4, 0.3), contact(3, 0.3, 0.4)]));
        tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3), contact(3, 0.6, 0.4)]));
        tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3)])); // 3 → 2 completes
        expect(tracker.getLiveState().stage).toBe("WAIT_RELEASE");
        tracker.releaseTimedOut();
        expect(tracker.getLiveState().stage).not.toBe("WAIT_RELEASE");
        // Next acquisition after the (short) cooldown — big delta jumps past it.
        tracker.feed(frame([contact(1, 0.3, 0.5), contact(2, 0.4, 0.5), contact(3, 0.3, 0.6)], 200));
        tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5), contact(3, 0.6, 0.6)]));
        const r = tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)]));
        expect(r).not.toBeNull();
        expect(r?.valid).toBe(true);
        expect(r?.fingerCount).toBe(3);
    });

    it("显式 empty frame 正常完成释放，不等待 timeout，且不产生重复 completion", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        let completions = 0;
        tracker.feed(frame([contact(1, 0.3, 0.3), contact(2, 0.4, 0.3), contact(3, 0.3, 0.4)]));
        tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3), contact(3, 0.6, 0.4)]));
        const r1 = tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3)]));
        if (r1?.valid) completions++;
        tracker.feed(frame([contact(1, 0.6, 0.3)])); // 2 → 1 tail
        tracker.feed(empty()); // explicit zero → cooldown, latch closed immediately
        expect(tracker.getLiveState().stage).toBe("COOLDOWN");
        // A late recovery must be a no-op (already out of WAIT_RELEASE).
        tracker.releaseTimedOut();
        expect(completions).toBe(1);
    });

    it("连续 20 次 3 指手势：每次都能 completion，不重复、不失效", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        let completions = 0;
        for (let i = 0; i < 20; i++) {
            const base = i * 0.01;
            tracker.feed(frame([contact(1, 0.3, 0.3 + base), contact(2, 0.4, 0.3 + base), contact(3, 0.3, 0.4 + base)]));
            tracker.feed(frame([contact(1, 0.6, 0.3 + base), contact(2, 0.7, 0.3 + base), contact(3, 0.6, 0.4 + base)]));
            const r = tracker.feed(frame([contact(1, 0.6, 0.3 + base), contact(2, 0.7, 0.3 + base)]));
            if (r?.valid) completions++;
            if (i % 2 === 0) {
                // Even iterations: release via explicit zero frame.
                tracker.feed(empty());
            } else {
                // Odd iterations: release tail without zero → recovery by
                // progression or timeout.
                tracker.feed(frame([contact(1, 0.6, 0.3 + base)])); // 2 → 1
                tracker.releaseTimedOut();
            }
            // Advance time past cooldown so the next iteration starts at IDLE.
            tracker.feed(frame([], 200));
        }
        expect(completions).toBe(20);
        expect(tracker.getLiveState().stage).not.toBe("WAIT_RELEASE");
    });

    // ------------------------------------------- auto-record recognition

    it("3 指共同下滑 → shape D（自动录制集合不含 swipe，直线落为 shape）", () => {
        const tracker = new TouchpadGestureTracker({}, AUTO_RECORD_KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.3), contact(2, 0.6, 0.3), contact(3, 0.55, 0.4)]));
        tracker.feed(frame([contact(1, 0.5, 0.8), contact(2, 0.6, 0.8), contact(3, 0.55, 0.9)]));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("shape");
        expect(r?.directions).toContain("D");
        expect(r?.fingerCount).toBe(3);
    });

    it("3 指共同 L-D-R → shape L-D-R", () => {
        const tracker = new TouchpadGestureTracker({}, AUTO_RECORD_KINDS);
        tracker.feed(frame([contact(1, 0.8, 0.4), contact(2, 0.9, 0.4), contact(3, 0.85, 0.5)]));
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.5, 0.4), contact(3, 0.45, 0.5)]));
        tracker.feed(frame([contact(1, 0.4, 0.8), contact(2, 0.5, 0.8), contact(3, 0.45, 0.9)]));
        tracker.feed(frame([contact(1, 0.8, 0.8), contact(2, 0.9, 0.8), contact(3, 0.85, 0.9)]));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("shape");
        expect(r?.directions).toEqual(["L", "D", "R"]);
    });

    it("3 指：2 指固定 + 1 指绘制 → anchorDraw anchorCount=2", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.3)]));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.5)]));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.5, 0.7)]));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.anchorCount).toBe(2);
        expect(r?.directions).toContain("D");
    });

    it("3 指：1 指固定 + 2 指绘制 → anchorDraw anchorCount=1（moving 质心路径）", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.3, 0.5), contact(3, 0.3, 0.6)]));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.5, 0.5), contact(3, 0.5, 0.6)]));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.7, 0.5), contact(3, 0.7, 0.6)]));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.anchorCount).toBe(1);
        expect(r?.directions).toContain("R");
    });

    it("contact 移动出去又回到起点 → 不是 anchor（全程稳定性判定）", () => {
        const tracker = new TouchpadGestureTracker({}, KINDS);
        // contact 1 moves far up and returns exactly to its start; contact 2
        // is genuinely stationary the whole time.  Large frame deltas keep the
        // duration past tapMaxDurationMs so only the anchor classification is
        // under test.
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.7, 0.5)], 150));
        tracker.feed(frame([contact(1, 0.5, 0.2), contact(2, 0.7, 0.5)], 150));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.7, 0.5)], 150));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        // Only contact 2 is a true anchor (contact 1's max excursion was 0.3).
        expect(r?.anchorCount).toBe(1);
    });

    // ------------------------------------------- pre-acquisition anchors

    it("一指预按 + 一指绘制 → anchorDraw（先按住，再绘制）", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 2 }, KINDS);
        // Finger 1 down and held still > anchorPreHoldMs (220).
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        // Finger 2 joins and draws R → D → L.
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.3, 0.5)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.5, 0.5)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.5, 0.7)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.3, 0.7)], 16));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.fingerCount).toBe(2);
        expect(r?.anchorCount).toBe(1);
        expect(r?.directions).toEqual(["R", "D", "L"]);
    });

    it("两指预按 + 一指绘制 → anchorDraw anchorCount=2", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.6, 0.4)], 220));
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.6, 0.4)], 220));
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.6, 0.4), contact(3, 0.5, 0.3)], 16));
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.6, 0.4), contact(3, 0.5, 0.7)], 16));
        tracker.feed(frame([contact(1, 0.4, 0.4), contact(2, 0.6, 0.4), contact(3, 0.8, 0.7)], 16));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.anchorCount).toBe(2);
        expect(r?.directions).toEqual(["D", "R"]);
    });

    it("一指预按 + 两指共同绘制 → anchorDraw anchorCount=1（moving 质心路径）", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.7, 0.5), contact(3, 0.7, 0.6)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.4, 0.5), contact(3, 0.4, 0.6)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.4, 0.8), contact(3, 0.4, 0.9)], 16));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.anchorCount).toBe(1);
        expect(r?.directions).toEqual(["L", "D"]);
    });

    it("预按 Anchor 在 Gesture 中漂移 → 撤销其 Anchor 身份，不误判 anchorDraw", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 2 }, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        // B joins; A then drifts 0.1 during the run (> anchorMaxDrift * 1.5).
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.3, 0.5)], 16));
        tracker.feed(frame([contact(1, 0.6, 0.5), contact(2, 0.5, 0.5)], 16));
        const r = tracker.feed(empty());
        expect(r?.kind).not.toBe("anchorDraw");
    });

    // ------------------------------------------- target-count acquisition

    it("required=3：单指大幅移动不建立 run、不产生轨迹", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.2, 0.2)]));
        tracker.feed(frame([contact(1, 0.8, 0.8)]));
        tracker.feed(frame([contact(1, 0.3, 0.3)]));
        const live = tracker.getLiveState();
        expect(live.stage).toBe("IDLE");
        expect(live.runActive).toBe(false);
        expect(live.lockedFingerCount).toBe(null);
        expect(live.displayPath).toEqual([]);
        expect(live.displayContactPaths).toEqual([]);
    });

    it("required=3：两指移动仍不建立 run、不产生轨迹", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.2, 0.2), contact(2, 0.25, 0.2)]));
        tracker.feed(frame([contact(1, 0.8, 0.8), contact(2, 0.85, 0.8)]));
        const live = tracker.getLiveState();
        expect(live.runActive).toBe(false);
        expect(live.displayPath).toEqual([]);
        expect(live.displayContactPaths).toEqual([]);
    });

    it("required=3：0→1→2→3 后三指下滑，run 实时建立并识别 shape D", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, AUTO_RECORD_KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.3)]));
        tracker.feed(frame([contact(1, 0.5, 0.3), contact(2, 0.6, 0.3)]));
        tracker.feed(frame([contact(1, 0.5, 0.3), contact(2, 0.6, 0.3), contact(3, 0.55, 0.4)]));
        // Movement on the full 3-contact frames (pure downward translation).
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.55, 0.6)]));
        const live = tracker.getLiveState();
        expect(live.runActive).toBe(true);
        expect(live.lockedFingerCount).toBe(3);
        expect(live.displayContactPaths.length).toBe(3);
        expect(live.displayPath.length).toBeGreaterThan(1);
        // Continue down and complete at the first drop.
        tracker.feed(frame([contact(1, 0.5, 0.8), contact(2, 0.6, 0.8), contact(3, 0.55, 0.9)]));
        const r = tracker.feed(frame([contact(1, 0.5, 0.8), contact(2, 0.6, 0.8)]));
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("shape");
        expect(r?.fingerCount).toBe(3);
        expect(r?.directions).toContain("D");
    });

    it("required=3：1→2→3 很快到达并立即移动也能识别（不因 arming 丢失）", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, AUTO_RECORD_KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.3)]));
        tracker.feed(frame([contact(1, 0.5, 0.3), contact(2, 0.6, 0.3)]));
        tracker.feed(frame([contact(1, 0.4, 0.3), contact(2, 0.5, 0.3), contact(3, 0.45, 0.4)]));
        tracker.feed(frame([contact(1, 0.6, 0.3), contact(2, 0.7, 0.3), contact(3, 0.65, 0.4)]));
        tracker.feed(frame([contact(1, 0.8, 0.3), contact(2, 0.9, 0.3), contact(3, 0.85, 0.4)]));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("shape");
        expect(r?.directions).toContain("R");
    });

    it("required=3：预按 Anchor 在 acquisition 阶段即显示为 A（run 未建立）", () => {
        const tracker = new TouchpadGestureTracker({ requiredFingerCount: 3 }, KINDS);
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        tracker.feed(frame([contact(1, 0.5, 0.5)], 220));
        const live1 = tracker.getLiveState();
        expect(live1.runActive).toBe(false);
        expect(live1.displayAnchorIds).toContain(1);
        // B + C join and draw right → run with A as the single anchor.
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.3, 0.5), contact(3, 0.3, 0.6)], 16));
        tracker.feed(frame([contact(1, 0.5, 0.5), contact(2, 0.6, 0.5), contact(3, 0.6, 0.6)], 16));
        const r = tracker.feed(empty());
        expect(r?.valid).toBe(true);
        expect(r?.kind).toBe("anchorDraw");
        expect(r?.anchorCount).toBe(1);
    });
});
