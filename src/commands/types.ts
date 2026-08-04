import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { GesturePoint, InvalidReason } from "@/gesture/types";

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
    /** Final direction sequence of the completed gesture (deep copy). */
    readonly directions: readonly Direction[];
    /** Gesture start point (CSS px) — independent object, no shared reference. */
    readonly start: { readonly x: number; readonly y: number };
    /** Gesture end point (CSS px) — independent object, no shared reference. */
    readonly end: { readonly x: number; readonly y: number };
    /** Read-only deep copy of the raw gesture trail. */
    readonly points: readonly { readonly x: number; readonly y: number }[];
    /** Gesture duration in milliseconds (null if not yet completed). */
    readonly durationMs: number | null;
    /** Key recognition metrics (no sensitive data). */
    readonly recognition: {
        readonly valid: boolean;
        readonly invalidReason: InvalidReason | null;
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

/**
 * Build a CommandContext from a session's raw data and recognition result.
 *
 * All arrays and objects are **deep-copied** so the context is a fully
 * independent snapshot — modifying the original session or result after
 * building the context has no effect on the context.
 */
export function buildCommandContext(
    sessionId: number,
    points: readonly GesturePoint[],
    result: RecognitionResult,
    durationMs: number | null,
): CommandContext {
    // Deep-copy trail points — each point is a fresh object.
    const trail = points.map((p) => ({ x: p.x, y: p.y }));
    // start and end are independent objects (not aliases into trail).
    const first = points[0];
    const last = points[points.length - 1];
    const start = first ? { x: first.x, y: first.y } : { x: 0, y: 0 };
    const end = last ? { x: last.x, y: last.y } : { x: start.x, y: start.y };
    return {
        sessionId,
        // Deep-copy directions so external mutation of result.directions
        // cannot affect the context.
        directions: result.directions.slice(),
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
