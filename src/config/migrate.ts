import { CURRENT_CONFIG_VERSION } from "./types";

/**
 * Explicit schema migration v1 → v2.
 *
 * Version 1 is the released binding shape:
 *
 *   { id, enabled, directions: Direction[], action }
 *
 * Version 2 adds an input source + structured gesture descriptor:
 *
 *   { id, enabled, source, gesture, action }
 *
 * The migration is **idempotent**: every legacy binding becomes
 *   source: "mouse"
 *   gesture: { kind: "shape", button: 2, directions: <original directions> }
 * while id / enabled / action / commandId / commandParams / shortcut title /
 * shortcut spec are preserved byte-for-byte.  Re-running the migration on an
 * already-migrated payload is a no-op.
 *
 * The migration is purely structural — it never drops data, never rewrites
 * actions, never touches an unknown commandId, and never touches the disk
 * (the caller persists only after validation succeeds).
 */

export interface MigrationResult {
    migrated: boolean;
    payload: unknown;
    notes: string[];
}

/** Migrate a v1 config payload to the v2 structure. */
export function migrateV1toV2(input: Record<string, unknown>): MigrationResult {
    const notes: string[] = [];
    if (input.version === CURRENT_CONFIG_VERSION) {
        // Already v2 (or an in-memory copy that was migrated earlier) — no-op.
        return { migrated: false, payload: input, notes };
    }

    const payload: Record<string, unknown> = { ...input };
    payload.version = CURRENT_CONFIG_VERSION;

    if (Array.isArray(payload.bindings)) {
        payload.bindings = payload.bindings.map((raw) => {
            if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
                // Malformed entries survive the migration untouched and are
                // rejected by the v2 validator.
                return raw;
            }
            const b = raw as Record<string, unknown>;
            // A binding that already looks like v2 is left as-is (idempotent).
            if (typeof b.source === "string" || b.gesture !== undefined) {
                return b;
            }
            notes.push(`binding ${JSON.stringify(b.id)} migrated to mouse:shape`);
            return {
                id: b.id,
                enabled: b.enabled,
                source: "mouse",
                gesture: {
                    kind: "shape",
                    button: 2,
                    directions: b.directions,
                },
                action: b.action,
            };
        });
    }

    return { migrated: true, payload, notes };
}
