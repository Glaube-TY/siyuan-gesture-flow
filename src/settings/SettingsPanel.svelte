<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { confirm } from "siyuan";
    import type { ConfigManager, ConfigUpdatePatch } from "@/config/ConfigManager";
    import type { GestureFlowConfig } from "@/config/types";
    import type { ConfigBinding } from "@/config/types";
    import type { SuppressionKey } from "@/gesture/types";
    import type { Direction } from "@/gesture/recognition/DirectionVectorizer";
    import { parseNumber, DebouncedPatchScheduler } from "./settingsHelpers";
    import SettingSection from "./components/SettingSection.svelte";
    import SettingRow from "./components/SettingRow.svelte";
    import BindingEditor from "./components/BindingEditor.svelte";
    import type { SettingCommandItem } from "./commandCatalog";
    import { catalogCommandIds } from "./commandCatalog";
    import { directionSymbol } from "./directionLabels";
    import { displayShortcut, detectShortcutPlatform } from "@/shortcuts/shortcutUtils";
    import type { BindingAction } from "@/config/types";
    import {
        addBinding,
        updateBinding,
        removeBinding,
        toggleBinding,
        findIncompatibleBindings,
    } from "@/config/bindingOperations";
    import type { BindingOperationError } from "@/config/bindingOperations";

    /**
     * Props passed in from the host plugin.
     *
     * The panel never touches the runtime or the DOM overlay directly —
     * it only reads/writes the config via {@link ConfigManager} and
     * reports status back to the host via {@link onStatus}.  Stage 5B
     * adds the read-only {@link commandCatalog} so the bindings UI can
     * list the commands registered in the runtime without touching the
     * CommandRegistry or any execute functions.
     */
    export let configManager: ConfigManager;
    export let i18n: Record<string, string>;
    export let commandCatalog: SettingCommandItem[] = [];
    export let onStatus: (message: string, isError: boolean) => void = () => {};

    let config: GestureFlowConfig = configManager.getConfig();
    let activeTab: "general" | "recognition" | "display" | "bindings" | "data" = "general";

    /** Debounced patch scheduler — merges rapid edits into a single save. */
    let scheduler: DebouncedPatchScheduler | null = null;
    let unsubscribe: (() => void) | null = null;

    /** Pending patch built up from user input.  Flushed by the scheduler. */
    let pendingPatch: ConfigUpdatePatch = {};

    /** Hidden file input for the import button. */
    let fileInput: HTMLInputElement | null = null;

    /**
     * Local string buffers for numeric inputs.  Svelte's two-way binding
     * works best with strings for `<input type="number">` so the user can
     * type intermediate states like "1." or "-".  The value is parsed
     * back to a number on blur or on debounce flush.
     */
    let activationDistanceStr = String(config.trigger.activationDistance);
    let timeoutMsStr = String(config.trigger.timeoutMs);
    let sampleDistanceStr = String(config.recognizer.sampleDistance);
    let simplifyToleranceStr = String(config.recognizer.simplifyTolerance);
    let minimumSegmentLengthStr = String(config.recognizer.minimumSegmentLength);
    let turnAngleThresholdStr = String(config.recognizer.turnAngleThreshold);
    let maximumSegmentsStr = String(config.recognizer.maximumSegments);
    let lineWidthStr = String(config.overlay.lineWidth);

    onMount(() => {
        scheduler = new DebouncedPatchScheduler(async (patch) => {
            const result = await configManager.updateConfig(patch);
            if (result.status === "saved") {
                onStatus(i18n.settingsSaveSuccess ?? "Saved", false);
            } else {
                // Validation or persistence failed — restore the UI to the
                // real config so it never shows optimistic values.
                rollbackConfig();
                onStatus(result.message, true);
            }
        });
        unsubscribe = configManager.subscribe((next) => {
            // External changes (e.g. import/reset) update the local copy.
            config = next;
            syncStringBuffers();
        });
    });

    onDestroy(() => {
        if (scheduler) {
            // Flush any pending patch so the last edit is not lost.
            void scheduler.flush();
            scheduler.destroy();
            scheduler = null;
        }
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
    });

    function syncStringBuffers(): void {
        activationDistanceStr = String(config.trigger.activationDistance);
        timeoutMsStr = String(config.trigger.timeoutMs);
        sampleDistanceStr = String(config.recognizer.sampleDistance);
        simplifyToleranceStr = String(config.recognizer.simplifyTolerance);
        minimumSegmentLengthStr = String(config.recognizer.minimumSegmentLength);
        turnAngleThresholdStr = String(config.recognizer.turnAngleThreshold);
        maximumSegmentsStr = String(config.recognizer.maximumSegments);
        lineWidthStr = String(config.overlay.lineWidth);
    }

    /**
     * Schedule a debounced save via the patch scheduler.  Multiple edits
     * within the window are merged into a single `updateConfig` call so
     * we do not restart the runtime on every keystroke.
     */
    function scheduleSave(): void {
        scheduler?.schedule(pendingPatch);
        pendingPatch = {};
    }

    // --------------------------------------------------------------- field setters

    function setEnabled(value: boolean): void {
        pendingPatch = { ...pendingPatch, enabled: value };
        config = { ...config, enabled: value };
        scheduleSave();
    }

    function setSuppressionKey(value: SuppressionKey | null): void {
        const trigger = { ...config.trigger, suppressionKey: value };
        pendingPatch = { ...pendingPatch, trigger };
        config = { ...config, trigger };
        scheduleSave();
    }

    function onSuppressionKeyChange(e: Event): void {
        const v = (e.currentTarget as HTMLSelectElement).value;
        setSuppressionKey(v === "" ? null : (v as SuppressionKey));
    }

    function setDirectionMode(value: 4 | 8): void {
        // Stage 5B: switching to 4-direction mode with enabled diagonal
        // bindings is refused up-front — nothing is written, no local
        // state changes, and the user gets a clear localised hint.
        if (value === 4) {
            const incompatible = findIncompatibleBindings(config.bindings, 4);
            if (incompatible.length > 0) {
                onStatus(
                    `${i18n.directionModeSwitchBlocked ?? "Cannot switch to 4-direction mode"} — ${i18n.directionModeSwitchHint ?? "edit or disable the diagonal bindings first"}`,
                    true,
                );
                return;
            }
        }
        const recognizer = { ...config.recognizer, directionMode: value };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function onDirectionModeChange(e: Event): void {
        setDirectionMode(Number((e.currentTarget as HTMLSelectElement).value) as 4 | 8);
    }

    function setShowTrail(value: boolean): void {
        const overlay = { ...config.overlay, showTrail: value };
        pendingPatch = { ...pendingPatch, overlay };
        config = { ...config, overlay };
        scheduleSave();
    }

    function setShowHint(value: boolean): void {
        const overlay = { ...config.overlay, showHint: value };
        pendingPatch = { ...pendingPatch, overlay };
        config = { ...config, overlay };
        scheduleSave();
    }

    function commitActivationDistance(): void {
        const n = parseNumber(activationDistanceStr, 4, 100, true);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            activationDistanceStr = String(config.trigger.activationDistance);
            return;
        }
        const trigger = { ...config.trigger, activationDistance: n };
        pendingPatch = { ...pendingPatch, trigger };
        config = { ...config, trigger };
        scheduleSave();
    }

    function commitTimeoutMs(): void {
        const n = parseNumber(timeoutMsStr, 0, 10000, true);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            timeoutMsStr = String(config.trigger.timeoutMs);
            return;
        }
        const trigger = { ...config.trigger, timeoutMs: n };
        pendingPatch = { ...pendingPatch, trigger };
        config = { ...config, trigger };
        scheduleSave();
    }

    function commitSampleDistance(): void {
        const n = parseNumber(sampleDistanceStr, 1, 100, false);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            sampleDistanceStr = String(config.recognizer.sampleDistance);
            return;
        }
        const recognizer = { ...config.recognizer, sampleDistance: n };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function commitSimplifyTolerance(): void {
        const n = parseNumber(simplifyToleranceStr, 0, 50, false);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            simplifyToleranceStr = String(config.recognizer.simplifyTolerance);
            return;
        }
        const recognizer = { ...config.recognizer, simplifyTolerance: n };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function commitMinimumSegmentLength(): void {
        const n = parseNumber(minimumSegmentLengthStr, 1, 500, false);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            minimumSegmentLengthStr = String(config.recognizer.minimumSegmentLength);
            return;
        }
        const recognizer = { ...config.recognizer, minimumSegmentLength: n };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function commitTurnAngleThreshold(): void {
        const n = parseNumber(turnAngleThresholdStr, 1, 89, false);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            turnAngleThresholdStr = String(config.recognizer.turnAngleThreshold);
            return;
        }
        const recognizer = { ...config.recognizer, turnAngleThreshold: n };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function commitMaximumSegments(): void {
        const n = parseNumber(maximumSegmentsStr, 1, 20, true);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            maximumSegmentsStr = String(config.recognizer.maximumSegments);
            return;
        }
        const recognizer = { ...config.recognizer, maximumSegments: n };
        pendingPatch = { ...pendingPatch, recognizer };
        config = { ...config, recognizer };
        scheduleSave();
    }

    function commitLineWidth(): void {
        const n = parseNumber(lineWidthStr, 1, 20, false);
        if (n === null) {
            onStatus(i18n.settingsInvalidValue ?? "Invalid value", true);
            lineWidthStr = String(config.overlay.lineWidth);
            return;
        }
        const overlay = { ...config.overlay, lineWidth: n };
        pendingPatch = { ...pendingPatch, overlay };
        config = { ...config, overlay };
        scheduleSave();
    }

    // --------------------------------------------------------------- bindings tab (stage 5B: see editor/handlers below)

    // --------------------------------------------------------------- data tab

    function handleExport(): void {
        const json = JSON.stringify(configManager.exportJson(), null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gesture-flow-config.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function triggerImport(): void {
        fileInput?.click();
    }

    async function handleImport(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            const result = await configManager.importJson(payload);
            if (result.status === "imported") {
                onStatus(i18n.settingsImportSuccess ?? "Imported", false);
            } else {
                onStatus(
                    i18n.settingsImportIncompatible ??
                        (result.status === "error" && "message" in result ? result.message : "Import failed"),
                    true,
                );
            }
        } catch (err) {
            const label = err instanceof Error ? err.message : String(err);
            onStatus(`${i18n.settingsImportError ?? "Import failed"}: ${label}`, true);
        }
        // Reset the input so the same file can be re-selected.
        input.value = "";
    }

    async function handleReset(): Promise<void> {
        // SiYuan's native styled confirm dialog (not the browser one).
        confirm(i18n.settingsResetConfirm ?? "Restore defaults?", "", () => {
            void doReset();
        });
    }

    async function doReset(): Promise<void> {
        const result = await configManager.reset();
        if (result.status === "saved") {
            onStatus(i18n.settingsResetDone ?? "Defaults restored", false);
        } else {
            onStatus(result.message, true);
        }
    }

    const navItems = [
        { key: "general", label: () => i18n.settingsTabGeneral ?? "General" },
        { key: "recognition", label: () => i18n.settingsTabRecognition ?? "Recognition" },
        { key: "display", label: () => i18n.settingsTabDisplay ?? "Display" },
        { key: "bindings", label: () => i18n.settingsTabBindings ?? "Bindings" },
        { key: "data", label: () => i18n.settingsTabData ?? "Data" },
    ] as const;

    // ------------------------------------------------------- bindings (5B)

    /** Editor state: null = list view, otherwise a new or existing binding. */
    let editing: { mode: "new" } | { mode: "edit"; binding: ConfigBinding } | null = null;

    /**
     * Restore local state from the ConfigManager's real config after a
     * failed save.  Re-syncs every numeric buffer, select and switch.
     * Never triggers another save and never restarts the runtime.
     */
    function rollbackConfig(): void {
        config = configManager.getConfig();
        syncStringBuffers();
    }

    /** Map a binding-operation error code to a localised user message. */
    function bindingErrorMessage(error: BindingOperationError): string {
        switch (error) {
            case "empty-directions":
                return i18n.bindingErrorEmpty ?? "Record a gesture first";
            case "too-many-segments":
                return i18n.bindingErrorTooMany ?? "Gesture has too many segments";
            case "direction-not-allowed":
                return i18n.bindingErrorDiagonal4Enable ?? "Diagonal bindings cannot be enabled in 4-direction mode";
            case "duplicate-directions":
                return i18n.bindingErrorDuplicate ?? "Another binding already uses this gesture";
            case "duplicate-id":
                return i18n.bindingErrorDuplicateId ?? "Could not generate a unique binding id";
            case "unknown-command":
                return i18n.bindingErrorNoCommand ?? "Choose a command";
            case "invalid-command-params":
                return i18n.bindingErrorInvalidParams ?? "Invalid command parameters";
            case "invalid-shortcut":
                return i18n.shortcutFormatError ?? "快捷键格式无效";
            case "not-found":
                return i18n.bindingErrorNotFound ?? "Binding not found";
        }
    }

    function commandTitle(id: string): string {
        return commandCatalog.find((c) => c.id === id)?.title ?? id;
    }

    /**
     * Display name for a binding action: builtin commands show the
     * localised command title; shortcuts show the user-defined action
     * name.  Unknown/invalid actions fall back to the direction sequence
     * only.
     */
    function bindingActionTitle(binding: ConfigBinding): string {
        const action = binding.action;
        if (action.type === "builtin") {
            return commandTitle(action.commandId);
        }
        if (action.type === "shortcut") {
            return action.title;
        }
        return directionsLabel(binding.directions);
    }

    /**
     * Secondary detail line for a binding action: shortcuts show the
     * actual key combination beneath the action name; builtin actions
     * have no detail.
     */
    function bindingActionDetail(binding: ConfigBinding): string | null {
        if (binding.action.type === "shortcut") {
            return displayShortcut(binding.action.shortcut, detectShortcutPlatform());
        }
        return null;
    }

    /** Badge class for the implementation type. */
    function actionBadgeClass(binding: ConfigBinding): string {
        return binding.action.type === "builtin"
            ? "gf-badge--builtin"
            : "gf-badge--shortcut";
    }

    /** Badge text for the implementation type. */
    function actionBadgeLabel(binding: ConfigBinding): string {
        return binding.action.type === "builtin"
            ? (i18n.actionBuiltinBadge ?? "内置功能")
            : (i18n.actionShortcutBadge ?? "快捷键");
    }

    /** Direction symbols joined for confirmation dialogs. */
    function directionsLabel(directions: readonly Direction[]): string {
        return directions.map(directionSymbol).join(" → ");
    }

    function bindingValidationOptions() {
        return {
            maximumSegments: config.recognizer.maximumSegments,
            directionMode: config.recognizer.directionMode,
            availableCommandIds: catalogCommandIds(commandCatalog),
        };
    }

    /**
     * Save a draft from the BindingEditor through the ConfigManager
     * pipeline.  Returns an error message on failure (draft is kept),
     * or null on success (editor is closed by the caller).
     */
    async function editorSave(draft: {
        enabled: boolean;
        directions: Direction[];
        action: BindingAction;
    }): Promise<string | null> {
        const result =
            editing?.mode === "edit"
                ? updateBinding(config, editing.binding.id, draft, bindingValidationOptions())
                : addBinding(config, draft, bindingValidationOptions());
        if (!result.ok) {
            rollbackConfig();
            return bindingErrorMessage(result.error);
        }
        const save = await configManager.updateConfig({ bindings: result.bindings });
        if (save.status === "error") {
            rollbackConfig();
            return save.message;
        }
        editing = null; // success — close the editor, list updates via subscribe
        return null;
    }

    function openNewBinding(): void {
        editing = { mode: "new" };
    }

    function openEditBinding(binding: ConfigBinding): void {
        editing = { mode: "edit", binding };
    }

    function closeEditor(): void {
        editing = null;
    }

    async function handleToggleBinding(binding: ConfigBinding, enabled: boolean): Promise<void> {
        const result = toggleBinding(
            config,
            binding.id,
            enabled,
            config.recognizer.directionMode,
        );
        if (!result.ok) {
            rollbackConfig(); // e.g. diagonal binding in 4-dir mode — switch stays off
            onStatus(bindingErrorMessage(result.error), true);
            return;
        }
        // Optimistic local update so the switch flips immediately; on a
        // failed save rollbackConfig restores the real state.
        config = { ...config, bindings: result.bindings };
        const save = await configManager.updateConfig({ bindings: result.bindings });
        if (save.status === "error") {
            rollbackConfig(); // switch reverts to the real state
            onStatus(save.message, true);
        }
    }

    /**
     * Delete confirmation through SiYuan's native `confirm` dialog
     * (styled like the rest of the app, not the browser confirm box).
     * The actual delete only runs after the user confirms.
     */
    function handleDeleteBinding(binding: ConfigBinding): void {
        // The user-entered title is passed as plain text to SiYuan's
        // confirm dialog (which renders it via textContent — never
        // concatenated into innerHTML).
        const detail = bindingActionDetail(binding);
        const label = detail
            ? `${directionsLabel(binding.directions)} — ${bindingActionTitle(binding)} — ${detail}`
            : `${directionsLabel(binding.directions)} — ${bindingActionTitle(binding)}`;
        confirm(i18n.bindingDeleteConfirm ?? "Delete binding", label, () => {
            void doDeleteBinding(binding);
        });
    }

    async function doDeleteBinding(binding: ConfigBinding): Promise<void> {
        const result = removeBinding(config, binding.id);
        if (!result.ok) {
            rollbackConfig();
            onStatus(bindingErrorMessage(result.error), true);
            return;
        }
        const save = await configManager.updateConfig({ bindings: result.bindings });
        if (save.status === "error") {
            rollbackConfig(); // list reverts to the real state
            onStatus(save.message, true);
        }
    }
</script>

<div class="gf-root">
    <nav class="gf-nav">
        {#each navItems as item}
            <button
                class="gf-nav-btn"
                class:active={activeTab === item.key}
                on:click={() => (activeTab = item.key)}
            >
                {item.label()}
            </button>
        {/each}
    </nav>

    <main class="gf-content">
        {#if activeTab === "general"}
            <SettingSection title={i18n.settingsSectionBasic ?? "Basic"}>
                <SettingRow
                    title={i18n.settingsEnabled ?? "Enable gestures"}
                    description={i18n.settingsEnabledDesc ?? ""}
                    last
                >
                    <input
                        type="checkbox"
                        class="b3-switch"
                        checked={config.enabled}
                        on:change={(e) => setEnabled(e.currentTarget.checked)}
                    />
                </SettingRow>
            </SettingSection>

            <SettingSection title={i18n.settingsSectionTrigger ?? "Trigger"}>
                <SettingRow
                    title={i18n.settingsSuppressionKey ?? "Temporary disable key"}
                    description={i18n.settingsSuppressionKeyDesc ?? ""}
                >
                    <select
                        class="b3-select"
                        value={config.trigger.suppressionKey ?? ""}
                        on:change={onSuppressionKeyChange}
                    >
                        <option value="">{i18n.settingsSuppressionKeyNone ?? "None"}</option>
                        <option value="Alt">Alt</option>
                        <option value="Control">Control</option>
                        <option value="Shift">Shift</option>
                        <option value="Meta">Meta</option>
                    </select>
                </SettingRow>
                <SettingRow
                    title={i18n.settingsActivationDistance ?? "Activation distance"}
                    description={i18n.settingsActivationDistanceDesc ?? ""}
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="4"
                        max="100"
                        step="1"
                        bind:value={activationDistanceStr}
                        on:blur={commitActivationDistance}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsTimeoutMs ?? "Gesture timeout"}
                    description={i18n.settingsTimeoutMsDesc ?? ""}
                    last
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="0"
                        max="10000"
                        step="100"
                        bind:value={timeoutMsStr}
                        on:blur={commitTimeoutMs}
                    />
                </SettingRow>
            </SettingSection>
        {/if}

        {#if activeTab === "recognition"}
            <SettingSection title={i18n.settingsSectionDirection ?? "Direction"}>
                <SettingRow
                    title={i18n.settingsDirectionMode ?? "Direction mode"}
                    description={i18n.settingsDirectionModeDesc ?? ""}
                >
                    <select
                        class="b3-select"
                        value={config.recognizer.directionMode}
                        on:change={onDirectionModeChange}
                    >
                        <option value={4}>{i18n.settingsDirectionMode4 ?? "4 directions"}</option>
                        <option value={8}>{i18n.settingsDirectionMode8 ?? "8 directions"}</option>
                    </select>
                </SettingRow>
                <SettingRow
                    title={i18n.settingsMaximumSegments ?? "Maximum segments"}
                    description={i18n.settingsMaximumSegmentsDesc ?? ""}
                    last
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="1"
                        max="20"
                        step="1"
                        bind:value={maximumSegmentsStr}
                        on:blur={commitMaximumSegments}
                    />
                </SettingRow>
            </SettingSection>

            <SettingSection title={i18n.settingsSectionPath ?? "Path processing"}>
                <SettingRow
                    title={i18n.settingsSampleDistance ?? "Sample distance"}
                    description={i18n.settingsSampleDistanceDesc ?? ""}
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="1"
                        max="100"
                        step="0.5"
                        bind:value={sampleDistanceStr}
                        on:blur={commitSampleDistance}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsSimplifyTolerance ?? "Simplify tolerance"}
                    description={i18n.settingsSimplifyToleranceDesc ?? ""}
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="0"
                        max="50"
                        step="0.1"
                        bind:value={simplifyToleranceStr}
                        on:blur={commitSimplifyTolerance}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsMinimumSegmentLength ?? "Minimum segment length"}
                    description={i18n.settingsMinimumSegmentLengthDesc ?? ""}
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="1"
                        max="500"
                        step="0.5"
                        bind:value={minimumSegmentLengthStr}
                        on:blur={commitMinimumSegmentLength}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsTurnAngleThreshold ?? "Turn angle threshold"}
                    description={i18n.settingsTurnAngleThresholdDesc ?? ""}
                    last
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="1"
                        max="89"
                        step="1"
                        bind:value={turnAngleThresholdStr}
                        on:blur={commitTurnAngleThreshold}
                    />
                </SettingRow>
            </SettingSection>
        {/if}

        {#if activeTab === "display"}
            <SettingSection title={i18n.settingsTabDisplay ?? "Display"}>
                <SettingRow
                    title={i18n.settingsShowTrail ?? "Show trail"}
                    description={i18n.settingsShowTrailDesc ?? ""}
                >
                    <input
                        type="checkbox"
                        class="b3-switch"
                        checked={config.overlay.showTrail}
                        on:change={(e) => setShowTrail(e.currentTarget.checked)}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsShowHint ?? "Show hint"}
                    description={i18n.settingsShowHintDesc ?? ""}
                >
                    <input
                        type="checkbox"
                        class="b3-switch"
                        checked={config.overlay.showHint}
                        on:change={(e) => setShowHint(e.currentTarget.checked)}
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsLineWidth ?? "Line width"}
                    description={i18n.settingsLineWidthDesc ?? ""}
                    last
                >
                    <input
                        type="number"
                        class="b3-text-field"
                        min="1"
                        max="20"
                        step="0.5"
                        bind:value={lineWidthStr}
                        on:blur={commitLineWidth}
                    />
                </SettingRow>
            </SettingSection>
        {/if}

        {#if activeTab === "bindings"}
            <SettingSection title={i18n.settingsTabBindings ?? "Bindings"}>
                <p class="gf-bindings-info">{i18n.settingsBindingsDesc ?? ""}</p>
                {#if editing}
                    <BindingEditor
                        binding={editing.mode === "edit" ? editing.binding : null}
                        {commandCatalog}
                        {i18n}
                        handleSave={editorSave}
                        on:cancel={closeEditor}
                        recognizer={{
                            sampleDistance: config.recognizer.sampleDistance,
                            simplifyTolerance: config.recognizer.simplifyTolerance,
                            minimumSegmentLength: config.recognizer.minimumSegmentLength,
                            turnAngleThreshold: config.recognizer.turnAngleThreshold,
                            maximumSegments: config.recognizer.maximumSegments,
                            directionMode: config.recognizer.directionMode,
                        }}
                        trigger={{
                            activationDistance: config.trigger.activationDistance,
                            timeoutMs: config.trigger.timeoutMs,
                        }}
                    />
                {:else}
                    <div class="gf-binding-toolbar">
                        <button
                            type="button"
                            class="b3-button b3-button--primary gf-binding-add"
                            on:click={openNewBinding}
                        >
                            {i18n.bindingAdd ?? "Add binding"}
                        </button>
                    </div>
                    {#if config.bindings.length === 0}
                        <p class="gf-binding-empty">
                            {i18n.bindingEmpty ?? "No bindings — add one to get started."}
                        </p>
                    {:else}
                        <div class="gf-binding-list">
                            {#each config.bindings as binding (binding.id)}
                                <div class="gf-binding-item">
                                    <div class="gf-binding-left">
                                        <div class="gf-binding-dirs">
                                            {#each binding.directions as dir, i (i)}
                                                <span class="gf-badge">{directionSymbol(dir)}</span>
                                            {/each}
                                        </div>
                                        <span class="gf-badge gf-binding-type {actionBadgeClass(binding)}">
                                            {actionBadgeLabel(binding)}
                                        </span>
                                        <span class="gf-binding-cmd">
                                            <span class="gf-binding-cmd-main">{bindingActionTitle(binding)}</span>
                                            {#if bindingActionDetail(binding)}
                                                <span class="gf-binding-cmd-detail">{bindingActionDetail(binding)}</span>
                                            {/if}
                                            {#if !binding.enabled}
                                                <span class="gf-binding-disabled">
                                                    ({i18n.settingsBindingDisabled ?? "disabled"})
                                                </span>
                                            {/if}
                                        </span>
                                    </div>
                                    <div class="gf-binding-controls">
                                        <input
                                            type="checkbox"
                                            class="b3-switch"
                                            checked={binding.enabled}
                                            on:change={(e) =>
                                                handleToggleBinding(binding, e.currentTarget.checked)}
                                        />
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text gf-binding-edit"
                                            on:click={() => openEditBinding(binding)}
                                        >
                                            {i18n.bindingEdit ?? "Edit"}
                                        </button>
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text gf-binding-delete"
                                            on:click={() => handleDeleteBinding(binding)}
                                        >
                                            {i18n.bindingDelete ?? "Delete"}
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {/if}
            </SettingSection>
        {/if}

        {#if activeTab === "data"}
            <SettingSection title={i18n.settingsTabData ?? "Data"}>
                <SettingRow
                    title={i18n.settingsExport ?? "Export configuration"}
                    description={i18n.settingsExportDesc ?? ""}
                >
                    <button class="b3-button b3-button--text" on:click={handleExport}>
                        {i18n.settingsExport ?? "Export"}
                    </button>
                </SettingRow>
                <SettingRow
                    title={i18n.settingsImport ?? "Import configuration"}
                    description={i18n.settingsImportDesc ?? ""}
                >
                    <button class="b3-button b3-button--text" on:click={triggerImport}>
                        {i18n.settingsImport ?? "Import"}
                    </button>
                    <input
                        bind:this={fileInput}
                        type="file"
                        accept="application/json,.json"
                        on:change={handleImport}
                        class="gf-file-hidden"
                    />
                </SettingRow>
                <SettingRow
                    title={i18n.settingsReset ?? "Restore defaults"}
                    description={i18n.settingsResetDesc ?? ""}
                    last
                >
                    <button class="b3-button b3-button--cancel" on:click={handleReset}>
                        {i18n.settingsReset ?? "Reset"}
                    </button>
                </SettingRow>
            </SettingSection>
        {/if}
    </main>
</div>

<style>
    .gf-root {
        display: flex;
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        font-family: var(--b3-theme-font-family, system-ui, sans-serif);
        color: var(--b3-theme-on-background, #1f2329);
        /* One shared page background for the whole panel: nav and
           content are transparent and inherit this layer, so the left
           and right regions always match (and the dialog body below is
           painted with the same variable in src/index.scss). */
        background: var(--b3-theme-background, #fff);
    }

    /* ---- Left navigation ---- */
    .gf-nav {
        flex: 0 0 148px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 8px;
        border-right: 1px solid var(--b3-border-color, #e9e9ea);
        /* Transparent: the page background comes from gf-root, so the
           nav can never drift into a different color layer. */
        background: transparent;
        /* Stretch to the full page height (flex stretch) and scroll
           internally when there are more items than fit. */
        min-height: 0;
        overflow-y: auto;
    }
    .gf-nav-btn {
        background: transparent;
        border: none;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 13px;
        text-align: left;
        white-space: nowrap;
        color: var(--b3-theme-on-surface, #626262);
        border-radius: 6px;
        transition: background 0.12s ease, color 0.12s ease;
        /* Never compress buttons when the nav is short on space — the
           nav container scrolls instead (overflow-y: auto above). */
        flex-shrink: 0;
    }
    .gf-nav-btn:hover {
        background: var(--b3-list-hover, rgba(0, 0, 0, 0.04));
    }
    .gf-nav-btn.active {
        background: var(--b3-theme-primary, #4285f4);
        color: var(--b3-theme-on-primary, #fff);
        font-weight: 500;
    }

    /* ---- Right content ---- */
    .gf-content {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 20px 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        /* Transparent: shares the gf-root page background. */
        background: transparent;
    }

    /* ---- Bindings ---- */
    .gf-bindings-info {
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        margin: 0 0 4px;
        word-break: normal;
        overflow-wrap: break-word;
    }
    .gf-binding-type {
        font-size: 11px;
        line-height: 1;
        padding: 3px 8px;
        border-radius: 3px;
        flex: 0 0 auto;
    }
    .gf-binding-type.gf-badge--builtin {
        background: var(--b3-theme-primary-lightest, #e8f0fe);
        color: var(--b3-theme-primary, #4285f4);
    }
    .gf-binding-type.gf-badge--shortcut {
        background: var(--b3-theme-secondary-lightest, #fef3e2);
        color: var(--b3-theme-secondary, #f29900);
    }
    .gf-binding-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .gf-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        font-family: var(--b3-font-family-code, monospace);
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-primary, #fff);
        background: var(--b3-theme-primary, #4285f4);
        border-radius: 4px;
    }
    .gf-binding-dirs {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }
    .gf-binding-toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
    }
    .gf-binding-empty {
        font-size: 13px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        padding: 16px 0;
        margin: 0;
        text-align: center;
    }
    .gf-binding-list {
        display: flex;
        flex-direction: column;
    }
    .gf-binding-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid var(--b3-border-color, #e9e9ea);
    }
    .gf-binding-item:last-child {
        border-bottom: none;
    }
    .gf-binding-cmd {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-surface, #1f2329);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    /* Shortcut bindings: action name (main) + key combination (detail). */
    .gf-binding-cmd-main {
        display: inline;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .gf-binding-cmd-detail {
        margin-left: 8px;
        font-size: 12px;
        font-weight: 400;
        color: var(--b3-theme-on-surface, #1f2329);
        opacity: 0.65;
    }
    .gf-binding-disabled {
        font-size: 12px;
        font-weight: 400;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-binding-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
    }
    .gf-binding-add {
        font-size: 13px;
        padding: 2px 12px;
    }

    /* ---- Hidden file input ---- */
    .gf-file-hidden {
        position: absolute;
        width: 0;
        height: 0;
        opacity: 0;
        overflow: hidden;
        pointer-events: none;
    }

    /* ---- Narrow screens: collapse nav to top horizontal ---- */
    @media (max-width: 560px) {
        .gf-root {
            flex-direction: column;
        }
        .gf-nav {
            flex: 0 0 auto;
            flex-direction: row;
            gap: 4px;
            overflow-x: auto;
            overflow-y: hidden;
            border-right: none;
            border-bottom: 1px solid var(--b3-border-color, #e9e9ea);
            padding: 8px;
        }
        .gf-nav-btn {
            white-space: nowrap;
        }
    }
</style>


