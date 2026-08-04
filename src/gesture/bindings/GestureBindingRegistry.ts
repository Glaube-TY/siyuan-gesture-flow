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
 * - Bindings referencing unregistered commands are rejected.
 * - Disabled bindings never resolve.
 *
 * The registry depends on {@link CommandRegistry} for command validation
 * but knows nothing about the DOM, the overlay, or the input layer.
 */
export class GestureBindingRegistry {
    private readonly commandRegistry: CommandRegistry;
    private readonly bindings = new Map<string, GestureBinding>();

    constructor(commandRegistry: CommandRegistry) {
        this.commandRegistry = commandRegistry;
    }

    /**
     * Register a binding.
     *
     * @throws if directions are empty, a duplicate, or reference an
     *         unregistered command.
     */
    register(binding: GestureBinding): void {
        if (binding.directions.length === 0) {
            throw new Error("Binding directions must not be empty");
        }
        const key = this.keyOf(binding.directions);
        if (this.bindings.has(key)) {
            throw new Error(`Duplicate binding for directions: ${key}`);
        }
        if (!this.commandRegistry.has(binding.commandId)) {
            throw new Error(`Binding references unknown command: ${binding.commandId}`);
        }
        // Store a defensive copy.
        this.bindings.set(key, {
            ...binding,
            directions: binding.directions.slice(),
            commandParams: { ...binding.commandParams },
        });
    }

    /** Register multiple bindings at once. */
    registerMany(bindings: readonly GestureBinding[]): void {
        for (const b of bindings) {
            this.register(b);
        }
    }

    /**
     * Resolve a direction sequence to a binding.
     *
     * Returns `null` if:
     * - No binding matches the exact sequence.
     * - The matching binding is disabled.
     */
    resolve(directions: readonly Direction[]): ResolvedBinding | null {
        if (directions.length === 0) return null;
        const key = this.keyOf(directions);
        const binding = this.bindings.get(key);
        if (!binding || !binding.enabled) return null;
        const command = this.commandRegistry.get(binding.commandId);
        if (!command) return null;
        return { binding, command };
    }

    /** List all bindings (defensive copy). */
    list(): GestureBinding[] {
        return Array.from(this.bindings.values());
    }

    /** Enable or disable a binding by direction key. */
    setEnabled(directions: readonly Direction[], enabled: boolean): boolean {
        const key = this.keyOf(directions);
        const binding = this.bindings.get(key);
        if (!binding) return false;
        binding.enabled = enabled;
        return true;
    }

    /**
     * Build a stable string key from a direction sequence.
     *
     * e.g. `["R"]` → `"R"`, `["R", "D"]` → `"R-D"`.
     */
    private keyOf(directions: readonly Direction[]): string {
        return directions.join("-");
    }
}
