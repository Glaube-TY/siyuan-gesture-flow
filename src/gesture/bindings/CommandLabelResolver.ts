import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBindingRegistry } from "./GestureBindingRegistry";
import { mouseSignature } from "@/gesture/signature";
import { displayShortcut, detectShortcutPlatform } from "@/shortcuts/shortcutUtils";

/**
 * A function that resolves a mouse direction sequence to a displayable
 * action label, or `null` when no binding matches.
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
     * Pointer button used to build the mouse gesture signature (2 = right).
     * Defaults to 2.
     */
    button?: number;
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
 * The resolver looks up the binding for the given mouse direction sequence
 * (converted to its canonical signature) and, if found and enabled, renders
 * a label by action type — builtin → localised command title, shortcut →
 * user action name / key combination.  Unknown / invalid actions return
 * `null` so internal fields are never displayed.
 */
export function createCommandLabelResolver(
    bindings: GestureBindingRegistry,
    i18n: Record<string, string>,
    options: CommandLabelResolverOptions = {},
): CommandLabelResolver {
    const button = options.button ?? 2;
    const commandTitles = options.commandTitles;
    const shortcutPrefixKey = options.shortcutPrefixKey ?? "overlayShortcutPrefix";

    return (directions: readonly Direction[]): string | null => {
        if (directions.length === 0) return null;
        const resolved = bindings.resolve(mouseSignature(button, directions));
        if (!resolved) return null;
        const action = resolved.binding.action;

        if (action.type === "builtin") {
            if (commandTitles && !commandTitles.has(action.commandId)) {
                return null;
            }
            const titleKey = commandTitles?.get(action.commandId) ?? action.commandId;
            return i18n[titleKey] ?? titleKey;
        }

        if (action.type === "shortcut") {
            if (action.title && action.title.trim().length > 0) {
                return action.title;
            }
            const prefix = i18n[shortcutPrefixKey] ?? "快捷键：";
            return `${prefix}${displayShortcut(action.shortcut, detectShortcutPlatform())}`;
        }

        return null;
    };
}
