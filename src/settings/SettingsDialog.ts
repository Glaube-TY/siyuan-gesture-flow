import { Dialog } from "siyuan";
import SettingsPanel from "./SettingsPanel.svelte";
import type { ConfigManager } from "@/config/ConfigManager";
import type { SettingCommandItem } from "./commandCatalog";

/**
 * Manages the full-screen SiYuan `Dialog` that hosts the Svelte
 * {@link SettingsPanel}.
 *
 * Replaces the previous `Setting.addItem({ actionElement })` approach
 * which squeezed the entire panel into SiYuan's ~200 px right-side
 * control column (`fn__size200`).  The Dialog gives the settings UI
 * the full content width.
 *
 * Lifecycle:
 * - {@link open} creates the Dialog, mounts the Svelte component, and
 *   guards against duplicate opens.
 * - {@link close} destroys the Svelte component and the Dialog.
 *   Idempotent — safe to call when already closed.
 * - {@link destroy} (plugin unload) permanently tears the instance down.
 *
 * **Idempotent destroy coordination** (stage 6A stabilisation):
 *
 * SiYuan's `Dialog.destroy()` — invoked by its own X button, Esc key or
 * scrim click — removes the DOM and fires `destroyCallback` on a delay.
 * In that interval the dialog element is still `isConnected`, so an
 * `isConnected` check is NOT a reliable "already destroying" signal.
 *
 * Each Dialog created by this class therefore owns an independent
 * {@link DialogState} holding:
 * - `nativeDestroy` — the original `Dialog.destroy` bound to the
 *   instance (captured before wrapping),
 * - `destroyStarted` — set once the native destroy has been initiated,
 * - `panel` / `panelDestroyed` — the Svelte panel and its destroy flag,
 * - the state object itself is the generation token: callbacks compare
 *   against it so a stale callback from an old dialog can never touch a
 *   newer one.
 *
 * The *instance method* `dialog.destroy` is wrapped (never the
 * prototype) so any caller — SiYuan's X/Esc/scrim path or plugin code —
 * funnels through the same idempotence guard:
 *
 * - User closes (X / Esc / scrim) → wrapped destroy runs once, marks
 *   `destroyStarted`; the delayed `destroyCallback` only cleans the
 *   panel, never destroys again.
 * - Plugin `close()` → references are detached first, then the wrapped
 *   destroy runs once; the delayed callback becomes a no-op.
 * - Plugin unload during the user-close delay → `close()` sees
 *   `destroyStarted` and skips the native destroy entirely.
 * - A stale callback from an old dialog arrives after a new one opened
 *   → state mismatch → ignored.
 * - Repeated `close()` / `destroy()` calls are safe no-ops.
 *
 * `SettingsPanel.$destroy()` is likewise guarded by `panelDestroyed` so
 * it can only ever run once per dialog.
 */
export class SettingsDialog {
    private state: DialogState | null = null;
    private destroyed = false;

    /** Whether the dialog is currently open. */
    get isOpen(): boolean {
        return this.state !== null;
    }

    /**
     * Open the settings dialog.
     *
     * If already open, this is a no-op (does not create a duplicate).
     */
    open(opts: {
        configManager: ConfigManager;
        i18n: Record<string, string>;
        commandCatalog: SettingCommandItem[];
        onStatus: (message: string, isError: boolean) => void;
        /** Plugin version shown in the About tab (from plugin.json). */
        version?: string;
    }): void {
        if (this.destroyed) return;
        if (this.state) return; // already open — prevent duplicate

        const title = opts.i18n.settingsTitle ?? "GestureFlow Settings";

        const dialog = new Dialog({
            title,
            content: '<div class="gf-dialog-host"></div>',
            width: "min(860px, calc(100vw - 48px))",
            height: "min(680px, calc(100vh - 48px))",
            destroyCallback: () => {
                // Fired (possibly with a delay) when the Dialog was
                // destroyed — by SiYuan (X/Esc/scrim) or by our own
                // wrapped destroy.  Clean the panel only.
                this.onDialogDestroyed(state);
            },
        });

        // Per-instance state; the `state` reference doubles as the
        // generation token for stale-callback protection.
        const state: DialogState = {
            dialog,
            nativeDestroy: dialog.destroy.bind(dialog),
            destroyStarted: false,
            panel: null,
            panelDestroyed: false,
        };
        this.state = state;

        // Wrap THIS instance's destroy method so every destroy path is
        // idempotent.  The prototype is never touched, so other SiYuan
        // dialogs are unaffected.
        dialog.destroy = () => {
            if (state.destroyStarted) return;
            state.destroyStarted = true;
            state.nativeDestroy();
        };

        // Scope the dialog-wide layout styles (height chain, scroll and
        // background responsibilities live in src/index.scss) to this
        // dialog only, so no other SiYuan b3-dialog is affected.
        // siyuan@1.2.3's Dialog options do not expose containerClassName,
        // so we tag the outermost element after construction instead.
        dialog.element.classList.add("gf-settings-dialog");

        // Find the host element inside the Dialog's DOM and mount
        // the Svelte component.
        const host = dialog.element.querySelector(".gf-dialog-host");
        if (!host) {
            // Should never happen — the content string always
            // contains the host div.  Destroy (idempotently) and bail.
            dialog.destroy();
            this.state = null;
            return;
        }

        state.panel = new SettingsPanel({
            target: host as HTMLElement,
            props: {
                configManager: opts.configManager,
                i18n: opts.i18n,
                commandCatalog: opts.commandCatalog,
                onStatus: opts.onStatus,
                version: opts.version ?? "",
            },
        });
    }

    /**
     * Handle a Dialog that reported destruction (via `destroyCallback`).
     *
     * The state bound to the callback is compared against the current
     * reference: if a *different* state reports its destroy (a delayed
     * callback from an old dialog), it is ignored so it cannot tear down
     * a newer dialog.
     *
     * Only the Svelte panel and the references are cleaned here — the
     * native Dialog destroy has already started (destroyStarted is set
     * by the wrapped destroy), so it is never called again.
     */
    private onDialogDestroyed(state: DialogState): void {
        if (this.state !== state) {
            return; // stale callback from an older dialog — ignore
        }
        this.destroyPanel(state);
        this.state = null;
    }

    /** Destroy the Svelte panel exactly once per dialog. */
    private destroyPanel(state: DialogState): void {
        if (state.panelDestroyed) return;
        state.panelDestroyed = true;
        if (state.panel) {
            state.panel.$destroy();
            state.panel = null;
        }
    }

    /**
     * Close and destroy the dialog if open.  Idempotent.
     *
     * References are detached first, the panel is destroyed exactly
     * once, and the native Dialog destroy runs exactly once (guarded by
     * `destroyStarted`).  A delayed `destroyCallback` arriving later is
     * a no-op because `this.state` no longer matches.
     */
    close(): void {
        const state = this.state;
        if (!state) return;
        this.state = null;
        this.destroyPanel(state);
        if (!state.destroyStarted) {
            // The wrapped destroy marks destroyStarted before calling the
            // native one — repeated close()/destroy() stay no-ops.
            state.dialog.destroy();
        }
    }

    /**
     * Permanently tear down.  After this the instance is unusable.
     * Called from Plugin.onunload.  Safe during a pending user-close
     * delay: the native destroy is not called a second time.
     */
    destroy(): void {
        this.close();
        this.destroyed = true;
    }
}

/** Per-instance dialog state (generation token + idempotence guards). */
interface DialogState {
    dialog: Dialog;
    /** Original `Dialog.destroy` bound to this instance. */
    nativeDestroy: () => void;
    /** True once the native destroy has been initiated. */
    destroyStarted: boolean;
    panel: SettingsPanel | null;
    /** True once `SettingsPanel.$destroy()` has been called. */
    panelDestroyed: boolean;
}
