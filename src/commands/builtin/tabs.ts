import { CommandDefinition } from "../types";
import { SiyuanActionBridge } from "../SiyuanActionBridge";

/**
 * Switch to the previous (left) tab in the same window split.
 *
 * Delegates to {@link SiyuanActionBridge.switchAdjacentTab}.
 * i18n key: `cmdTabsPrevious`
 */
export function createTabsPreviousCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "tabs.previous",
        title: "cmdTabsPrevious",
        group: "Tabs",
        execute: () => bridge.switchAdjacentTab("previous"),
    };
}

/**
 * Switch to the next (right) tab in the same window split.
 *
 * Delegates to {@link SiyuanActionBridge.switchAdjacentTab}.
 * i18n key: `cmdTabsNext`
 */
export function createTabsNextCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "tabs.next",
        title: "cmdTabsNext",
        group: "Tabs",
        execute: () => bridge.switchAdjacentTab("next"),
    };
}

/**
 * Close the currently active tab in the active window.
 *
 * Delegates to {@link SiyuanActionBridge.closeActiveTab}.  No default
 * gesture is registered — users bind their own trajectory.
 * i18n key: `cmdTabsClose`
 */
export function createTabsCloseCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "tabs.close",
        title: "cmdTabsClose",
        group: "Tabs",
        execute: () => bridge.closeActiveTab(),
    };
}
