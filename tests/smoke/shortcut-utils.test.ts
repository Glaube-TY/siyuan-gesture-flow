import { describe, it, expect } from "vitest";
import {
    eventToShortcutSpec,
    displayShortcut,
    canonicalKey,
} from "../../src/shortcuts/shortcutUtils";

/**
 * Shortcut capture / display smoke tests.
 *
 * Pure logic only: capture from a KeyboardEvent, canonical key
 * normalisation, and Windows / macOS display.  Escape-cancel and
 * Delete-clear are component-level behaviours driven by these primitives
 * (both yield `null` from eventToShortcutSpec, which the recorder maps
 * to cancel / clear) — verified in real SiYuan, not in a DOM mock.
 */

/**
 * Pure-logic stand-in for a KeyboardEvent: eventToShortcutSpec only
 * reads `key`, `code` and the four modifier flags, so a plain object
 * works without any DOM / happy-dom dependency.
 */
function press(key: string, code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) {
    return {
        key,
        code,
        ctrlKey: mods.ctrlKey ?? false,
        altKey: mods.altKey ?? false,
        shiftKey: mods.shiftKey ?? false,
        metaKey: mods.metaKey ?? false,
    } as unknown as KeyboardEvent;
}

describe("shortcut-utils smoke", () => {
    it("捕获 Ctrl+Shift+P（字母小写规范化）", () => {
        const spec = eventToShortcutSpec(press("p", "KeyP", { ctrlKey: true, shiftKey: true }));
        expect(spec).toEqual({
            key: "p",
            code: "KeyP",
            keyCode: 80,
            ctrlKey: true,
            altKey: false,
            shiftKey: true,
            metaKey: false,
        });
    });

    it("捕获 Alt+Left（方向键）", () => {
        const spec = eventToShortcutSpec(press("ArrowLeft", "ArrowLeft", { altKey: true }));
        expect(spec?.key).toBe("ArrowLeft");
        expect(spec?.keyCode).toBe(37);
        expect(spec?.altKey).toBe(true);
    });

    it("捕获功能键 F6", () => {
        const spec = eventToShortcutSpec(press("F6", "F6"));
        expect(spec?.key).toBe("F6");
        expect(spec?.keyCode).toBe(117);
    });

    it("Escape 返回 null（组件据此取消捕获）", () => {
        expect(eventToShortcutSpec(press("Escape", "Escape"))).toBeNull();
    });

    it("Delete / Backspace 返回 null（组件据此清空）", () => {
        expect(eventToShortcutSpec(press("Delete", "Delete"))).toBeNull();
        expect(eventToShortcutSpec(press("Backspace", "Backspace"))).toBeNull();
    });

    it("纯修饰键不保存", () => {
        expect(eventToShortcutSpec(press("Control", "ControlLeft", { ctrlKey: true }))).toBeNull();
    });

    it("Windows 展示 Ctrl+Shift+P / Alt+Left / F6", () => {
        const ctrlShiftP = { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
        const altLeft = { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
        const f6 = { key: "F6", code: "F6", keyCode: 117, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
        expect(displayShortcut(ctrlShiftP)).toBe("Ctrl+Shift+P");
        expect(displayShortcut(altLeft)).toBe("Alt+Left");
        expect(displayShortcut(f6)).toBe("F6");
    });

    it("macOS 展示修饰键符号", () => {
        const ctrlShiftP = { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
        expect(displayShortcut(ctrlShiftP, "mac")).toBe("⌃⇧P");
    });

    it("canonicalKey 小写化字母", () => {
        expect(canonicalKey("P")).toBe("p");
        expect(canonicalKey("F5")).toBe("F5");
    });
});
