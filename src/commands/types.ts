import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GesturePoint } from "@/gesture/types";

/**
 * Read-only execution context passed to every command.
 *
 * Commands must not retain references to the live {@link GestureSession};
 * instead they receive this immutable snapshot.  DOM targets are
 * intentionally omitted — future context-sensitive actions will extend
 * this interface through a separate design.
 */
export interface CommandContext {
    /** Unique session identifier (matches {@link GestureSession.id}). */
    readonly sessionId: number;
    /** Final direction sequence of the completed gesture. */
    readonly directions: readonly Direction[];
    /** Gesture start point (CSS px). */
    readonly start: { readonly x: number; readonly y: number };
    /** Gesture end point (CSS px). */
    readonly end: { readonly x: number; readonly y: number };
    /** Read-only copy of the raw gesture trail. */
    readonly points: readonly { x: number; y: number }[];
    /** Gesture duration in milliseconds (null if not yet completed). */
    readonly durationMs: number | null;
    /** Key recognition metrics (no sensitive data). */
    readonly recognition: {
        readonly valid: boolean;
        readonly invalidReason: string | null;
        readonly rawPointCount: number;
        readonly sampledPointCount: number;
        readonly simplifiedPointCount: number;
    };
}

/** Result of a command execution — a discriminated union. */
export type CommandExecutionResult =
    | { status: "executed" }
    | { status: "unavailable"; reason: string }
    | { status: "noop"; reason: string }
    | { status: "failed"; reason: string; error?: string };

/** Build a CommandContext from a session and recognition result. */
export function buildCommandContext(
    sessionId: number,
    points: readonly GesturePoint[],
    result: RecognitionResult,
    durationMs: number | null,
): CommandContext {
    const trail = points.map((p) => ({ x: p.x, y: p.y }));
    const start = trail[0] ?? { x: 0, y: 0 };
    const end = trail[trail.length - 1] ?? start;
    return {
        sessionId,
        directions: result.directions,
        start,
        end,
        points: trail,
        durationMs,
        recognition: {
            valid: result.valid,
            invalidReason: result.invalidReason,
            rawPointCount: result.rawPointCount,
            sampledPointCount: result.sampledPointCount,
            simplifiedPointCount: result.simplifiedPointCount,
        },
    };
}

/**
 * A command definition registered in the {@link CommandRegistry}.
 *
 * Commands are pure declarations — they do not know about gestures, the
 * DOM, or the overlay.  The `execute` function receives a
 * {@link CommandContext} and optional params.
 */
export interface CommandDefinition<TParams = Record<string, never>> {
    /** Stable namespaced id, e.g. `tabs.previous`. */
    readonly id: string;
    /** Human-readable title (i18n key resolved by the registry consumer). */
    readonly title: string;
    /** Logical group for UI grouping, e.g. `Tabs` or `Scrolling`. */
    readonly group: string;
    /** Execute the command.  May be sync or async. */
    execute(
        context: CommandContext,
        params: TParams,
    ): Promise<CommandExecutionResult> | CommandExecutionResult;
}

/** Parameters type for a command — always an object, never undefined. */
export type CommandParams<T extends CommandDefinition> = T extends CommandDefinition<infer P>
    ? P
    : Record<string, never>;
