<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import GestureRecorder from "./GestureRecorder.svelte";
    import TouchpadGestureRecorder from "./TouchpadGestureRecorder.svelte";
    import ShortcutRecorder from "./ShortcutRecorder.svelte";
    import { GestureEngine } from "@/gesture/GestureEngine";
    import type { RecognizerConfig } from "@/gesture/GestureEngine";
    import type { Direction } from "@/gesture/recognition/DirectionVectorizer";
    import type { BindingAction, ConfigBinding, MouseShapeGestureSpec } from "@/config/types";
    import type { SettingCommandItem } from "../commandCatalog";
    import { directionSymbol } from "../directionLabels";
    import type { ShortcutSpec } from "@/shortcuts/types";
    import type { GestureSource } from "@/gesture/signature";
    import type { TouchpadGestureSpec } from "@/gesture/touchpad/types";
    import type { TouchpadTrackerConfig } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
    import { touchpadDescriptorLabel } from "@/gesture/touchpad/labels";
    import type { TouchpadConfig } from "@/config/types";
    import { systemGestureConflict } from "@/gesture/conflict/TouchpadConflictPolicy";

    /**
     * Binding editor (version 2 — multi-input source).
     *
     * Draft-only UI: nothing is persisted until the user presses Save, which
     * delegates to the parent via {@link handleSave}.  The editor supports:
     *
     *   - input source: mouse (existing GestureRecorder) or touchpad
     *     (TouchpadGestureRecorder);
     *   - action types: builtin command or keyboard shortcut.
     *
     * Switching sources/types only edits the local draft — nothing is
     * persisted until Save.
     */

    export let binding: ConfigBinding | null;
    export let commandCatalog: SettingCommandItem[];
    /** Full current recognizer config — the mouse recorder must match the runtime. */
    export let recognizer: RecognizerConfig;
    /** Trigger values the mouse recorder must honour. */
    export let trigger: { activationDistance: number; timeoutMs: number };
    /** Touchpad thresholds the touchpad recorder must honour. */
    export let touchpad: TouchpadConfig;
    export let i18n: Record<string, string>;
    /** Parent-provided save callback.  Must not resolve until persisted. */
    export let handleSave: (draft: {
        enabled: boolean;
        source: GestureSource;
        gesture: ConfigBinding["gesture"];
        action: BindingAction;
    }) => Promise<string | null>;

    const dispatch = createEventDispatcher<{
        cancel: Record<string, never>;
    }>();

    $: engine = new GestureEngine({
        sampleDistance: recognizer.sampleDistance,
        simplifyTolerance: recognizer.simplifyTolerance,
        minimumSegmentLength: recognizer.minimumSegmentLength,
        turnAngleThreshold: recognizer.turnAngleThreshold,
        maximumSegments: recognizer.maximumSegments,
        directionMode: recognizer.directionMode,
    });

    type ImplType = "builtin" | "shortcut" | "javascript";

    // ---- draft state (never written to config until Save) ----
    let enabled = binding?.enabled ?? true;
    let source: GestureSource = binding?.source ?? "mouse";
    let directions: Direction[] = binding && binding.source === "mouse"
        ? (binding.gesture as MouseShapeGestureSpec).directions.slice()
        : [];
    let touchpadGesture: TouchpadGestureSpec | null =
        binding && binding.source === "touchpad"
            ? (binding.gesture as TouchpadGestureSpec)
            : null;
    let implType: ImplType = binding ? binding.action.type : "builtin";
    let commandId = "";
    let shortcutTitle = "";
    let shortcut: ShortcutSpec | null = null;
    let errorMessage = "";
    let saving = false;

    if (binding) {
        if (binding.action.type === "builtin") {
            commandId = binding.action.commandId;
        } else {
            shortcutTitle = binding.action.title;
            shortcut = { ...binding.action.shortcut };
        }
    } else {
        commandId = commandCatalog[0]?.id ?? "";
    }

    function onRecord(e: CustomEvent<{ directions: Direction[] }>): void {
        directions = e.detail.directions;
        errorMessage = "";
    }

    function onTouchpadRecord(e: CustomEvent<{ gesture: TouchpadGestureSpec }>): void {
        touchpadGesture = e.detail.gesture;
        errorMessage = "";
    }

    function onClear(): void {
        directions = [];
        touchpadGesture = null;
        errorMessage = "";
    }

    function onSourceChange(e: Event): void {
        const next = (e.currentTarget as HTMLInputElement).value as GestureSource;
        source = next;
        errorMessage = "";
        if (next === "mouse" && directions.length === 0 && touchpadGesture) {
            directions = directionsOf(touchpadGesture);
        }
    }

    function directionsOf(spec: TouchpadGestureSpec): Direction[] {
        if (spec.kind === "swipe") return [spec.direction];
        if (spec.kind === "shape" || spec.kind === "anchorDraw") return spec.directions.slice();
        return [];
    }

    function onImplTypeChange(e: Event): void {
        const target = e.currentTarget as HTMLInputElement;
        implType = target.value as ImplType;
        errorMessage = "";
        if (implType === "builtin" && !commandId) {
            commandId = commandCatalog[0]?.id ?? "";
        }
    }

    function onShortcutTitleInput(e: Event): void {
        shortcutTitle = (e.currentTarget as HTMLInputElement).value;
        errorMessage = "";
    }

    function onShortcutChange(e: CustomEvent<ShortcutSpec | null>): void {
        shortcut = e.detail;
        errorMessage = "";
    }

    /** Validate the draft against the config constraints (UI mirror). */
    function validateDraft(): string | null {
        if (source === "mouse") {
            if (directions.length === 0) {
                return i18n.bindingErrorEmpty ?? "Record a gesture first";
            }
            if (directions.length > recognizer.maximumSegments) {
                return i18n.bindingErrorTooMany ?? "Gesture has too many segments";
            }
            if (
                recognizer.directionMode === 4 &&
                enabled &&
                directions.some((d) => d.length === 2)
            ) {
                return i18n.bindingErrorDiagonal4Enable ?? "Diagonals cannot be enabled in 4-direction mode";
            }
        } else {
            if (!touchpadGesture) {
                return i18n.tpRecorderNoGesture ?? "Record a touchpad gesture first";
            }
        }
        if (implType === "builtin") {
            if (!commandId) {
                return i18n.bindingErrorNoCommand ?? "Choose a command";
            }
        } else if (implType === "shortcut") {
            if (shortcutTitle.trim().length === 0) {
                return i18n.shortcutActionTitleRequired ?? "Enter an action name";
            }
            if (shortcutTitle.trim().length > 80) {
                return i18n.shortcutActionTitleTooLong ?? "Action name must be at most 80 characters";
            }
            if (!shortcut) {
                return i18n.shortcutEmptyError ?? "Shortcut must not be empty";
            }
        } else {
            return i18n.bindingErrorJavascriptUnavailable ?? "JavaScript actions are in development";
        }
        return null;
    }

    function draftAction(): BindingAction | null {
        if (implType === "builtin") {
            return { type: "builtin", commandId, commandParams: {} };
        }
        if (implType === "shortcut" && shortcut) {
            return { type: "shortcut", title: shortcutTitle.trim(), shortcut };
        }
        return null;
    }

    function draftGesture(): ConfigBinding["gesture"] | null {
        if (source === "mouse") {
            return { kind: "shape", button: 2, directions };
        }
        return touchpadGesture;
    }

    async function onSave(): Promise<void> {
        if (saving) return;
        const localError = validateDraft();
        if (localError) {
            errorMessage = localError;
            return;
        }
        const action = draftAction();
        const gesture = draftGesture();
        if (!action || !gesture) {
            errorMessage = i18n.bindingErrorJavascriptUnavailable ?? "JavaScript 功能正在开发";
            return;
        }
        saving = true;
        errorMessage = "";
        try {
            const saveError = await handleSave({ enabled, source, gesture, action });
            if (saveError) {
                errorMessage = saveError;
            }
        } finally {
            saving = false;
        }
    }

    function onCancel(): void {
        dispatch("cancel", {});
    }

    const groups = [...new Set(commandCatalog.map((c) => c.group))];

    function groupTitle(group: string): string {
        return commandCatalog.find((c) => c.group === group)?.groupTitle ?? group;
    }

    const touchpadTrackerConfig: Partial<TouchpadTrackerConfig> = {
        tapMaxDurationMs: touchpad.tapMaxDurationMs,
        tapMaxMovement: touchpad.tapMaxMovement,
        holdDurationMs: touchpad.holdDurationMs,
        holdMaxMovement: touchpad.holdMaxMovement,
        swipeMinDistance: touchpad.swipeMinDistance,
        shapeMinPathLength: touchpad.shapeMinPathLength,
        anchorMaxDrift: touchpad.anchorMaxDrift,
        anchorDrawActivation: touchpad.anchorDrawActivation,
        pinchThreshold: touchpad.pinchThreshold,
        rotateThresholdDeg: touchpad.rotateThresholdDeg,
        cooldownMs: touchpad.cooldownMs,
        // Recording must use the exact same 4/8-direction quantisation as
        // runtime recognition; otherwise a diagonal can be recorded in the
        // default 4-direction mode and then fail validation/matching.
        directionMode: recognizer.directionMode,
    };

    /**
     * Contextual system-conflict note for the current touchpad gesture draft.
     * Only shown while editing THIS binding, never as a settings page card.
     */
    $: conflictNote = touchpadGesture ? touchpadConflictNote(touchpadGesture) : null;

    function touchpadConflictNote(spec: TouchpadGestureSpec): string | null {
        if (systemGestureConflict(spec)) {
            return i18n.tpConflictBlocked ?? "这是系统内置触控板手势，插件不会执行，请重新录制";
        }
        return null;
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

    <div class="gf-binding-editor-row gf-binding-type-row">
        <span class="gf-binding-editor-label">
            {i18n.tpInputSource ?? "输入方式"}
        </span>
        <div class="gf-binding-type-group" role="radiogroup" aria-label={i18n.tpInputSource ?? "输入方式"}>
            <label class="gf-binding-type-option">
                <input
                    type="radio"
                    name="gf-binding-input-source"
                    value="mouse"
                    checked={source === "mouse"}
                    on:change={onSourceChange}
                />
                <span>{i18n.tpSourceMouse ?? "鼠标"}</span>
            </label>
            <label class="gf-binding-type-option">
                <input
                    type="radio"
                    name="gf-binding-input-source"
                    value="touchpad"
                    checked={source === "touchpad"}
                    on:change={onSourceChange}
                />
                <span>{i18n.tpSourceTouchpad ?? "触控板"}</span>
            </label>
        </div>
    </div>

    <div class="gf-binding-editor-row">
        <span class="gf-binding-editor-label">
            {i18n.bindingGesture ?? "Gesture"}
        </span>
        <div class="gf-binding-editor-dirs">
            {#if source === "mouse"}
                {#if directions.length > 0}
                    {#each directions as dir, i (i)}
                        <span class="gf-badge gf-binding-editor-dir">{directionSymbol(dir)}</span>
                    {/each}
                {:else}
                    <span class="gf-binding-editor-empty">
                        {i18n.bindingNoGesture ?? "No gesture recorded"}
                    </span>
                {/if}
            {:else}
                {#if touchpadGesture}
                    <span class="gf-tp-binding-label">{touchpadDescriptorLabel(touchpadGesture, i18n)}</span>
                {:else}
                    <span class="gf-binding-editor-empty">
                        {i18n.tpRecorderNoGesture ?? "No touchpad gesture recorded"}
                    </span>
                {/if}
            {/if}
        </div>
    </div>

    {#if source === "mouse"}
        <GestureRecorder
            {engine}
            {trigger}
            {i18n}
            {directions}
            on:update={onRecord}
            on:clear={onClear}
        />
    {:else}
        <TouchpadGestureRecorder
            {i18n}
            trackerConfig={touchpadTrackerConfig}
            on:update={onTouchpadRecord}
            on:clear={onClear}
        />
        {#if touchpadGesture && conflictNote}
            <p class="gf-tp-conflict-inline">
                {conflictNote}
            </p>
        {/if}
    {/if}

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
                {#if commandCatalog.length > 0 && !commandCatalog.some((c) => c.id === commandId)}
                    <option value={commandId} disabled>
                        {i18n.bindingUnavailableInThisVersion ?? "Unavailable in this version"}: {commandId}
                    </option>
                {/if}
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
        <div class="gf-shortcut-title-row">
            <label class="gf-shortcut-title-label" for="gf-shortcut-title">
                {i18n.shortcutActionTitle ?? "操作名称"}
            </label>
            <input
                id="gf-shortcut-title"
                class="b3-text-field gf-shortcut-title-input"
                type="text"
                maxlength="80"
                placeholder={i18n.shortcutActionTitlePlaceholder ?? "例如：打开全局搜索"}
                value={shortcutTitle}
                on:input={onShortcutTitleInput}
            />
        </div>
        <ShortcutRecorder
            value={shortcut}
            {i18n}
            on:change={onShortcutChange}
        />
    {/if}

    {#if errorMessage}
        <p class="gf-binding-editor-error">{errorMessage}</p>
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
    .gf-tp-binding-label {
        font-size: 13px;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-shortcut-title-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
    }
    .gf-shortcut-title-label {
        font-size: 13px;
        color: var(--b3-theme-on-background, inherit);
        opacity: 0.85;
    }
    .gf-shortcut-title-input {
        width: 100%;
        box-sizing: border-box;
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
    .gf-tp-conflict-inline {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-secondary, #f29900);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .gf-binding-editor-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
