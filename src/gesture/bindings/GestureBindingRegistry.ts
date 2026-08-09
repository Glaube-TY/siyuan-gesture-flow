import { BindingAction } from "@/config/types";
import { GestureSignatureKey } from "@/gesture/signature";
import { GestureBinding, ResolvedBinding } from "./types";

/**
 * Registry of gesture-to-action bindings (version 2).
 *
 * Bindings map a canonical {@link GestureSignatureKey} (e.g.
 * `mouse:2:shape:L-D` or `touchpad:3:tap`) to an action (built-in command or
 * keyboard shortcut).  Matching is **strict and complete**: the full
 * signature must match — `mouse:2:shape:R` does not match
 * `mouse:2:shape:R-D`, and a mouse gesture never matches a touchpad one.
 *
 * - Empty signatures are rejected.
 * - Duplicate signatures are rejected.
 * - Duplicate binding ids are rejected.
 * - Disabled bindings never resolve.
 *
 * The registry is deliberately action-agnostic: it performs NO command
 * lookup and knows nothing about {@link CommandRegistry} or the shortcut
 * system.  Resolving only answers "which binding, if any, matches this
 * signature and is enabled?" — executing the action is the action
 * executor's job.
 *
 * **Immutability**: the registry stores deep defensive copies of every
 * binding.  {@link list}, {@link resolve}, and {@link getById} all return
 * fresh copies — external code cannot mutate internal state by modifying the
 * returned objects.
 */
export class GestureBindingRegistry {
    /** Primary store: signature → binding (authoritative record). */
    private readonly bySignature = new Map<string, GestureBinding>();
    /** Secondary index: binding-id → signature. */
    private readonly idToSignature = new Map<string, string>();

    /**
     * Register a single binding.
     *
     * @throws if the id is empty, the id is a duplicate, the signature is
     *         empty, or the signature is a duplicate.
     */
    register(binding: GestureBinding): void {
        const id = this.validateId(binding.id);
        if (this.idToSignature.has(id)) {
            throw new Error(`Duplicate binding id: ${id}`);
        }
        const signature = this.validateSignature(binding.signature);
        if (this.bySignature.has(signature)) {
            throw new Error(`Duplicate binding for signature: ${signature}`);
        }
        this.bySignature.set(signature, this.cloneBinding(binding));
        this.idToSignature.set(id, signature);
    }

    /**
     * Register multiple bindings atomically.
     *
     * The entire batch is validated before any binding is committed.
     *
     * @throws if any binding is invalid or conflicts with an existing or
     *         in-batch binding.
     */
    registerMany(bindings: readonly GestureBinding[]): void {
        const validated: Array<{ signature: string; id: string; stored: GestureBinding }> = [];
        const seenIds = new Set<string>();
        const seenSignatures = new Set<string>();

        for (const binding of bindings) {
            const id = this.validateId(binding.id);
            if (this.idToSignature.has(id) || seenIds.has(id)) {
                throw new Error(`Duplicate binding id: ${id}`);
            }
            const signature = this.validateSignature(binding.signature);
            if (this.bySignature.has(signature) || seenSignatures.has(signature)) {
                throw new Error(`Duplicate binding for signature: ${signature}`);
            }
            validated.push({ signature, id, stored: this.cloneBinding(binding) });
            seenIds.add(id);
            seenSignatures.add(signature);
        }

        for (const { signature, id, stored } of validated) {
            this.bySignature.set(signature, stored);
            this.idToSignature.set(id, signature);
        }
    }

    /**
     * Resolve a gesture signature to an enabled binding.
     *
     * Returns `null` if no binding matches the exact signature or the
     * matching binding is disabled.  The returned binding is a defensive
     * copy — mutating it does not affect the registry.
     */
    resolve(signature: GestureSignatureKey): ResolvedBinding | null {
        if (!signature) return null;
        const binding = this.bySignature.get(signature);
        if (!binding || !binding.enabled) return null;
        return { binding: this.cloneBinding(binding) };
    }

    /** Whether any binding (enabled or not) uses the given signature. */
    has(signature: GestureSignatureKey): boolean {
        return this.bySignature.has(signature);
    }

    /** List all bindings as defensive deep copies. */
    list(): GestureBinding[] {
        return Array.from(this.bySignature.values()).map((b) => this.cloneBinding(b));
    }

    /** Look up a binding by id.  Returns a defensive copy, or null. */
    getById(id: string): GestureBinding | null {
        const signature = this.idToSignature.get(this.validateId(id));
        if (!signature) return null;
        const binding = this.bySignature.get(signature);
        return binding ? this.cloneBinding(binding) : null;
    }

    /** Enable or disable a binding by gesture signature. */
    setEnabled(signature: GestureSignatureKey, enabled: boolean): boolean {
        const binding = this.bySignature.get(signature);
        if (!binding) return false;
        binding.enabled = enabled;
        return true;
    }

    /** Enable or disable a binding by id. */
    setEnabledById(id: string, enabled: boolean): boolean {
        const signature = this.idToSignature.get(this.validateId(id));
        if (!signature) return false;
        const binding = this.bySignature.get(signature);
        if (!binding) return false;
        binding.enabled = enabled;
        return true;
    }

    // --------------------------------------------------------------- internals

    private validateId(rawId: string): string {
        const id = rawId?.trim();
        if (!id) {
            throw new Error("Binding id must not be empty");
        }
        return id;
    }

    private validateSignature(raw: string): string {
        const signature = raw?.trim();
        if (!signature) {
            throw new Error("Binding signature must not be empty");
        }
        return signature;
    }

    private cloneBinding(b: GestureBinding): GestureBinding {
        return {
            id: b.id,
            enabled: b.enabled,
            signature: b.signature,
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
            title: action.title,
            shortcut: { ...action.shortcut },
        };
    }
    return action;
}
