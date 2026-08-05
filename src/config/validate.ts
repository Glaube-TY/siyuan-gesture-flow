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
} from "./types";
import { createDefaultConfig, deepCloneConfig } from "./defaults";

/**
 * Options for {@link validateConfig}.
 *
 * {@link availableCommandIds} lets the caller inject the current
 * {@link CommandRegistry}'s command id set without the validator depending
 * on the registry directly.  When omitted, binding `commandId` existence is
 * not checked (used by pure-logic tests and by the migration path before the
 * runtime is available).
 */
export interface ValidateOptions {
    availableCommandIds?: Set<string>;
}

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

/**
 * Validate and normalise an unknown payload into a {@link GestureFlowConfig}.
 *
 * The validator is deliberately defensive: it never throws on bad input.
 * Instead it returns a {@link ValidationResult} that distinguishes three
 * outcomes:
 *
 * - `valid`      — input was already a clean current-version config.
 * - `normalized` — input was repairable (missing fields filled, values
 *                  clamped into range, unknown commandIds disabled).  The
 *                  returned config is safe to use; {@link notes} lists
 *                  every repair so the UI can inform the user.
 * - `invalid`    — input could not be safely used (wrong root type,
 *                  duplicate binding ids, duplicate direction sequences,
 *                  unknown future version).  {@link config} is a fresh
 *                  default and {@link errors} lists the concrete reasons.
 *
 * Range clamping follows the spec in the stage 5A task:
 *   activationDistance 4–100, timeoutMs 0–10000, sampleDistance > 0,
 *   simplifyTolerance >= 0, minimumSegmentLength > 0,
 *   turnAngleThreshold 1–89, maximumSegments positive integer,
 *   directionMode 4|8, lineWidth 1–20, button === 2.
 */
export function validateConfig(
    input: unknown,
    options: ValidateOptions = {},
): ValidationResult {
    const notes: string[] = [];
    const errors: string[] = [];

    // --- Root type ----------------------------------------------------------
    if (!isPlainObject(input)) {
        return invalid([`config root must be an object, got ${typeof input}`]);
    }

    const root = input as Record<string, unknown>;
    const defaults = createDefaultConfig();

    // --- version ------------------------------------------------------------
    // An unknown future version must NOT be force-downgraded.
    if (root.version === undefined) {
        // Missing version: treat as normalisable (fill current version).
        notes.push("missing version — set to current");
    } else if (typeof root.version !== "number" || !Number.isInteger(root.version)) {
        errors.push(`version must be an integer, got ${JSON.stringify(root.version)}`);
    } else if (root.version > CURRENT_CONFIG_VERSION) {
        errors.push(
            `unknown future config version ${root.version} (current is ${CURRENT_CONFIG_VERSION}) — refusing to downgrade`,
        );
    } else if (root.version < 1) {
        errors.push(`invalid config version ${root.version}`);
    }
    if (errors.length > 0) {
        return invalid(errors);
    }

    // --- enabled ------------------------------------------------------------
    let enabled = defaults.enabled;
    if (root.enabled === undefined) {
        notes.push("missing enabled — set to default");
    } else if (typeof root.enabled !== "boolean") {
        errors.push(`enabled must be boolean, got ${typeof root.enabled}`);
    } else {
        enabled = root.enabled;
    }

    // --- trigger ------------------------------------------------------------
    const triggerResult = validateTrigger(root.trigger, defaults.trigger, notes, errors);

    // --- recognizer ---------------------------------------------------------
    const recognizerResult = validateRecognizer(
        root.recognizer,
        defaults.recognizer,
        notes,
        errors,
    );

    // --- overlay ------------------------------------------------------------
    const overlayResult = validateOverlay(root.overlay, defaults.overlay, notes, errors);

    // --- bindings -----------------------------------------------------------
    const bindingsResult = validateBindings(
        root.bindings,
        defaults.bindings,
        notes,
        errors,
        options.availableCommandIds,
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
    // Stage 5A: only the right button (2) is allowed.
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
    availableCommandIds?: Set<string>,
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
        notes.push("bindings empty — using defaults");
        return defaults.map(cloneBindingShallow);
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
        let id: string;
        if (o.id === undefined) {
            errors.push(`bindings[${i}].id missing`);
            continue;
        }
        if (typeof o.id !== "string") {
            errors.push(`bindings[${i}].id must be string, got ${typeof o.id}`);
            continue;
        }
        const trimmedId = o.id.trim();
        if (!trimmedId) {
            errors.push(`bindings[${i}].id must not be empty`);
            continue;
        }
        if (seenIds.has(trimmedId)) {
            errors.push(`duplicate binding id: ${trimmedId}`);
            continue;
        }
        seenIds.add(trimmedId);
        id = trimmedId;

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

        // directions
        if (!Array.isArray(o.directions)) {
            errors.push(`bindings[${i}].directions must be an array`);
            continue;
        }
        const directions: Direction[] = [];
        let dirError = false;
        for (const d of o.directions) {
            if (typeof d !== "string" || !ALL_DIRECTIONS.includes(d as Direction)) {
                errors.push(`bindings[${i}].directions has invalid direction ${JSON.stringify(d)}`);
                dirError = true;
                break;
            }
            directions.push(d as Direction);
        }
        if (dirError) continue;
        if (directions.length === 0) {
            errors.push(`bindings[${i}].directions must not be empty`);
            continue;
        }
        // No duplicate consecutive? The spec says "方向序列不重复" — meaning
        // the whole sequence must be unique among bindings, not internal
        // duplicates.  Internal duplicates are handled by the recognizer.
        const key = directions.join("-");
        if (seenKeys.has(key)) {
            errors.push(`duplicate binding directions: ${key}`);
            continue;
        }
        seenKeys.add(key);

        // commandId
        if (o.commandId === undefined || typeof o.commandId !== "string") {
            errors.push(`bindings[${i}].commandId must be a string`);
            continue;
        }
        const commandId = o.commandId.trim();
        if (!commandId) {
            errors.push(`bindings[${i}].commandId must not be empty`);
            continue;
        }
        if (availableCommandIds && !availableCommandIds.has(commandId)) {
            // Unknown command: disable and report (do not silently execute
            // a wrong command, do not drop the binding).
            notes.push(`bindings[${i}].commandId "${commandId}" unknown — disabled`);
            enabled = false;
        }

        // commandParams
        let commandParams: Record<string, unknown> = {};
        if (o.commandParams !== undefined) {
            if (!isPlainObject(o.commandParams)) {
                errors.push(`bindings[${i}].commandParams must be a plain object`);
                continue;
            }
            commandParams = { ...(o.commandParams as Record<string, unknown>) };
        }

        result.push({
            id,
            enabled,
            directions,
            commandId,
            commandParams,
        });
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

function cloneBindingShallow(b: ConfigBinding): ConfigBinding {
    return {
        id: b.id,
        enabled: b.enabled,
        directions: b.directions.slice(),
        commandId: b.commandId,
        commandParams: { ...b.commandParams },
    };
}
