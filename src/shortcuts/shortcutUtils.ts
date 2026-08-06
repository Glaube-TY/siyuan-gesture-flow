import type { ShortcutSpec } from "./types";

/**
 * Shortcut capture, normalisation, validation and display utilities
 * (stage 6A).
 *
 * Single source of truth for shortcut keys: `SUPPORTED_KEYS` stores
 * **physical base keys** (lowercase letters, digits/punctuation base
 * characters, exact spec names for `F6` / `ArrowLeft` / `Home` /
 * `Enter` / `Tab`).  Shifted variants (`!`, `+`, `?`, …) are never
 * persisted: capture maps them back to their base key
 * ({@link SHIFTED_TO_BASE}) and records the shift in `shiftKey`.
 * Every consumer — capture (`eventToShortcutSpec`), config validation
 * (`validateShortcutSpec`) and binding-draft validation — goes through
 * the same helpers, so a key accepted at capture time is always
 * accepted at validation time.
 *
 * Capture rules:
 * - Pure modifier keys (Control/Alt/Shift/Meta) are never saved.
 * - For a known physical `code`, the persisted key is the base
 *   character of that key (`Digit1` → `1`, `Equal` → `=`,
 *   `KeyP` → `p`); Shift state lives in `shiftKey`.
 * - When `code` is absent, shifted characters (`!`, `+`, `?`, …) are
 *   mapped back to their base key via {@link SHIFTED_TO_BASE}.
 * - Letters are normalised to lowercase; display always shows them
 *   uppercase.
 * - Escape is reserved for cancel-capture; Backspace/Delete for
 *   clear-capture.  None of them is saved as a shortcut.
 * - Modifier display order is always: Control, Alt, Shift, Meta, key.
 *
 * Platform detection never assumes `navigator` exists at module load —
 * call {@link detectShortcutPlatform} at render time.
 */

/** Keys that are modifiers only — never a main key. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
    "Control",
    "Alt",
    "Shift",
    "Meta",
]);

/**
 * Supported main keys in CANONICAL (physical base) form: lowercase
 * letters, digits, base punctuation characters, and exact spec names
 * for multi-character keys.  Shifted variants (`!` `@` `+` `?` …) are
 * NOT persisted keys — capture converts them to their base key.
 * Multi-character keys are matched exactly — never uppercased.
 */
export const SUPPORTED_KEYS: ReadonlySet<string> = new Set([
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
    "Home", "End", "PageUp", "PageDown",
    " ", "Enter", "Tab",
    // Base punctuation (US layout).  Shifted variants of these keys are
    // stored as the base key + shiftKey.
    "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`",
]);

/**
 * Physical code → canonical key.  Used to prove that a `code` belongs to
 * the spec's `key` (no conflicting pairs like `key: "ArrowLeft"` +
 * `code: "KeyP"`).
 */
const KEY_BY_CODE: Readonly<Record<string, string>> = {
    // Letters (physical positions) → canonical lowercase
    KeyA: "a", KeyB: "b", KeyC: "c", KeyD: "d", KeyE: "e", KeyF: "f",
    KeyG: "g", KeyH: "h", KeyI: "i", KeyJ: "j", KeyK: "k", KeyL: "l",
    KeyM: "m", KeyN: "n", KeyO: "o", KeyP: "p", KeyQ: "q", KeyR: "r",
    KeyS: "s", KeyT: "t", KeyU: "u", KeyV: "v", KeyW: "w", KeyX: "x",
    KeyY: "y", KeyZ: "z",
    // Digits (physical positions)
    Digit0: "0", Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4",
    Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9",
    // Function keys
    F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
    F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
    // Navigation
    ArrowLeft: "ArrowLeft", ArrowUp: "ArrowUp", ArrowRight: "ArrowRight", ArrowDown: "ArrowDown",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Space: " ", Enter: "Enter", Tab: "Tab",
    // Common punctuation (US layout)
    Semicolon: ";", Equal: "=", Comma: ",", Minus: "-", Period: ".",
    Slash: "/", Backquote: "`", BracketLeft: "[", Backslash: "\\",
    BracketRight: "]", Quote: "'",
};

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

/** Canonical key → keyCode (used when `code` is absent or non-standard). */
const KEYCODE_BY_KEY: Readonly<Record<string, number>> = {
    " ": 32, Enter: 13, Tab: 9,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Home: 36, End: 35, PageUp: 33, PageDown: 34,
    ";": 186, "=": 187, ",": 188, "-": 189, ".": 190,
    "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222,
};

/**
 * Shifted (KeyboardEvent.key) variant → physical base key (US layout).
 * Used at capture time: a pressed `!` is persisted as key `"1"` with
 * `shiftKey: true`, never as `!`.
 */
export const SHIFTED_TO_BASE: Readonly<Record<string, string>> = {
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
    "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\",
    ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "~": "`",
};

/**
 * Physical base key → shifted KeyboardEvent.key variant (US layout).
 * The reverse of {@link SHIFTED_TO_BASE}: `ShortcutExecutor` uses it to
 * rebuild the real `event.key` for a persisted base key + shiftKey.
 */
export const BASE_TO_SHIFTED: Readonly<Record<string, string>> = {
    "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
    "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
    "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|",
    ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?", "`": "~",
};

/**
 * Resolve the physical base key for a raw `KeyboardEvent.key` + `code`
 * pair.  When the physical `code` is known its base character wins
 * (`Equal` → `=`, `Digit1` → `1`, `KeyP` → `p`); otherwise shifted
 * variants map back through {@link SHIFTED_TO_BASE} and single letters
 * are canonicalised to lowercase.
 */
export function baseKeyFor(rawKey: string, code: string): string {
    if (code && code in KEY_BY_CODE) {
        return KEY_BY_CODE[code];
    }
    const shifted = SHIFTED_TO_BASE[rawKey];
    if (shifted !== undefined) return shifted;
    return canonicalKey(rawKey);
}

/**
 * Normalise a main key: single characters (letters) are lowercased;
 * everything else (F5, ArrowLeft, Home…) is kept as-is.
 */
export function canonicalKey(key: string): string {
    return key.length === 1 ? key.toLowerCase() : key;
}

/** Whether the given key is a pure modifier (never a main key). */
export function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key);
}

/**
 * Whether a key is a supported main key.  Handles both canonical
 * (lowercase letters) and raw event keys (uppercase letters) — the
 * check always canonicalises first, so multi-character names are
 * matched exactly and never corrupted by `toUpperCase()`.
 */
export function isSupportedShortcutKey(key: string): boolean {
    if (typeof key !== "string" || key.length === 0) return false;
    return SUPPORTED_KEYS.has(canonicalKey(key));
}

/**
 * Derive the numeric keyCode for a captured key/code pair.
 *
 * Prefers the physical `code` mapping; falls back to the canonical key
 * mapping when `code` is absent (some environments do not report it).
 * Returns `null` for unsupported keys.
 */
export function keyCodeFor(key: string, code: string): number | null {
    if (code && code in KEYCODE_BY_CODE) {
        return KEYCODE_BY_CODE[code];
    }
    const ck = canonicalKey(key);
    if (ck in KEYCODE_BY_KEY) {
        return KEYCODE_BY_KEY[ck];
    }
    if (ck.length === 1) {
        const upper = ck.toUpperCase();
        if (/^[A-Z]$/.test(upper)) return upper.charCodeAt(0);
        if (/^[0-9]$/.test(ck)) return ck.charCodeAt(0);
    }
    return null;
}

/**
 * Normalise a raw shortcut-ish object into a canonical {@link ShortcutSpec}.
 *
 * - `key` is resolved to its physical base key (shifted variants like
 *   `!`/`+`/`?` map to the base key; letters lowercased).
 * - `code` is kept when present (may be empty for code-less keyboards).
 * - `keyCode` is kept when a positive integer is supplied, otherwise
 *   derived from the key/code mapping.
 * - Modifier flags are coerced to booleans.
 *
 * This only SHAPES the data — use {@link validateShortcutSpec} to prove
 * key/code/keyCode consistency before persisting.
 */
export function normalizeShortcutSpec(input: {
    key: string;
    code?: string;
    keyCode?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
}): ShortcutSpec {
    const code = input.code ?? "";
    const key = baseKeyFor(input.key, code);
    const derived = keyCodeFor(key, code);
    const keyCode =
        typeof input.keyCode === "number" && Number.isInteger(input.keyCode) && input.keyCode > 0
            ? input.keyCode
            : (derived ?? 0);
    return {
        key,
        code,
        keyCode,
        ctrlKey: input.ctrlKey === true,
        altKey: input.altKey === true,
        shiftKey: input.shiftKey === true,
        metaKey: input.metaKey === true,
    };
}

/**
 * Strictly validate a {@link ShortcutSpec}: supported key, matching
 * `code` (when present), positive `keyCode` consistent with the key /
 * code, boolean modifiers, and no functions / DOM data.
 *
 * Rejects conflicting triples such as `key: "ArrowLeft"` +
 * `code: "KeyP"` + `keyCode: 1`, and `keyCode: 0`.
 */
export function validateShortcutSpec(spec: ShortcutSpec): boolean {
    if (typeof spec !== "object" || spec === null) return false;
    if (Object.values(spec).some((v) => typeof v === "function")) return false;

    const key = spec.key;
    if (typeof key !== "string" || !isSupportedShortcutKey(key) || isModifierKey(key)) {
        return false;
    }
    const ck = canonicalKey(key);

    const code = spec.code;
    if (typeof code !== "string") return false;
    if (code !== "" && !(code in KEYCODE_BY_CODE)) {
        return false; // unknown physical code
    }
    if (code !== "" && KEY_BY_CODE[code] !== ck) {
        return false; // code does not belong to this key
    }

    const keyCode = spec.keyCode;
    if (typeof keyCode !== "number" || !Number.isInteger(keyCode) || keyCode <= 0) {
        return false; // 0 / negative / non-integer rejected
    }
    const expectedKeyCode = code !== ""
        ? KEYCODE_BY_CODE[code]
        : KEYCODE_BY_KEY[ck];
    if (expectedKeyCode === undefined || keyCode !== expectedKeyCode) {
        return false; // keyCode does not match the key/code
    }

    return (
        typeof spec.ctrlKey === "boolean" &&
        typeof spec.altKey === "boolean" &&
        typeof spec.shiftKey === "boolean" &&
        typeof spec.metaKey === "boolean"
    );
}

/**
 * Alias kept for callers that used the previous name — equivalent to
 * {@link validateShortcutSpec}.
 */
export function isValidShortcut(spec: ShortcutSpec): boolean {
    return validateShortcutSpec(spec);
}

/**
 * Build a canonical {@link ShortcutSpec} from a KeyboardEvent.
 *
 * The persisted `key` is the physical base key of the pressed key
 * (`Digit1` → `1`, `Equal` → `=`, `KeyP` → `p`); Shift state is kept in
 * `shiftKey`.  Returns `null` for pure modifier presses and unsupported
 * keys.  The caller decides what to do with Escape/Backspace/Delete
 * (cancel / clear) — this function does not interpret them.
 */
export function eventToShortcutSpec(e: KeyboardEvent): ShortcutSpec | null {
    if (isModifierKey(e.key)) return null;
    const base = baseKeyFor(e.key, e.code || "");
    if (!isSupportedShortcutKey(base)) return null;
    const spec = normalizeShortcutSpec({
        key: base,
        code: e.code || "",
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
    });
    if (spec.keyCode <= 0) return null;
    return spec;
}

/**
 * Display text for a main key.  Letters ALWAYS render uppercase (with or
 * without Shift); arrows → Left/Up/Right/Down; Space → Space.  Base
 * punctuation renders as its own character (`Shift+=` shows `=`, never
 * `+`).  Display is purely presentational — never parsed back.
 */
export function displayKey(spec: ShortcutSpec): string {
    let key = spec.key;
    if (key === " ") return "Space";
    if (key === "ArrowLeft") return "Left";
    if (key === "ArrowUp") return "Up";
    if (key === "ArrowRight") return "Right";
    if (key === "ArrowDown") return "Down";
    // Letters are stored lowercase; always display uppercase.
    if (key.length === 1 && /^[a-z]$/.test(key)) {
        key = key.toUpperCase();
    }
    return key;
}

/** Platform type for shortcut display. */
export type ShortcutPlatform = "win-linux" | "mac";

/**
 * Detect the current platform for shortcut display.
 *
 * Browser environments read `navigator.platform`; macOS → `mac`,
 * everything else → `win-linux`.  Node / unknown environments fall back
 * to the stable `win-linux` default.  Never assumes `navigator` exists
 * at module load — call this at render time.
 */
export function detectShortcutPlatform(): ShortcutPlatform {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const platform = nav?.platform ?? nav?.userAgent ?? "";
    return /mac|Mac/i.test(platform) ? "mac" : "win-linux";
}

/**
 * Cross-platform shortcut display.
 *
 * Windows/Linux: `Ctrl+Shift+P`, `Alt+Left`, `F6`, `Win+P` (meta shows
 * as `Win`).  macOS: modifier symbols `⌃` `⌥` `⇧` `⌘` without
 * separators (`⌃⇧P`).  Direction keys render as `Left/Up/Right/Down` on
 * every platform.
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
    if (spec.metaKey) parts.push(isMac ? "⌘" : "Win");
    parts.push(displayKey(spec));
    // macOS renders modifier symbols without separators (⌃⇧P); Windows /
    // Linux use "+" (Ctrl+Shift+P).
    return parts.join(isMac ? "" : "+");
}

/**
 * The real `KeyboardEvent.key` for a persisted base key + modifiers
 * (used by {@link ShortcutExecutor}).
 *
 * Rebuilds the true key semantics: Shift restores the shifted variant
 * (`1`+Shift → `!`, `=`+Shift → `+`, `/`+Shift → `?`, `[`+Shift → `{`),
 * Shift+letters produce uppercase, and everything else keeps the base
 * key.  `code` / `keyCode` are untouched — they already describe the
 * physical key.
 */
export function eventKeyFor(spec: ShortcutSpec): string {
    const base = spec.key;
    if (spec.shiftKey) {
        const shifted = BASE_TO_SHIFTED[base];
        if (shifted !== undefined) return shifted;
        if (base.length === 1 && /^[a-z]$/.test(base)) return base.toUpperCase();
    }
    return base;
}
