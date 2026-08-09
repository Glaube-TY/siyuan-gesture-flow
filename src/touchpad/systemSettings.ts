/**
 * Open the Windows touchpad settings page (ms-settings:devices-touchpad) via
 * the renderer's `@electron/remote` shell when available.
 *
 * Returns true when the request was handed to the OS.
 */
export function openWindowsTouchpadSettings(): boolean {
    const win = window as unknown as { require?: (id: string) => unknown };
    if (typeof win.require !== "function") return false;
    try {
        const remote = win.require("@electron/remote") as { shell?: { openExternal?: (url: string) => Promise<void> } };
        if (remote?.shell?.openExternal) {
            void remote.shell.openExternal("ms-settings:devices-touchpad");
            return true;
        }
    } catch {
        // fall through
    }
    return false;
}
