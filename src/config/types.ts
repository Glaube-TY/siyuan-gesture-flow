import { SuppressionKey } from "@/gesture/types";
import { DirectionMode, Direction } from "@/gesture/recognition/DirectionVectorizer";
import type { ShortcutSpec } from "@/shortcuts/types";

/**
 * Versioned gesture-flow plugin configuration.
 *
 * Stage 5A introduces persistent, validated, versioned configuration.
 * The {@link version} field drives the migration framework in
 * `migrations.ts`.  Only {@link CURRENT_CONFIG_VERSION} is produced by
 * a successful load; older on-disk data is migrated forward before the
 * rest of the plugin ever sees it.
 *
 * Stage 6A bumps the schema to version 2: bindings no longer carry a
 * top-level `commandId`/`commandParams`.  Instead each binding holds a
 * single {@link BindingAction} — either a built-in command action or a
 * keyboard-shortcut action.  JavaScript actions are NOT a persistent
 * type in this stage (the settings UI shows a disabled "in development"
 * placeholder that can never be saved or imported).
 *
 * All nested structures are plain JSON-serialisable data — no functions,
 * DOM nodes, events, or session objects.  This keeps `saveData` / export
 * safe and deterministic.
 */

/** Current config schema version.  Bump when the shape changes. */
export const CURRENT_CONFIG_VERSION = 2 as const;

/** Supported historical config versions (for migration source checks). */
export type SupportedConfigVersion = 1 | 2;

/** Trigger (input-layer) configuration. */
export interface TriggerConfig {
    /** Pointer button that starts a gesture. Stage 5A only allows 2 (right). */
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

/** Action: run a built-in command through the CommandRegistry. */
export interface BuiltinBindingAction {
    readonly type: "builtin";
    /** Target command id in the CommandRegistry. */
    commandId: string;
    /** Parameters passed to the command's execute function (plain object). */
    commandParams: Record<string, unknown>;
}

/** Action: dispatch a synthetic keyboard shortcut. */
export interface ShortcutBindingAction {
    readonly type: "shortcut";
    /** Structured, serialisable shortcut data (never a KeyboardEvent). */
    shortcut: ShortcutSpec;
}

/**
 * The union of persistent binding actions (stage 6A).
 *
 * JavaScript is deliberately NOT a member: it exists only as a disabled
 * "in development" option in the settings UI and can never be saved,
 * imported, or executed.
 */
export type BindingAction = BuiltinBindingAction | ShortcutBindingAction;

/** A single gesture-to-action binding (config-layer shape, version 2). */
export interface ConfigBinding {
    /** Unique binding id. */
    id: string;
    /** Whether this binding is active. */
    enabled: boolean;
    /** Direction sequence that triggers the action. */
    directions: Direction[];
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
    bindings: ConfigBinding[];
}

/**
 * Outcome of validating an unknown payload.
 *
 * - `valid`        — payload was already a well-formed current config.
 * - `normalized`   — payload was repaired (missing fields filled, values
 *                    clamped) into a usable current config.
 * - `invalid`      — payload could not be safely used; {@link config}
 *                    holds a fresh default and {@link errors} lists the
 *                    concrete reasons.
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
    /** "loaded" | "migrated" | "normalized" | "defaults" | "imported" | "reset" | "error" */
    source: "loaded" | "migrated" | "normalized" | "defaults" | "imported" | "reset" | "error";
    /** Human-readable detail (empty on clean loads). */
    message: string;
}

/** Listener invoked with an independent config snapshot on every change. */
export type ConfigListener = (config: GestureFlowConfig) => void;
