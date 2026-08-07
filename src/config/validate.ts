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
import { validateShortcutSpec } from "@/shortcuts/shortcutUtils";

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

/** Diagonals — only allowed in 8-direction mode. */
const DIAGONALS: readonly Direction[] = ["UL", "UR", "DL", "DR"];

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
    // The validator understands exactly one current structure.  Any
    // payload whose version is not the fixed current version is invalid
    // (no version inference, no migration); the caller decides whether to
    // discard it (import) or preserve it untouched (load fallback).
    if (root.version !== CURRENT_CONFIG_VERSION) {
        errors.push(
            `unsupported config version ${JSON.stringify(root.version)} (current is ${CURRENT_CONFIG_VERSION})`,
        );
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
        // Stage 5B: an explicitly empty array is a VALID user choice —
        // the user deleted every binding.  It must NOT be replaced with
        // the default bindings.  (Only a *missing* `bindings` field
        // falls back to defaults, handled above.)
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
        // Stage 5B stabilization: 4-direction mode must not silently run
        // ENABLED diagonal bindings — reject them loudly so the UI can
        // tell the user to edit or disable them.  A *disabled* diagonal
        // binding is allowed to stay (it can be re-enabled after
        // switching back to 8-direction mode), and the runtime never
        // resolves disabled bindings, so it cannot crash on them.
        if (directionMode === 4 && enabled && directions.some((d) => DIAGONALS.includes(d))) {
            errors.push(
                `bindings[${i}].directions contains enabled diagonals not allowed in 4-direction mode: ${directions.join("-")}`,
            );
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

        // action (unified binding action — single current structure)
        if (o.action === undefined || o.action === null || !isPlainObject(o.action)) {
            errors.push(`bindings[${i}].action must be an object`);
            continue;
        }
        const rawAction = o.action as Record<string, unknown>;
        const actionType = rawAction.type;

        if (actionType === "builtin") {
            if (typeof rawAction.commandId !== "string") {
                errors.push(`bindings[${i}].action.commandId must be a string`);
                continue;
            }
            const commandId = rawAction.commandId.trim();
            if (!commandId) {
                errors.push(`bindings[${i}].action.commandId must not be empty`);
                continue;
            }
            if (availableCommandIds && !availableCommandIds.has(commandId)) {
                // Unknown command: disable and report (do not silently
                // execute a wrong command, do not drop the binding).
                notes.push(`bindings[${i}].action.commandId "${commandId}" unknown — disabled`);
                enabled = false;
            }
            let commandParams: Record<string, unknown> = {};
            if (rawAction.commandParams !== undefined) {
                if (!isPlainObject(rawAction.commandParams)) {
                    errors.push(`bindings[${i}].action.commandParams must be a plain object`);
                    continue;
                }
                commandParams = { ...(rawAction.commandParams as Record<string, unknown>) };
            }
            result.push({
                id,
                enabled,
                directions,
                action: { type: "builtin", commandId, commandParams },
            });
            continue;
        }

        if (actionType === "shortcut") {
            // User-defined action name: required, trimmed, ≤ 80 chars.
            const rawTitle = rawAction.title;
            if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
                errors.push(`bindings[${i}].action.title must be a non-empty string`);
                continue;
            }
            if (rawTitle.trim().length > 80) {
                errors.push(`bindings[${i}].action.title must be at most 80 characters`);
                continue;
            }
            const rawShortcut = rawAction.shortcut;
            if (rawShortcut === undefined || rawShortcut === null || !isPlainObject(rawShortcut)) {
                errors.push(`bindings[${i}].action.shortcut must be an object`);
                continue;
            }
            const s = rawShortcut as Record<string, unknown>;
            // Reject functions / DOM data (JSON payloads can't carry them,
            // but be strict anyway).
            if (Object.values(s).some((v) => typeof v === "function")) {
                errors.push(`bindings[${i}].action.shortcut must not contain functions`);
                continue;
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
            // Same strict key/code/keyCode consistency check as capture
            // and binding-draft validation — single source of truth.
            if (!validateShortcutSpec(candidate)) {
                errors.push(`bindings[${i}].action.shortcut is invalid`);
                continue;
            }
            result.push({
                id,
                enabled,
                directions,
                action: {
                    type: "shortcut",
                    title: rawTitle.trim(),
                    shortcut: candidate,
                },
            });
            continue;
        }

        if (actionType === "javascript") {
            // JavaScript actions are NOT a persistent type in stage 6A —
            // reject them so imports can never bypass the disabled
            // "in development" state.
            errors.push(`bindings[${i}].action.type "javascript" is not available in this version`);
            continue;
        }

        // Unknown action type: config is invalid.  Never silently convert
        // to builtin, never execute.
        errors.push(`bindings[${i}].action.type unknown: ${JSON.stringify(actionType)}`);
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
    if (b.action.type === "builtin") {
        return {
            id: b.id,
            enabled: b.enabled,
            directions: b.directions.slice(),
            action: {
                type: "builtin",
                commandId: b.action.commandId,
                commandParams: { ...b.action.commandParams },
            },
        };
    }
    return {
        id: b.id,
        enabled: b.enabled,
        directions: b.directions.slice(),
        action: {
            type: "shortcut",
            title: b.action.title,
            shortcut: { ...b.action.shortcut },
        },
    };
}
