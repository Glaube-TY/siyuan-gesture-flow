import { SuppressionKey } from "@/gesture/types";
import {
    Direction,
    DirectionMode,
} from "@/gesture/recognition/DirectionVectorizer";
import {
    ConfigBinding,
    CURRENT_CONFIG_VERSION,
    GestureFlowConfig,
    SupportedConfigVersion,
    ValidationResult,
    MouseShapeGestureSpec,
} from "./types";
import {
    MAX_TOUCHPAD_FINGERS,
    MIN_TOUCHPAD_FINGERS,
    TouchpadGestureKind,
    TouchpadGestureSpec,
} from "@/gesture/touchpad/types";
import { GestureSignatureKey, mouseSignature, touchpadSignature } from "@/gesture/signature";
import { createDefaultConfig, deepCloneConfig, cloneBinding } from "./defaults";
import { validateShortcutSpec } from "@/shortcuts/shortcutUtils";
import { migrateV1toV2 } from "./migrate";

const ALLOWED_SUPPRESSION_KEYS: readonly SuppressionKey[] = [
    "Alt",
    "Control",
    "Shift",
    "Meta",
];

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

/** Diagonals — only allowed in 8-direction mode. */
const DIAGONALS: readonly Direction[] = ["UL", "UR", "DL", "DR"];

const TOUCHPAD_KINDS: readonly string[] = [
    "tap",
    "press",
    "hold",
    "swipe",
    "shape",
    "anchorDraw",
    "pinch",
    "rotate",
];

/**
 * Validate and normalise an unknown payload into a {@link GestureFlowConfig}.
 *
 * The validator understands exactly two persisted structures: the released
 * v1 schema and the current v2 schema.  A v1 payload is migrated
 * automatically (idempotent — see {@link migrateV1toV2}) and reported as
 * `normalized`.  Anything else (corrupt, future version) is `invalid` and is
 * never written back to disk by the caller.
 *
 * The validator is deliberately defensive: it never throws on bad input.
 * Outcomes:
 *
 * - `valid`      — input was already a clean current-version config.
 * - `normalized` — input was repairable (v1→v2 migration, missing fields
 *                  filled, values clamped).  {@link notes} lists every
 *                  repair.
 * - `invalid`    — input could not be safely used.  {@link config} is a
 *                  fresh default and {@link errors} lists the reasons.
 *
 * A builtin binding whose `commandId` is not registered by the current
 * version is NOT structural damage: it is preserved as-is and simply reports
 * `unavailable` at runtime.
 */
export function validateConfig(input: unknown): ValidationResult {
    const notes: string[] = [];
    const errors: string[] = [];

    // --- Root type ----------------------------------------------------------
    if (!isPlainObject(input)) {
        return invalid([`config root must be an object, got ${typeof input}`]);
    }

    // --- version + migration ------------------------------------------------
    const root = input as Record<string, unknown>;
    let payload: unknown = input;
    if (root.version === 1) {
        const migration = migrateV1toV2(root);
        payload = migration.payload;
        notes.push(...migration.notes);
        notes.push(`migrated from schema v1 to v${CURRENT_CONFIG_VERSION}`);
    } else if (root.version !== CURRENT_CONFIG_VERSION) {
        errors.push(
            `unsupported config version ${JSON.stringify(root.version)} (current is ${CURRENT_CONFIG_VERSION})`,
        );
    }
    if (errors.length > 0) {
        return invalid(errors);
    }
    const root2 = payload as Record<string, unknown>;

    // --- enabled ------------------------------------------------------------
    let enabled = createDefaultConfig().enabled;
    if (root2.enabled === undefined) {
        notes.push("missing enabled — set to default");
    } else if (typeof root2.enabled !== "boolean") {
        errors.push(`enabled must be boolean, got ${typeof root2.enabled}`);
    } else {
        enabled = root2.enabled;
    }

    const defaults = createDefaultConfig();

    // --- trigger ------------------------------------------------------------
    const triggerResult = validateTrigger(root2.trigger, defaults.trigger, notes, errors);

    // --- recognizer ---------------------------------------------------------
    const recognizerResult = validateRecognizer(
        root2.recognizer,
        defaults.recognizer,
        notes,
        errors,
    );

    // --- overlay ------------------------------------------------------------
    const overlayResult = validateOverlay(root2.overlay, defaults.overlay, notes, errors);

    // --- touchpad -----------------------------------------------------------
    const touchpadResult = validateTouchpad(root2.touchpad, defaults.touchpad, notes, errors);

    // --- bindings -----------------------------------------------------------
    const bindingsResult = validateBindings(
        root2.bindings,
        defaults.bindings,
        notes,
        errors,
        recognizerResult.directionMode,
    );

    if (errors.length > 0) {
        return invalid(errors);
    }

    const config: GestureFlowConfig = {
        version: CURRENT_CONFIG_VERSION as SupportedConfigVersion,
        enabled,
        trigger: triggerResult,
        recognizer: recognizerResult,
        overlay: overlayResult,
        touchpad: touchpadResult,
        bindings: bindingsResult,
    };

    if (notes.length === 0) {
        return { status: "valid", config: deepCloneConfig(config) };
    }
    return { status: "normalized", config: deepCloneConfig(config), notes };
}

// ----------------------------------------------------------------- helpers

function invalid(errors: string[]): ValidationResult {
    return {
        status: "invalid",
        config: createDefaultConfig(),
        errors,
    };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateTrigger(
    input: unknown,
    defaults: GestureFlowConfig["trigger"],
    notes: string[],
    errors: string[],
): GestureFlowConfig["trigger"] {
    if (input === undefined || input === null) {
        notes.push("missing trigger — using defaults");
        return { ...defaults };
    }
    if (!isPlainObject(input)) {
        errors.push(`trigger must be an object, got ${typeof input}`);
        return { ...defaults };
    }
    const o = input as Record<string, unknown>;
    return {
        button: validateButton(o.button, defaults.button, notes, errors),
        activationDistance: clampNumber(
            o.activationDistance,
            defaults.activationDistance,
            4,
            100,
            "trigger.activationDistance",
            notes,
            errors,
        ),
        suppressionKey: validateSuppressionKey(
            o.suppressionKey,
            defaults.suppressionKey,
            notes,
            errors,
        ),
        timeoutMs: clampNumber(
            o.timeoutMs,
            defaults.timeoutMs,
            0,
            10000,
            "trigger.timeoutMs",
            notes,
            errors,
        ),
    };
}

function validateButton(
    v: unknown,
    def: number,
    notes: string[],
    errors: string[],
): number {
    if (v === undefined) {
        notes.push("missing trigger.button — set to default");
        return def;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
        errors.push(`trigger.button must be an integer, got ${JSON.stringify(v)}`);
        return def;
    }
    // Only mouse button 2 (right button) is currently supported.
    if (v !== 2) {
        errors.push(`trigger.button must be 2 (right), got ${v}`);
        return def;
    }
    return v;
}

function validateSuppressionKey(
    v: unknown,
    def: SuppressionKey | null,
    notes: string[],
    errors: string[],
): SuppressionKey | null {
    if (v === undefined) {
        notes.push("missing trigger.suppressionKey — set to default");
        return def;
    }
    if (v === null) {
        return null;
    }
    if (typeof v !== "string") {
        errors.push(`trigger.suppressionKey must be string or null, got ${typeof v}`);
        return def;
    }
    if (!ALLOWED_SUPPRESSION_KEYS.includes(v as SuppressionKey)) {
        errors.push(`trigger.suppressionKey has unknown value ${JSON.stringify(v)}`);
        return def;
    }
    return v as SuppressionKey;
}

function validateRecognizer(
    input: unknown,
    defaults: GestureFlowConfig["recognizer"],
    notes: string[],
    errors: string[],
): GestureFlowConfig["recognizer"] {
    if (input === undefined || input === null) {
        notes.push("missing recognizer — using defaults");
        return { ...defaults };
    }
    if (!isPlainObject(input)) {
        errors.push(`recognizer must be an object, got ${typeof input}`);
        return { ...defaults };
    }
    const o = input as Record<string, unknown>;
    return {
        sampleDistance: clampNumber(
            o.sampleDistance,
            defaults.sampleDistance,
            1,
            100,
            "recognizer.sampleDistance",
            notes,
            errors,
        ),
        simplifyTolerance: clampNumber(
            o.simplifyTolerance,
            defaults.simplifyTolerance,
            0,
            50,
            "recognizer.simplifyTolerance",
            notes,
            errors,
        ),
        minimumSegmentLength: clampNumber(
            o.minimumSegmentLength,
            defaults.minimumSegmentLength,
            1,
            500,
            "recognizer.minimumSegmentLength",
            notes,
            errors,
        ),
        turnAngleThreshold: clampNumber(
            o.turnAngleThreshold,
            defaults.turnAngleThreshold,
            1,
            89,
            "recognizer.turnAngleThreshold",
            notes,
            errors,
        ),
        maximumSegments: clampInt(
            o.maximumSegments,
            defaults.maximumSegments,
            1,
            20,
            "recognizer.maximumSegments",
            notes,
            errors,
        ),
        directionMode: validateDirectionMode(
            o.directionMode,
            defaults.directionMode,
            notes,
            errors,
        ),
    };
}

function validateDirectionMode(
    v: unknown,
    def: DirectionMode,
    notes: string[],
    errors: string[],
): DirectionMode {
    if (v === undefined) {
        notes.push("missing recognizer.directionMode — set to default");
        return def;
    }
    if (v !== 4 && v !== 8) {
        errors.push(`recognizer.directionMode must be 4 or 8, got ${JSON.stringify(v)}`);
        return def;
    }
    return v;
}

function validateOverlay(
    input: unknown,
    defaults: GestureFlowConfig["overlay"],
    notes: string[],
    errors: string[],
): GestureFlowConfig["overlay"] {
    if (input === undefined || input === null) {
        notes.push("missing overlay — using defaults");
        return { ...defaults };
    }
    if (!isPlainObject(input)) {
        errors.push(`overlay must be an object, got ${typeof input}`);
        return { ...defaults };
    }
    const o = input as Record<string, unknown>;
    return {
        showTrail: validateBoolean(o.showTrail, defaults.showTrail, "overlay.showTrail", notes),
        showHint: validateBoolean(o.showHint, defaults.showHint, "overlay.showHint", notes),
        lineWidth: clampNumber(
            o.lineWidth,
            defaults.lineWidth,
            1,
            20,
            "overlay.lineWidth",
            notes,
            errors,
        ),
    };
}

function validateBoolean(
    v: unknown,
    def: boolean,
    field: string,
    notes: string[],
): boolean {
    if (v === undefined) {
        notes.push(`missing ${field} — set to default`);
        return def;
    }
    if (typeof v !== "boolean") {
        notes.push(`${field} not boolean — set to default`);
        return def;
    }
    return v;
}

function validateTouchpad(
    input: unknown,
    defaults: GestureFlowConfig["touchpad"],
    notes: string[],
    errors: string[],
): GestureFlowConfig["touchpad"] {
    if (input === undefined || input === null) {
        notes.push("missing touchpad — using defaults");
        return { ...defaults };
    }
    if (!isPlainObject(input)) {
        errors.push(`touchpad must be an object, got ${typeof input}`);
        return { ...defaults };
    }
    const o = input as Record<string, unknown>;
    return {
        enabled: validateBoolean(o.enabled, defaults.enabled, "touchpad.enabled", notes),
        safeMode: validateBoolean(o.safeMode, defaults.safeMode, "touchpad.safeMode", notes),
        tapMaxDurationMs: clampInt(o.tapMaxDurationMs, defaults.tapMaxDurationMs, 50, 2000, "touchpad.tapMaxDurationMs", notes, errors),
        tapMaxMovement: clampNumber(o.tapMaxMovement, defaults.tapMaxMovement, 0.005, 0.3, "touchpad.tapMaxMovement", notes, errors),
        holdDurationMs: clampInt(o.holdDurationMs, defaults.holdDurationMs, 100, 5000, "touchpad.holdDurationMs", notes, errors),
        holdMaxMovement: clampNumber(o.holdMaxMovement, defaults.holdMaxMovement, 0.005, 0.3, "touchpad.holdMaxMovement", notes, errors),
        swipeMinDistance: clampNumber(o.swipeMinDistance, defaults.swipeMinDistance, 0.02, 0.8, "touchpad.swipeMinDistance", notes, errors),
        shapeMinPathLength: clampNumber(o.shapeMinPathLength, defaults.shapeMinPathLength, 0.02, 0.8, "touchpad.shapeMinPathLength", notes, errors),
        anchorMaxDrift: clampNumber(o.anchorMaxDrift, defaults.anchorMaxDrift, 0.002, 0.2, "touchpad.anchorMaxDrift", notes, errors),
        anchorDrawActivation: clampNumber(o.anchorDrawActivation, defaults.anchorDrawActivation, 0.02, 0.8, "touchpad.anchorDrawActivation", notes, errors),
        pinchThreshold: clampNumber(o.pinchThreshold, defaults.pinchThreshold, 0.02, 0.9, "touchpad.pinchThreshold", notes, errors),
        rotateThresholdDeg: clampNumber(o.rotateThresholdDeg, defaults.rotateThresholdDeg, 5, 120, "touchpad.rotateThresholdDeg", notes, errors),
        cooldownMs: clampInt(o.cooldownMs, defaults.cooldownMs, 0, 2000, "touchpad.cooldownMs", notes, errors),
    };
}

function clampNumber(
    v: unknown,
    def: number,
    min: number,
    max: number,
    field: string,
    notes: string[],
    errors: string[],
): number {
    if (v === undefined) {
        notes.push(`missing ${field} — set to default`);
        return def;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`${field} must be a finite number, got ${JSON.stringify(v)}`);
        return def;
    }
    if (v < min) {
        notes.push(`${field}=${v} below min ${min} — clamped`);
        return min;
    }
    if (v > max) {
        notes.push(`${field}=${v} above max ${max} — clamped`);
        return max;
    }
    return v;
}

function clampInt(
    v: unknown,
    def: number,
    min: number,
    max: number,
    field: string,
    notes: string[],
    errors: string[],
): number {
    if (v === undefined) {
        notes.push(`missing ${field} — set to default`);
        return def;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
        errors.push(`${field} must be an integer, got ${JSON.stringify(v)}`);
        return def;
    }
    if (v < min) {
        notes.push(`${field}=${v} below min ${min} — clamped`);
        return min;
    }
    if (v > max) {
        notes.push(`${field}=${v} above max ${max} — clamped`);
        return max;
    }
    return v;
}

function validateBindings(
    input: unknown,
    defaults: ConfigBinding[],
    notes: string[],
    errors: string[],
    directionMode: DirectionMode = 4,
): ConfigBinding[] {
    if (input === undefined || input === null) {
        notes.push("missing bindings — using defaults");
        return defaults.map(cloneBindingShallow);
    }
    if (!Array.isArray(input)) {
        errors.push(`bindings must be an array, got ${typeof input}`);
        return defaults.map(cloneBindingShallow);
    }
    if (input.length === 0) {
        // An explicitly empty array is a VALID user choice.
        return [];
    }

    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const result: ConfigBinding[] = [];

    for (let i = 0; i < input.length; i++) {
        const raw = input[i];
        if (!isPlainObject(raw)) {
            errors.push(`bindings[${i}] must be an object`);
            continue;
        }
        const o = raw as Record<string, unknown>;

        // id
        const id = validateBindingId(o.id, seenIds, i, errors);
        if (id === null) continue;

        // enabled
        let enabled = true;
        if (o.enabled !== undefined) {
            if (typeof o.enabled !== "boolean") {
                errors.push(`bindings[${i}].enabled must be boolean`);
                continue;
            }
            enabled = o.enabled;
        } else {
            notes.push(`bindings[${i}].enabled missing — set to true`);
        }

        // source
        let source: "mouse" | "touchpad" = "mouse";
        if (o.source !== undefined) {
            if (o.source !== "mouse" && o.source !== "touchpad") {
                errors.push(`bindings[${i}].source must be "mouse" or "touchpad", got ${JSON.stringify(o.source)}`);
                continue;
            }
            source = o.source;
        } else {
            notes.push(`bindings[${i}].source missing — treated as mouse`);
        }

        // gesture
        let gesture: ConfigBinding["gesture"] | null = null;
        if (o.gesture !== undefined && o.gesture !== null) {
            if (!isPlainObject(o.gesture)) {
                errors.push(`bindings[${i}].gesture must be an object`);
                continue;
            }
            gesture = source === "mouse"
                ? validateMouseGesture(o.gesture, directionMode, enabled, i, notes, errors)
                : validateTouchpadGesture(o.gesture, directionMode, enabled, i, notes, errors);
            if (gesture === null) continue;
        } else if (Array.isArray(o.directions)) {
            // Tolerance for hand-edited / partially-migrated data: a bare
            // `directions` array is treated as a mouse shape.
            notes.push(`bindings[${i}].gesture missing — reconstructed from directions`);
            const shape = validateMouseGesture({ kind: "shape", directions: o.directions } as Record<string, unknown>, directionMode, enabled, i, notes, errors);
            if (shape === null) continue;
            gesture = shape;
        } else {
            errors.push(`bindings[${i}].gesture missing`);
            continue;
        }

        // action (unified binding action — single current structure)
        const action = validateAction(o.action, i, errors);
        if (action === null) continue;

        const signature = signatureOf(source, gesture);
        if (seenKeys.has(signature)) {
            errors.push(`duplicate binding gesture: ${signature}`);
            continue;
        }
        seenKeys.add(signature);

        result.push({ id, enabled, source, gesture, action });
    }

    if (errors.length > 0) {
        return defaults.map(cloneBindingShallow);
    }
    if (result.length === 0) {
        notes.push("bindings produced no usable entries — using defaults");
        return defaults.map(cloneBindingShallow);
    }
    return result;
}

/** Validate the shared binding id field.  Returns the trimmed id or null. */
function validateBindingId(
    v: unknown,
    seenIds: Set<string>,
    index: number,
    errors: string[],
): string | null {
    if (v === undefined) {
        errors.push(`bindings[${index}].id missing`);
        return null;
    }
    if (typeof v !== "string") {
        errors.push(`bindings[${index}].id must be string, got ${typeof v}`);
        return null;
    }
    const trimmed = v.trim();
    if (!trimmed) {
        errors.push(`bindings[${index}].id must not be empty`);
        return null;
    }
    if (seenIds.has(trimmed)) {
        errors.push(`duplicate binding id: ${trimmed}`);
        return null;
    }
    seenIds.add(trimmed);
    return trimmed;
}

/** Validate a mouse gesture (kind must be "shape"). */
function validateMouseGesture(
    input: Record<string, unknown>,
    directionMode: DirectionMode,
    enabled: boolean,
    index: number,
    notes: string[],
    errors: string[],
): MouseShapeGestureSpec | null {
    if (input.kind !== undefined && input.kind !== "shape") {
        errors.push(`bindings[${index}].gesture.kind must be "shape" for mouse, got ${JSON.stringify(input.kind)}`);
        return null;
    }
    let button = 2;
    if (input.button !== undefined) {
        if (typeof input.button !== "number" || !Number.isInteger(input.button)) {
            errors.push(`bindings[${index}].gesture.button must be an integer`);
            return null;
        }
        if (input.button !== 2) {
            errors.push(`bindings[${index}].gesture.button must be 2 (right), got ${input.button}`);
            return null;
        }
        button = input.button;
    } else {
        notes.push(`bindings[${index}].gesture.button missing — set to 2`);
    }
    const directions = validateDirections(input.directions, directionMode, enabled, index, notes, errors);
    if (directions === null) return null;
    return { kind: "shape", button, directions };
}

/** Validate a touchpad gesture descriptor. */
function validateTouchpadGesture(
    input: Record<string, unknown>,
    directionMode: DirectionMode,
    enabled: boolean,
    index: number,
    notes: string[],
    errors: string[],
): TouchpadGestureSpec | null {
    const kind = input.kind;
    if (typeof kind !== "string" || !TOUCHPAD_KINDS.includes(kind)) {
        errors.push(`bindings[${index}].gesture.kind is not a valid touchpad kind: ${JSON.stringify(kind)}`);
        return null;
    }
    const k = kind as TouchpadGestureKind;

    const fingerCount = validateFingerCount(input.fingerCount, index, notes, errors);
    if (fingerCount === null) return null;

    switch (k) {
        case "tap":
        case "press":
        case "hold":
            return { kind: k, fingerCount };
        case "swipe": {
            const direction = validateSingleDirection(input.direction, index, notes, errors);
            if (direction === null) return null;
            if (directionMode === 4 && enabled && DIAGONALS.includes(direction)) {
                errors.push(`bindings[${index}].gesture contains enabled diagonal not allowed in 4-direction mode: ${direction}`);
                return null;
            }
            return { kind: "swipe", fingerCount, direction };
        }
        case "shape": {
            const directions = validateDirections(input.directions, directionMode, enabled, index, notes, errors);
            if (directions === null) return null;
            return { kind: "shape", fingerCount, directions };
        }
        case "anchorDraw": {
            const anchorCount = validateAnchorCount(input.anchorCount, fingerCount, index, notes, errors);
            if (anchorCount === null) return null;
            const directions = validateDirections(input.directions, directionMode, enabled, index, notes, errors);
            if (directions === null) return null;
            return { kind: "anchorDraw", fingerCount, anchorCount, directions };
        }
        case "pinch": {
            const direction = input.direction;
            if (direction !== "in" && direction !== "out") {
                errors.push(`bindings[${index}].gesture.direction must be "in" or "out", got ${JSON.stringify(direction)}`);
                return null;
            }
            return { kind: "pinch", fingerCount, direction };
        }
        case "rotate": {
            const direction = input.direction;
            if (direction !== "cw" && direction !== "ccw") {
                errors.push(`bindings[${index}].gesture.direction must be "cw" or "ccw", got ${JSON.stringify(direction)}`);
                return null;
            }
            return { kind: "rotate", fingerCount, direction };
        }
        default:
            errors.push(`bindings[${index}].gesture.kind unsupported: ${JSON.stringify(kind)}`);
            return null;
    }
}

function validateFingerCount(
    v: unknown,
    index: number,
    notes: string[],
    errors: string[],
): number | null {
    if (v === undefined) {
        notes.push(`bindings[${index}].gesture.fingerCount missing — set to 2`);
        return 2;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
        errors.push(`bindings[${index}].gesture.fingerCount must be an integer, got ${JSON.stringify(v)}`);
        return null;
    }
    if (v < MIN_TOUCHPAD_FINGERS || v > MAX_TOUCHPAD_FINGERS) {
        errors.push(`bindings[${index}].gesture.fingerCount must be between ${MIN_TOUCHPAD_FINGERS} and ${MAX_TOUCHPAD_FINGERS}, got ${v}`);
        return null;
    }
    return v;
}

function validateAnchorCount(
    v: unknown,
    fingerCount: number,
    index: number,
    notes: string[],
    errors: string[],
): number | null {
    if (v === undefined) {
        notes.push(`bindings[${index}].gesture.anchorCount missing — set to 1`);
        return 1;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) {
        errors.push(`bindings[${index}].gesture.anchorCount must be an integer, got ${JSON.stringify(v)}`);
        return null;
    }
    if (v < 1 || v >= fingerCount) {
        errors.push(`bindings[${index}].gesture.anchorCount must be at least 1 and less than fingerCount (${fingerCount}), got ${v}`);
        return null;
    }
    return v;
}

function validateSingleDirection(
    v: unknown,
    index: number,
    notes: string[],
    errors: string[],
): Direction | null {
    if (typeof v !== "string" || !ALL_DIRECTIONS.includes(v as Direction)) {
        errors.push(`bindings[${index}].gesture.direction has invalid direction ${JSON.stringify(v)}`);
        return null;
    }
    void notes;
    return v as Direction;
}

function validateDirections(
    v: unknown,
    directionMode: DirectionMode,
    enabled: boolean,
    index: number,
    notes: string[],
    errors: string[],
): Direction[] | null {
    if (!Array.isArray(v)) {
        errors.push(`bindings[${index}].gesture.directions must be an array`);
        return null;
    }
    const directions: Direction[] = [];
    for (const d of v) {
        if (typeof d !== "string" || !ALL_DIRECTIONS.includes(d as Direction)) {
            errors.push(`bindings[${index}].gesture.directions has invalid direction ${JSON.stringify(d)}`);
            return null;
        }
        directions.push(d as Direction);
    }
    if (directions.length === 0) {
        errors.push(`bindings[${index}].gesture.directions must not be empty`);
        return null;
    }
    if (directionMode === 4 && enabled && directions.some((d) => DIAGONALS.includes(d))) {
        errors.push(
            `bindings[${index}].gesture contains enabled diagonals not allowed in 4-direction mode: ${directions.join("-")}`,
        );
        return null;
    }
    void notes;
    return directions;
}

/** Validate the shared action structure (unchanged from v1 semantics). */
function validateAction(
    v: unknown,
    index: number,
    errors: string[],
): ConfigBinding["action"] | null {
    if (v === undefined || v === null || !isPlainObject(v)) {
        errors.push(`bindings[${index}].action must be an object`);
        return null;
    }
    const rawAction = v as Record<string, unknown>;
    const actionType = rawAction.type;

    if (actionType === "builtin") {
        if (typeof rawAction.commandId !== "string") {
            errors.push(`bindings[${index}].action.commandId must be a string`);
            return null;
        }
        const commandId = rawAction.commandId.trim();
        if (!commandId) {
            errors.push(`bindings[${index}].action.commandId must not be empty`);
            return null;
        }
        let commandParams: Record<string, unknown> = {};
        if (rawAction.commandParams !== undefined) {
            if (!isPlainObject(rawAction.commandParams)) {
                errors.push(`bindings[${index}].action.commandParams must be a plain object`);
                return null;
            }
            commandParams = { ...(rawAction.commandParams as Record<string, unknown>) };
        }
        return { type: "builtin", commandId, commandParams };
    }

    if (actionType === "shortcut") {
        const rawTitle = rawAction.title;
        if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
            errors.push(`bindings[${index}].action.title must be a non-empty string`);
            return null;
        }
        if (rawTitle.trim().length > 80) {
            errors.push(`bindings[${index}].action.title must be at most 80 characters`);
            return null;
        }
        const rawShortcut = rawAction.shortcut;
        if (rawShortcut === undefined || rawShortcut === null || !isPlainObject(rawShortcut)) {
            errors.push(`bindings[${index}].action.shortcut must be an object`);
            return null;
        }
        const s = rawShortcut as Record<string, unknown>;
        if (Object.values(s).some((val) => typeof val === "function")) {
            errors.push(`bindings[${index}].action.shortcut must not contain functions`);
            return null;
        }
        const key = typeof s.key === "string" ? s.key : "";
        const code = typeof s.code === "string" ? s.code : "";
        const keyCode = typeof s.keyCode === "number" ? s.keyCode : 0;
        const candidate = {
            key,
            code,
            keyCode,
            ctrlKey: s.ctrlKey === true,
            altKey: s.altKey === true,
            shiftKey: s.shiftKey === true,
            metaKey: s.metaKey === true,
        };
        if (!validateShortcutSpec(candidate)) {
            errors.push(`bindings[${index}].action.shortcut is invalid`);
            return null;
        }
        return {
            type: "shortcut",
            title: rawTitle.trim(),
            shortcut: candidate,
        };
    }

    if (actionType === "javascript") {
        errors.push(`bindings[${index}].action.type "javascript" is not available in this version`);
        return null;
    }

    errors.push(`bindings[${index}].action.type unknown: ${JSON.stringify(actionType)}`);
    return null;
}

/** Canonical signature for a validated binding (for duplicate detection). */
function signatureOf(source: "mouse" | "touchpad", gesture: ConfigBinding["gesture"]): GestureSignatureKey {
    if (source === "mouse") {
        const g = gesture as MouseShapeGestureSpec;
        return mouseSignature(g.button, g.directions);
    }
    return touchpadSignature(gesture as TouchpadGestureSpec);
}

function cloneBindingShallow(b: ConfigBinding): ConfigBinding {
    return cloneBinding(b);
}
