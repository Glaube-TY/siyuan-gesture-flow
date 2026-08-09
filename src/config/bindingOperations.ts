import { BindingAction, BuiltinBindingAction, ConfigBinding, GestureFlowConfig, ShortcutBindingAction, MouseShapeGestureSpec } from "./types";
import {
    Direction,
    DirectionMode,
} from "@/gesture/recognition/DirectionVectorizer";
import {
    MAX_TOUCHPAD_FINGERS,
    MIN_TOUCHPAD_FINGERS,
    TouchpadGestureSpec,
    hasDirections,
    specDirections,
} from "@/gesture/touchpad/types";
import { GestureSource, GestureSignatureKey, mouseSignature, touchpadSignature } from "@/gesture/signature";
import { isValidShortcut } from "@/shortcuts/shortcutUtils";

/**
 * Atomic binding configuration operations (version-2 descriptors).
 *
 * Pure functions only: every operation takes the current bindings list
 * (or config) and returns a NEW array — the input is never mutated.
 *
 * Validations mirror the config-layer validator (v2): id uniqueness, gesture
 * uniqueness by canonical signature (so a mouse `L` and a touchpad `3:tap`
 * never collide), descriptor shape, direction-mode compatibility, and the
 * same action rules as before.
 */

export type BindingOperationError =
    | "empty-directions"
    | "too-many-segments"
    | "direction-not-allowed"
    | "duplicate-directions"
    | "duplicate-id"
    | "unknown-command"
    | "invalid-command-params"
    | "invalid-shortcut"
    | "not-found"
    | "invalid-gesture";

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
    source: GestureSource;
    /** The gesture descriptor (mouse shape or touchpad gesture). */
    gesture: ConfigBinding["gesture"];
    /** The action this binding performs (builtin command or shortcut). */
    action: BindingAction;
}

/** Options shared by the validating operations. */
export interface BindingValidationOptions {
    /** All current bindings (the gesture-duplicate context). */
    bindings: readonly ConfigBinding[];
    /** Binding id to exclude from the duplicate check (the one being edited). */
    excludeId?: string;
    /** Maximum direction segments allowed by the current recognizer config. */
    maximumSegments: number;
    /** Current direction mode — 4 rejects diagonals. */
    directionMode: DirectionMode;
    /** Command ids selectable in the settings (catalog). */
    availableCommandIds?: Set<string>;
    /** Command id already present on the binding being edited. */
    preserveCommandId?: string;
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

/** Stable key of a mouse direction sequence, e.g. `["R","D"]` → `"R-D"`. */
export function directionsKey(directions: readonly Direction[]): string {
    return directions.join("-");
}

/**
 * Canonical signature of a binding (its gesture uniqueness key).
 *
 * Two bindings conflict only when their full signatures are equal — a mouse
 * `L` and a touchpad `3:tap` are different gestures.
 */
export function bindingSignature(source: GestureSource, gesture: ConfigBinding["gesture"]): GestureSignatureKey {
    if (source === "mouse") {
        const g = gesture as MouseShapeGestureSpec;
        return mouseSignature(g.button, g.directions);
    }
    return touchpadSignature(gesture as TouchpadGestureSpec);
}

/**
 * Generate a stable, unique binding id.
 *
 * Prefers `crypto.randomUUID()`; falls back to a time+random combination
 * when unavailable.
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
 * Pure check — no mutation.  Direction-mode compatibility: in 4-direction
 * mode, ONLY *enabled* diagonal-bearing gestures are rejected.
 */
export function validateBindingDraft(
    draft: BindingDraft,
    options: BindingValidationOptions,
): { ok: true } | BindingOperationFailure {
    const { gesture, source } = draft;

    // --- Gesture descriptor shape ---
    if (source === "mouse") {
        const g = gesture as MouseShapeGestureSpec;
        if (g.kind !== "shape") {
            return fail("invalid-gesture", "mouse gesture must be a shape");
        }
        if (g.directions.length === 0) {
            return fail("empty-directions", "direction sequence must not be empty");
        }
        if (g.directions.length > options.maximumSegments) {
            return fail(
                "too-many-segments",
                `direction sequence exceeds maximumSegments (${options.maximumSegments})`,
            );
        }
        if (options.directionMode === 4 && draft.enabled && g.directions.some((d) => DIAGONALS.includes(d))) {
            return fail("direction-not-allowed", "diagonal directions cannot be enabled in 4-direction mode");
        }
        for (const d of g.directions) {
            if (!ALL_DIRECTIONS.includes(d)) {
                return fail("direction-not-allowed", `unknown direction ${JSON.stringify(d)}`);
            }
        }
    } else {
        const g = gesture as TouchpadGestureSpec;
        const kindError = validateTouchpadDescriptor(g, draft.enabled, options);
        if (kindError) return kindError;
    }

    // --- Gesture uniqueness by signature ---
    const duplicate = findDuplicateGesture(options.bindings, source, gesture, options.excludeId);
    if (duplicate) {
        return fail(
            "duplicate-directions",
            `another binding already uses this gesture (${bindingSignature(source, gesture)})`,
        );
    }

    // --- Action ---
    const actionError = validateDraftAction(draft.action, options);
    if (actionError) return actionError;

    return { ok: true };
}

function validateTouchpadDescriptor(
    g: TouchpadGestureSpec,
    enabled: boolean,
    options: BindingValidationOptions,
): BindingOperationFailure | null {
    if (g.fingerCount < MIN_TOUCHPAD_FINGERS || g.fingerCount > MAX_TOUCHPAD_FINGERS) {
        return fail("invalid-gesture", `fingerCount must be between ${MIN_TOUCHPAD_FINGERS} and ${MAX_TOUCHPAD_FINGERS}`);
    }
    if (hasDirections(g)) {
        const dirs = specDirections(g);
        if (dirs.length === 0) {
            return fail("empty-directions", "gesture needs at least one direction");
        }
        if (dirs.length > options.maximumSegments) {
            return fail("too-many-segments", `gesture exceeds maximumSegments (${options.maximumSegments})`);
        }
        for (const d of dirs) {
            if (!ALL_DIRECTIONS.includes(d)) {
                return fail("direction-not-allowed", `unknown direction ${JSON.stringify(d)}`);
            }
        }
        if (enabled && options.directionMode === 4 && dirs.some((d) => DIAGONALS.includes(d))) {
            return fail("direction-not-allowed", "diagonal directions cannot be enabled in 4-direction mode");
        }
    }
    if (g.kind === "anchorDraw") {
        if (g.anchorCount < 1 || g.anchorCount >= g.fingerCount) {
            return fail("invalid-gesture", "anchorCount must be at least 1 and less than fingerCount");
        }
    }
    return null;
}

function validateDraftAction(
    action: BindingAction,
    options: BindingValidationOptions,
): BindingOperationFailure | null {
    const actionType = action.type;
    if (actionType === "builtin") {
        const builtin = action as BuiltinBindingAction;
        const commandId = builtin.commandId;
        if (!commandId || commandId.trim().length === 0) {
            return fail("unknown-command", "commandId must not be empty");
        }
        if (options.availableCommandIds && !options.availableCommandIds.has(commandId)) {
            if (options.preserveCommandId !== commandId) {
                return fail("unknown-command", `unknown command ${JSON.stringify(commandId)}`);
            }
        }
        const cp = builtin.commandParams;
        if (cp !== undefined) {
            if (typeof cp !== "object" || cp === null || Array.isArray(cp)) {
                return fail("invalid-command-params", "commandParams must be a plain object");
            }
        }
    } else if (actionType === "shortcut") {
        const sc = action as ShortcutBindingAction;
        const title = typeof sc.title === "string" ? sc.title.trim() : "";
        if (title.length === 0) {
            return fail("invalid-shortcut", "action title must not be empty");
        }
        if (title.length > 80) {
            return fail("invalid-shortcut", "action title must be at most 80 characters");
        }
        if (!isValidShortcut(sc.shortcut)) {
            return fail("invalid-shortcut", "shortcut is invalid or empty");
        }
    } else {
        return fail("unknown-command", `unsupported action type ${JSON.stringify(actionType)}`);
    }
    return null;
}

/**
 * Find a binding whose canonical gesture signature equals the given one.
 *
 * @param excludeId  When editing, the edited binding's own id is excluded.
 */
export function findDuplicateGesture(
    bindings: readonly ConfigBinding[],
    source: GestureSource,
    gesture: ConfigBinding["gesture"],
    excludeId?: string,
): ConfigBinding | null {
    const key = bindingSignature(source, gesture);
    return (
        bindings.find(
            (b) => b.id !== excludeId && bindingSignature(b.source, b.gesture) === key,
        ) ?? null
    );
}

/** Backwards-compatible alias used by older call sites. */
export function findDuplicateDirections(
    bindings: readonly ConfigBinding[],
    directions: readonly Direction[],
    excludeId?: string,
): ConfigBinding | null {
    return findDuplicateGesture(bindings, "mouse", { kind: "shape", button: 2, directions: directions.slice() }, excludeId);
}

/**
 * Add a new binding (fresh unique id) to the bindings list.
 *
 * The generated id is checked against the existing bindings; on a collision a
 * new id is generated (bounded retries).  The input config is never modified.
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

    const existingIds = new Set(config.bindings.map((b) => b.id));
    let id: string | null = null;
    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt++) {
        const candidate = generateBindingId();
        if (!existingIds.has(candidate)) {
            id = candidate;
            break;
        }
    }
    if (id === null) {
        return fail("duplicate-id", "could not generate a unique binding id");
    }

    const binding: ConfigBinding = {
        id,
        enabled: draft.enabled,
        source: draft.source,
        gesture: cloneGesture(draft.gesture),
        action: cloneAction(draft.action),
    };
    return { ok: true, bindings: [...config.bindings, binding] };
}

const MAX_ID_GENERATION_ATTEMPTS = 10;

/**
 * Find bindings that are incompatible with the given direction mode:
 * *enabled* bindings containing diagonals while in 4-direction mode.
 */
export function findIncompatibleBindings(
    bindings: readonly ConfigBinding[],
    directionMode: DirectionMode,
): ConfigBinding[] {
    if (directionMode !== 4) return [];
    return bindings.filter(
        (b) =>
            b.enabled &&
            (b.source === "mouse"
                ? (b.gesture as MouseShapeGestureSpec).directions.some((d) => DIAGONALS.includes(d))
                : specDirections(b.gesture as TouchpadGestureSpec).some((d) => DIAGONALS.includes(d))),
    );
}

/**
 * Update an existing binding in place of its current entry.
 *
 * The binding keeps its original id.  Returns `not-found` when the id does
 * not exist.  Input is never mutated.
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
        preserveCommandId:
            existing.action.type === "builtin" ? existing.action.commandId : undefined,
    });
    if (!validation.ok) return validation;

    const updated: ConfigBinding = {
        id,
        enabled: draft.enabled,
        source: draft.source,
        gesture: cloneGesture(draft.gesture),
        action: cloneAction(draft.action),
    };
    return {
        ok: true,
        bindings: config.bindings.map((b) => (b.id === id ? updated : b)),
    };
}

/** Deep-copy a binding action (builtin commandParams / shortcut object). */
export function cloneAction(action: BindingAction): BindingAction {
    if (action.type === "builtin") {
        return {
            type: "builtin",
            commandId: action.commandId,
            commandParams: { ...action.commandParams },
        };
    }
    if (action.type === "shortcut") {
        return {
            type: "shortcut",
            title: action.title,
            shortcut: { ...action.shortcut },
        };
    }
    return action;
}

/** Deep-copy a gesture descriptor. */
function cloneGesture(gesture: ConfigBinding["gesture"]): ConfigBinding["gesture"] {
    if ("button" in gesture) {
        const g = gesture as MouseShapeGestureSpec;
        return { kind: "shape", button: g.button, directions: g.directions.slice() };
    }
    const spec = gesture as TouchpadGestureSpec;
    if (spec.kind === "swipe") return { kind: "swipe", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "pinch") return { kind: "pinch", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "rotate") return { kind: "rotate", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "shape") return { kind: "shape", fingerCount: spec.fingerCount, directions: spec.directions.slice() };
    if (spec.kind === "anchorDraw") {
        return { kind: "anchorDraw", fingerCount: spec.fingerCount, anchorCount: spec.anchorCount, directions: spec.directions.slice() };
    }
    return { kind: spec.kind, fingerCount: spec.fingerCount };
}

/**
 * Remove a binding by id.
 *
 * Removing the last binding is legal — the result may be an empty array.
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
 * Enabling a diagonal-bearing gesture while in 4-direction mode is rejected.
 */
export function toggleBinding(
    config: GestureFlowConfig,
    id: string,
    enabled: boolean,
    directionMode: DirectionMode = 4,
): BindingOperationResult {
    const target = config.bindings.find((b) => b.id === id);
    if (!target) {
        return fail("not-found", `binding ${JSON.stringify(id)} not found`);
    }
    if (enabled && directionMode === 4) {
        const dirs =
            target.source === "mouse"
                ? (target.gesture as MouseShapeGestureSpec).directions
                : specDirections(target.gesture as TouchpadGestureSpec);
        if (dirs.some((d) => DIAGONALS.includes(d))) {
            return fail("direction-not-allowed", "diagonal gesture cannot be enabled in 4-direction mode");
        }
    }
    return {
        ok: true,
        bindings: config.bindings.map((b) => (b.id === id ? { ...b, enabled } : b)),
    };
}

function fail(error: BindingOperationError, message: string): BindingOperationFailure {
    return { ok: false, error, message };
}
