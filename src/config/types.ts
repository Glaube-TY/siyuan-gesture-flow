import { SuppressionKey } from "@/gesture/types";
import { DirectionMode, Direction } from "@/gesture/recognition/DirectionVectorizer";
import type { ShortcutSpec } from "@/shortcuts/types";

/**
 * Versioned gesture-flow plugin configuration.
 *
 * Version 1 is the first released config schema (shipped with v0.1.0).
 * v0.2.0 only adds selectable built-in commands and does not change the
 * persisted structure, so it continues to use version 1.  The version is
 * raised only when the persisted structure itself changes, and a
 * migration is then provided.
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
 * Current config schema version.  Version 1 is the schema first released
 * with v0.1.0; v0.2.0 keeps it because the persisted structure is
 * unchanged.
 */
export const CURRENT_CONFIG_VERSION = 1 as const;

/** The only supported config version (the v0.1.0 released schema). */
export type SupportedConfigVersion = 1;

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

/** A single gesture-to-action binding (config-layer shape, version 1). */
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
