import { describe, it, expect } from "vitest";
import {
    subscribeTouchpadRawFrames,
    publishTouchpadRawFrame,
} from "../../src/runtime/TouchpadRuntimeState";
import { TouchpadFrame } from "../../src/touchpad/types";

function mkFrame(n: number): TouchpadFrame {
    return {
        timestamp: n,
        contacts: Array.from({ length: n }, (_, i) => ({ id: i, x: 0, y: 0, touching: true })),
        source: "raw-contacts",
    };
}

describe("touchpad raw frame bus", () => {
    it("delivers every raw frame including the final empty frame", () => {
        const received: number[] = [];
        const unsubscribe = subscribeTouchpadRawFrames((frame) => {
            received.push(frame.contacts.length);
        });
        publishTouchpadRawFrame(mkFrame(3));
        publishTouchpadRawFrame(mkFrame(2));
        publishTouchpadRawFrame(mkFrame(1));
        publishTouchpadRawFrame(mkFrame(0));
        unsubscribe();
        expect(received).toEqual([3, 2, 1, 0]);
    });

    it("stops notifying after unsubscribe", () => {
        let count = 0;
        const unsubscribe = subscribeTouchpadRawFrames(() => {
            count++;
        });
        unsubscribe();
        publishTouchpadRawFrame(mkFrame(3));
        expect(count).toBe(0);
    });
});
