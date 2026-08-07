import type { CommandDefinition } from "../types";
import type { SiyuanActionBridge } from "../SiyuanActionBridge";

/**
 * Declarative pairing of a GestureFlow command id with the official
 * SiYuan `globalCommand` string it should invoke.
 *
 * The table **only declares** the pairing.  Execution always goes
 * through {@link SiyuanActionBridge.executeGlobalCommand}, so no command
 * definition here ever contains try/catch, App probing, or result
 * conversion of its own.  Adding a new official action means: add one
 * entry here (registration is automatic via
 * {@link createOfficialGlobalCommands}) and add its i18n keys.
 *
 * All command names were verified against the official SiYuan v3.7.0
 * source `app/src/boot/globalEvent/command/global.ts` — the version
 * declared by the plugin's `minAppVersion`.  The installed `siyuan` type
 * package (v1.2.3) declares the public
 * `globalCommand(command, app)` entry the bridge calls.
 *
 * Entries are ordered for the settings command picker: within each
 * group, by typical daily-use frequency.
 */
export interface OfficialGlobalAction {
    /** GestureFlow command id, e.g. `search.global`. */
    readonly id: string;
    /** i18n title key (doubles as the command's `title` field). */
    readonly title: string;
    /** Stable runtime group id (i18n label key = `cmdGroup${group}`). */
    readonly group: string;
    /** The official SiYuan globalCommand string, e.g. `globalSearch`. */
    readonly globalCommand: string;
}

/**
 * Built-in actions implemented purely by delegating to SiYuan's public
 * `globalCommand` API.  Group order: Tabs → Documents → Search →
 * Panels & Views → Layout → Application & System.
 */
export const OFFICIAL_GLOBAL_ACTIONS: readonly OfficialGlobalAction[] = [
    // --- Tabs ---
    { id: "tabs.closeLeft", title: "cmdTabsCloseLeft", group: "Tabs", globalCommand: "closeLeft" },
    { id: "tabs.closeRight", title: "cmdTabsCloseRight", group: "Tabs", globalCommand: "closeRight" },
    { id: "tabs.closeOthers", title: "cmdTabsCloseOthers", group: "Tabs", globalCommand: "closeOthers" },
    { id: "tabs.closeAll", title: "cmdTabsCloseAll", group: "Tabs", globalCommand: "closeAll" },
    // --- Documents ---
    { id: "document.new", title: "cmdDocumentNew", group: "Documents", globalCommand: "newFile" },
    { id: "document.dailyNote", title: "cmdDocumentDailyNote", group: "Documents", globalCommand: "dailyNote" },
    { id: "documents.recent", title: "cmdDocumentsRecent", group: "Documents", globalCommand: "recentDocs" },
    { id: "document.history", title: "cmdDocumentHistory", group: "Documents", globalCommand: "dataHistory" },
    { id: "document.flashcards", title: "cmdDocumentFlashcards", group: "Documents", globalCommand: "riffCard" },
    // --- Search ---
    { id: "search.global", title: "cmdSearchGlobal", group: "Search", globalCommand: "globalSearch" },
    { id: "search.selection", title: "cmdSearchSelection", group: "Search", globalCommand: "stickSearch" },
    // --- Panels & Views ---
    { id: "panel.fileTree", title: "cmdPanelFileTree", group: "PanelsViews", globalCommand: "fileTree" },
    { id: "panel.outline", title: "cmdPanelOutline", group: "PanelsViews", globalCommand: "outline" },
    { id: "panel.backlinks", title: "cmdPanelBacklinks", group: "PanelsViews", globalCommand: "backlinks" },
    { id: "panel.bookmarks", title: "cmdPanelBookmarks", group: "PanelsViews", globalCommand: "bookmark" },
    { id: "panel.tags", title: "cmdPanelTags", group: "PanelsViews", globalCommand: "tag" },
    { id: "panel.inbox", title: "cmdPanelInbox", group: "PanelsViews", globalCommand: "inbox" },
    { id: "view.graph", title: "cmdViewGraph", group: "PanelsViews", globalCommand: "graphView" },
    { id: "view.globalGraph", title: "cmdViewGlobalGraph", group: "PanelsViews", globalCommand: "globalGraph" },
    { id: "view.toggleDock", title: "cmdViewToggleDock", group: "PanelsViews", globalCommand: "toggleDock" },
    // --- Layout ---
    { id: "layout.splitHorizontal", title: "cmdLayoutSplitHorizontal", group: "Layout", globalCommand: "splitLR" },
    { id: "layout.splitVertical", title: "cmdLayoutSplitVertical", group: "Layout", globalCommand: "splitTB" },
    { id: "layout.unsplit", title: "cmdLayoutUnsplit", group: "Layout", globalCommand: "unsplit" },
    { id: "layout.unsplitAll", title: "cmdLayoutUnsplitAll", group: "Layout", globalCommand: "unsplitAll" },
    // --- Application & System ---
    { id: "app.settings", title: "cmdAppSettings", group: "ApplicationSystem", globalCommand: "config" },
    { id: "app.sync", title: "cmdAppSync", group: "ApplicationSystem", globalCommand: "syncNow" },
    { id: "editor.toggleReadonly", title: "cmdEditorToggleReadonly", group: "ApplicationSystem", globalCommand: "editReadonly" },
    { id: "app.lockScreen", title: "cmdAppLockScreen", group: "ApplicationSystem", globalCommand: "lockScreen" },
];

/**
 * Build the {@link CommandDefinition} for every entry in
 * {@link OFFICIAL_GLOBAL_ACTIONS}.
 *
 * Every produced command executes through the single bridge entry
 * {@link SiyuanActionBridge.executeGlobalCommand} — no per-command
 * execution logic is duplicated.
 */
export function createOfficialGlobalCommands(bridge: SiyuanActionBridge): CommandDefinition[] {
    return OFFICIAL_GLOBAL_ACTIONS.map((spec) => {
        const command = spec.globalCommand;
        return {
            id: spec.id,
            title: spec.title,
            group: spec.group,
            execute: () => bridge.executeGlobalCommand(command),
        };
    });
}
