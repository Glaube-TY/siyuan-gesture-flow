// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
    eventToShortcutSpec,
    displayShortcut,
    canonicalKey,
    isModifierKey,
    keyCodeFor,
    isValidShortcut,
    SUPPORTED_KEYS,
} from "./shortcutUtils";
import { shortcutCanonicalKey } from "./types";

/** Build a fake KeyboardEvent-like object (happy-dom may normalise fields). */
function press(opts: {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
}): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", {
        key: opts.key,
        code: opts.code,
        ctrlKey: opts.ctrlKey ?? false,
        altKey: opts.altKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        metaKey: opts.metaKey ?? false,
        bubbles: true,
        cancelable: true,
    });
    if (opts.code !== undefined) {
        Object.defineProperty(ev, "code", { value: opts.code, configurable: true });
    }
    return ev;
}

describe("shortcutUtils — 捕获", () => {
    it("捕获字母（Ctrl+Shift+P）", () => {
        const spec = eventToShortcutSpec(press({ key: "p", code: "KeyP", ctrlKey: true, shiftKey: true }));
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

    it("捕获数字（Ctrl+9）", () => {
        const spec = eventToShortcutSpec(press({ key: "9", code: "Digit9", ctrlKey: true }));
        expect(spec?.key).toBe("9");
        expect(spec?.keyCode).toBe(57);
    });

    it("捕获功能键（F6）", () => {
        const spec = eventToShortcutSpec(press({ key: "F6", code: "F6" }));
        expect(spec?.key).toBe("F6");
        expect(spec?.keyCode).toBe(117);
    });

    it("捕获方向键（Alt+Left）", () => {
        const spec = eventToShortcutSpec(press({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }));
        expect(spec?.key).toBe("ArrowLeft");
        expect(spec?.keyCode).toBe(37);
        expect(spec?.altKey).toBe(true);
    });

    it("捕获常见标点（Ctrl+;）", () => {
        const spec = eventToShortcutSpec(press({ key: ";", code: "Semicolon", ctrlKey: true }));
        expect(spec?.key).toBe(";");
        expect(spec?.keyCode).toBe(186);
    });

    it("捕获 Space 与 Enter", () => {
        expect(eventToShortcutSpec(press({ key: " ", code: "Space" }))?.keyCode).toBe(32);
        expect(eventToShortcutSpec(press({ key: "Enter", code: "Enter" }))?.keyCode).toBe(13);
    });

    it("纯修饰键不保存（返回 null）", () => {
        expect(eventToShortcutSpec(press({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
        expect(eventToShortcutSpec(press({ key: "Alt", code: "AltLeft", altKey: true }))).toBeNull();
        expect(eventToShortcutSpec(press({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
        expect(eventToShortcutSpec(press({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeNull();
    });

    it("Escape / Backspace / Delete 本身不产生 spec（由组件层处理取消/清空）", () => {
        expect(eventToShortcutSpec(press({ key: "Escape", code: "Escape" }))).toBeNull();
        expect(eventToShortcutSpec(press({ key: "Backspace", code: "Backspace" }))).toBeNull();
        expect(eventToShortcutSpec(press({ key: "Delete", code: "Delete" }))).toBeNull();
    });

    it("不支持的主键返回 null", () => {
        expect(eventToShortcutSpec(press({ key: "Unidentified", code: "" }))).toBeNull();
    });
});

describe("shortcutUtils — 规范化", () => {
    it("canonicalKey 小写化字母、保留其他", () => {
        expect(canonicalKey("P")).toBe("p");
        expect(canonicalKey("F5")).toBe("F5");
        expect(canonicalKey("ArrowLeft")).toBe("ArrowLeft");
    });

    it("isModifierKey 识别修饰键", () => {
        expect(isModifierKey("Control")).toBe(true);
        expect(isModifierKey("p")).toBe(false);
    });

    it("keyCodeFor 覆盖字母/数字/功能键/导航", () => {
        expect(keyCodeFor("a", "KeyA")).toBe(65);
        expect(keyCodeFor("1", "Digit1")).toBe(49);
        expect(keyCodeFor("F12", "F12")).toBe(123);
        expect(keyCodeFor("ArrowDown", "ArrowDown")).toBe(40);
        expect(keyCodeFor(" ", "Space")).toBe(32);
    });

    it("SUPPORTED_KEYS 包含 F1–F12、方向键、Home/End/PageUp/PageDown、标点", () => {
        for (let i = 1; i <= 12; i++) expect(SUPPORTED_KEYS.has(`F${i}`)).toBe(true);
        for (const k of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
            expect(SUPPORTED_KEYS.has(k)).toBe(true);
        }
        for (const k of [";", "=", ",", "-", ".", "/", "`", "[", "\\", "]", "'"]) {
            expect(SUPPORTED_KEYS.has(k)).toBe(true);
        }
    });
});

describe("shortcutUtils — 展示", () => {
    const ctrlShiftP = { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
    const altLeft = { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
    const f6 = { key: "F6", code: "F6", keyCode: 117, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

    it("Windows/Linux 显示 Ctrl+Shift+P、Alt+Left、F6", () => {
        expect(displayShortcut(ctrlShiftP)).toBe("Ctrl+Shift+P");
        expect(displayShortcut(altLeft)).toBe("Alt+Left");
        expect(displayShortcut(f6)).toBe("F6");
    });

    it("macOS 显示修饰键符号", () => {
        expect(displayShortcut(ctrlShiftP, "mac")).toBe("⌃⇧P");
        expect(displayShortcut(altLeft, "mac")).toBe("⌥Left");
        expect(displayShortcut(f6, "mac")).toBe("F6");
    });

    it("Shift 字母大写、非 Shift 字母小写", () => {
        const plainP = { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
        expect(displayShortcut(plainP)).toBe("Ctrl+p");
        expect(displayShortcut(ctrlShiftP)).toBe("Ctrl+Shift+P");
    });

    it("修饰键顺序稳定：Control、Alt、Shift、Meta、主键", () => {
        const all = { key: "a", code: "KeyA", keyCode: 65, ctrlKey: true, altKey: true, shiftKey: true, metaKey: true };
        // Shift held → letter displayed uppercase.
        expect(displayShortcut(all)).toBe("Ctrl+Alt+Shift+Meta+A");
        // canonicalKey 同样稳定（用于比较/去重，字母保持小写）
        // 顺序：Control(C) Alt(A) Shift(S) Meta(M)
        expect(shortcutCanonicalKey(all)).toBe("CASM+a");
    });
});

describe("shortcutUtils — 校验", () => {
    it("isValidShortcut 接受合法 spec", () => {
        expect(isValidShortcut({ key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe(true);
    });

    it("isValidShortcut 拒绝空主键 / 修饰键主键 / 非法 keyCode", () => {
        expect(isValidShortcut({ key: "", code: "KeyP", keyCode: 80, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        expect(isValidShortcut({ key: "Control", code: "ControlLeft", keyCode: 17, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        expect(isValidShortcut({ key: "p", code: "KeyP", keyCode: 1.5, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
        expect(isValidShortcut({ key: "p", code: "KeyP", keyCode: 80, ctrlKey: "yes" as never, altKey: false, shiftKey: false, metaKey: false })).toBe(false);
    });

    it("结构化数据与显示文本不互相污染：修改显示不影响 spec，展示函数只读 spec", () => {
        const spec = { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
        const text = displayShortcut(spec);
        expect(text).toBe("Ctrl+Shift+P");
        // 展示文本不可反向解析：spec 保持原样
        expect(spec.key).toBe("p");
        expect(spec.keyCode).toBe(80);
    });
});
