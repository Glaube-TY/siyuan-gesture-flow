// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { defaultGestureIgnoreTarget } from "./GestureFlowRuntime";

describe("GestureFlowRuntime — 默认输入目标排除（defaultGestureIgnoreTarget）", () => {
    it("只排除带 data-gesture-flow-recorder 标记的元素及其后代", () => {
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        expect(defaultGestureIgnoreTarget(recorder)).toBe(true);

        const inner = document.createElement("span");
        recorder.appendChild(inner);
        expect(defaultGestureIgnoreTarget(inner)).toBe(true);
    });

    it("普通元素与 null 不被排除", () => {
        const plain = document.createElement("div");
        expect(defaultGestureIgnoreTarget(plain)).toBe(false);
        expect(defaultGestureIgnoreTarget(null)).toBe(false);
    });

    it("标记从元素上移除后（录制器销毁）不再排除", () => {
        const recorder = document.createElement("div");
        recorder.setAttribute("data-gesture-flow-recorder", "");
        expect(defaultGestureIgnoreTarget(recorder)).toBe(true);
        recorder.removeAttribute("data-gesture-flow-recorder");
        expect(defaultGestureIgnoreTarget(recorder)).toBe(false);
    });
});
