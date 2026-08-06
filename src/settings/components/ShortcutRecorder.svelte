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
     * Shortcut capture / display / test component (stage 6A).
     *
     * The component is fully controlled: it never saves bindings, never
     * touches ConfigManager, and never closes the editor.  It only
     * reports a captured {@link ShortcutSpec} (or `null` when cleared)
     * via the `change` event, and requests a live test of the *current
     * draft* via the `test` event — the parent runs the same
     * {@link ShortcutExecutor} used at runtime.
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
        test: ShortcutSpec;
    }>();

    let capturing = false;

    /** Display the value with the current platform's modifier style. */
    function renderShortcut(spec: ShortcutSpec): string {
        return displayShortcut(spec, detectShortcutPlatform());
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

    function testShortcut(): void {
        if (disabled || !value) return;
        dispatch("test", value);
    }

    onMount(() => {
        window.addEventListener("keydown", onKeyDown, { capture: true });
    });

    onDestroy(() => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
    });
</script>

<div class="gf-shortcut-recorder">
    <div class="gf-shortcut-field">
        <input
            class="b3-text-field gf-shortcut-input"
            type="text"
            readonly
            value={capturing
                ? (i18n.shortcutCapturing ?? "正在录入…")
                : value
                  ? renderShortcut(value)
                  : (i18n.shortcutEmpty ?? "")}
            on:click={beginCapture}
            on:focus={beginCapture}
            aria-label={i18n.shortcutCaptureHint ?? "点击后按下组合键"}
        />
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
    <div class="gf-shortcut-actions">
        {#if value && !capturing}
            <button
                class="b3-button b3-button--outline gf-shortcut-btn"
                on:click={testShortcut}
                aria-label={i18n.shortcutTest ?? "测试快捷键"}
            >
                {i18n.shortcutTest ?? "测试快捷键"}
            </button>
        {/if}
    </div>
    <p class="gf-shortcut-hint">
        {i18n.shortcutCompatibilityHint ??
            "快捷键会作为合成键盘事件发送。思源内置快捷键和多数插件快捷键可以响应；主动拒绝非真实键盘事件的少数插件可能不兼容；测试结果可能受当前焦点区域影响。"}
    </p>
    <p class="gf-shortcut-hint gf-shortcut-hint--context">
        {i18n.shortcutContextHint ?? "上下文相关快捷键请关闭设置窗口后用真实手势验证。"}
    </p>
</div>
