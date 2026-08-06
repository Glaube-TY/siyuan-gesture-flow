import {
    CURRENT_CONFIG_VERSION,
    GestureFlowConfig,
    SupportedConfigVersion,
    ValidationResult,
} from "./types";
import { createDefaultConfig } from "./defaults";
import { validateConfig, ValidateOptions } from "./validate";

/**
 * Migration framework for versioned gesture-flow configuration.
 *
 * Stage 5A ships only version 1, but the framework is designed so that
 * future schema changes can be applied incrementally without touching
 * `ConfigManager` or the runtime.  Each migration is a pure function
 * `v(N) -> v(N+1)`; the runner chains them in order.
 *
 * Principles:
 * - Migration functions are **pure**: they take a plain object and return
 *   a plain object.  They never call `saveData`, never touch the DOM,
 *   never log, and never throw on malformed input (they return a
 *   `MigrationFailure` instead so the caller can fall back to defaults).
 * - Unknown **future** versions are never force-downgraded.  If the
 *   on-disk `version` is greater than {@link CURRENT_CONFIG_VERSION},
 *   migration refuses to run and the caller falls back to defaults.
 * - Missing `version` is treated as "needs migration from the earliest
 *   known shape" — in practice this means the validator/normaliser fills
 *   in every missing field with the current default.
 *
 * Flow used by {@link migrateAndValidate}:
 *
 *   raw data
 *     -> detect version (refuse future versions)
 *     -> run migrations v(N)..v(CURRENT) in order
 *     -> validateConfig (normalise + range-clamp + binding check)
 *     -> return result
 *
 * On any migration failure the result is `invalid` with a fresh default
 * config — the caller (ConfigManager) decides whether to persist it.
 */

/**
 * A single migration step: transform a v(N) payload into a v(N+1) payload.
 *
 * The function must be pure and must not throw.  On failure it returns
 * a {@link MigrationFailure} so the runner can abort the chain.
 */
type MigrationStep = (
    input: Record<string, unknown>,
) => Record<string, unknown> | MigrationFailure;

/**
 * Outcome of a migration step that could not complete.
 *
 * The runner collects these into a final `invalid` validation result.
 */
interface MigrationFailure {
    error: string;
}

/**
 * Ordered map of migrations: source version -> step function.
 *
 * To add a migration from v1 to v2 in the future:
 *   MIGRATIONS.set(1, migrateV1ToV2);
 *
 * The runner starts at the payload's detected version and applies each
 * step in ascending order until it reaches {@link CURRENT_CONFIG_VERSION}.
 */
const MIGRATIONS = new Map<number, MigrationStep>();

/**
 * v1 → v2 migration (stage 6A): wrap legacy top-level `commandId` /
 * `commandParams` into a `builtin` action.
 *
 * Pure function: takes a plain v1 payload, returns a plain v2 payload.
 * Never calls saveData, never touches the DOM, never throws.  Binding
 * id / enabled / directions are preserved untouched; empty bindings
 * stay empty; unknown or malformed bindings are left for the v2
 * validator to reject.
 *
 * Deliberate `bindings` handling:
 * - `bindings` **missing** → stays missing (the validator fills the
 *   default bindings — never read "user deleted all bindings" from an
 *   absent field).
 * - `bindings: []` → stays `[]` (user really deleted every binding).
 * - `bindings` an array → each item is migrated individually.
 * - `bindings` NOT an array → kept as-is; the validator rejects it.
 */
function migrateV1ToV2(input: Record<string, unknown>): Record<string, unknown> | MigrationFailure {
    if (input.bindings === undefined) {
        return { ...input };
    }
    if (!Array.isArray(input.bindings)) {
        return { ...input };
    }
    return {
        ...input,
        bindings: input.bindings.map((raw) => {
            if (!isPlainObject(raw)) return raw;
            const b = raw as Record<string, unknown>;
            // Already migrated (a v2-shaped binding inside a v1 payload):
            // keep it for the validator, but strip any stale top-level
            // legacy fields so the payload is a clean v2 shape.
            if (isPlainObject(b.action)) {
                const { commandId: _cid, commandParams: _cp, ...rest } = b;
                void _cid;
                void _cp;
                return rest;
            }
            const commandId = typeof b.commandId === "string" ? b.commandId : "";
            const commandParams =
                isPlainObject(b.commandParams) ? b.commandParams : {};
            const { commandId: _cid2, commandParams: _cp2, ...rest } = b;
            void _cid2;
            void _cp2;
            return {
                ...rest,
                action: { type: "builtin", commandId, commandParams },
            };
        }),
    };
}

// Register the v1 → v2 migration (stage 6A).
registerMigration(1, migrateV1ToV2);

/**
 * Detect the version field of an unknown payload.
 *
 * Returns:
 * - `null` when the version is missing (treated as "needs migration from
 *   the earliest known shape").
 * - The integer version when present and valid.
 * - `'future'` when the version is greater than
 *   {@link CURRENT_CONFIG_VERSION} — the caller must refuse to downgrade.
 * - `'invalid'` when the version is present but not a positive integer.
 */
export function detectVersion(input: unknown): number | "future" | "invalid" | null {
    if (!isPlainObject(input)) return "invalid";
    const v = (input as Record<string, unknown>).version;
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isInteger(v)) return "invalid";
    if (v < 1) return "invalid";
    if (v > CURRENT_CONFIG_VERSION) return "future";
    return v;
}

/**
 * Run the migration chain on an unknown payload, then validate the result.
 *
 * This is the single entry point used by {@link ConfigManager.load} and
 * {@link ConfigManager.importJson}.  It never throws — every failure
 * path produces an `invalid` {@link ValidationResult} with a fresh
 * default config so callers can always resume from a safe state.
 *
 * Options:
 * - {@link ValidateOptions.availableCommandIds} — injected command id
 *   set used to validate binding `commandId` fields.  When omitted,
 *   unknown commandIds are disabled (not dropped) by the validator.
 */
export function migrateAndValidate(
    input: unknown,
    options: ValidateOptions = {},
): ValidationResult {
    // Step 1: detect version.
    const detected = detectVersion(input);

    if (detected === "invalid") {
        return invalidResult(["config version is invalid"]);
    }
    if (detected === "future") {
        // Refuse to downgrade a future version — the caller must fall
        // back to defaults.  This prevents silent data loss when a newer
        // SiYuan/plugin version wrote a schema the current code does not
        // understand.
        return invalidResult([
            `unknown future config version (current is ${CURRENT_CONFIG_VERSION}) — refusing to downgrade`,
        ]);
    }

    // Step 2: run migration chain from the detected version up to the
    // current one (currently v1 → v2 for the stage 6A schema bump).
    let payload: unknown = input;
    let migrated = false;
    if (detected === null) {
        // Missing version.  Early dev builds shipped a v1-shaped payload
        // without a version field; if the bindings still carry top-level
        // commandId / commandParams, treat them as v1 and migrate.
        const raw = input as Record<string, unknown>;
        if (hasLegacyV1Bindings(raw)) {
            const result = migrateV1ToV2(raw);
            if (isMigrationFailure(result)) {
                return invalidResult([result.error]);
            }
            payload = { ...result, version: 2 };
            migrated = true;
        } else {
            // v2-shaped data without a version field: stamp the current
            // version and let the normaliser fill anything else missing.
            payload = { ...raw, version: CURRENT_CONFIG_VERSION };
        }
    } else {
        // Run migrations from detected version up to current.
        let current = input as Record<string, unknown>;
        let version = detected;
        while (version < CURRENT_CONFIG_VERSION) {
            const step = MIGRATIONS.get(version);
            if (!step) {
                return invalidResult([
                    `no migration step registered for version ${version}`,
                ]);
            }
            const result = step(current);
            if (isMigrationFailure(result)) {
                return invalidResult([result.error]);
            }
            current = result;
            version++;
            // Bump the version field so subsequent steps see the new shape.
            current = { ...current, version };
            migrated = true;
        }
        payload = current;
    }

    // Step 3: validate + normalise.
    const result = validateConfig(payload, options);
    if (migrated && (result.status === "valid" || result.status === "normalized")) {
        return { ...result, migrated: true };
    }
    return result;
}

/**
 * Register a migration step for a source version.
 *
 * Exposed for tests and future schema upgrades.  Stage 5A does not call
 * this — the map is empty and `migrateAndValidate` is a no-op for v1.
 */
export function registerMigration(fromVersion: number, step: MigrationStep): void {
    if (fromVersion < 1 || fromVersion >= CURRENT_CONFIG_VERSION) {
        throw new Error(
            `Cannot register migration for version ${fromVersion} (current is ${CURRENT_CONFIG_VERSION})`,
        );
    }
    MIGRATIONS.set(fromVersion, step);
}

/**
 * Whether any migration steps are registered.  Exposed for tests so they
 * can assert the migration map is in the expected state.
 */
export function hasMigrations(): boolean {
    return MIGRATIONS.size > 0;
}

// --------------------------------------------------------------- helpers

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Whether an unknown payload looks like a legacy v1 shape: its
 * `bindings` array contains at least one plain object carrying top-level
 * `commandId` / `commandParams` and no `action`.  Used to migrate
 * version-less early-dev configs instead of rejecting them.
 */
function hasLegacyV1Bindings(input: Record<string, unknown>): boolean {
    if (!Array.isArray(input.bindings)) return false;
    return input.bindings.some((raw) => {
        if (!isPlainObject(raw)) return false;
        const b = raw as Record<string, unknown>;
        return (
            b.action === undefined &&
            (typeof b.commandId === "string" || isPlainObject(b.commandParams))
        );
    });
}

function isMigrationFailure(
    v: Record<string, unknown> | MigrationFailure,
): v is MigrationFailure {
    return typeof (v as MigrationFailure).error === "string";
}

function invalidResult(errors: string[]): ValidationResult {
    return {
        status: "invalid",
        config: createDefaultConfig(),
        errors,
    };
}

/**
 * Type-level assertion that {@link SupportedConfigVersion} stays in sync
 * with {@link CURRENT_CONFIG_VERSION}.  If the two ever diverge the
 * compiler will flag this line — a reminder to add a migration step.
 */
const _VERSION_CHECK: SupportedConfigVersion = CURRENT_CONFIG_VERSION;
void _VERSION_CHECK;

/**
 * Re-export of the validated config type for callers that only import
 * from the migration entry point.
 */
export type { GestureFlowConfig };
