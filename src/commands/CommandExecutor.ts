import { CommandRegistry } from "./CommandRegistry";
import {
    CommandContext,
    CommandDefinition,
    CommandExecutionResult,
} from "./types";

/**
 * Executes commands with uniform error handling.
 *
 * The executor wraps every command's `execute` call in a try/catch so
 * that no unhandled rejection propagates.  Synchronous throws and
 * rejected promises are both converted into a `failed` result.
 *
 * Each session is executed at most once — a lightweight guard prevents
 * duplicate execution if the same session id is reported complete twice.
 * The guard uses a bounded LRU-style set to avoid unbounded growth.
 */
export class CommandExecutor {
    private readonly registry: CommandRegistry;
    /** Bounded set of recently executed session ids. */
    private readonly executed = new Set<number>();
    private readonly maxHistory = 64;

    constructor(registry: CommandRegistry) {
        this.registry = registry;
    }

    /**
     * Execute a command by id for the given context.
     *
     * If the session was already executed, returns `noop` without
     * re-invoking the command.
     */
    async execute(
        commandId: string,
        context: CommandContext,
        params: Record<string, unknown> = {},
    ): Promise<CommandExecutionResult> {
        // De-duplicate: each session executes at most once.
        if (this.executed.has(context.sessionId)) {
            return { status: "noop", reason: "session already executed" };
        }

        const command = this.registry.get(commandId);
        if (!command) {
            return { status: "unavailable", reason: `command not found: ${commandId}` };
        }

        // Mark as executed *before* calling, so even if the command throws
        // synchronously we do not retry.
        this.markExecuted(context.sessionId);

        try {
            // Cast to a permissive params type: the registry stores
            // commands with the default params type, but at runtime we
            // pass the binding's params object.
            const result = await (command as CommandDefinition<Record<string, unknown>>).execute(
                context,
                params,
            );
            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return {
                status: "failed",
                reason: `command ${commandId} threw`,
                error,
            };
        }
    }

    /** Whether this session has already been executed. */
    hasExecuted(sessionId: number): boolean {
        return this.executed.has(sessionId);
    }

    /** Clear the execution history (e.g. on plugin unload). */
    reset(): void {
        this.executed.clear();
    }

    /** Mark a session as executed, evicting old entries if needed. */
    private markExecuted(sessionId: number): void {
        if (this.executed.size >= this.maxHistory) {
            // Evict the oldest entry (first inserted).
            const oldest = this.executed.values().next().value;
            if (oldest !== undefined) {
                this.executed.delete(oldest);
            }
        }
        this.executed.add(sessionId);
    }
}
