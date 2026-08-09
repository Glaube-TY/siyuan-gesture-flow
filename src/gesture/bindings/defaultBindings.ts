import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBinding } from "./types";

/**
 * Default gesture bindings (version 2 — signature-keyed).
 *
 * All four default bindings are mouse shape gestures and non-destructive:
 *
 * - `mouse:2:shape:L` → `tabs.previous`  (switch to left tab)
 * - `mouse:2:shape:R` → `tabs.next`      (switch to right tab)
 * - `mouse:2:shape:U` → `scroll.top`     (scroll document to top)
 * - `mouse:2:shape:D` → `scroll.bottom`  (scroll document to bottom)
 *
 * No destructive actions (close, delete, overwrite) are bound by default.
 * No touchpad bindings ship by default — the touchpad feature starts in its
 * safe, inactive state.
 */
export const DEFAULT_BINDINGS: readonly GestureBinding[] = [
    {
        id: "default-L",
        enabled: true,
        signature: "mouse:2:shape:L",
        directions: ["L" as Direction],
        action: { type: "builtin", commandId: "tabs.previous", commandParams: {} },
    },
    {
        id: "default-R",
        enabled: true,
        signature: "mouse:2:shape:R",
        directions: ["R" as Direction],
        action: { type: "builtin", commandId: "tabs.next", commandParams: {} },
    },
    {
        id: "default-U",
        enabled: true,
        signature: "mouse:2:shape:U",
        directions: ["U" as Direction],
        action: { type: "builtin", commandId: "scroll.top", commandParams: {} },
    },
    {
        id: "default-D",
        enabled: true,
        signature: "mouse:2:shape:D",
        directions: ["D" as Direction],
        action: { type: "builtin", commandId: "scroll.bottom", commandParams: {} },
    },
];
