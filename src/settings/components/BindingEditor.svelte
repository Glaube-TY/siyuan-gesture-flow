<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import GestureRecorder from "./GestureRecorder.svelte";
    import { GestureEngine } from "@/gesture/GestureEngine";
    import type { RecognizerConfig } from "@/gesture/GestureEngine";
    import type { Direction } from "@/gesture/recognition/DirectionVectorizer";
    import type { ConfigBinding } from "@/config/types";
    import type { SettingCommandItem } from "../commandCatalog";
    import { directionSymbol } from "../directionLabels";

    /**
     * Binding editor (stage 5B).
     *
     * Draft-only UI: nothing is persisted until the user presses Save,
     * which delegates to the parent via {@link handleSave}.  Editing an
     * existing binding keeps its original id; creating a new one
     * generates a fresh id at save time (not before).
     *
     * Validation mirrors the config layer so errors are shown inline:
     * empty directions, too many segments, diagonals in 4-dir mode,
     * duplicate gesture, unknown command.
     *
     * Config parity (stage 5B stabilization): the recorder uses a
     * GestureEngine built from the FULL current recognizer config
     * (rebuilt reactively when the config changes) plus the current
     * trigger activation/timeout values — no hard-coded defaults.
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
        commandId: string;
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

    // ---- draft state (never written to config until Save) ----
    let enabled = binding?.enabled ?? true;
    let directions: Direction[] = binding ? binding.directions.slice() : [];
    let commandId = binding?.commandId ?? (commandCatalog[0]?.id ?? "");
    let errorMessage = "";
    let saving = false;

    function onRecord(e: CustomEvent<{ directions: Direction[] }>): void {
        directions = e.detail.directions;
        errorMessage = "";
    }

    function onClear(): void {
        directions = [];
        errorMessage = "";
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
        if (!commandId) {
            return i18n.bindingErrorNoCommand ?? "Choose a command";
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
        saving = true;
        errorMessage = "";
        try {
            const saveError = await handleSave({ enabled, directions, commandId });
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

    <div class="gf-binding-editor-row">
        <span class="gf-binding-editor-label">
            {i18n.bindingCommand ?? "Command"}
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
        max-width: 260px;
        min-width: 0;
    }
    .gf-binding-editor-error {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-error, #d23f31);
    }
    .gf-binding-editor-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
