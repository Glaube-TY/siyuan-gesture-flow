import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GestureState, InvalidReason } from "@/gesture/types";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { CommandExecutor } from "@/commands/CommandExecutor";
import { buildCommandContext, CommandExecutionResult } from "@/commands/types";
import { ShortcutExecutor, ShortcutExecutionResult } from "@/shortcuts/ShortcutExecutor";

/**
 * Outcome of a single dispatch attempt (stage 6A).
 *
 * - `executed` — an action was actually invoked; `actionType` says
 *   which kind and `result` carries the underlying executor result.
 * - `skipped` — at least one execution condition failed; `reason`
 *   explains why without revealing sensitive data.
 */
export type DispatchResult =
    | {
          status: "executed";
          actionType: "builtin";
          commandId: string;
          result: CommandExecutionResult;
      }
    | {
          status: "executed";
          actionType: "shortcut";
          result: ShortcutExecutionResult;
      }
    | { status: "skipped"; reason: string };

/**
 * Coordinates gesture completion → binding resolution → action
 * execution (built-in command or synthetic keyboard shortcut).
 *
 * The dispatcher is the single owner of the dispatch decision tree:
 *
 * 1. Verifies session state (must be {@link GestureState.COMPLETED}).
 * 2. Verifies recognition result (must be valid, non-empty directions,
 *    no invalidReason).
 * 3. Resolves the enabled binding via {@link GestureBindingRegistry}
 *    (which is action-agnostic).
 * 4. Builds an immutable {@link CommandContext} snapshot.
 * 5. Dispatches by `binding.action.type`:
 *    - `builtin` → {@link CommandExecutor}
 *    - `shortcut` → {@link ShortcutExecutor}
 *    JavaScript is deliberately absent from the runtime branch.
 *
 * De-duplication: each session executes at most once, regardless of
 * action type (a bounded LRU-style set, mirroring CommandExecutor).
 *
 * The dispatcher **never re-runs recognition** — it uses the
 * {@link RecognitionResult} produced by the gesture controller.  It
 * never touches the DOM or the SiYuan API directly; all side effects
 * happen inside the executed command / dispatched event.
 */
export class GestureActionExecutor {
    private readonly bindings: GestureBindingRegistry;
    private readonly commandExecutor: CommandExecutor;
    private readonly shortcutExecutor: ShortcutExecutor;
    /** Bounded set of recently executed session ids (cross-type dedup). */
    private readonly executedSessions = new Set<number>();
    private readonly maxHistory = 64;

    constructor(
        bindings: GestureBindingRegistry,
        commandExecutor: CommandExecutor,
        shortcutExecutor: ShortcutExecutor,
    ) {
        this.bindings = bindings;
        this.commandExecutor = commandExecutor;
        this.shortcutExecutor = shortcutExecutor;
    }

    /**
     * Attempt to dispatch the action bound to a completed gesture.
     *
     * Returns `skipped` (with a reason) when any execution condition
     * fails.  Returns `executed` (with the action type and its result)
     * when an action is actually invoked.
     *
     * The dispatcher is async because the underlying CommandExecutor is
     * async.  Callers may fire-and-forget the returned promise — the
     * executors handle their own error containment, so the promise
     * never rejects.
     */
    async dispatch(
        session: GestureSession,
        result: RecognitionResult,
    ): Promise<DispatchResult> {
        // --- Execution conditions (all must hold) ---
        if (session.state !== GestureState.COMPLETED) {
            return { status: "skipped", reason: `session state is ${session.state}` };
        }
        if (!result.valid) {
            return { status: "skipped", reason: `result invalid (${result.invalidReason})` };
        }
        if (result.invalidReason !== null) {
            const reason: InvalidReason = result.invalidReason;
            return { status: "skipped", reason: `invalidReason=${reason}` };
        }
        if (result.directions.length === 0) {
            return { status: "skipped", reason: "empty directions" };
        }

        // Cross-type session de-duplication: each completed gesture
        // executes its action at most once.
        if (this.executedSessions.has(session.id)) {
            return { status: "skipped", reason: "session already executed" };
        }
        this.markSession(session.id);

        // Resolve the enabled binding (registry is action-agnostic).
        const resolved = this.bindings.resolve(result.directions);
        if (!resolved) {
            return { status: "skipped", reason: "no enabled binding" };
        }
        const action = resolved.binding.action;

        if (action.type === "builtin") {
            const context = buildCommandContext(
                session.id,
                session.points,
                result,
                session.durationMs,
            );
            const execResult = await this.commandExecutor.execute(
                action.commandId,
                context,
                action.commandParams,
            );
            return {
                status: "executed",
                actionType: "builtin",
                commandId: action.commandId,
                result: execResult,
            };
        }

        // shortcut action
        if (action.type === "shortcut") {
            const execResult = this.shortcutExecutor.dispatch(action.shortcut);
            return {
                status: "executed",
                actionType: "shortcut",
                result: execResult,
            };
        }

        // Unknown / invalid action type (e.g. a malicious "javascript"
        // payload): never execute, never fall through.
        const actionType = (action as { type?: unknown }).type;
        return { status: "skipped", reason: `unsupported action type ${JSON.stringify(actionType)}` };
    }

    /** Clear the execution history (e.g. on plugin unload). */
    reset(): void {
        this.executedSessions.clear();
    }

    /** Mark a session as executed, evicting old entries if needed. */
    private markSession(sessionId: number): void {
        if (this.executedSessions.size >= this.maxHistory) {
            const oldest = this.executedSessions.values().next().value;
            if (oldest !== undefined) {
                this.executedSessions.delete(oldest);
            }
        }
        this.executedSessions.add(sessionId);
    }
}
