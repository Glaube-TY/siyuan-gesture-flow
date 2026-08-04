import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GestureBindingRegistry } from "./GestureBindingRegistry";

/**
 * A function that resolves a direction sequence to a displayable command
 * label, or `null` when no binding matches.
 *
 * The FeedbackController uses this to populate the overlay's
 * `commandLabel` field without depending directly on the
 * {@link GestureBindingRegistry} or {@link CommandRegistry}.
 */
export type CommandLabelResolver = (
    directions: readonly Direction[],
) => string | null;

/**
 * Create a {@link CommandLabelResolver} backed by a
 * {@link GestureBindingRegistry} and an i18n map.
 *
 * The resolver looks up the binding for the given directions and, if
 * found and enabled, returns the localised command title.  If no binding
 * matches, it returns `null` so the overlay shows only the direction
 * sequence.
 *
 * @param bindings  The binding registry to query.
 * @param i18n      The i18n map (key → localised string).  The command
 *                  `title` field is used as the i18n key.
 */
export function createCommandLabelResolver(
    bindings: GestureBindingRegistry,
    i18n: Record<string, string>,
): CommandLabelResolver {
    return (directions: readonly Direction[]): string | null => {
        const resolved = bindings.resolve(directions);
        if (!resolved) return null;
        // The command title is an i18n key (e.g. "cmdTabsNext").
        // Fall back to the raw title if the key is missing.
        return i18n[resolved.command.title] ?? resolved.command.title;
    };
}
