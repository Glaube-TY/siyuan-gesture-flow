import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { BindingAction } from "@/config/types";

/**
 * A single gesture-to-action binding (runtime-layer shape, stage 6A).
 *
 * The registry layer only deals with direction matching — it does NOT
 * know about the CommandRegistry or how an action executes.  The action
 * itself is the same version-2 config shape used by the settings layer.
 */
export interface GestureBinding {
    /** Unique binding id (e.g. `default-L`). */
    readonly id: string;
    /** Whether this binding is active.  Disabled bindings never resolve. */
    enabled: boolean;
    /** Direction sequence that triggers the action (e.g. `["L"]`). */
    readonly directions: readonly Direction[];
    /** The action performed when the gesture is recognised. */
    readonly action: BindingAction;
}

/**
 * Resolved binding — the matched enabled binding only.  Command lookup
 * and shortcut dispatch are owned by the action executor, not by the
 * registry.
 */
export interface ResolvedBinding {
    readonly binding: GestureBinding;
}
