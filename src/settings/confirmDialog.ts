import { Dialog } from "siyuan";

/**
 * Safe confirm dialog (RC hardening).
 *
 * SiYuan's `confirm(title, text, cb)` inserts its `text` argument into
 * the dialog HTML, so user-entered titles (e.g. a shortcut action name
 * like `<img src=x onerror=…>`) must never be passed to it.  This module
 * builds a small confirm dialog with the plugin's own DOM nodes: every
 * line is rendered via `textContent` (never innerHTML), so user text is
 * always shown as literal text.
 *
 * Buttons reuse SiYuan's `b3-button` classes.  The dialog is idempotent:
 * whichever path closes it (confirm / cancel / X / Esc / scrim / unload
 * via {@link closeAllSafeConfirms}), the callback fires at most once.
 */

export interface SafeConfirmOptions {
    /** Dialog title (plain string, rendered as text). */
    title: string;
    /** Plain-text body lines, each rendered in its own node. */
    body: string[];
    /** Confirm button label. */
    confirmLabel: string;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Called exactly once when the user confirms. */
    onConfirm: () => void;
    /** Called exactly once when the user cancels or dismisses. */
    onCancel?: () => void;
}

const OPEN_DIALOGS = new Set<SafeConfirmDialog>();

/**
 * Show a safe confirm dialog.  Any previously open SafeConfirm dialog is
 * closed first so only one confirm exists at a time.
 */
export function showSafeConfirm(options: SafeConfirmOptions): SafeConfirmDialog {
    closeAllSafeConfirms();
    const dialog = new SafeConfirmDialog(options);
    OPEN_DIALOGS.add(dialog);
    return dialog;
}

/** Close every open SafeConfirm dialog without firing confirm. */
export function closeAllSafeConfirms(): void {
    for (const d of [...OPEN_DIALOGS]) {
        d.close(false);
    }
    OPEN_DIALOGS.clear();
}

class SafeConfirmDialog {
    private readonly dialog: Dialog;
    private closed = false;
    private fired = false;
    private outcome = false;

    constructor(private readonly options: SafeConfirmOptions) {
        const dialog = new Dialog({
            title: options.title,
            content: '<div class="gf-confirm-host"></div>',
            width: "420px",
            destroyCallback: () => {
                OPEN_DIALOGS.delete(this);
                this.fire();
            },
        });
        this.dialog = dialog;
        dialog.element.classList.add("gf-confirm-dialog");

        const host = dialog.element.querySelector(".gf-confirm-host");
        if (host) {
            this.renderBody(host as HTMLElement);
        }
    }

    private renderBody(host: HTMLElement): void {
        for (const line of this.options.body) {
            const lineEl = document.createElement("div");
            lineEl.className = "gf-confirm-line";
            // textContent — user text is never parsed as HTML.
            lineEl.textContent = line;
            host.appendChild(lineEl);
        }

        const actions = document.createElement("div");
        actions.className = "gf-confirm-actions";

        const cancel = document.createElement("button");
        cancel.className = "b3-button b3-button--outline gf-confirm-btn";
        cancel.textContent = this.options.cancelLabel ?? "Cancel";
        cancel.addEventListener("click", () => this.close(false));

        const ok = document.createElement("button");
        ok.className = "b3-button b3-button--primary gf-confirm-btn";
        ok.textContent = this.options.confirmLabel;
        ok.addEventListener("click", () => this.close(true));

        actions.append(cancel, ok);
        host.appendChild(actions);
    }

    /**
     * Close the dialog.  The native destroy runs at most once; the
     * user-facing callback (confirm/cancel) fires at most once — even
     * when X / Esc / scrim destroy the dialog without going through here.
     */
    close(confirmed: boolean): void {
        if (this.closed) return;
        this.closed = true;
        this.outcome = confirmed;
        this.dialog.destroy();
    }

    private fire(): void {
        if (this.fired) return;
        this.fired = true;
        if (this.outcome) {
            this.options.onConfirm();
        } else {
            this.options.onCancel?.();
        }
    }
}
