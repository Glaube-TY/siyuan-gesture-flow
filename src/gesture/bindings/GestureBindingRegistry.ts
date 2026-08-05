import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { BindingAction } from "@/config/types";
import { GestureBinding, ResolvedBinding } from "./types";

/**
 * Registry of gesture-to-action bindings (stage 6A).
 *
 * Bindings map a direction sequence (e.g. `["L"]`) to an action
 * (built-in command or keyboard shortcut).  Matching is **strict and
 * complete**: `["R"]` does not match `["R", "D"]`.
 *
 * - Empty direction sequences are rejected.
 * - Duplicate direction sequences are rejected.
 * - Duplicate binding ids are rejected.
 * - Disabled bindings never resolve.
 *
 * The registry is deliberately action-agnostic: it performs NO command
 * lookup and knows nothing about {@link CommandRegistry} or the
 * shortcut system.  Resolving only answers "which binding, if any,
 * matches these directions and is enabled?" — executing the action is
 * the action executor's job.
 *
 * **Immutability**: the registry stores deep defensive copies of every
 * binding.  {@link list}, {@link resolve}, and {@link getById} all
 * return fresh copies — external code cannot mutate internal state by
 * modifying the returned objects (including the nested action).
 *
 * **Indexing**: the registry maintains two internal indices — by
 * direction key (the primary store) and by binding id (a secondary
 * lookup).  Both indices always point to the same authoritative record;
 * {@link setEnabled} and {@link setEnabledById} update the single
 * shared object so the two indices can never diverge.
 */
export class GestureBindingRegistry {
    /** Primary store: direction-key → binding (authoritative record). */
    private readonly byKey = new Map<string, GestureBinding>();
    /** Secondary index: binding-id → direction-key. */
    private readonly idToKey = new Map<string, string>();

    /**
     * Register a single binding.
     *
     * @throws if the id is empty, the id is a duplicate, the directions
     *         are empty, or the directions are a duplicate.
     */
    register(binding: GestureBinding): void {
        const id = this.validateId(binding.id);
        if (this.idToKey.has(id)) {
            throw new Error(`Duplicate binding id: ${id}`);
        }
        if (binding.directions.length === 0) {
            throw new Error("Binding directions must not be empty");
        }
        const key = this.keyOf(binding.directions);
        if (this.byKey.has(key)) {
            throw new Error(`Duplicate binding for directions: ${key}`);
        }
        // Store a defensive deep copy — the caller retains no alias.
        this.byKey.set(key, this.cloneBinding(binding));
        this.idToKey.set(id, key);
    }

    /**
     * Register multiple bindings atomically.
     *
     * The entire batch is validated before any binding is committed.
     * If any binding fails validation, the registry is left unchanged
     * — no partial registration occurs.
     *
     * @throws if any binding is invalid or conflicts with an existing
     *         or in-batch binding.
     */
    registerMany(bindings: readonly GestureBinding[]): void {
        // Phase 1: validate the entire batch without mutating state.
        const validated: Array<{ key: string; id: string; stored: GestureBinding }> = [];
        const seenIds = new Set<string>();
        const seenKeys = new Set<string>();

        for (const binding of bindings) {
            const id = this.validateId(binding.id);
            if (this.idToKey.has(id) || seenIds.has(id)) {
                throw new Error(`Duplicate binding id: ${id}`);
            }
            if (binding.directions.length === 0) {
                throw new Error("Binding directions must not be empty");
            }
            const key = this.keyOf(binding.directions);
            if (this.byKey.has(key) || seenKeys.has(key)) {
                throw new Error(`Duplicate binding for directions: ${key}`);
            }
            validated.push({ key, id, stored: this.cloneBinding(binding) });
            seenIds.add(id);
            seenKeys.add(key);
        }

        // Phase 2: commit — all validations passed.
        for (const { key, id, stored } of validated) {
            this.byKey.set(key, stored);
            this.idToKey.set(id, key);
        }
    }

    /**
     * Resolve a direction sequence to an enabled binding.
     *
     * Returns `null` if no binding matches the exact sequence or the
     * matching binding is disabled.  The returned binding is a
     * defensive copy — mutating it does not affect the registry.
     */
    resolve(directions: readonly Direction[]): ResolvedBinding | null {
        if (directions.length === 0) return null;
        const key = this.keyOf(directions);
        const binding = this.byKey.get(key);
        if (!binding || !binding.enabled) return null;
        return {
            binding: this.cloneBinding(binding),
        };
    }

    /**
     * List all bindings as defensive deep copies.
     *
     * Mutating the returned array or any binding in it has no effect on
     * the registry.
     */
    list(): GestureBinding[] {
        return Array.from(this.byKey.values()).map((b) => this.cloneBinding(b));
    }

    /** Look up a binding by id.  Returns a defensive copy, or null. */
    getById(id: string): GestureBinding | null {
        const key = this.idToKey.get(this.validateId(id));
        if (!key) return null;
        const binding = this.byKey.get(key);
        return binding ? this.cloneBinding(binding) : null;
    }

    /** Enable or disable a binding by direction sequence. */
    setEnabled(directions: readonly Direction[], enabled: boolean): boolean {
        const key = this.keyOf(directions);
        const binding = this.byKey.get(key);
        if (!binding) return false;
        binding.enabled = enabled;
        return true;
    }

    /** Enable or disable a binding by id. */
    setEnabledById(id: string, enabled: boolean): boolean {
        const key = this.idToKey.get(this.validateId(id));
        if (!key) return false;
        const binding = this.byKey.get(key);
        if (!binding) return false;
        binding.enabled = enabled;
        return true;
    }

    // --------------------------------------------------------------- internals

    /**
     * Validate a binding id: must be non-empty after trimming.
     * Returns the trimmed id.
     */
    private validateId(rawId: string): string {
        const id = rawId?.trim();
        if (!id) {
            throw new Error("Binding id must not be empty");
        }
        return id;
    }

    /**
     * Build a stable string key from a direction sequence.
     *
     * e.g. `["R"]` → `"R"`, `["R", "D"]` → `"R-D"`.
     */
    private keyOf(directions: readonly Direction[]): string {
        return directions.join("-");
    }

    /**
     * Create a deep defensive copy of a binding, including its nested
     * action (commandParams / shortcut object).
     */
    private cloneBinding(b: GestureBinding): GestureBinding {
        return {
            id: b.id,
            enabled: b.enabled,
            directions: b.directions.slice(),
            action: cloneAction(b.action),
        };
    }
}

/** Deep-copy a binding action (builtin commandParams / shortcut object). */
export function cloneAction(action: BindingAction): BindingAction {
    if (action.type === "builtin") {
        return {
            type: "builtin",
            commandId: action.commandId,
            commandParams: { ...action.commandParams },
        };
    }
    if (action.type === "shortcut") {
        return {
            type: "shortcut",
            shortcut: { ...action.shortcut },
        };
    }
    // Unknown / invalid action type: keep it as-is (never convert to a
    // different type).  The validator and action executor reject it.
    return action;
}
