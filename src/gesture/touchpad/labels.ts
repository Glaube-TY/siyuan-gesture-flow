import { TouchpadGestureSpec, TouchpadGestureKind } from "@/gesture/touchpad/types";

/**
 * Localised display labels for touchpad gestures (settings + feedback).
 *
 * User-facing naming (internal kinds are never shown verbatim):
 *
 *   shape      → 轨迹 (trail), e.g.  3指 · ↓       3指 · ← → ↓
 *   anchorDraw → 组合轨迹, e.g.       3指 · 2指固定 + 1指绘制 · ↓
 *   tap        → 点击                3指 · 点击
 *   hold       → 长按                3指 · 长按
 *   pinch      → 捏合 / 张开          3指 · 捏合
 *   rotate     → 旋转                3指 · 旋转
 *   swipe      → 滑动 (兼容旧绑定)     3指 · 下滑
 */

/** Compact universal direction symbols (also used by the mouse recorder). */
const DIR_SYMBOL: Record<string, string> = {
    U: "↑",
    D: "↓",
    L: "←",
    R: "→",
    UL: "↖",
    UR: "↗",
    DL: "↙",
    DR: "↘",
};

/** Direction word (zh) or phrase (en) for swipe labels. */
function swipeWord(dir: string, i18n: Record<string, string>): string {
    const fallbacks: Record<string, string> = {
        U: "swipe up",
        D: "swipe down",
        L: "swipe left",
        R: "swipe right",
        UL: "swipe up-left",
        UR: "swipe up-right",
        DL: "swipe down-left",
        DR: "swipe down-right",
    };
    return i18n[`tpSwipe${dir}`] ?? fallbacks[dir] ?? dir;
}

/** e.g. "3指" (zh) / "3-finger" (en). */
function fingers(n: number, i18n: Record<string, string>): string {
    const suffix = i18n.tpFingers ?? "指";
    return `${n}${suffix}`;
}

/** Direction sequence with " → " separators and arrow symbols. */
function dirsLabel(dirs: readonly string[]): string {
    return dirs.map((d) => DIR_SYMBOL[d] ?? d).join(" → ");
}

/** Localised label for a touchpad gesture descriptor. */
export function touchpadDescriptorLabel(
    spec: TouchpadGestureSpec,
    i18n: Record<string, string>,
): string {
    const kindLabel = (key: string, fallback: string): string => i18n[key] ?? fallback;
    const prefix = fingers(spec.fingerCount, i18n);
    switch (spec.kind) {
        case "tap":
            return `${prefix} · ${kindLabel("tpTap", "tap")}`;
        case "press":
            return `${prefix} · ${kindLabel("tpPress", "press")}`;
        case "hold":
            return `${prefix} · ${kindLabel("tpHold", "hold")}`;
        case "swipe":
            return `${prefix} · ${swipeWord(spec.direction, i18n)}`;
        case "shape":
            return `${prefix} · ${dirsLabel(spec.directions)}`;
        case "anchorDraw": {
            const moving = Math.max(0, spec.fingerCount - spec.anchorCount);
            const fixed = `${fingers(spec.anchorCount, i18n)}${kindLabel("tpFixed", " fixed")}`;
            const draw = `${fingers(moving, i18n)}${kindLabel("tpDraw", " draw")}`;
            return `${prefix} · ${fixed} + ${draw} · ${dirsLabel(spec.directions)}`;
        }
        case "pinch":
            return spec.direction === "in"
                ? `${prefix} · ${kindLabel("tpPinchIn", "pinch in")}`
                : `${prefix} · ${kindLabel("tpPinchOut", "pinch out")}`;
        case "rotate":
            return spec.direction === "cw"
                ? `${prefix} · ${kindLabel("tpRotateCw", "rotate clockwise")}`
                : `${prefix} · ${kindLabel("tpRotateCcw", "rotate counter-clockwise")}`;
        default:
            return "gesture";
    }
}

/** Short label for the live "current kind" diagnostics (user-friendly). */
export function touchpadKindLabel(kind: TouchpadGestureKind, i18n: Record<string, string>): string {
    switch (kind) {
        case "tap": return i18n.tpTap ?? "tap";
        case "press": return i18n.tpPress ?? "press";
        case "hold": return i18n.tpHold ?? "hold";
        case "swipe": return i18n.tpSwipe ?? "swipe";
        case "shape": return i18n.tpTrail ?? "trail";
        case "anchorDraw": return i18n.tpCombined ?? "combined";
        case "pinch": return i18n.tpPinch ?? "pinch";
        case "rotate": return i18n.tpRotate ?? "rotate";
        default: return kind;
    }
}
