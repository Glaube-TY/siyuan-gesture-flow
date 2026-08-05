import { Plugin, getFrontend, getBackend, showMessage } from "siyuan";
import "./index.scss";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { ConfigManager, CONFIG_STORAGE_NAME } from "@/config/ConfigManager";
import type { ConfigPersistenceHost } from "@/config/ConfigManager";
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
    private configManager: ConfigManager | null = null;
    private runtime: GestureFlowRuntime | null = null;
    private unsubscribeConfig: (() => void) | null = null;
    private settingsDialog: SettingsDialog | null = null;

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
                // the command set is stable for stage 5A.  Future stages
                // that add commands at runtime should expose the live
                // registry here.
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
            onLog: (message) => {
                if (IS_DEV) {
                    console.debug(`[${this.name}] ${message}`);
                }
            },
        });
        this.runtime = runtime;

        // --- Load config and start runtime ---
        // We start the runtime after the config loads so the first start
        // uses the persisted values (or defaults on first run).
        void configManager.load().then((result) => {
            if (IS_DEV) {
                console.log(`[${this.name}] config loaded (source: ${result.source})`);
            }
            runtime.start(result.config);

            // Subscribe to config changes so the runtime restarts when
            // the settings UI saves a new config.  The subscription is
            // established after the first start so the initial load does
            // not trigger a redundant restart.
            this.unsubscribeConfig = configManager.subscribe((next) => {
                const restartResult = runtime.restart(next);
                if (restartResult.status === "rolled-back" && IS_DEV) {
                    console.warn(
                        `[${this.name}] ${this.i18n?.settingsRollback ?? "Restart failed; previous configuration restored"}: ${restartResult.error}`,
                    );
                }
            });
        });
    }

    /**
     * Open the settings dialog.
     *
     * Uses the SiYuan `Dialog` API (not `Setting`) so the settings UI
     * gets the full dialog content width.  The previous approach used
     * `Setting.addItem({ actionElement })` which placed the entire panel
     * into a ~200 px right-side control column.
     *
     * The {@link SettingsDialog} guards against duplicate opens and
     * handles Svelte component lifecycle.
     */
    openSetting(): void {
        if (!this.configManager) {
            showMessage("GestureFlow not ready");
            return;
        }
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
        if (this.unsubscribeConfig) {
            this.unsubscribeConfig();
            this.unsubscribeConfig = null;
        }
        this.runtime?.stop();
        this.runtime = null;
        this.settingsDialog?.destroy();
        this.settingsDialog = null;
        this.configManager?.destroy();
        this.configManager = null;
        if (IS_DEV) {
            console.log(`[${this.name}] unloading`);
        }
    }
}
