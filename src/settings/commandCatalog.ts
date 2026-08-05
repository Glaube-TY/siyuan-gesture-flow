import { CommandRegistry } from "@/commands/CommandRegistry";

/**
 * Read-only command catalog for the settings UI (stage 5B).
 *
 * The settings panel must not hard-code the list of selectable commands
 * and must not touch `execute` functions or the {@link SiyuanActionBridge}.
 * This module bridges that gap: the plugin builds the catalog once from
 * the live {@link CommandRegistry} and resolves i18n titles, then hands
 * the plain metadata down to SettingsDialog → SettingsPanel.
 *
 * The catalog is a snapshot; the registry remains the single source of
 * truth at runtime.  The command `title` field doubles as the i18n key
 * (see `createCommandLabelResolver`), so {@link SettingCommandItem.titleKey}
 * reuses it directly.
 */
export interface SettingCommandItem {
    /** Command id as registered in the CommandRegistry, e.g. `tabs.next`. */
    readonly id: string;
    /** i18n key used to resolve the display title (the command's `title`). */
    readonly titleKey: string;
    /** Localised display title (falls back to the raw key when missing). */
    readonly title: string;
    /** Stable logical group id, e.g. `Tabs` / `Scrolling` (runtime grouping). */
    readonly group: string;
    /**
     * Localised group name for the settings `<optgroup>` label
     * (falls back to the raw group id).  The runtime group id itself
     * is never changed.
     */
    readonly groupTitle: string;
}

/** i18n key for a command group label (e.g. `Tabs` → `cmdGroupTabs`). */
function groupTitleKey(group: string): string {
    return `cmdGroup${group}`;
}

/**
 * Build the settings command catalog from a live registry.
 *
 * Only command metadata is copied — no execute functions, no bridge
 * references, no registry reference is retained.  Group labels are
 * resolved through i18n so the UI never shows raw group ids.
 */
export function buildCommandCatalog(
    registry: CommandRegistry,
    i18n: Record<string, string>,
): SettingCommandItem[] {
    return registry.list().map((cmd) => ({
        id: cmd.id,
        titleKey: cmd.title,
        title: i18n[cmd.title] ?? cmd.title,
        group: cmd.group,
        groupTitle: i18n[groupTitleKey(cmd.group)] ?? cmd.group,
    }));
}

/** The command id set of a catalog (used for save-time validation). */
export function catalogCommandIds(catalog: readonly SettingCommandItem[]): Set<string> {
    return new Set(catalog.map((c) => c.id));
}
