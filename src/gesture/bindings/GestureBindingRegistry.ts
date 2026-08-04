import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { GestureBinding, ResolvedBinding } from "./types";

/**
 * Registry of gesture-to-command bindings.
 *
 * Bindings map a direction sequence (e.g. `["L"]`) to a command id.
 * Matching is **strict and complete**: `["R"]` does not match
 * `["R", "D"]`.
 *
 * - Empty direction sequences are rejected.
 * - Duplicate direction sequences are rejected.
 * - Duplicate binding ids are rejected.
 * - Bindings referencing unregistered commands are rejected.
 * - Disabled bindings never resolve.
 *
 * **Immutability**: the registry stores deep defensive copies of every
 * binding.  {@link list}, {@link resolve}, and {@link getById} all
 * return fresh copies — external code cannot mutate internal state by
 * modifying the returned objects.  In particular, mutating the
 * `directions` array, `commandParams` object, or `enabled` flag of a
 * returned binding has no effect on the registry.
 *
 * **Indexing**: the registry maintains two internal indices — by
 * direction key (the primary store) and by binding id (a secondary
 * lookup).  Both indices always point to the same authoritative record;
 * {@link setEnabled} and {@link setEnabledById} update the single
 * shared object so the two indices can never diverge.
 *
 * The registry depends on {@link CommandRegistry} for command validation
 * but knows nothing about the DOM, the overlay, or the input layer.
 */
export class GestureBindingRegistry {
    private readonly commandRegistry: CommandRegistry;
    /** Primary store: direction-key → binding (authoritative record). */
    private readonly byKey = new Map<string, GestureBinding>();
    /** Secondary index: binding-id → direction-key. */
    private readonly idToKey = new Map<string, string>();

    constructor(commandRegistry: CommandRegistry) {
        this.commandRegistry = commandRegistry;
    }

    /**
     * Register a single binding.
     *
     * @throws if the id is empty, the id is a duplicate, the directions
     *         are empty, the directions are a duplicate, or the binding
     *         references an unregistered command.
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
        if (!this.commandRegistry.has(binding.commandId)) {
            throw new Error(`Binding references unknown command: ${binding.commandId}`);
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
            if (!this.commandRegistry.has(binding.commandId)) {
                throw new Error(`Binding references unknown command: ${binding.commandId}`);
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
     * Resolve a direction sequence to a binding.
     *
     * Returns `null` if:
     * - No binding matches the exact sequence.
     * - The matching binding is disabled.
     * - The referenced command no longer exists.
     *
     * The returned {@link ResolvedBinding.binding} is a defensive copy
     * — mutating it does not affect the registry.
     */
    resolve(directions: readonly Direction[]): ResolvedBinding | null {
        if (directions.length === 0) return null;
        const key = this.keyOf(directions);
        const binding = this.byKey.get(key);
        if (!binding || !binding.enabled) return null;
        const command = this.commandRegistry.get(binding.commandId);
        if (!command) return null;
        return {
            binding: this.cloneBinding(binding),
            command,
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
     * Create a deep defensive copy of a binding.
     *
     * `directions` (array) and `commandParams` (object) are copied so
     * external mutation cannot affect the stored binding.  `enabled`
     * is a primitive and copied by value.
     */
    private cloneBinding(b: GestureBinding): GestureBinding {
        return {
            id: b.id,
            enabled: b.enabled,
            directions: b.directions.slice(),
            commandId: b.commandId,
            commandParams: { ...b.commandParams },
        };
    }
}
