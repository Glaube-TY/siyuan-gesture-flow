import type { ShortcutSpec } from "./types";

/**
 * Shortcut capture, normalisation and display utilities (stage 6A).
 *
 * The design follows the approach used by SiYuan plugins for shortcut
 * handling (capture → structured spec → display), re-implemented here
 * for Svelte 4 + strict TypeScript.  All functions are pure and
 * testable; none of them touches the DOM or the event system.
 *
 * Capture rules:
 * - Pure modifier keys (Control/Alt/Shift/Meta) are never saved.
 * - Letters are normalised to lowercase; display uppercases them when
 *   Shift is held.
 * - Modifier display order is always: Control, Alt, Shift, Meta, key.
 */

/** Keys that are modifiers only — never a main key. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
    "Control",
    "Alt",
    "Shift",
    "Meta",
]);

/** Supported main keys: letters, digits, F1–F12, arrows, navigation, common punctuation. */
export const SUPPORTED_KEYS: ReadonlySet<string> = new Set([
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
    "Home", "End", "PageUp", "PageDown",
    " ", "Enter", "Tab",
    "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
    "-", "_", "=", "+", "[", "]", "{", "}", "\\", "|", ";", ":", "'", "\"",
    ",", "<", ".", ">", "/", "?", "`", "~",
]);

/**
 * Physical code → numeric keyCode, compatible with SiYuan's shortcut
 * matching (keyCode semantics).  Letters map to A=65..Z=90, digits to
 * 48..57, F1–F12 to 112..123, navigation per DOM conventions.
 */
const KEYCODE_BY_CODE: Readonly<Record<string, number>> = {
    // Letters (physical positions)
    KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69, KeyF: 70,
    KeyG: 71, KeyH: 72, KeyI: 73, KeyJ: 74, KeyK: 75, KeyL: 76,
    KeyM: 77, KeyN: 78, KeyO: 79, KeyP: 80, KeyQ: 81, KeyR: 82,
    KeyS: 83, KeyT: 84, KeyU: 85, KeyV: 86, KeyW: 87, KeyX: 88,
    KeyY: 89, KeyZ: 90,
    // Digits (physical positions)
    Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52,
    Digit5: 53, Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,
    // Function keys
    F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
    F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
    // Navigation
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Home: 36, End: 35, PageUp: 33, PageDown: 34,
    Space: 32, Enter: 13, Tab: 9,
    // Common punctuation (US layout)
    Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190,
    Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220,
    BracketRight: 221, Quote: 222,
};

/**
 * Normalise a main key for comparison: single characters (letters) are
 * lowercased; everything else (F5, ArrowLeft, Space…) is kept as-is.
 */
export function canonicalKey(key: string): string {
    return key.length === 1 ? key.toLowerCase() : key;
}

/** Whether the given key is a pure modifier (never a main key). */
export function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key);
}

/**
 * Derive the numeric keyCode for a captured key/code pair.
 *
 * Returns `null` when the key is not supported (callers then ignore
 * the shortcut instead of saving a half-known mapping).
 */
export function keyCodeFor(key: string, code: string): number | null {
    if (code in KEYCODE_BY_CODE) {
        return KEYCODE_BY_CODE[code];
    }
    // Fallback for environments where `code` is unreliable: letters /
    // digits by canonical key.
    if (key.length === 1) {
        const upper = key.toUpperCase();
        if (/^[A-Z]$/.test(upper)) return upper.charCodeAt(0);
        if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
    }
    return null;
}

/**
 * Build a {@link ShortcutSpec} from a KeyboardEvent.
 *
 * Returns `null` for pure modifier presses and unsupported keys.  The
 * caller decides what to do with Escape/Backspace/Delete (cancel /
 * clear) — this function does not interpret them.
 */
export function eventToShortcutSpec(e: KeyboardEvent): ShortcutSpec | null {
    if (isModifierKey(e.key)) return null;
    const key = canonicalKey(e.key);
    const code = e.code || "";
    if (!SUPPORTED_KEYS.has(e.key)) {
        // Accept letters/digits even when the event's key is a shifted
        // symbol (e.g. key "P" with Shift on US layout).
        if (!/^[a-zA-Z0-9]$/.test(e.key)) return null;
    }
    const keyCode = keyCodeFor(key, code);
    if (keyCode === null) return null;
    return {
        key,
        code,
        keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
    };
}

/** Whether a spec is a valid, non-empty shortcut (has a supported key). */
export function isValidShortcut(spec: ShortcutSpec): boolean {
    return (
        typeof spec === "object" &&
        spec !== null &&
        typeof spec.key === "string" &&
        spec.key.length > 0 &&
        !isModifierKey(spec.key) &&
        SUPPORTED_KEYS.has(spec.key.toUpperCase()) &&
        Number.isInteger(spec.keyCode) &&
        spec.keyCode >= 0 &&
        typeof spec.code === "string" &&
        typeof spec.ctrlKey === "boolean" &&
        typeof spec.altKey === "boolean" &&
        typeof spec.shiftKey === "boolean" &&
        typeof spec.metaKey === "boolean"
    );
}

/** Display text for a main key (arrows → Left/Up/Right/Down, Space, etc.). */
export function displayKey(spec: ShortcutSpec): string {
    let key = spec.key;
    if (key === " ") return "Space";
    if (key === "ArrowLeft") return "Left";
    if (key === "ArrowUp") return "Up";
    if (key === "ArrowRight") return "Right";
    if (key === "ArrowDown") return "Down";
    // Letters are stored lowercase; show uppercase when Shift is held.
    if (key.length === 1 && /^[a-z]$/.test(key) && spec.shiftKey) {
        key = key.toUpperCase();
    }
    return key;
}

/** Platform type for shortcut display. */
export type ShortcutPlatform = "win-linux" | "mac";

/**
 * Cross-platform shortcut display.
 *
 * Windows/Linux: `Ctrl+Shift+P`, `Alt+Left`, `F6`.
 * macOS: modifier symbols `⌃` `⌥` `⇧` `⌘`.
 *
 * This function ONLY reads {@link ShortcutSpec} — the display string is
 * never parsed back into execution data.
 */
export function displayShortcut(spec: ShortcutSpec, platform: ShortcutPlatform = "win-linux"): string {
    const isMac = platform === "mac";
    const parts: string[] = [];
    if (spec.ctrlKey) parts.push(isMac ? "⌃" : "Ctrl");
    if (spec.altKey) parts.push(isMac ? "⌥" : "Alt");
    if (spec.shiftKey) parts.push(isMac ? "⇧" : "Shift");
    if (spec.metaKey) parts.push(isMac ? "⌘" : "Meta");
    parts.push(displayKey(spec));
    // macOS renders modifier symbols without separators (⌃⇧P); Windows /
    // Linux use "+" (Ctrl+Shift+P).
    return parts.join(isMac ? "" : "+");
}
