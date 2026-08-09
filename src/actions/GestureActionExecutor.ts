import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GestureState, InvalidReason } from "@/gesture/types";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { mouseSignature, GestureSignatureKey } from "@/gesture/signature";
import { CommandExecutor } from "@/commands/CommandExecutor";
import { buildCommandContext, CommandExecutionResult } from "@/commands/types";
import { ShortcutExecutor, ShortcutExecutionResult } from "@/shortcuts/ShortcutExecutor";
import { GesturePoint } from "@/gesture/types";
import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { BindingAction } from "@/config/types";

/**
 * Outcome of a single dispatch attempt.
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
 * Input for a touchpad-originated dispatch.
 *
 * `points` are normalised touchpad-surface coordinates (0..1) — commands
 * that use geometry (if any) receive these directly.
 */
export interface TouchpadDispatchInput {
    /** Monotonic session id (namespace-independent; prefixed internally). */
    sessionId: number;
    /** Canonical gesture signature of the completed gesture. */
    signature: GestureSignatureKey;
    /** Direction sequence (swipe / shape / anchorDraw), possibly empty. */
    directions: readonly Direction[];
    /** Sampled points (centroid or tracer trail). */
    points: readonly { x: number; y: number }[];
    durationMs: number | null;
}

/**
 * Coordinates gesture completion → binding resolution → action
 * execution (built-in command or synthetic keyboard shortcut).
 *
 * The dispatcher is the single owner of the dispatch decision tree for BOTH
 * input sources:
 *
 *   - mouse: {@link dispatch} — session + RecognitionResult; the mouse
 *     signature is derived from the trigger button and direction sequence.
 *   - touchpad: {@link dispatchTouchpad} — an already-resolved signature
 *     produced by the touchpad recognizer.
 *
 * Both paths share the same binding registry (signature-keyed), command
 * executor and shortcut executor, so a command bound to a mouse gesture and
 * the same command bound to a touchpad gesture dispatch identically.
 *
 * De-duplication: each session executes at most once, regardless of input
 * source or action type.
 *
 * The dispatcher never re-runs recognition; it uses the result produced by
 * the gesture controller / touchpad adapter.
 */
export class GestureActionExecutor {
    private readonly bindings: GestureBindingRegistry;
    private readonly commandExecutor: CommandExecutor;
    private readonly shortcutExecutor: ShortcutExecutor;
    /** Bounded set of recently executed session keys (cross-type dedup). */
    private readonly executedSessions = new Set<string>();
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
     * Dispatch the action bound to a completed mouse gesture.
     */
    async dispatch(
        session: GestureSession,
        result: RecognitionResult,
    ): Promise<DispatchResult> {
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

        const key = `m:${session.id}`;
        if (this.executedSessions.has(key)) {
            return { status: "skipped", reason: "session already executed" };
        }
        this.markSession(key);

        const signature = mouseSignature(session.trigger.button, result.directions);
        const resolved = this.bindings.resolve(signature);
        if (!resolved) {
            return { status: "skipped", reason: "no enabled binding" };
        }

        const context = buildCommandContext(
            session.id,
            session.points,
            result,
            session.durationMs,
        );
        return this.execute(resolved.binding.action, context);
    }

    /**
     * Dispatch the action bound to a completed touchpad gesture.
     */
    async dispatchTouchpad(input: TouchpadDispatchInput): Promise<DispatchResult> {
        if (!input.signature) {
            return { status: "skipped", reason: "empty signature" };
        }

        const key = `t:${input.sessionId}`;
        if (this.executedSessions.has(key)) {
            return { status: "skipped", reason: "session already executed" };
        }
        this.markSession(key);

        const resolved = this.bindings.resolve(input.signature);
        if (!resolved) {
            return { status: "skipped", reason: "no enabled binding" };
        }

        const resultLike = minimalRecognitionResult(input.directions, input.points.length);
        const context = buildCommandContext(
            input.sessionId,
            toGesturePoints(input.points),
            resultLike,
            input.durationMs,
        );
        return this.execute(resolved.binding.action, context);
    }

    /** Clear the execution history (e.g. on plugin unload). */
    reset(): void {
        this.executedSessions.clear();
    }

    /** Whether the registry holds any binding for the given signature. */
    hasBinding(signature: GestureSignatureKey): boolean {
        return this.bindings.has(signature);
    }

    /** Whether the registry holds any *enabled* binding for the signature. */
    hasEnabledBinding(signature: GestureSignatureKey): boolean {
        return this.bindings.resolve(signature) !== null;
    }

    // --------------------------------------------------------------- internals

    private async execute(
        action: BindingAction,
        context: ReturnType<typeof buildCommandContext>,
    ): Promise<DispatchResult> {
        if (action.type === "builtin") {
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
        if (action.type === "shortcut") {
            const execResult = this.shortcutExecutor.dispatch(action.shortcut);
            return {
                status: "executed",
                actionType: "shortcut",
                result: execResult,
            };
        }
        const actionType = (action as { type?: unknown }).type;
        return { status: "skipped", reason: `unsupported action type ${JSON.stringify(actionType)}` };
    }

    private markSession(key: string): void {
        if (this.executedSessions.size >= this.maxHistory) {
            const oldest = this.executedSessions.values().next().value;
            if (oldest !== undefined) {
                this.executedSessions.delete(oldest);
            }
        }
        this.executedSessions.add(key);
    }
}

/** Build a minimal RecognitionResult from touchpad data for the command context. */
function minimalRecognitionResult(
    directions: readonly Direction[],
    pointCount: number,
): RecognitionResult {
    return {
        valid: true,
        invalidReason: null,
        directions: directions.slice(),
        rawDirections: directions.slice(),
        segments: [],
        rawPointCount: pointCount,
        sampledPointCount: pointCount,
        simplifiedPointCount: pointCount,
        cancelled: false,
        cancelReason: null,
    };
}

/** Convert plain touchpad points to GesturePoint (timestamps defaulted). */
function toGesturePoints(points: readonly { x: number; y: number }[]): GesturePoint[] {
    return points.map((p, i) => ({ x: p.x, y: p.y, t: i * 16 }));
}
