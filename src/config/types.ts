import { SuppressionKey } from "@/gesture/types";
import { DirectionMode, Direction } from "@/gesture/recognition/DirectionVectorizer";
import { TouchpadGestureSpec } from "@/gesture/touchpad/types";
import type { GestureSource } from "@/gesture/signature";
import type { ShortcutSpec } from "@/shortcuts/types";

/**
 * Versioned gesture-flow plugin configuration.
 *
 * Version 1 is the first released config schema (shipped with v0.1.0).
 * v0.2.0 only adds selectable built-in commands and does not change the
 * persisted structure, so it continues to use version 1.
 *
 * **Version 2** (this release) extends {@link ConfigBinding} with an
 * explicit input source and a structured gesture descriptor so bindings can
 * come from the mouse *and* the touchpad.  The migration from v1 is
 * automatic and idempotent (see {@link validateConfig}): every legacy
 * binding becomes `source: "mouse"` + `gesture: { kind: "shape", button: 2,
 * directions }` while id / enabled / action / commandId / shortcut title /
 * shortcut spec are preserved unchanged.
 *
 * Bindings carry a single {@link BindingAction} — either a built-in
 * command action or a shortcut action.  JavaScript actions are NOT a
 * persistent type (the settings UI shows a disabled "in development"
 * placeholder that can never be saved or imported).
 *
 * All nested structures are plain JSON-serialisable data — no functions,
 * DOM nodes, events, or session objects.  This keeps `saveData` / export
 * safe and deterministic.
 */

/**
 * Current config schema version.  Version 2 introduces the input-source /
 * gesture-descriptor binding structure.
 */
export const CURRENT_CONFIG_VERSION = 2 as const;

/** Config versions this release can read. */
export type SupportedConfigVersion = 1 | 2;

/** Trigger (input-layer) configuration. */
export interface TriggerConfig {
    /** Pointer button that starts a gesture. Only button 2 (right) is allowed. */
    button: number;
    /** Movement in px required to transition PENDING -> TRACKING. */
    activationDistance: number;
    /** Modifier key that temporarily disables gestures while held (null = none). */
    suppressionKey: SuppressionKey | null;
    /** Maximum gesture duration in ms before auto-cancel (0 = no timeout). */
    timeoutMs: number;
}

/** Recognition pipeline configuration. */
export interface RecognizerConfig {
    /** Distance between resampled points (px). */
    sampleDistance: number;
    /** RDP tolerance — maximum perpendicular deviation kept (px). */
    simplifyTolerance: number;
    /** Segments shorter than this are merged away (px). */
    minimumSegmentLength: number;
    /** Heading change (degrees) required to start a new direction segment. */
    turnAngleThreshold: number;
    /** Maximum number of direction segments allowed in the final sequence. */
    maximumSegments: number;
    /** 4 = U/D/L/R, 8 = adds four diagonals. */
    directionMode: DirectionMode;
}

/** Overlay (visual feedback) configuration. */
export interface OverlayConfig {
    /** Whether the Canvas trail is drawn. When false, recognition still runs. */
    showTrail: boolean;
    /** Whether the direction/command hint element is shown. */
    showHint: boolean;
    /** Trail line width in CSS pixels. */
    lineWidth: number;
}

/**
 * Touchpad input configuration (version 2).
 *
 * Movement thresholds are expressed in **normalised touchpad-surface
 * units** (0..1) so they are independent of physical pad size.
 */
export interface TouchpadConfig {
    /** Master switch for the touchpad gesture feature. */
    enabled: boolean;
    /**
     * Safe mode (default ON): 1/2-finger gestures are never dispatched, so
     * the system's own click / scroll / right-click / pinch-zoom keep
     * working untouched.  Only 3+ finger gestures dispatch.
     */
    safeMode: boolean;
    /** Tap: maximum duration between touch-down and lift (ms). */
    tapMaxDurationMs: number;
    /** Tap: maximum per-contact movement (normalised 0..1). */
    tapMaxMovement: number;
    /** Hold: minimum duration before a hold is recognised (ms). */
    holdDurationMs: number;
    /** Hold: maximum per-contact movement (normalised 0..1). */
    holdMaxMovement: number;
    /** Swipe: minimum centroid travel before a swipe is recognised (0..1). */
    swipeMinDistance: number;
    /** Shape: minimum centroid path length before shape analysis runs (0..1). */
    shapeMinPathLength: number;
    /** AnchorDraw: maximum anchor drift (normalised 0..1). */
    anchorMaxDrift: number;
    /** AnchorDraw: minimum tracer path length to enter tracking (0..1). */
    anchorDrawActivation: number;
    /** Pinch: pairwise-distance ratio change required (e.g. 0.15 = 15%). */
    pinchThreshold: number;
    /** Rotate: cumulative angle change required (degrees). */
    rotateThresholdDeg: number;
    /** Cooldown after a completed gesture before the next can start (ms). */
    cooldownMs: number;
}

/** Action: run a built-in command through the CommandRegistry. */
export interface BuiltinBindingAction {
    readonly type: "builtin";
    /** Target command id in the CommandRegistry. */
    commandId: string;
    /** Parameters passed to the command's execute function (plain object). */
    commandParams: Record<string, unknown>;
}

/**
 * Action: dispatch a synthetic keyboard shortcut.
 *
 * `title` is a user-entered action name (plain text, trimmed, 1–80
 * chars); `shortcut` is the structured, serialisable shortcut data
 * (never a KeyboardEvent).  The title belongs to the action — it is NOT
 * part of {@link ShortcutSpec}.
 */
export interface ShortcutBindingAction {
    readonly type: "shortcut";
    /** User-defined action name (trimmed, 1–80 characters). */
    title: string;
    /** Structured, serialisable shortcut data (never a KeyboardEvent). */
    shortcut: ShortcutSpec;
}

/**
 * The union of persistent binding actions.
 *
 * JavaScript is deliberately NOT a member: it exists only as a disabled
 * "in development" option in the settings UI and can never be saved,
 * imported, or executed.
 */
export type BindingAction = BuiltinBindingAction | ShortcutBindingAction;

/** Mouse shape gesture (the only mouse gesture kind this release supports). */
export interface MouseShapeGestureSpec {
    readonly kind: "shape";
    /** Pointer button that triggers the gesture.  Only 2 (right) is allowed. */
    readonly button: number;
    /** Direction sequence that triggers the action (e.g. `["L"]`). */
    readonly directions: Direction[];
}

/** A single gesture-to-action binding (config-layer shape, version 2). */
export interface ConfigBinding {
    /** Unique binding id. */
    id: string;
    /** Whether this binding is active. */
    enabled: boolean;
    /** Input source the gesture comes from. */
    source: GestureSource;
    /** The gesture descriptor (mouse shape or a touchpad gesture). */
    gesture: MouseShapeGestureSpec | TouchpadGestureSpec;
    /** The action performed when the gesture is recognised. */
    action: BindingAction;
}

/** The full persisted plugin configuration. */
export interface GestureFlowConfig {
    version: SupportedConfigVersion;
    enabled: boolean;
    trigger: TriggerConfig;
    recognizer: RecognizerConfig;
    overlay: OverlayConfig;
    touchpad: TouchpadConfig;
    bindings: ConfigBinding[];
}

/**
 * Outcome of validating an unknown payload against the single current
 * structure.
 *
 * - `valid`      — payload was already a well-formed current config.
 * - `normalized` — payload was repaired (missing fields filled, values
 *                  clamped) into a usable current config.
 * - `invalid`    — payload could not be safely used; {@link config}
 *                  holds a fresh default and {@link errors} lists the
 *                  concrete reasons.  Corrupt, unknown or future-version
 *                  data is treated as invalid — the caller must not
 *                  overwrite the original payload.
 */
export type ValidationResult =
    | { status: "valid"; config: GestureFlowConfig }
    | { status: "normalized"; config: GestureFlowConfig; notes: string[] }
    | { status: "invalid"; config: GestureFlowConfig; errors: string[] };

/**
 * Result of a load/import operation.  Never throws bare strings — callers
 * inspect {@link status} and {@link message} to decide how to surface the
 * outcome to the user.
 */
export interface ConfigLoadResult {
    /** Whether the in-memory config is now usable (always true — defaults on failure). */
    ok: boolean;
    /** The current in-memory config (independent snapshot). */
    config: GestureFlowConfig;
    /**
     * How the config was produced:
     * - `loaded` / `normalized` — read from disk (`normalized` = the
     *   current structure was repaired and the cleaned version persisted).
     * - `defaults` — no config on disk yet (first run) or a read error.
     * - `fallback` — a config exists on disk but this version cannot use
     *   it; defaults are used temporarily and the original data is left
     *   untouched on disk.
     * - `imported` / `reset` — produced by those explicit user actions.
     * - `error` — the manager was destroyed.
     */
    source: "loaded" | "normalized" | "defaults" | "fallback" | "imported" | "reset" | "error";
    /** Human-readable detail (empty on clean loads). */
    message: string;
}

/** Listener invoked with an independent config snapshot on every change. */
export type ConfigListener = (config: GestureFlowConfig) => void;
