import { CommandRegistry } from "./CommandRegistry";
import { SiyuanActionBridge } from "./SiyuanActionBridge";
import { createScrollTopCommand, createScrollBottomCommand } from "./builtin/scrolling";
import { createTabsPreviousCommand, createTabsNextCommand } from "./builtin/tabs";

/**
 * Register all stage-4 built-in commands with the given registry.
 *
 * Each command delegates to the {@link SiyuanActionBridge} for SiYuan
 * API/DOM access.  Commands are pure declarations — they contain no
 * selectors or DOM queries of their own.
 */
export function registerBuiltinCommands(
    registry: CommandRegistry,
    bridge: SiyuanActionBridge,
): void {
    registry.registerMany([
        createTabsPreviousCommand(bridge),
        createTabsNextCommand(bridge),
        createScrollTopCommand(bridge),
        createScrollBottomCommand(bridge),
    ]);
}
