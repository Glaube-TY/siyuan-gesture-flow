import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { displayShortcut, detectShortcutPlatform } from "@/shortcuts/shortcutUtils";

/**
 * A function that resolves a direction sequence to a displayable action
 * label, or `null` when no binding matches.
 *
 * The FeedbackController uses this to populate the overlay's
 * `commandLabel` field without depending directly on the
 * {@link GestureBindingRegistry}, {@link CommandRegistry}, or
 * {@link ShortcutExecutor}.
 */
export type CommandLabelResolver = (
    directions: readonly Direction[],
) => string | null;

/** Options for {@link createCommandLabelResolver}. */
export interface CommandLabelResolverOptions {
    /**
     * Command id → localised title key map.  The resolver looks up the
     * title key for a builtin command and translates it via `i18n`;
     * without this map it falls back to the command id itself.
     */
    commandTitles?: ReadonlyMap<string, string>;
    /** i18n key for the "shortcut:" prefix label. */
    shortcutPrefixKey?: string;
}

/**
 * Create a {@link CommandLabelResolver} backed by a
 * {@link GestureBindingRegistry} and an i18n map.
 *
 * The resolver looks up the binding for the given directions and, if
 * found and enabled, renders a label by action type:
 *
 * - `builtin` → localised command title.  The title key comes from the
 *   `commandTitles` map (built from the CommandRegistry's `title`
 *   field, which is itself an i18n key such as `cmdTabsNext`); falling
 *   back to the command id when the map is absent.  A builtin command
 *   the current version does not register returns `null` so the overlay
 *   never shows an internal id.
 * - `shortcut` → localised "shortcut:" prefix + the display string,
 *   e.g. `快捷键：Ctrl+Shift+P`.
 * - unknown / invalid action → the direction sequence is shown by the
 *   overlay; the resolver returns `null` so internal error fields are
 *   never displayed.
 *
 * If no binding matches, it returns `null` so the overlay shows only
 * the direction sequence.
 *
 * The resolver never touches the {@link CommandRegistry} or
 * {@link ShortcutExecutor} — it only reads a pre-built title map.
 */
export function createCommandLabelResolver(
    bindings: GestureBindingRegistry,
    i18n: Record<string, string>,
    options: CommandLabelResolverOptions = {},
): CommandLabelResolver {
    const commandTitles = options.commandTitles;
    const shortcutPrefixKey = options.shortcutPrefixKey ?? "overlayShortcutPrefix";

    return (directions: readonly Direction[]): string | null => {
        const resolved = bindings.resolve(directions);
        if (!resolved) return null;
        const action = resolved.binding.action;

        if (action.type === "builtin") {
            // A command this version does not register: hide the raw
            // internal id — the overlay falls back to showing only the
            // direction sequence.  (When no title map is provided, keep
            // the legacy fallback to the command id itself.)
            if (commandTitles && !commandTitles.has(action.commandId)) {
                return null;
            }
            const titleKey = commandTitles?.get(action.commandId) ?? action.commandId;
            return i18n[titleKey] ?? titleKey;
        }

        if (action.type === "shortcut") {
            // Prefer the user-defined action name; fall back to the key
            // combination only if the title is somehow missing (valid
            // current configs never allow an empty title).
            if (action.title && action.title.trim().length > 0) {
                return action.title;
            }
            const prefix = i18n[shortcutPrefixKey] ?? "快捷键：";
            return `${prefix}${displayShortcut(action.shortcut, detectShortcutPlatform())}`;
        }

        // Unknown / invalid action: never expose internal fields — the
        // overlay falls back to the direction sequence.
        return null;
    };
}
