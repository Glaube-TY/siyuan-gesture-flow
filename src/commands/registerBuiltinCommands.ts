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

/**
 * Register all built-in commands with the given registry.
 *
 * Each command delegates to the {@link SiyuanActionBridge} for SiYuan
 * API/DOM access.  Commands are pure declarations — they contain no
 * selectors or DOM queries of their own.
 *
 * The four original command ids are stable; stage 6B-1 added
 * `tabs.close` and `document.reload`, stage 6B-2 adds
 * `tabs.restoreRecent` — all without default gestures.  Stage 6B-3 adds
 * `navigation.back` / `navigation.forward` (Navigation group).
 */
export function registerBuiltinCommands(
    registry: CommandRegistry,
    bridge: SiyuanActionBridge,
): void {
    registry.registerMany([
        createTabsPreviousCommand(bridge),
        createTabsNextCommand(bridge),
        createTabsCloseCommand(bridge),
        createTabsRestoreRecentCommand(bridge),
        createDocumentReloadCommand(bridge),
        createNavigationBackCommand(bridge),
        createNavigationForwardCommand(bridge),
        createScrollTopCommand(bridge),
        createScrollBottomCommand(bridge),
    ]);
}
