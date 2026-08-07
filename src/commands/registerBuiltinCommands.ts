import { CommandRegistry } from "./CommandRegistry";
import { SiyuanActionBridge } from "./SiyuanActionBridge";
import { createScrollTopCommand, createScrollBottomCommand } from "./builtin/scrolling";
import {
    createTabsPreviousCommand,
    createTabsNextCommand,
    createTabsCloseCommand,
    createTabsRestoreRecentCommand,
} from "./builtin/tabs";
import { createDocumentReloadCommand } from "./builtin/document";
import {
    createNavigationBackCommand,
    createNavigationForwardCommand,
} from "./builtin/navigation";
import { createOfficialGlobalCommands } from "./builtin/global";

/**
 * Register all built-in commands with the given registry.
 *
 * Each command delegates to the {@link SiyuanActionBridge} for SiYuan
 * API/DOM access.  Commands are pure declarations — they contain no
 * selectors or DOM queries of their own.
 *
 * The four original command ids are stable; stage 6B-1 added
 * `tabs.close` and `document.reload`, stage 6B-2 adds
 * `tabs.restoreRecent`, stage 6B-3 adds `navigation.back` /
 * `navigation.forward`.  v0.2.0 adds the pure-global-command actions
 * declared in `OFFICIAL_GLOBAL_ACTIONS` (search, documents, panels &
 * views, layout, application & system, plus the tab close actions).
 *
 * Registration order also drives the settings command picker (each
 * group and its actions appear in this order).  The global-command
 * batch is split so the picker shows Search before Navigation, matching
 * the recommended group order.
 */
export function registerBuiltinCommands(
    registry: CommandRegistry,
    bridge: SiyuanActionBridge,
): void {
    const globalCommands = createOfficialGlobalCommands(bridge);
    const search = globalCommands.filter((c) => c.group === "Search");
    const remaining = globalCommands.filter((c) => c.group !== "Search");
    registry.registerMany([
        createTabsPreviousCommand(bridge),
        createTabsNextCommand(bridge),
        createTabsCloseCommand(bridge),
        createTabsRestoreRecentCommand(bridge),
        createDocumentReloadCommand(bridge),
        ...search,
        createNavigationBackCommand(bridge),
        createNavigationForwardCommand(bridge),
        ...remaining,
        createScrollTopCommand(bridge),
        createScrollBottomCommand(bridge),
    ]);
}
