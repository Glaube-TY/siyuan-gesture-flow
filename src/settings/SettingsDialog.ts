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
 *
 * **Destroy coordination** (stage 5B):
 *
 * SiYuan's `Dialog.destroy()` — invoked by its own X button, Esc key or
 * scrim click — removes the DOM and then fires `destroyCallback`.  The
 * old code had `destroyCallback` call {@link close}, which called
 * `Dialog.destroy()` a second time (double destroy) and risked a second
 * `SettingsPanel.$destroy()`.
 *
 * The two paths are now clearly separated:
 *
 * - **External close** (user X / Esc / scrim): SiYuan already destroyed
 *   the Dialog.  `destroyCallback` fires and {@link onDialogDestroyed}
 *   only tears down the panel and clears the references — it never calls
 *   `Dialog.destroy()` again.
 * - **Plugin close** ({@link close}): the dialog reference is cleared
 *   *before* calling `Dialog.destroy()`, so the `destroyCallback` fired
 *   by that destroy arrives with `this.dialog === null` and becomes a
 *   no-op instead of re-entering.
 *
 * Each `destroyCallback` is bound to its own Dialog instance, so a
 * delayed callback from an old dialog can never tear down a newer one.
 * {@link destroy} (plugin unload) still closes any open dialog.
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
        commandCatalog: SettingCommandItem[];
        onStatus: (message: string, isError: boolean) => void;
    }): void {
        if (this.destroyed) return;
        if (this.dialog) return; // already open — prevent duplicate

        const title = opts.i18n.settingsTitle ?? "GestureFlow Settings";

        // Create the Dialog with an empty host div.  We'll mount the
        // Svelte component into it after the Dialog is constructed.
        // The destroyCallback is bound to THIS dialog instance so a
        // late callback from an older dialog can never touch a newer one.
        const dialog = new Dialog({
            title,
            content: '<div class="gf-dialog-host"></div>',
            width: "min(860px, calc(100vw - 48px))",
            height: "min(680px, calc(100vh - 48px))",
            destroyCallback: () => {
                // Called when the user clicks X, presses Esc, or clicks
                // the overlay — the Dialog is ALREADY destroyed at this
                // point, so only the panel and references are cleaned.
                this.onDialogDestroyed(dialog);
            },
        });
        this.dialog = dialog;

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
            // contains the host div.  Destroy and bail out.
            dialog.destroy();
            this.dialog = null;
            return;
        }

        this.panel = new SettingsPanel({
            target: host as HTMLElement,
            props: {
                configManager: opts.configManager,
                i18n: opts.i18n,
                commandCatalog: opts.commandCatalog,
                onStatus: opts.onStatus,
            },
        });
    }

    /**
     * Handle a Dialog that was destroyed by SiYuan itself (user closed
     * it via X / Esc / scrim).
     *
     * The dialog instance bound to the callback is compared against the
     * current reference: if a *different* instance reports its destroy
     * (a delayed callback from an old dialog), it is ignored so it
     * cannot tear down a newer dialog.
     *
     * Only the Svelte panel and the references are cleaned here — the
     * SiYuan Dialog has already been destroyed, so `Dialog.destroy()`
     * is deliberately NOT called again.
     */
    private onDialogDestroyed(d: Dialog): void {
        if (this.dialog !== d) {
            return; // stale callback from an older dialog — ignore
        }
        if (this.panel) {
            this.panel.$destroy();
            this.panel = null;
        }
        this.dialog = null;
    }

    /**
     * Close and destroy the dialog if open.  Idempotent.
     *
     * Order matters: references are cleared FIRST so the
     * `destroyCallback` fired by `Dialog.destroy()` arrives with no
     * references to clean and no second destroy to perform.  The panel
     * is destroyed exactly once, the Dialog exactly once.
     */
    close(): void {
        const d = this.dialog;
        const p = this.panel;
        this.dialog = null;
        this.panel = null;
        if (p) {
            p.$destroy();
        }
        if (d) {
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
