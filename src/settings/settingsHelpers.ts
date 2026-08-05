import type { ConfigUpdatePatch } from "@/config/ConfigManager";

/**
 * Pure helpers extracted from {@link SettingsPanel.svelte} so the
 * settings logic can be unit-tested without mounting a Svelte
 * component.
 *
 * The Svelte component stays a thin view layer: it renders the current
 * config and forwards user input to these helpers + the
 * {@link ConfigManager}.
 */

/**
 * Parse a numeric input string, clamping into the allowed range.
 *
 * Returns `null` when the input is not a valid number — the caller
 * keeps the local string buffer so the user can continue editing.
 * When `isInt` is true, non-integer values are rejected.
 *
 * This is the single source of truth for numeric-field validation in
 * the settings UI; the same rules apply to every field.
 */
export function parseNumber(
    raw: string,
    min: number,
    max: number,
    isInt: boolean,
): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    if (isInt && !Number.isInteger(n)) return null;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

/**
 * Accumulates partial config patches and flushes them via the injected
 * `save` callback after a short debounce window.
 *
 * Multiple `schedule` calls within the window are merged into a single
 * `save` invocation so rapid edits (e.g. typing in a number field) do
 * not restart the runtime on every keystroke.
 *
 * Nested sections (`trigger`, `recognizer`, `overlay`) are shallow-merged
 * so a patch that only touches `trigger.activationDistance` does not
 * erase sibling fields from a previously-scheduled patch.
 */
export class DebouncedPatchScheduler {
    private pendingPatch: ConfigUpdatePatch = {};
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly save: (patch: ConfigUpdatePatch) => Promise<void>;
    private readonly delayMs: number;
    private destroyed = false;

    constructor(
        save: (patch: ConfigUpdatePatch) => Promise<void>,
        delayMs: number = 400,
    ) {
        this.save = save;
        this.delayMs = delayMs;
    }

    /** Schedule a partial patch.  Merges with any pending patch. */
    schedule(patch: ConfigUpdatePatch): void {
        if (this.destroyed) return;
        this.pendingPatch = mergePatch(this.pendingPatch, patch);
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, this.delayMs);
    }

    /** Immediately flush the pending patch (if any). */
    async flush(): Promise<void> {
        if (this.destroyed) return;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const patch = this.pendingPatch;
        this.pendingPatch = {};
        if (Object.keys(patch).length === 0) return;
        await this.save(patch);
    }

    /** Whether a patch is waiting to be flushed. */
    get hasPending(): boolean {
        return Object.keys(this.pendingPatch).length > 0;
    }

    /** Whether a debounce timer is currently active. */
    get isScheduled(): boolean {
        return this.timer !== null;
    }

    /**
     * Cancel any pending timer and flush the accumulated patch so the
     * last edit is not lost.  After destroy, further `schedule` calls
     * are no-ops.
     */
    destroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.destroyed = true;
    }
}

/**
 * Merge a new partial patch into an accumulated patch.
 *
 * Nested sections are shallow-merged so sibling fields are preserved.
 * `bindings` is replaced wholesale (the settings UI always sends the
 * full bindings array).
 */
function mergePatch(
    acc: ConfigUpdatePatch,
    next: ConfigUpdatePatch,
): ConfigUpdatePatch {
    const merged: ConfigUpdatePatch = { ...acc };
    if (next.enabled !== undefined) {
        merged.enabled = next.enabled;
    }
    if (next.trigger) {
        merged.trigger = { ...(acc.trigger ?? {}), ...next.trigger };
    }
    if (next.recognizer) {
        merged.recognizer = { ...(acc.recognizer ?? {}), ...next.recognizer };
    }
    if (next.overlay) {
        merged.overlay = { ...(acc.overlay ?? {}), ...next.overlay };
    }
    if (next.bindings) {
        merged.bindings = next.bindings;
    }
    return merged;
}
