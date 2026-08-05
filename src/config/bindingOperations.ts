import { ConfigBinding, GestureFlowConfig } from "./types";
import {
    Direction,
    DirectionMode,
} from "@/gesture/recognition/DirectionVectorizer";

/**
 * Atomic binding configuration operations (stage 5B).
 *
 * Pure functions only: every operation takes the current bindings list
 * (or config) and returns a NEW array — the input is never mutated.
 * The settings UI uses these helpers instead of splicing the config
 * array directly, and the result is persisted through the existing
 * ConfigManager pipeline (updateConfig → migrateAndValidate → save).
 *
 * All validations here mirror the config-layer validator so the UI can
 * surface precise errors before the save round-trip:
 * - direction sequence must not be empty;
 * - segment count must not exceed `maximumSegments`;
 * - every direction must be allowed by `directionMode` (4-dir mode
 *   rejects diagonals — they are never silently rewritten);
 * - the full sequence must be unique among the other bindings
 *   (self-excluded when editing);
 * - `commandId` must exist in the catalog (when provided);
 * - `commandParams` must stay a plain object.
 */

export type BindingOperationError =
    | "empty-directions"
    | "too-many-segments"
    | "direction-not-allowed"
    | "duplicate-directions"
    | "duplicate-id"
    | "unknown-command"
    | "invalid-command-params"
    | "not-found";

export interface BindingOperationFailure {
    ok: false;
    error: BindingOperationError;
    message: string;
}

export type BindingOperationResult =
    | { ok: true; bindings: ConfigBinding[] }
    | BindingOperationFailure;

/** Editable fields of a binding (id is assigned by add/update). */
export interface BindingDraft {
    enabled: boolean;
    directions: readonly Direction[];
    commandId: string;
    commandParams?: Record<string, unknown>;
}

/** Options shared by the validating operations. */
export interface BindingValidationOptions {
    /** All current bindings (the sequence-duplicate context). */
    bindings: readonly ConfigBinding[];
    /** Binding id to exclude from the duplicate check (the one being edited). */
    excludeId?: string;
    /** Maximum direction segments allowed by the current recognizer config. */
    maximumSegments: number;
    /** Current direction mode — 4 rejects diagonals. */
    directionMode: DirectionMode;
    /** Command ids selectable in the settings (catalog). */
    availableCommandIds?: Set<string>;
}

const ALL_DIRECTIONS: readonly Direction[] = [
    "U",
    "D",
    "L",
    "R",
    "UL",
    "UR",
    "DL",
    "DR",
];

const DIAGONALS: readonly Direction[] = ["UL", "UR", "DL", "DR"];

/** Stable key of a direction sequence, e.g. `["R","D"]` → `"R-D"`. */
export function directionsKey(directions: readonly Direction[]): string {
    return directions.join("-");
}

/**
 * Generate a stable, unique binding id.
 *
 * Prefers `crypto.randomUUID()`; falls back to a time+random combination
 * when unavailable.  The result only ever contains characters that are
 * safe in a config id (lowercase letters, digits, hyphens).
 */
export function generateBindingId(): string {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") {
        return c.randomUUID();
    }
    const rand = Math.random().toString(36).slice(2, 10) || "0";
    return `gf-${Date.now().toString(36)}-${rand}`;
}

/**
 * Validate a binding draft against the current config constraints.
 *
 * Pure check — no mutation.  Used by the binding editor before saving
 * and by add/update internally.
 */
export function validateBindingDraft(
    draft: BindingDraft,
    options: BindingValidationOptions,
): { ok: true } | BindingOperationFailure {
    const { directions } = draft;

    if (directions.length === 0) {
        return fail("empty-directions", "direction sequence must not be empty");
    }
    if (directions.length > options.maximumSegments) {
        return fail(
            "too-many-segments",
            `direction sequence exceeds maximumSegments (${options.maximumSegments})`,
        );
    }
    if (options.directionMode === 4 && directions.some((d) => DIAGONALS.includes(d))) {
        return fail(
            "direction-not-allowed",
            "diagonal directions are not allowed in 4-direction mode",
        );
    }
    for (const d of directions) {
        if (!ALL_DIRECTIONS.includes(d)) {
            return fail("direction-not-allowed", `unknown direction ${JSON.stringify(d)}`);
        }
    }

    const duplicate = findDuplicateDirections(
        options.bindings,
        directions,
        options.excludeId,
    );
    if (duplicate) {
        return fail(
            "duplicate-directions",
            `another binding already uses this gesture (${directionsKey(directions)})`,
        );
    }

    if (!draft.commandId || draft.commandId.trim().length === 0) {
        return fail("unknown-command", "commandId must not be empty");
    }
    if (options.availableCommandIds && !options.availableCommandIds.has(draft.commandId)) {
        return fail("unknown-command", `unknown command ${JSON.stringify(draft.commandId)}`);
    }

    if (draft.commandParams !== undefined) {
        if (typeof draft.commandParams !== "object" || draft.commandParams === null || Array.isArray(draft.commandParams)) {
            return fail("invalid-command-params", "commandParams must be a plain object");
        }
    }

    return { ok: true };
}

/**
 * Find a binding whose full direction sequence equals the given one.
 *
 * @param excludeId  When editing, the edited binding's own id is
 *                   excluded so it does not conflict with itself.
 */
export function findDuplicateDirections(
    bindings: readonly ConfigBinding[],
    directions: readonly Direction[],
    excludeId?: string,
): ConfigBinding | null {
    const key = directionsKey(directions);
    return (
        bindings.find(
            (b) => b.id !== excludeId && directionsKey(b.directions) === key,
        ) ?? null
    );
}

/**
 * Add a new binding (fresh unique id) to the bindings list.
 *
 * Returns a new array; the input config is never modified.
 */
export function addBinding(
    config: GestureFlowConfig,
    draft: BindingDraft,
    options: Omit<BindingValidationOptions, "bindings" | "excludeId">,
): BindingOperationResult {
    const validation = validateBindingDraft(draft, {
        bindings: config.bindings,
        maximumSegments: options.maximumSegments,
        directionMode: options.directionMode,
        availableCommandIds: options.availableCommandIds,
    });
    if (!validation.ok) return validation;

    const id = generateBindingId();
    const binding: ConfigBinding = {
        id,
        enabled: draft.enabled,
        directions: draft.directions.slice(),
        commandId: draft.commandId,
        commandParams: draft.commandParams !== undefined
            ? { ...draft.commandParams }
            : {},
    };
    return { ok: true, bindings: [...config.bindings, binding] };
}

/**
 * Update an existing binding in place of its current entry.
 *
 * The binding keeps its original id.  Returns `not-found` when the id
 * does not exist.  Input is never mutated.
 */
export function updateBinding(
    config: GestureFlowConfig,
    id: string,
    draft: BindingDraft,
    options: Omit<BindingValidationOptions, "bindings">,
): BindingOperationResult {
    const existing = config.bindings.find((b) => b.id === id);
    if (!existing) {
        return fail("not-found", `binding ${JSON.stringify(id)} not found`);
    }
    const validation = validateBindingDraft(draft, {
        bindings: config.bindings,
        excludeId: id,
        maximumSegments: options.maximumSegments,
        directionMode: options.directionMode,
        availableCommandIds: options.availableCommandIds,
    });
    if (!validation.ok) return validation;

    const updated: ConfigBinding = {
        id,
        enabled: draft.enabled,
        directions: draft.directions.slice(),
        commandId: draft.commandId,
        commandParams: draft.commandParams !== undefined
            ? { ...draft.commandParams }
            : {},
    };
    return {
        ok: true,
        bindings: config.bindings.map((b) => (b.id === id ? updated : b)),
    };
}

/**
 * Remove a binding by id.
 *
 * Removing the last binding is legal — the result may be an empty
 * array, which the config layer now treats as an explicit user choice.
 * Returns `not-found` when the id does not exist.
 */
export function removeBinding(
    config: GestureFlowConfig,
    id: string,
): BindingOperationResult {
    if (!config.bindings.some((b) => b.id === id)) {
        return fail("not-found", `binding ${JSON.stringify(id)} not found`);
    }
    return { ok: true, bindings: config.bindings.filter((b) => b.id !== id) };
}

/**
 * Enable or disable a binding by id.
 *
 * Returns `not-found` when the id does not exist.  Input is never
 * mutated.
 */
export function toggleBinding(
    config: GestureFlowConfig,
    id: string,
    enabled: boolean,
): BindingOperationResult {
    if (!config.bindings.some((b) => b.id === id)) {
        return fail("not-found", `binding ${JSON.stringify(id)} not found`);
    }
    return {
        ok: true,
        bindings: config.bindings.map((b) => (b.id === id ? { ...b, enabled } : b)),
    };
}

function fail(error: BindingOperationError, message: string): BindingOperationFailure {
    return { ok: false, error, message };
}
