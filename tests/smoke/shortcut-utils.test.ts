import { describe, it, expect } from "vitest";
import {
    eventToShortcutSpec,
    displayShortcut,
    canonicalKey,
    validateShortcutSpec,
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

    it("Shift+= 捕获规范化为基础键并通过校验", () => {
        const spec = eventToShortcutSpec(press("+", "Equal", { shiftKey: true }));
        expect(spec).toEqual({
            key: "=",
            code: "Equal",
            keyCode: 187,
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
            metaKey: false,
        });
        expect(validateShortcutSpec(spec!)).toBe(true);
    });

    it("Shift+1 捕获规范化为基础键并通过校验", () => {
        const spec = eventToShortcutSpec(press("!", "Digit1", { shiftKey: true }));
        expect(spec?.key).toBe("1");
        expect(spec?.code).toBe("Digit1");
        expect(spec?.keyCode).toBe(49);
        expect(spec?.shiftKey).toBe(true);
        expect(validateShortcutSpec(spec!)).toBe(true);
    });

    it("Ctrl+P 显示大写 P（Windows/Linux）", () => {
        const spec = eventToShortcutSpec(press("p", "KeyP", { ctrlKey: true }));
        expect(displayShortcut(spec!)).toBe("Ctrl+P");
    });

    it("Win+P 显示 Win（Windows/Linux meta 键）", () => {
        const spec = eventToShortcutSpec(press("p", "KeyP", { metaKey: true }));
        expect(displayShortcut(spec!)).toBe("Win+P");
        expect(spec?.key).toBe("p"); // 存储仍是基础小写
    });

    it("macOS 显示 ⌘P", () => {
        const spec = eventToShortcutSpec(press("p", "KeyP", { metaKey: true }));
        expect(displayShortcut(spec!, "mac")).toBe("⌘P");
    });

    it("Shift+字母显示大写（macOS ⌃⇧P）", () => {
        const spec = eventToShortcutSpec(press("p", "KeyP", { ctrlKey: true, shiftKey: true }));
        expect(displayShortcut(spec!, "mac")).toBe("⌃⇧P");
    });

    it("canonicalKey 小写化字母", () => {
        expect(canonicalKey("P")).toBe("p");
        expect(canonicalKey("F5")).toBe("F5");
    });

    it("统一校验通过：Alt+ArrowLeft / Ctrl+Home / PageDown", () => {
        expect(validateShortcutSpec({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toBe(true);
        expect(validateShortcutSpec({ key: "Home", code: "Home", keyCode: 36, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe(true);
        expect(validateShortcutSpec({ key: "PageDown", code: "PageDown", keyCode: 34, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(true);
    });

    it("统一校验拒绝冲突的 key/code/keyCode 组合", () => {
        // key 为 ArrowLeft、code 为 KeyP、keyCode 为 1 — 互相冲突
        expect(validateShortcutSpec({ key: "ArrowLeft", code: "KeyP", keyCode: 1, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        // keyCode 为 0
        expect(validateShortcutSpec({ key: "p", code: "KeyP", keyCode: 0, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        // keyCode 与 key/code 不一致
        expect(validateShortcutSpec({ key: "p", code: "KeyP", keyCode: 37, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        // 纯修饰键无效
        expect(validateShortcutSpec({ key: "Control", code: "ControlLeft", keyCode: 17, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
    });

    it("macOS 显示方向键与其他平台一致（Left 系列）", () => {
        const altLeft = { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
        expect(displayShortcut(altLeft)).toBe("Alt+Left");
        expect(displayShortcut(altLeft, "mac")).toBe("⌥Left");
    });
});
