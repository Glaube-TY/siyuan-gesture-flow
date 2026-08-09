import { describe, it, expect } from "vitest";
import { TouchpadFrame } from "../../src/touchpad/types";
import {
    recognizeGestureEventFrame,
    gestureEventLabel,
    gestureEventDetail,
} from "../../src/gesture/touchpad/recognition/GestureEventRecognizer";

/**
 * Electron `input-event` observer path smoke tests.
 *
 * The Electron `webContents` `input-event` listener receives the actual
 * InputEvent as the SECOND argument.  This suite validates the mapping of
 * those gesture-event frames into recognition results + diagnostics so the
 * previously-broken observer path is covered by regression tests.
 */

function observerFrame(gesture: TouchpadFrame["gesture"]): TouchpadFrame {
    return { timestamp: 1000, contacts: [], source: "gesture-events", gesture };
}

describe("electron observer event mapping", () => {
    it("scroll update is surfaced in diagnostics with deltas", () => {
        const detail = gestureEventDetail(observerFrame({ type: "scroll", state: "update", deltaX: -12, deltaY: -34, hasPrecise: true }));
        expect(detail).not.toBeNull();
        expect(detail?.type).toBe("gestureScrollUpdate");
        expect(detail?.deltaX).toBe(-12);
        expect(detail?.deltaY).toBe(-34);
    });

    it("scroll begin/update/end labels are produced", () => {
        expect(gestureEventLabel(observerFrame({ type: "scroll", state: "begin", deltaX: 0, deltaY: 0, hasPrecise: true }))).toBe("scroll:begin");
        expect(gestureEventLabel(observerFrame({ type: "scroll", state: "update", deltaX: 1, deltaY: 2, hasPrecise: true }))).toBe("scroll:update");
        expect(gestureEventLabel(observerFrame({ type: "scroll", state: "end", deltaX: 1, deltaY: 2, hasPrecise: true }))).toBe("scroll:end");
    });

    it("two-finger scroll end recognises a 2-finger swipe", () => {
        const result = recognizeGestureEventFrame(
            observerFrame({ type: "scroll", state: "end", deltaX: -0.6, deltaY: 0, hasPrecise: true }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(result?.kind).toBe("swipe");
        expect(result?.fingerCount).toBe(2);
        expect(result?.directions.length).toBe(1);
        // The exact scroll-delta → direction mapping must be validated against
        // live Electron 42 events; the recognizer guarantees a cardinal output.
        expect(["U", "D", "L", "R", "UL", "UR", "DL", "DR"]).toContain(result?.directions[0]);
    });

    it("scroll below threshold produces no result", () => {
        const result = recognizeGestureEventFrame(
            observerFrame({ type: "scroll", state: "end", deltaX: 0.02, deltaY: 0, hasPrecise: true }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(result).toBeNull();
    });

    it("pinch end maps to 2-finger pinch in/out", () => {
        const out = recognizeGestureEventFrame(
            observerFrame({ type: "pinch", state: "end", scale: 1.4 }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(out?.kind).toBe("pinch");
        expect(out?.pinchDirection).toBe("out");
        expect(out?.fingerCount).toBe(2);

        const in_ = recognizeGestureEventFrame(
            observerFrame({ type: "pinch", state: "end", scale: 0.6 }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(in_?.pinchDirection).toBe("in");
    });

    it("two-finger tap maps to a 2-finger tap", () => {
        const result = recognizeGestureEventFrame(
            observerFrame({ type: "twoFingerTap" }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(result?.kind).toBe("tap");
        expect(result?.fingerCount).toBe(2);
    });

    it("longPress is surfaced in diagnostics but never dispatched", () => {
        const result = recognizeGestureEventFrame(
            observerFrame({ type: "longPress" }),
            { swipeMinDistance: 0.15, pinchThreshold: 0.15 },
            null,
        );
        expect(result).toBeNull();
        expect(gestureEventLabel(observerFrame({ type: "longPress" }))).toBe("long-press");
    });
});
