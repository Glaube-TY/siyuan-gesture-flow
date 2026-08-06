import { Plugin, getFrontend, getBackend, showMessage, globalCommand } from "siyuan";
import "./index.scss";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { closeAllSafeConfirms } from "@/settings/confirmDialog";
import { ConfigManager, CONFIG_STORAGE_NAME } from "@/config/ConfigManager";
import type { ConfigPersistenceHost } from "@/config/ConfigManager";
import type { ConfigLoadResult } from "@/config/types";
import { GestureFlowRuntime } from "@/runtime/GestureFlowRuntime";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { SiyuanActionBridge } from "@/commands/SiyuanActionBridge";
import { registerBuiltinCommands } from "@/commands/registerBuiltinCommands";
import { buildCommandCatalog } from "@/settings/commandCatalog";
import type { SettingCommandItem } from "@/settings/commandCatalog";
import { OverlayI18n } from "@/gesture/overlay/types";

/** Whether the plugin is running in development mode (concise debug logs). */
const IS_DEV = process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";

/**
 * GestureFlow plugin entry.
 *
 * Stage 5A replaces the hard-coded wiring with a config-driven runtime.
 * Responsibilities kept in this file:
 * - Construct the {@link ConfigManager} and load the persisted config.
 * - Construct the {@link GestureFlowRuntime} and start it with the
 *   loaded config.
 * - Subscribe to config changes and restart the runtime when needed.
 * - Provide the settings UI via {@link openSetting}.
 * - Unload cleanup: stop the runtime, destroy the config manager, and
 *   tear down the settings panel.
 *
 * All dispatch decisions live in {@link GestureActionExecutor}; this
 * file does not inspect session state or recognition results directly.
 */
export default class GestureFlowPlugin extends Plugin {
    /**
     * The SiYuan `App` instance, captured from the plugin constructor
     * options (the official loader calls
     * `new pluginClass({ app, name, displayName, i18n })` —
     * app/src/plugin/loader.ts).  Kept in a private read-only field; the
     * base class field is never read directly.  Type is derived from the
     * public `globalCommand` signature (no private App type dependency).
     */
    private readonly gfApp: Parameters<typeof globalCommand>[1];

    private configManager: ConfigManager | null = null;
    private runtime: GestureFlowRuntime | null = null;
    private unsubscribeConfig: (() => void) | null = null;
    private settingsDialog: SettingsDialog | null = null;

    /**
     * Lifecycle generation token (RC hardening).  Incremented at the
     * start of {@link onload} and at the start of {@link onunload}; every
     * asynchronous continuation (config load, settings-open wait, config
     * subscription) captures the token it was created under and re-checks
     * it before touching any component.  A stale token means the plugin
     * was unloaded — the continuation must not mount listeners, start a
     * runtime, open settings, or restore anything.
     */
    private lifecycleToken = 0;

    /**
     * Shared config-load promise.  Reused by {@link openSetting} while
     * the initial load is still in flight so the settings page is never
     * created from defaults before the real config arrives.
     */
    private configLoadPromise: Promise<ConfigLoadResult> | null = null;

    /**
     * Receive the same options object the official plugin loader passes
     * to every plugin subclass constructor, forward it to the base class,
     * then keep the App instance for runtime wiring.  The parameter type
     * is derived from the base class constructor rather than hand-written.
     */
    constructor(options: ConstructorParameters<typeof Plugin>[0]) {
        super(options);
        this.gfApp = options.app;
    }

    /**
     * Source of the settings command catalog (stage 5B).
     *
     * The runtime rebuilds its own CommandRegistry on every start; the
     * built-in command set is static in this stage, so this registry —
     * populated once at load with the exact same
     * `registerBuiltinCommands` call — is used to build the read-only
     * catalog the settings UI displays.  Only metadata (id / i18n key /
     * group) crosses into the settings layer, never execute functions.
     */
    private commandCatalogSource: CommandRegistry | null = null;

    onload(): void {
        // New lifecycle generation — invalidates any continuation still
        // pending from a previous load/unload cycle.
        const token = ++this.lifecycleToken;

        if (IS_DEV) {
            console.log(`[${this.name}] loading (frontend: ${getFrontend()}, backend: ${getBackend()})`);
        }

        if (typeof document === "undefined") {
            return; // non-DOM environment, nothing to attach
        }

        // --- Config manager ---
        // The plugin instance itself is the persistence host — it exposes
        // loadData / saveData / removeData via the SiYuan Plugin API.
        const host: ConfigPersistenceHost = {
            loadData: (name: string) => this.loadData(name),
            saveData: (name: string, content: unknown) => this.saveData(name, content),
            removeData: (name: string) => this.removeData(name),
        };

        // The available command id set is computed on demand so the
        // validator always sees the current registry.  We construct a
        // throwaway registry here just to enumerate the built-in command
        // ids; the runtime creates its own registry during start.
        const probeRegistry = new CommandRegistry();
        const probeBridge = new SiyuanActionBridge();
        registerBuiltinCommands(probeRegistry, probeBridge);
        // Keep the registry alive as the settings command catalog source.
        this.commandCatalogSource = probeRegistry;
        const commandIds = new Set(probeRegistry.list().map((c) => c.id));

        const configManager = new ConfigManager({
            host,
            storageName: CONFIG_STORAGE_NAME,
            availableCommandIds: () => {
                // The runtime's registry is rebuilt on every start, so
                // the command set is stable; it is derived from the
                // built-in registry above.
                return commandIds;
            },
        });
        this.configManager = configManager;

        // --- Runtime ---
        const overlayI18n: OverlayI18n = {
            gestureTooLong: this.i18n?.gestureTooLong ?? "Gesture too long",
            gestureUnrecognised: this.i18n?.gestureUnrecognised ?? "Unrecognised",
        };

        const runtime = new GestureFlowRuntime({
            target: document,
            overlayI18n,
            i18n: this.i18n ?? {},
            app: this.gfApp,
            onLog: (message) => {
                if (IS_DEV) {
                    console.debug(`[${this.name}] ${message}`);
                }
            },
        });
        this.runtime = runtime;

        // --- Load config and start runtime ---
        // We start the runtime after the config loads so the first start
        // uses the persisted values (or defaults on first run).  The
        // shared promise is also used by openSetting so the settings page
        // is never created from defaults while the config is still
        // loading.  Every continuation re-checks the lifecycle token and
        // the exact instances captured here — a late callback after
        // onunload must not remount anything.
        this.configLoadPromise = configManager.load();
        void this.configLoadPromise.then((result) => {
            if (token !== this.lifecycleToken) return; // unloaded meanwhile
            if (this.configManager !== configManager || this.runtime !== runtime) {
                return; // replaced by a newer lifecycle
            }

            if (IS_DEV) {
                console.log(`[${this.name}] config loaded (source: ${result.source})`);
            }
            runtime.start(result.config);

            // Subscribe to config changes so the runtime restarts when
            // the settings UI saves a new config.  The subscription is
            // established after the first start so the initial load does
            // not trigger a redundant restart.
            this.unsubscribeConfig = configManager.subscribe((next) => {
                if (token !== this.lifecycleToken) return;
                const restartResult = runtime.restart(next);
                if (restartResult.status === "rolled-back") {
                    // Consistency: the new config was persisted and shown
                    // in the settings UI, but the runtime could not apply
                    // it and rolled back to the previous working config.
                    // Restore that working config into the ConfigManager
                    // (memory + disk) so UI, disk and runtime never
                    // diverge.  The restored config is already valid, so
                    // the resulting notify→restart cycle settles as
                    // "applied" and does not loop.
                    void configManager.replaceConfig(restartResult.config).catch(() => {
                        // Non-fatal — the runtime keeps running the
                        // working config regardless.
                    });
                    if (IS_DEV) {
                        console.warn(
                            `[${this.name}] ${this.i18n?.settingsRollback ?? "Restart failed; previous configuration restored"}: ${restartResult.error}`,
                        );
                    }
                }
            });
        });
    }

    /**
     * Open the settings dialog.
     *
     * Waits until the shared config load has finished: the settings page
     * is never created from a default config that a later load would
     * overwrite.  While loading, a short localised hint is shown and the
     * SAME load promise is reused (no second load).  If the plugin was
     * unloaded while waiting, the dialog is not opened.
     */
    openSetting(): void {
        const token = this.lifecycleToken;
        if (!this.configManager) {
            showMessage("GestureFlow not ready");
            return;
        }
        if (this.configManager.isLoaded) {
            this.doOpenSetting();
            return;
        }
        const pending = this.configLoadPromise ?? this.configManager.load();
        showMessage(this.i18n?.settingsLoading ?? "正在加载手势设置…", 1500);
        void pending.then(() => {
            if (token !== this.lifecycleToken) return; // unloaded while waiting
            if (this.configManager === null) return;
            this.doOpenSetting();
        });
    }

    /** Build and show the settings dialog (config is already loaded). */
    private doOpenSetting(): void {
        if (this.configManager === null) return;
        if (!this.settingsDialog) {
            this.settingsDialog = new SettingsDialog();
        }
        // Build the read-only command catalog from the live registry and
        // resolve i18n titles here — the settings layer only ever sees
        // plain metadata.
        let commandCatalog: SettingCommandItem[] = [];
        if (this.commandCatalogSource) {
            commandCatalog = buildCommandCatalog(this.commandCatalogSource, this.i18n ?? {});
        }
        this.settingsDialog.open({
            configManager: this.configManager,
            i18n: this.i18n ?? {},
            commandCatalog,
            onStatus: (message: string, isError: boolean) => {
                showMessage(message, 2000, isError ? "error" : "info");
            },
        });
    }

    onunload(): void {
        // Invalidate the lifecycle generation FIRST so every pending
        // asynchronous continuation (config load, settings-open wait,
        // config subscription callback, runtime restart) becomes a no-op
        // before any component is torn down.
        this.lifecycleToken++;
        this.configLoadPromise = null;

        if (this.unsubscribeConfig) {
            this.unsubscribeConfig();
            this.unsubscribeConfig = null;
        }
        this.settingsDialog?.destroy();
        this.settingsDialog = null;
        // Close any safe-confirm dialog we opened (e.g. delete-binding
        // confirmation) so it cannot outlive the plugin.
        closeAllSafeConfirms();
        this.runtime?.stop();
        this.runtime = null;
        this.configManager?.destroy();
        this.configManager = null;
        if (IS_DEV) {
            console.log(`[${this.name}] unloading`);
        }
    }
}
