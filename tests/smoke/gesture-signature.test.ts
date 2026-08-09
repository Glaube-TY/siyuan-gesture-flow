import { describe, it, expect } from "vitest";
import { mouseSignature, touchpadSignature } from "../../src/gesture/signature";

describe("gesture signatures", () => {
    it("mouse signatures encode button + direction sequence", () => {
        expect(mouseSignature(2, ["L"])).toBe("mouse:2:shape:L");
        expect(mouseSignature(2, ["R", "D"])).toBe("mouse:2:shape:R-D");
        expect(mouseSignature(2, ["UL", "DR"])).toBe("mouse:2:shape:UL-DR");
    });

    it("touchpad tap signature", () => {
        expect(touchpadSignature({ kind: "tap", fingerCount: 3 })).toBe("touchpad:3:tap");
        expect(touchpadSignature({ kind: "tap", fingerCount: 2 })).toBe("touchpad:2:tap");
    });

    it("touchpad swipe signature", () => {
        expect(touchpadSignature({ kind: "swipe", fingerCount: 4, direction: "L" })).toBe("touchpad:4:swipe:L");
    });

    it("touchpad shape signature reuses direction sequences", () => {
        expect(touchpadSignature({ kind: "shape", fingerCount: 3, directions: ["L", "D", "R"] })).toBe("touchpad:3:shape:L-D-R");
    });

    it("anchorDraw signature includes the anchor count", () => {
        expect(touchpadSignature({ kind: "anchorDraw", fingerCount: 2, anchorCount: 1, directions: ["U", "R"] })).toBe("touchpad:2:anchorDraw:1:U-R");
        expect(touchpadSignature({ kind: "anchorDraw", fingerCount: 3, anchorCount: 2, directions: ["U"] })).toBe("touchpad:3:anchorDraw:2:U");
    });

    it("pinch / rotate signatures include direction", () => {
        expect(touchpadSignature({ kind: "pinch", fingerCount: 2, direction: "in" })).toBe("touchpad:2:pinch:in");
        expect(touchpadSignature({ kind: "pinch", fingerCount: 2, direction: "out" })).toBe("touchpad:2:pinch:out");
        expect(touchpadSignature({ kind: "rotate", fingerCount: 3, direction: "cw" })).toBe("touchpad:3:rotate:cw");
        expect(touchpadSignature({ kind: "rotate", fingerCount: 3, direction: "ccw" })).toBe("touchpad:3:rotate:ccw");
    });

    it("distinct sources never collide", () => {
        const mouse = mouseSignature(2, ["L"]);
        const tp = touchpadSignature({ kind: "swipe", fingerCount: 3, direction: "L" });
        const tpTap = touchpadSignature({ kind: "tap", fingerCount: 3 });
        expect(mouse).not.toBe(tp);
        expect(mouse).not.toBe(tpTap);
        expect(tp).not.toBe(tpTap);
    });
});
