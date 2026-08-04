import { CommandDefinition } from "./types";

/**
 * Registry of available commands.
 *
 * The registry is the single source of truth for command definitions.
 * It knows nothing about gestures, directions, the DOM, or the overlay.
 *
 * - Command ids must be non-empty and unique.
 * - Duplicate ids cause an explicit error (no silent override).
 * - {@link list} and {@link listByGroup} return defensive copies so
 *   external code cannot mutate internal state.
 */
export class CommandRegistry {
    private readonly commands = new Map<string, CommandDefinition>();

    /**
     * Register a single command.
     * @throws if the command id is empty or already registered.
     */
    register(command: CommandDefinition): void {
        if (!command.id || command.id.trim().length === 0) {
            throw new Error("Command id must not be empty");
        }
        if (this.commands.has(command.id)) {
            throw new Error(`Command already registered: ${command.id}`);
        }
        this.commands.set(command.id, command);
    }

    /**
     * Register multiple commands atomically.
     *
     * The entire batch is validated before any command is committed.  If
     * any command has an empty id, a duplicate id (either against the
     * registry or within the batch), the registry is left unchanged —
     * no partial registration occurs.
     *
     * @throws if any command has an empty or duplicate id.
     */
    registerMany(commands: readonly CommandDefinition[]): void {
        // Phase 1: validate the entire batch without mutating state.
        const seen = new Set<string>();
        for (const cmd of commands) {
            if (!cmd.id || cmd.id.trim().length === 0) {
                throw new Error("Command id must not be empty");
            }
            if (this.commands.has(cmd.id) || seen.has(cmd.id)) {
                throw new Error(`Command already registered: ${cmd.id}`);
            }
            seen.add(cmd.id);
        }

        // Phase 2: commit — all validations passed.
        for (const cmd of commands) {
            this.commands.set(cmd.id, cmd);
        }
    }

    /** Look up a command by id.  Returns undefined if not found. */
    get(id: string): CommandDefinition | undefined {
        return this.commands.get(id);
    }

    /** Whether a command with the given id is registered. */
    has(id: string): boolean {
        return this.commands.has(id);
    }

    /** List all registered commands (defensive copy). */
    list(): CommandDefinition[] {
        return Array.from(this.commands.values());
    }

    /** List commands in a specific group (defensive copy). */
    listByGroup(group: string): CommandDefinition[] {
        return Array.from(this.commands.values()).filter((c) => c.group === group);
    }
}
