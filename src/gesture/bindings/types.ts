import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { CommandDefinition } from "@/commands/types";

/** A single gesture-to-command binding. */
export interface GestureBinding {
    /** Unique binding id (e.g. `default-L`). */
    readonly id: string;
    /** Whether this binding is active.  Disabled bindings never resolve. */
    enabled: boolean;
    /** Direction sequence that triggers the command (e.g. `["L"]`). */
    readonly directions: readonly Direction[];
    /** Target command id in the {@link CommandRegistry}. */
    readonly commandId: string;
    /** Parameters passed to the command's execute function. */
    readonly commandParams: Record<string, unknown>;
}

/**
 * Resolved binding — includes the full {@link CommandDefinition} so the
 * caller can display the command title or execute it without a second
 * lookup.
 */
export interface ResolvedBinding {
    readonly binding: GestureBinding;
    readonly command: CommandDefinition;
}
