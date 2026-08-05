import { Dialog } from "siyuan";
import SettingsPanel from "./SettingsPanel.svelte";
import type { ConfigManager } from "@/config/ConfigManager";

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
 * - The Dialog's own `destroyCallback` also calls {@link close} so the
 *   X-button / Esc key path is covered.  A guard flag prevents
 *   double-destroy.
 */
export class SettingsDialog {
    private dialog: Dialog | null = null;
    private panel: SettingsPanel | null = null;
    private destroyed = false;

    /** Whether the dialog is currently open. */
    get isOpen(): boolean {
        return this.dialog !== null;
    }

    /**
     * Open the settings dialog.
     *
     * If already open, this is a no-op (does not create a duplicate).
     */
    open(opts: {
        configManager: ConfigManager;
        i18n: Record<string, string>;
        onStatus: (message: string, isError: boolean) => void;
    }): void {
        if (this.destroyed) return;
        if (this.dialog) return; // already open — prevent duplicate

        const title = opts.i18n.settingsTitle ?? "GestureFlow Settings";

        // Create the Dialog with an empty host div.  We'll mount the
        // Svelte component into it after the Dialog is constructed.
        this.dialog = new Dialog({
            title,
            content: '<div class="gf-dialog-host"></div>',
            width: "min(860px, calc(100vw - 48px))",
            height: "min(680px, calc(100vh - 48px))",
            destroyCallback: () => {
                // Called when the user clicks X, presses Esc, or
                // clicks the overlay.  Use the same cleanup path.
                this.close();
            },
        });

        // Find the host element inside the Dialog's DOM and mount
        // the Svelte component.
        const host = this.dialog.element.querySelector(".gf-dialog-host");
        if (!host) {
            // Should never happen — the content string always
            // contains the host div.  Destroy and bail out.
            this.dialog.destroy();
            this.dialog = null;
            return;
        }

        this.panel = new SettingsPanel({
            target: host as HTMLElement,
            props: {
                configManager: opts.configManager,
                i18n: opts.i18n,
                onStatus: opts.onStatus,
            },
        });
    }

    /**
     * Close and destroy the dialog if open.  Idempotent.
     *
     * Tears down the Svelte component first (so onDestroy runs and
     * cleans up subscriptions / debounce timers), then destroys the
     * Dialog.  A guard prevents the Dialog's destroyCallback from
     * re-entering.
     */
    close(): void {
        if (this.panel) {
            this.panel.$destroy();
            this.panel = null;
        }
        if (this.dialog) {
            // Clear the reference before calling destroy so the
            // destroyCallback guard works.
            const d = this.dialog;
            this.dialog = null;
            d.destroy();
        }
    }

    /**
     * Permanently tear down.  After this the instance is unusable.
     * Called from Plugin.onunload.
     */
    destroy(): void {
        this.close();
        this.destroyed = true;
    }
}
