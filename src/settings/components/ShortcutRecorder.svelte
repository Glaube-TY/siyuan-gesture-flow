<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import type { ShortcutSpec } from "@/shortcuts/types";
    import {
        displayShortcut,
        eventToShortcutSpec,
        isModifierKey,
        detectShortcutPlatform,
    } from "@/shortcuts/shortcutUtils";

    /**
     * Shortcut capture / display component (stage 6A).
     *
     * The component is fully controlled and follows a strict one-way
     * data flow: the parent owns the single `value` source of truth,
     * passes it down via {@link value}, and updates it only in response
     * to the `change` event.  The component never saves bindings and
     * never touches ConfigManager.
     *
     * Capture semantics:
     * - Pure Control/Alt/Shift/Meta presses are ignored (never saved).
     * - Escape cancels capture without changing the current shortcut.
     * - Backspace/Delete clear the shortcut.
     * - Supported keys (letters, digits, F1–F12, arrows, navigation,
     *   punctuation…) end capture and emit a `change` event.
     * - While capturing, key events are stopped from propagating so the
     *   SiYuan shortcut system / dialog hotkeys are not triggered.
     * - All window-level listeners are removed on destroy — no residue.
     */

    export let value: ShortcutSpec | null = null;
    export let disabled = false;
    export let i18n: Record<string, string> = {};

    const dispatch = createEventDispatcher<{
        change: ShortcutSpec | null;
    }>();

    let capturing = false;

    // Reactive display text — recomputed whenever the capture state or
    // the value changes, so the input reflects the current state
    // immediately (capturing, captured combination, or the empty hint).
    $: platform = detectShortcutPlatform();
    $: displayText = capturing
        ? (i18n.shortcutCapturing ?? "正在录入快捷键…")
        : value
          ? displayShortcut(value, platform)
          : (i18n.shortcutCaptureHint ?? "点击后按下组合键");

    /**
     * Cancel capture when the input loses focus (e.g. the user clicked
     * another settings control).  The current shortcut is kept, no
     * `change` is emitted, and the draft is not cleared.  Clicking an
     * already-focused input never fires blur, so no pointer-state guard
     * is needed — a blur always means focus left the input.
     */
    function onBlur(): void {
        if (!capturing) return;
        capturing = false;
    }

    // If `disabled` becomes true mid-capture, leave capturing
    // immediately so no further keys are intercepted.
    $: if (disabled) {
        capturing = false;
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (!capturing) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const key = e.key;
        // Pure modifiers: ignore, keep capturing.
        if (isModifierKey(key)) return;

        if (key === "Escape") {
            // Cancel capture without modifying the current shortcut.
            capturing = false;
            return;
        }
        if (key === "Backspace" || key === "Delete") {
            capturing = false;
            dispatch("change", null);
            return;
        }

        const spec = eventToShortcutSpec(e);
        if (!spec) {
            // Unsupported key — keep capturing.
            return;
        }
        capturing = false;
        dispatch("change", spec);
    }

    function beginCapture(): void {
        if (disabled) return;
        capturing = true;
    }

    function clearShortcut(): void {
        if (disabled) return;
        capturing = false;
        dispatch("change", null);
    }

    onMount(() => {
        window.addEventListener("keydown", onKeyDown, { capture: true });
    });

    onDestroy(() => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
    });
</script>

<div class="gf-shortcut-recorder">
    <input
        class="b3-text-field gf-shortcut-input"
        class:gf-shortcut-input--capturing={capturing}
        type="text"
        readonly
        disabled={disabled}
        value={displayText}
        on:click={beginCapture}
        on:focus={beginCapture}
        on:blur={onBlur}
        aria-label={i18n.shortcutCaptureHint ?? "点击后按下组合键"}
    />
    <div class="gf-shortcut-actions">
        {#if value && !capturing}
            <button
                class="b3-button b3-button--outline gf-shortcut-btn"
                on:click={clearShortcut}
                aria-label={i18n.shortcutClear ?? "清除快捷键"}
            >
                {i18n.shortcutClearLabel ?? "清除"}
            </button>
        {/if}
    </div>
</div>

<style>
    /* All styles are component-scoped (Svelte scopes every class with a
       data-svelte attribute); only gf- prefixed classes are styled and
       only b3- classes from SiYuan are reused for base appearance. */

    .gf-shortcut-recorder {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
    }

    /* Row 1: the capture field takes the full width of its row. */
    .gf-shortcut-input {
        width: 100%;
        height: 52px;
        box-sizing: border-box;
        font-size: 16px;
        font-weight: 500;
        text-align: center;
        cursor: pointer;
        border-radius: 8px;
    }

    /* Capturing state: theme primary border + light translucent tint.
       Colors come from theme variables with fallbacks — never hard-coded
       light-theme values.  No animation. */
    .gf-shortcut-input--capturing {
        border-color: var(--b3-theme-primary, #3b82f6);
        background-color: color-mix(in srgb, var(--b3-theme-primary, #3b82f6) 10%, transparent);
    }

    .gf-shortcut-input:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }

    /* Row 2: right-aligned action buttons (never squeeze the input). */
    .gf-shortcut-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        min-height: 32px;
    }

    .gf-shortcut-btn {
        /* Reuses b3-button base appearance; extra spacing only. */
        padding: 4px 14px;
    }
</style>
