import { CommandRegistry } from "./CommandRegistry";
import { SiyuanActionBridge } from "./SiyuanActionBridge";
import { createScrollTopCommand, createScrollBottomCommand } from "./builtin/scrolling";
import {
    createTabsPreviousCommand,
    createTabsNextCommand,
    createTabsCloseCommand,
} from "./builtin/tabs";
import { createDocumentReloadCommand } from "./builtin/document";

/**
 * Register all built-in commands with the given registry.
 *
 * Each command delegates to the {@link SiyuanActionBridge} for SiYuan
 * API/DOM access.  Commands are pure declarations — they contain no
 * selectors or DOM queries of their own.
 *
 * The four original command ids are stable; stage 6B-1 adds
 * `tabs.close` (Tabs group) and `document.reload` (Document group) —
 * both intentionally without default gestures.
 */
export function registerBuiltinCommands(
    registry: CommandRegistry,
    bridge: SiyuanActionBridge,
): void {
    registry.registerMany([
        createTabsPreviousCommand(bridge),
        createTabsNextCommand(bridge),
        createTabsCloseCommand(bridge),
        createDocumentReloadCommand(bridge),
        createScrollTopCommand(bridge),
        createScrollBottomCommand(bridge),
    ]);
}
