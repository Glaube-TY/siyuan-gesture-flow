import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GestureState, InvalidReason } from "@/gesture/types";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { CommandExecutor } from "./CommandExecutor";
import { buildCommandContext, CommandExecutionResult } from "./types";

/**
 * Outcome of a single dispatch attempt.
 *
 * - `executed` — a command was found and invoked; {@link result} carries
 *   the command's own {@link CommandExecutionResult}.
 * - `skipped` — at least one execution condition failed; {@link reason}
 *   explains why without revealing sensitive data.
 */
export type DispatchResult =
    | { status: "executed"; commandId: string; result: CommandExecutionResult }
    | { status: "skipped"; reason: string };

/**
 * Coordinates gesture completion → binding resolution → command execution.
 *
 * The dispatcher is the single owner of the dispatch decision tree:
 *
 * 1. Verifies session state (must be {@link GestureState.COMPLETED}).
 * 2. Verifies recognition result (must be valid, with non-empty
 *    directions and no invalidReason).
 * 3. Resolves the binding via {@link GestureBindingRegistry}.
 * 4. Builds an immutable {@link CommandContext} snapshot.
 * 5. Delegates execution to {@link CommandExecutor}, which handles
 *    de-duplication and error containment.
 *
 * The dispatcher **never re-runs recognition** — it uses the
 * {@link RecognitionResult} produced by
 * {@link GestureFeedbackController.onComplete}.  It also never touches
 * the DOM or the SiYuan API directly; all side effects happen inside
 * the executed command.
 */
export class GestureCommandDispatcher {
    private readonly bindings: GestureBindingRegistry;
    private readonly executor: CommandExecutor;

    constructor(bindings: GestureBindingRegistry, executor: CommandExecutor) {
        this.bindings = bindings;
        this.executor = executor;
    }

    /**
     * Attempt to dispatch the command bound to a completed gesture.
     *
     * Returns `skipped` (with a reason) when any execution condition
     * fails.  Returns `executed` (with the command id and its result)
     * when a command is actually invoked.
     *
     * Execution conditions (all must hold):
     * - `session.state === COMPLETED`
     * - `result.valid === true`
     * - `result.invalidReason === null`
     * - `result.directions.length > 0`
     * - an enabled binding exists for the directions
     * - the binding references a registered command
     *
     * The dispatcher is async because the underlying CommandExecutor is
     * async.  Callers may fire-and-forget the returned promise — the
     * executor handles its own error containment, so the promise never
     * rejects.
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

        // Resolve the binding.  resolve() returns null when:
        // - no binding matches the exact directions,
        // - the matching binding is disabled, or
        // - the referenced command no longer exists.
        const resolved = this.bindings.resolve(result.directions);
        if (!resolved) {
            return { status: "skipped", reason: "no enabled binding" };
        }

        // Build an immutable snapshot — the command cannot mutate the
        // live session or recognition result.
        const context = buildCommandContext(
            session.id,
            session.points,
            result,
            session.durationMs,
        );

        // Delegate to the executor — it handles de-duplication (each
        // session runs at most once) and converts sync/async throws into
        // `failed` results.
        const execResult = await this.executor.execute(
            resolved.command.id,
            context,
            resolved.binding.commandParams,
        );

        return {
            status: "executed",
            commandId: resolved.command.id,
            result: execResult,
        };
    }
}
