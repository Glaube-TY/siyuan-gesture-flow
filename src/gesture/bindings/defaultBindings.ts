import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBinding } from "./types";

/**
 * Default gesture bindings (stage 6A: unified action model).
 *
 * All four bindings are non-destructive and use the builtin action type:
 *
 * - `["L"]` → `tabs.previous`  (switch to left tab)
 * - `["R"]` → `tabs.next`      (switch to right tab)
 * - `["U"]` → `scroll.top`     (scroll document to top)
 * - `["D"]` → `scroll.bottom`  (scroll document to bottom)
 *
 * No destructive actions (close, delete, overwrite) are bound by default.
 */
export const DEFAULT_BINDINGS: readonly GestureBinding[] = [
    {
        id: "default-L",
        enabled: true,
        directions: ["L" as Direction],
        action: { type: "builtin", commandId: "tabs.previous", commandParams: {} },
    },
    {
        id: "default-R",
        enabled: true,
        directions: ["R" as Direction],
        action: { type: "builtin", commandId: "tabs.next", commandParams: {} },
    },
    {
        id: "default-U",
        enabled: true,
        directions: ["U" as Direction],
        action: { type: "builtin", commandId: "scroll.top", commandParams: {} },
    },
    {
        id: "default-D",
        enabled: true,
        directions: ["D" as Direction],
        action: { type: "builtin", commandId: "scroll.bottom", commandParams: {} },
    },
];
