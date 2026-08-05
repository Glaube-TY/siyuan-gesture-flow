/**
 * Strict, serialisable shortcut structure (stage 6A).
 *
 * A shortcut is captured once from a KeyboardEvent and stored as plain
 * structured data — never a KeyboardEvent instance, DOM node or
 * function.  The four modifier flags plus a normalised main key fully
 * determine the shortcut; the display string is always *derived* from
 * these fields and is never parsed back into execution data.
 */
export interface ShortcutSpec {
    /** Normalised main key (lowercase letters, e.g. `p`, `F5`, `ArrowLeft`, ` `). */
    key: string;
    /** Normalised physical key code (e.g. `KeyP`, `F5`, `ArrowLeft`). */
    code: string;
    /** Numeric key code compatible with SiYuan's shortcut matching. */
    keyCode: number;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

/**
 * Canonical comparison key: modifiers in stable order + normalised key.
 * Used for duplicate detection and equality — not for display.
 */
export function shortcutCanonicalKey(spec: ShortcutSpec): string {
    const mods = [
        spec.ctrlKey ? "C" : "",
        spec.altKey ? "A" : "",
        spec.shiftKey ? "S" : "",
        spec.metaKey ? "M" : "",
    ].join("");
    return `${mods}+${spec.key}`;
}
