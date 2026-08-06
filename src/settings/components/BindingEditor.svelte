<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import GestureRecorder from "./GestureRecorder.svelte";
    import ShortcutRecorder from "./ShortcutRecorder.svelte";
    import { GestureEngine } from "@/gesture/GestureEngine";
    import type { RecognizerConfig } from "@/gesture/GestureEngine";
    import type { Direction } from "@/gesture/recognition/DirectionVectorizer";
    import type { BindingAction, ConfigBinding } from "@/config/types";
    import type { SettingCommandItem } from "../commandCatalog";
    import { directionSymbol } from "../directionLabels";
    import type { ShortcutSpec } from "@/shortcuts/types";
    import { ShortcutExecutor } from "@/shortcuts/ShortcutExecutor";

    /**
     * Binding editor (stage 6A).
     *
     * Draft-only UI: nothing is persisted until the user presses Save,
     * which delegates to the parent via {@link handleSave}.  Editing an
     * existing binding keeps its original id; creating a new one
     * generates a fresh id at save time (not before).
     *
     * The editor now supports two persistent action types:
     * - `builtin` — pick a command from the catalog.
     * - `shortcut` — capture a keyboard shortcut (ShortcutRecorder).
     * JavaScript shows as a disabled "in development" option that can
     * never be selected, drafted, or saved.
     *
     * Switching between types only edits the local draft — nothing is
     * persisted and the runtime is not restarted until Save.  Cancelling
     * leaves the original binding untouched.
     */

    export let binding: ConfigBinding | null;
    export let commandCatalog: SettingCommandItem[];
    /** Full current recognizer config — the recorder must match the runtime. */
    export let recognizer: RecognizerConfig;
    /** Trigger values the recorder must honour (activation distance + timeout). */
    export let trigger: { activationDistance: number; timeoutMs: number };
    export let i18n: Record<string, string>;
    /** Parent-provided save callback.  Must not resolve until persisted. */
    export let handleSave: (draft: {
        enabled: boolean;
        directions: Direction[];
        action: BindingAction;
    }) => Promise<string | null>;

    const dispatch = createEventDispatcher<{
        cancel: Record<string, never>;
    }>();

    // Rebuilt whenever the recognizer config changes so the recorder
    // always recognises with the same parameters as the runtime.
    $: engine = new GestureEngine({
        sampleDistance: recognizer.sampleDistance,
        simplifyTolerance: recognizer.simplifyTolerance,
        minimumSegmentLength: recognizer.minimumSegmentLength,
        turnAngleThreshold: recognizer.turnAngleThreshold,
        maximumSegments: recognizer.maximumSegments,
        directionMode: recognizer.directionMode,
    });

    /** Selectable implementation types: javascript is a disabled placeholder. */
    type ImplType = "builtin" | "shortcut" | "javascript";

    // ---- draft state (never written to config until Save) ----
    let enabled = binding?.enabled ?? true;
    let directions: Direction[] = binding ? binding.directions.slice() : [];
    let implType: ImplType = binding
        ? binding.action.type
        : "builtin";
    let commandId = "";
    let shortcut: ShortcutSpec | null = null;
    let errorMessage = "";
    let testMessage = "";
    let saving = false;
    const shortcutExecutor = new ShortcutExecutor();

    // Initialise per-action draft fields from the edited binding.
    if (binding) {
        if (binding.action.type === "builtin") {
            commandId = binding.action.commandId;
        } else {
            shortcut = { ...binding.action.shortcut };
        }
    } else {
        commandId = commandCatalog[0]?.id ?? "";
    }

    function onRecord(e: CustomEvent<{ directions: Direction[] }>): void {
        directions = e.detail.directions;
        errorMessage = "";
    }

    function onClear(): void {
        directions = [];
        errorMessage = "";
    }

    /** Switch implementation type — edits the draft only. */
    function onImplTypeChange(e: Event): void {
        const target = e.currentTarget as HTMLInputElement;
        implType = target.value as ImplType;
        errorMessage = "";
        // Clear a stale test result when the implementation type changes.
        testMessage = "";
        // When switching (back) to builtin, seed the command draft so the
        // visible select and the model never diverge (e.g. editing a
        // shortcut binding leaves commandId empty until now).
        if (implType === "builtin" && !commandId) {
            commandId = commandCatalog[0]?.id ?? "";
        }
    }

    function onShortcutChange(e: CustomEvent<ShortcutSpec | null>): void {
        shortcut = e.detail;
        errorMessage = "";
        // Clear a stale test result on re-capture / clear.
        testMessage = "";
    }

    function onShortcutTest(e: CustomEvent<ShortcutSpec>): void {
        // Test only the current draft shortcut — nothing is saved, the
        // editor stays open, ConfigManager is untouched.  The same
        // ShortcutExecutor class used by the runtime performs the
        // dispatch.
        const spec = e.detail;
        const result = shortcutExecutor.dispatch(spec);
        if (result.status === "dispatched") {
            testMessage = i18n.shortcutTestSent ?? "已发送测试快捷键";
        } else if (result.status === "unavailable") {
            testMessage = i18n.shortcutTestFailed ?? "快捷键发送失败";
        } else {
            testMessage = `${i18n.shortcutTestFailed ?? "快捷键发送失败"}：${result.reason}`;
        }
    }

    /** Validate the draft against the config constraints (UI mirror). */
    function validateDraft(): string | null {
        if (directions.length === 0) {
            return i18n.bindingErrorEmpty ?? "Record a gesture first";
        }
        if (directions.length > recognizer.maximumSegments) {
            return (
                i18n.bindingErrorTooMany ??
                `Gesture has too many segments (max ${recognizer.maximumSegments})`
            );
        }
        // Mirrors the config layer: only ENABLED diagonal bindings are
        // rejected in 4-direction mode; a disabled one may be kept.
        if (
            recognizer.directionMode === 4 &&
            enabled &&
            directions.some((d) => d.length === 2)
        ) {
            return i18n.bindingErrorDiagonal4Enable ?? "Diagonals cannot be enabled in 4-direction mode";
        }
        if (implType === "builtin") {
            if (!commandId) {
                return i18n.bindingErrorNoCommand ?? "Choose a command";
            }
        } else if (implType === "shortcut") {
            if (!shortcut) {
                return i18n.shortcutEmptyError ?? "快捷键不能为空";
            }
        } else {
            // javascript is never savable.
            return i18n.bindingErrorJavascriptUnavailable ?? "JavaScript 功能正在开发";
        }
        return null;
    }

    function draftAction(): BindingAction | null {
        if (implType === "builtin") {
            return { type: "builtin", commandId, commandParams: {} };
        }
        if (implType === "shortcut" && shortcut) {
            return { type: "shortcut", shortcut };
        }
        return null;
    }

    async function onSave(): Promise<void> {
        if (saving) return;
        const localError = validateDraft();
        if (localError) {
            errorMessage = localError;
            return;
        }
        const action = draftAction();
        if (!action) {
            errorMessage = i18n.bindingErrorJavascriptUnavailable ?? "JavaScript 功能正在开发";
            return;
        }
        saving = true;
        errorMessage = "";
        try {
            const saveError = await handleSave({ enabled, directions, action });
            if (saveError) {
                // Save failed — keep the draft and show the error.
                errorMessage = saveError;
            }
            // On success the parent closes the editor.
        } finally {
            saving = false;
        }
    }

    function onCancel(): void {
        dispatch("cancel", {});
    }

    const groups = [...new Set(commandCatalog.map((c) => c.group))];

    /** Localised group label for the command optgroup. */
    function groupTitle(group: string): string {
        return commandCatalog.find((c) => c.group === group)?.groupTitle ?? group;
    }
</script>

<div class="gf-binding-editor">
    <h4 class="gf-binding-editor-title">
        {binding ? i18n.bindingEditTitle ?? "Edit binding" : i18n.bindingAddTitle ?? "New binding"}
    </h4>

    <div class="gf-binding-editor-row">
        <span class="gf-binding-editor-label">
            {i18n.bindingEnabled ?? "Enabled"}
        </span>
        <input
            type="checkbox"
            class="b3-switch"
            checked={enabled}
            on:change={(e) => (enabled = e.currentTarget.checked)}
        />
    </div>

    <div class="gf-binding-editor-row">
        <span class="gf-binding-editor-label">
            {i18n.bindingGesture ?? "Gesture"}
        </span>
        <div class="gf-binding-editor-dirs">
            {#if directions.length > 0}
                {#each directions as dir, i (i)}
                    <span class="gf-badge gf-binding-editor-dir">{directionSymbol(dir)}</span>
                {/each}
            {:else}
                <span class="gf-binding-editor-empty">
                    {i18n.bindingNoGesture ?? "No gesture recorded"}
                </span>
            {/if}
        </div>
    </div>

    <GestureRecorder
        {engine}
        {trigger}
        {i18n}
        {directions}
        on:update={onRecord}
        on:clear={onClear}
    />

    <div class="gf-binding-editor-row gf-binding-type-row">
        <span class="gf-binding-editor-label">
            {i18n.actionType ?? "实现类型"}
        </span>
        <div class="gf-binding-type-group" role="radiogroup" aria-label={i18n.actionType ?? "实现类型"}>
            <label class="gf-binding-type-option">
                <input
                    type="radio"
                    name="gf-binding-impl-type"
                    value="builtin"
                    checked={implType === "builtin"}
                    on:change={onImplTypeChange}
                />
                <span>{i18n.actionBuiltin ?? "内置功能"}</span>
            </label>
            <label class="gf-binding-type-option">
                <input
                    type="radio"
                    name="gf-binding-impl-type"
                    value="shortcut"
                    checked={implType === "shortcut"}
                    on:change={onImplTypeChange}
                />
                <span>{i18n.actionShortcut ?? "快捷键"}</span>
            </label>
            <label class="gf-binding-type-option gf-binding-type-option--disabled">
                <input
                    type="radio"
                    name="gf-binding-impl-type"
                    value="javascript"
                    disabled
                    checked={implType === "javascript"}
                />
                <span>{i18n.actionJavascript ?? "JavaScript"}（{i18n.actionInDevelopment ?? "开发中"}）</span>
            </label>
        </div>
    </div>

    {#if implType === "builtin"}
        <div class="gf-binding-editor-row">
            <span class="gf-binding-editor-label">
                {i18n.actionBuiltinSelect ?? "选择内置功能"}
            </span>
            <select class="b3-select gf-binding-editor-select" bind:value={commandId}>
                {#each groups as group}
                    <optgroup label={groupTitle(group)}>
                        {#each commandCatalog.filter((c) => c.group === group) as cmd}
                            <option value={cmd.id}>{cmd.title}</option>
                        {/each}
                    </optgroup>
                {/each}
            </select>
        </div>
    {:else if implType === "shortcut"}
        <ShortcutRecorder
            bind:value={shortcut}
            {i18n}
            on:change={onShortcutChange}
            on:test={onShortcutTest}
        />
    {/if}

    {#if errorMessage}
        <p class="gf-binding-editor-error">{errorMessage}</p>
    {/if}

    {#if testMessage}
        <p class="gf-binding-editor-test">{testMessage}</p>
    {/if}

    <div class="gf-binding-editor-actions">
        <button
            type="button"
            class="b3-button b3-button--text"
            disabled={saving}
            on:click={onCancel}
        >
            {i18n.bindingCancel ?? "Cancel"}
        </button>
        <button
            type="button"
            class="b3-button b3-button--primary gf-binding-editor-save"
            disabled={saving}
            on:click={onSave}
        >
            {saving ? i18n.bindingSaving ?? "Saving…" : i18n.bindingSave ?? "Save"}
        </button>
    </div>
</div>

<style>
    .gf-binding-editor {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .gf-binding-editor-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-binding-editor-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .gf-binding-editor-label {
        font-size: 13px;
        color: var(--b3-theme-on-surface, #1f2329);
        white-space: nowrap;
    }
    .gf-binding-editor-dirs {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }
    .gf-binding-editor-dir {
        min-width: 26px;
        height: 26px;
        font-size: 14px;
    }
    .gf-binding-editor-empty {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-binding-editor-select {
        max-width: 280px;
        min-width: 0;
    }
    .gf-binding-type-row {
        align-items: flex-start;
    }
    .gf-binding-type-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
    }
    .gf-binding-type-option {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface, #1f2329);
        cursor: pointer;
        white-space: nowrap;
    }
    .gf-binding-type-option input[type="radio"] {
        margin: 0;
        accent-color: var(--b3-theme-primary, #4285f4);
    }
    .gf-binding-type-option--disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .gf-binding-type-option--disabled input[type="radio"] {
        cursor: not-allowed;
    }
    .gf-binding-editor-error {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-error, #d23f31);
    }
    .gf-binding-editor-test {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-binding-editor-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
