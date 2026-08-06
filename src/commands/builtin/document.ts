import { CommandDefinition } from "../types";
import { SiyuanActionBridge } from "../SiyuanActionBridge";

/**
 * Reload the currently active document.
 *
 * Delegates to {@link SiyuanActionBridge.reloadActiveDocument} — the
 * operation targets the active **document editor**, not a browser-style
 * tab reload.  Non-document tabs return `unavailable`.
 *
 * No default gesture is registered — users bind their own trajectory.
 * i18n key: `cmdDocumentReload`
 */
export function createDocumentReloadCommand(bridge: SiyuanActionBridge): CommandDefinition {
    return {
        id: "document.reload",
        title: "cmdDocumentReload",
        group: "Document",
        execute: () => bridge.reloadActiveDocument(),
    };
}
