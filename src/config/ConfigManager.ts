import {
    ConfigListener,
    ConfigLoadResult,
    GestureFlowConfig,
} from "./types";
import { createDefaultConfig, deepCloneConfig } from "./defaults";
import { validateConfig } from "./validate";

/**
 * Stable storage key used with `Plugin.loadData` / `Plugin.saveData`.
 *
 * SiYuan's `loadData(storageName)` reads `<storageName>` from the
 * plugin's `data/storage/` directory.  The storage name must not contain
 * a path separator; the file extension is managed by the SiYuan runtime
 * (the API accepts the bare name and the kernel appends the appropriate
 * suffix internally).  We use a single stable name so old and new builds
 * agree on the location.
 */
export const CONFIG_STORAGE_NAME = "gesture-flow-config";

/**
 * Minimal subset of the SiYuan `Plugin` class needed by ConfigManager.
 *
 * Decoupling via an interface keeps ConfigManager testable without
 * instantiating a real Plugin, and prevents it from depending on DOM,
 * event bus, or any other Plugin capability beyond persistence.
 */
export interface ConfigPersistenceHost {
    loadData(storageName: string): Promise<unknown>;
    saveData(storageName: string, content: unknown): Promise<unknown>;
    removeData(storageName: string): Promise<unknown>;
}

/** Result of a save operation. */
export type SaveResult =
    | { status: "saved"; config: GestureFlowConfig }
    | { status: "error"; message: string };

/** Result of an import operation. */
export type ImportResult =
    | { status: "imported"; config: GestureFlowConfig; notes: string[] }
    | { status: "error"; message: string; errors: string[] };

/**
 * A deep-partial patch for {@link GestureFlowConfig} used by
 * {@link ConfigManager.updateConfig}.  Top-level fields are optional,
 * and nested sections (`trigger`, `recognizer`, `overlay`) are also
 * partial so callers can update a single field without erasing siblings.
 */
export type ConfigUpdatePatch = {
    version?: number;
    enabled?: boolean;
    trigger?: Partial<GestureFlowConfig["trigger"]>;
    recognizer?: Partial<GestureFlowConfig["recognizer"]>;
    overlay?: Partial<GestureFlowConfig["overlay"]>;
    touchpad?: Partial<GestureFlowConfig["touchpad"]>;
    bindings?: GestureFlowConfig["bindings"];
};

/**
 * Manages the versioned, validated gesture-flow configuration.
 *
 * ConfigManager is the single owner of the in-memory config snapshot.
 * It serialises all persistence operations so that rapid edits from the
 * settings UI never race each other for the underlying `saveData` call.
 *
 * Responsibilities:
 * - Load on-disk data via the injected {@link ConfigPersistenceHost},
 *   run it through {@link validateConfig} against the single current
 *   structure, and keep the resulting
 *   snapshot as the source of truth.
 * - When the saved data cannot be used (corrupt, unknown/future version,
 *   otherwise incompatible), leave the on-disk data untouched and run
 *   temporarily on the defaults, reporting `source: "fallback"`.
 * - Expose {@link getConfig} returning an independent deep copy so
 *   external code can never mutate the internal state.
 * - Provide {@link replaceConfig} / {@link updateConfig} for atomic
 *   updates that re-validate the candidate before persisting.
 * - Notify subscribers with independent snapshots on every successful
 *   change.
 * - Support {@link exportJson} / {@link importJson} for user-driven
 *   backup/restore.  Imports go through the same validation
 *   pipeline as the initial load.
 * - {@link reset} restores the default config and persists it.
 * - {@link destroy} tears down subscriptions and rejects any pending
 *   save so no further notifications fire.
 *
 * ConfigManager never touches the DOM, the runtime, or the input layer.
 * It does not depend on `CommandRegistry`; whether a command id is
 * registered is a runtime concern, never a load-time decision — a binding
 * to an unknown command is preserved as-is and reports `unavailable` at
 * runtime.
 */
export class ConfigManager {
    private readonly host: ConfigPersistenceHost;
    private readonly storageName: string;
    private config: GestureFlowConfig;
    private listeners = new Set<ConfigListener>();
    private loadPromise: Promise<ConfigLoadResult> | null = null;
    private loaded = false;
    private destroyed = false;

    /** Serialised save queue — ensures last-write-wins, no concurrent saves. */
    private saveChain: Promise<SaveResult> = Promise.resolve({ status: "saved", config: createDefaultConfig() });

    constructor(opts: {
        host: ConfigPersistenceHost;
        storageName?: string;
    }) {
        this.host = opts.host;
        this.storageName = opts.storageName ?? CONFIG_STORAGE_NAME;
        this.config = createDefaultConfig();
    }

    // --------------------------------------------------------------- loading

    /**
     * Load the configuration from persistent storage exactly once.
     *
     * Subsequent calls return the same promise (idempotent).  The loaded
     * snapshot is always a fresh deep copy — callers can mutate it
     * freely without affecting the internal state.
     *
     * On any failure the manager falls back to a fresh default config
     * and reports the outcome via {@link ConfigLoadResult.source}: a
     * read error yields `"defaults"`, a present-but-unusable config
     * (corrupt / unknown or future version) yields `"fallback"` without
     * touching the disk, and a destroyed manager yields `"error"`.
     */
    load(): Promise<ConfigLoadResult> {
        if (this.destroyed) {
            return Promise.resolve({
                ok: false,
                config: createDefaultConfig(),
                source: "error",
                message: "ConfigManager destroyed",
            });
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }
        this.loadPromise = this.doLoad();
        return this.loadPromise;
    }

    private async doLoad(): Promise<ConfigLoadResult> {
        let raw: unknown;
        try {
            raw = await this.host.loadData(this.storageName);
        } catch (err) {
            // loadData throws when the storage is absent or the kernel
            // reports an error.  Treat both as "no config yet" and fall
            // back to defaults.  The error is captured in the message
            // but never re-thrown.
            if (this.destroyed) {
                return this.destroyedResult();
            }
            const label = err instanceof Error ? err.message : String(err);
            this.config = createDefaultConfig();
            this.loaded = true;
            return {
                ok: true,
                config: this.getConfig(),
                source: "defaults",
                message: `loadData failed (${label}) — using defaults`,
            };
        }

        // The plugin may have been unloaded while loadData was in
        // flight.  After destroy we must not mutate state, write back
        // defaults, notify subscribers, or continue saving.
        if (this.destroyed) {
            return this.destroyedResult();
        }

        // loadData returns `null` / `undefined` when the storage file
        // does not exist yet (first run).  Fall back to defaults without
        // treating this as an error.
        if (raw === null || raw === undefined) {
            this.config = createDefaultConfig();
            this.loaded = true;
            return {
                ok: true,
                config: this.getConfig(),
                source: "defaults",
                message: "",
            };
        }

        const result = validateConfig(raw);
        if (this.destroyed) {
            return this.destroyedResult();
        }
        if (result.status === "invalid") {
            // A released plugin must never overwrite data it cannot
            // understand.  An existing config that is corrupt, from a
            // future / unknown version, or otherwise incompatible stays
            // untouched on disk — no saveData, no removeData, no reset.
            // The runtime still starts, temporarily using the defaults,
            // and the load result reports `fallback` so the caller can
            // show a one-time hint.  When the user upgrades back to the
            // version that wrote that config, it is still there.
            this.config = createDefaultConfig();
            this.loaded = true;
            return {
                ok: true,
                config: this.getConfig(),
                source: "fallback",
                message:
                    "saved configuration is not readable by this version — defaults used temporarily, original data preserved",
            };
        }

        this.config = result.config;
        this.loaded = true;

        // Normalisation repaired missing fields within the current
        // structure — persist the cleaned-up version so subsequent
        // loads skip the work.
        if (result.status === "normalized") {
            void this.persist(this.config).catch(() => {
                // Non-fatal — see above.
            });
        }

        const source = result.status === "valid" ? "loaded" : result.status;
        const message = result.status === "normalized"
            ? `normalised: ${result.notes.join("; ")}`
            : "";
        return {
            ok: true,
            config: this.getConfig(),
            source,
            message,
        };
    }

    // --------------------------------------------------------------- access

    /** Whether {@link load} has resolved at least once. */
    get isLoaded(): boolean {
        return this.loaded;
    }

    /**
     * Return an independent deep copy of the current configuration.
     *
     * Mutating the returned object has no effect on the manager or on
     * subsequent calls to {@link getConfig}.
     */
    getConfig(): GestureFlowConfig {
        return deepCloneConfig(this.config);
    }

    // --------------------------------------------------------------- updates

    /**
     * Replace the entire configuration with a validated candidate.
     *
     * The candidate is run through {@link validateConfig} (single current
     * structure) before
     * being accepted.  On success the new config is persisted and
     * subscribers receive a fresh snapshot.  On failure the previous
     * config is preserved and the error is returned.
     */
    async replaceConfig(candidate: unknown): Promise<SaveResult> {
        if (this.destroyed) {
            return { status: "error", message: "ConfigManager destroyed" };
        }
        const result = validateConfig(candidate);
        if (result.status === "invalid") {
            return {
                status: "error",
                message: `config rejected: ${result.errors.join("; ")}`,
            };
        }
        const previous = this.config;
        this.config = result.config;
        const notes = result.status === "normalized" ? result.notes : [];
        const saveResult = await this.persist(this.config);
        if (saveResult.status === "error") {
            // Persistence failed — roll back the in-memory state so it
            // stays consistent with the last successfully saved data.
            // Subscribers are NOT notified of the rejected change.
            this.config = previous;
            return saveResult;
        }
        this.notify();
        if (notes.length > 0) {
            // Notes are surfaced via the save result's config snapshot;
            // callers that need the notes should use {@link importJson}.
        }
        return { status: "saved", config: this.getConfig() };
    }

    /**
     * Apply a partial update to the current configuration.
     *
     * The patch is merged into a copy of the current config, then the
     * merged object is validated via {@link replaceConfig}.  This keeps
     * the validation pipeline identical for full and partial updates.
     *
     * Nested sections (`trigger`, `recognizer`, `overlay`) accept partial
     * objects — only the provided fields are overwritten, siblings are
     * preserved.  `bindings` is replaced wholesale when provided.
     */
    async updateConfig(patch: ConfigUpdatePatch): Promise<SaveResult> {
        if (this.destroyed) {
            return { status: "error", message: "ConfigManager destroyed" };
        }
        const merged: Record<string, unknown> = {
            ...deepCloneConfig(this.config),
            ...patch as Record<string, unknown>,
        };
        // Deep-merge nested sections so a partial patch (e.g. only
        // `trigger.activationDistance`) does not erase sibling fields.
        if (patch.trigger) {
            merged.trigger = { ...this.config.trigger, ...patch.trigger };
        }
        if (patch.recognizer) {
            merged.recognizer = { ...this.config.recognizer, ...patch.recognizer };
        }
        if (patch.overlay) {
            merged.overlay = { ...this.config.overlay, ...patch.overlay };
        }
        if (patch.touchpad) {
            merged.touchpad = { ...this.config.touchpad, ...patch.touchpad };
        }
        if (patch.bindings) {
            merged.bindings = patch.bindings;
        }
        return this.replaceConfig(merged);
    }

    /**
     * Reset the configuration to defaults and persist.
     *
     * Subscribers receive the default snapshot.
     */
    async reset(): Promise<SaveResult> {
        if (this.destroyed) {
            return { status: "error", message: "ConfigManager destroyed" };
        }
        const def = createDefaultConfig();
        this.config = def;
        const saveResult = await this.persist(def);
        if (saveResult.status === "error") {
            // Even if persistence fails, the in-memory state is already
            // the default — that is still a usable state.  We return the
            // error so the UI can inform the user, but we DO notify
            // subscribers so the runtime can restart with the default.
            this.notify();
            return saveResult;
        }
        this.notify();
        return { status: "saved", config: this.getConfig() };
    }

    // --------------------------------------------------------------- import/export

    /**
     * Export the current configuration as a JSON-serialisable object.
     *
     * The returned object is a deep copy and contains only plain data
     * (no DOM nodes, no event objects, no session references).  Safe
     * to `JSON.stringify` and write to a user-chosen file.
     */
    exportJson(): GestureFlowConfig {
        return this.getConfig();
    }

    /**
     * Import a configuration from an unknown payload (typically the
     * result of `JSON.parse` on a user-selected file).
     *
     * The payload goes through the full validation pipeline against the
     * single current structure.  Incompatible payloads are rejected —
     * never migrated, never written to disk.  On success the new config
     * is persisted and
     * subscribers are notified.  On failure the current config is
     * preserved — the import never overwrites the in-memory state
     * with unusable data.
     */
    async importJson(payload: unknown): Promise<ImportResult> {
        if (this.destroyed) {
            return { status: "error", message: "ConfigManager destroyed", errors: [] };
        }
        const result = validateConfig(payload);
        if (result.status === "invalid") {
            return {
                status: "error",
                message: "config format is not compatible with this version",
                errors: result.errors,
            };
        }
        const previous = this.config;
        this.config = result.config;
        const saveResult = await this.persist(this.config);
        if (saveResult.status === "error") {
            this.config = previous;
            return {
                status: "error",
                message: saveResult.message,
                errors: [],
            };
        }
        this.notify();
        const notes = result.status === "normalized" ? result.notes : [];
        return {
            status: "imported",
            config: this.getConfig(),
            notes,
        };
    }

    // --------------------------------------------------------------- subscriptions

    /**
     * Subscribe to configuration changes.
     *
     * The listener is invoked with an independent deep copy of the
     * config on every successful {@link replaceConfig}, {@link updateConfig},
     * {@link reset}, or {@link importJson}.  Returns an unsubscribe
     * function.
     */
    subscribe(listener: ConfigListener): () => void {
        // After destroy no listener is added and nothing is ever called
        // back — a safe no-op unsubscribe is returned instead.
        if (this.destroyed) {
            return () => undefined;
        }
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Tear down the manager.
     *
     * After `destroy`:
     * - No further subscriber notifications fire.
     * - {@link load} / {@link replaceConfig} / etc. return error results.
     * - Pending saves still run to completion (they are not cancelled),
     *   but their results are not surfaced.
     */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.clear();
        // The save chain is left to settle on its own — it resolves to
        // a no-op for any post-destroy caller because of the `destroyed`
        // guard at the top of `persist`.
    }

    // --------------------------------------------------------------- internals

    /** Result returned by any async path that resolves after destroy. */
    private destroyedResult(): ConfigLoadResult {
        return {
            ok: false,
            config: createDefaultConfig(),
            source: "error",
            message: "ConfigManager destroyed",
        };
    }

    /**
     * Persist the given config serially.
     *
     * Calls to `persist` are chained so that only one `saveData` is in
     * flight at a time.  If multiple updates arrive while a save is
     * running, the later updates wait for the earlier save to finish,
     * then issue their own save with the latest in-memory snapshot.
     * This implements the "last write wins" semantics required by the
     * spec without risking interleaved writes.
     *
     * On failure the in-memory state is left unchanged — the caller
     * (replaceConfig / importJson) is responsible for rolling back to
     * the previous snapshot if it wants to keep memory and disk in
     * sync.  `persist` itself never rolls back; it only reports the
     * outcome.
     */
    private persist(config: GestureFlowConfig): Promise<SaveResult> {
        if (this.destroyed) {
            return Promise.resolve({ status: "error", message: "ConfigManager destroyed" });
        }
        const snapshot = deepCloneConfig(config);
        const previousChain = this.saveChain;
        const next = previousChain.then(() => {
            if (this.destroyed) {
                return { status: "error" as const, message: "ConfigManager destroyed" };
            }
            return this.host.saveData(this.storageName, snapshot)
                .then(() => ({ status: "saved" as const, config: deepCloneConfig(snapshot) }))
                .catch((err) => {
                    const label = err instanceof Error ? err.message : String(err);
                    return {
                        status: "error" as const,
                        message: `saveData failed (${label})`,
                    };
                });
        });
        // Swallow rejections on the chain itself so they don't surface
        // as unhandled promise rejections.  The actual result is
        // returned to the caller via `next`.
        this.saveChain = next.then(
            () => ({ status: "saved" as const, config: snapshot }),
            () => ({ status: "saved" as const, config: snapshot }),
        );
        return next;
    }

    private notify(): void {
        if (this.destroyed) return;
        const snapshot = this.getConfig();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // Listener errors never break the notification loop.
            }
        }
    }
}
