import { CommandDefinition } from "../types";
import { SiyuanActionBridge } from "../SiyuanActionBridge";

/**
 * Scroll the active document to the top.
 *
 * Delegates to {@link SiyuanActionBridge.scrollActiveDocument}.
 * i18n key: `cmdScrollTop`
 */
export function createScrollTopCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "scroll.top",
        title: "cmdScrollTop",
        group: "Scrolling",
        execute: () => bridge.scrollActiveDocument("top"),
    };
}

/**
 * Scroll the active document to the bottom.
 *
 * Delegates to {@link SiyuanActionBridge.scrollActiveDocument}.
 * i18n key: `cmdScrollBottom`
 */
export function createScrollBottomCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "scroll.bottom",
        title: "cmdScrollBottom",
        group: "Scrolling",
        execute: () => bridge.scrollActiveDocument("bottom"),
    };
}
