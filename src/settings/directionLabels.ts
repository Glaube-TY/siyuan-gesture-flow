import { Direction } from "@/gesture/recognition/DirectionVectorizer";

/**
 * Display symbols for direction values (stage 5B).
 *
 * The UI shows user-friendly symbols (arrows) while the configuration
 * always stores the stable `Direction` strings (U/D/L/R/UL/UR/DL/DR) —
 * symbols are presentation only.
 */
export const DIRECTION_SYMBOLS: Record<Direction, string> = {
    U: "↑",
    D: "↓",
    L: "←",
    R: "→",
    UL: "↖",
    UR: "↗",
    DL: "↙",
    DR: "↘",
};

/** Symbol for a single direction (falls back to the raw value). */
export function directionSymbol(d: Direction): string {
    return DIRECTION_SYMBOLS[d] ?? d;
}
