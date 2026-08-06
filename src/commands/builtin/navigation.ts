import { CommandDefinition } from "../types";
import { SiyuanActionBridge } from "../SiyuanActionBridge";

/**
 * Go back one step in SiYuan's navigation history.
 *
 * Delegates to {@link SiyuanActionBridge.navigateBack}, which calls the
 * public `globalCommand("goBack", app)`.  No default gesture is
 * registered; with no history SiYuan accepts the command with no visible
 * change.
 * i18n key: `cmdNavigationBack`
 */
export function createNavigationBackCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "navigation.back",
        title: "cmdNavigationBack",
        group: "Navigation",
        execute: () => bridge.navigateBack(),
    };
}

/**
 * Go forward one step in SiYuan's navigation history.
 *
 * Delegates to {@link SiyuanActionBridge.navigateForward}, which calls the
 * public `globalCommand("goForward", app)`.  No default gesture is
 * registered.
 * i18n key: `cmdNavigationForward`
 */
export function createNavigationForwardCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "navigation.forward",
        title: "cmdNavigationForward",
        group: "Navigation",
        execute: () => bridge.navigateForward(),
    };
}
