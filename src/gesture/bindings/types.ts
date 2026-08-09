import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { BindingAction } from "@/config/types";
import { GestureSignatureKey } from "@/gesture/signature";

/**
 * A single gesture-to-action binding (runtime-layer shape, version 2).
 *
 * The registry layer only deals with signature matching — it does NOT know
 * about the CommandRegistry or how an action executes.  Bindings are keyed by
 * the canonical {@link GestureSignatureKey} (e.g. `mouse:2:shape:L` or
 * `touchpad:3:tap`) so different input sources never collide.
 *
 * `directions` is kept only for the mouse overlay hint (the direction
 * sequence shown while drawing); touchpad bindings may carry it too for
 * direction-bearing kinds but matching never uses it.
 */
export interface GestureBinding {
    /** Unique binding id (e.g. `default-L`). */
    readonly id: string;
    /** Whether this binding is active.  Disabled bindings never resolve. */
    enabled: boolean;
    /** Canonical gesture signature that triggers the action. */
    readonly signature: GestureSignatureKey;
    /** Direction sequence (mouse shape / touchpad swipe/shape/anchorDraw). */
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
