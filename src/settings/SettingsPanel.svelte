<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { ConfigManager, ConfigUpdatePatch } from "@/config/ConfigManager";
    import type { GestureFlowConfig } from "@/config/types";
    import type { SuppressionKey } from "@/gesture/types";
    import { parseNumber, DebouncedPatchScheduler } from "./settingsHelpers";

    /**
     * Props passed in from the host plugin.
     *
     * The panel never touches the runtime or the DOM overlay directly —
     * it only reads/writes the config via {@link ConfigManager} and
     * reports status back to the host via {@link onStatus}.
     */
    export let configManager: ConfigManager;
    export let i18n: Record<string, string>;
    export let onStatus: (message: string, isError: boolean) => void = () => {};

    let config: GestureFlowConfig = configManager.getConfig();
    let activeTab: "general" | "recognition" | "display" | "bindings" | "data" = "general";

    /** Debounced patch scheduler — merges rapid edits into a single save. */
    let scheduler: DebouncedPatchScheduler | null = null;
    let unsubscribe: (() => void) | null = null;

    /** Pending patch built up from user input.  Flushed by the scheduler. */
    let pendingPatch: ConfigUpdatePatch = {};

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

    // --------------------------------------------------------------- bindings tab

    function setBindingEnabled(id: string, enabled: boolean): void {
        const bindings = config.bindings.map((b) =>
            b.id === id ? { ...b, enabled } : b,
        );
        pendingPatch = { ...pendingPatch, bindings };
        config = { ...config, bindings };
        scheduleSave();
    }

    function commandLabel(commandId: string): string {
        // Map command ids to i18n keys.  Future stages can read this
        // from the CommandRegistry; for stage 5A the four built-in
        // commands are known.
        const map: Record<string, string> = {
            "tabs.previous": i18n.cmdTabsPrevious ?? "tabs.previous",
            "tabs.next": i18n.cmdTabsNext ?? "tabs.next",
            "scroll.top": i18n.cmdScrollTop ?? "scroll.top",
            "scroll.bottom": i18n.cmdScrollBottom ?? "scroll.bottom",
        };
        return map[commandId] ?? commandId;
    }

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
                onStatus(result.message, true);
            }
        } catch (err) {
            const label = err instanceof Error ? err.message : String(err);
            onStatus(`${i18n.settingsImportError ?? "Import failed"}: ${label}`, true);
        }
        // Reset the input so the same file can be re-selected.
        input.value = "";
    }

    async function handleReset(): Promise<void> {
        const ok = window.confirm(i18n.settingsResetConfirm ?? "Restore defaults?");
        if (!ok) return;
        const result = await configManager.reset();
        if (result.status === "saved") {
            onStatus(i18n.settingsResetDone ?? "Defaults restored", false);
        } else {
            onStatus(result.message, true);
        }
    }
</script>

<div class="gesture-flow-settings">
    <h2>{i18n.settingsTitle ?? "GestureFlow Settings"}</h2>

    <div class="gf-tabs">
        <button class:active={activeTab === "general"} on:click={() => (activeTab = "general")}>
            {i18n.settingsTabGeneral ?? "General"}
        </button>
        <button class:active={activeTab === "recognition"} on:click={() => (activeTab = "recognition")}>
            {i18n.settingsTabRecognition ?? "Recognition"}
        </button>
        <button class:active={activeTab === "display"} on:click={() => (activeTab = "display")}>
            {i18n.settingsTabDisplay ?? "Display"}
        </button>
        <button class:active={activeTab === "bindings"} on:click={() => (activeTab = "bindings")}>
            {i18n.settingsTabBindings ?? "Bindings"}
        </button>
        <button class:active={activeTab === "data"} on:click={() => (activeTab = "data")}>
            {i18n.settingsTabData ?? "Data"}
        </button>
    </div>

    {#if activeTab === "general"}
        <section class="gf-section">
            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsEnabled ?? "Enable gestures"}</span>
                    <span class="gf-desc">{i18n.settingsEnabledDesc ?? ""}</span>
                </div>
                <input
                    type="checkbox"
                    checked={config.enabled}
                    on:change={(e) => setEnabled(e.currentTarget.checked)}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsSuppressionKey ?? "Temporary disable key"}</span>
                    <span class="gf-desc">{i18n.settingsSuppressionKeyDesc ?? ""}</span>
                </div>
                <select
                    value={config.trigger.suppressionKey ?? ""}
                    on:change={onSuppressionKeyChange}
                >
                    <option value="">{i18n.settingsSuppressionKeyNone ?? "None"}</option>
                    <option value="Alt">Alt</option>
                    <option value="Control">Control</option>
                    <option value="Shift">Shift</option>
                    <option value="Meta">Meta</option>
                </select>
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsActivationDistance ?? "Activation distance"}</span>
                    <span class="gf-desc">{i18n.settingsActivationDistanceDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="4"
                    max="100"
                    step="1"
                    bind:value={activationDistanceStr}
                    on:blur={commitActivationDistance}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsTimeoutMs ?? "Gesture timeout"}</span>
                    <span class="gf-desc">{i18n.settingsTimeoutMsDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="0"
                    max="10000"
                    step="100"
                    bind:value={timeoutMsStr}
                    on:blur={commitTimeoutMs}
                />
            </label>
        </section>
    {/if}

    {#if activeTab === "recognition"}
        <section class="gf-section">
            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsDirectionMode ?? "Direction mode"}</span>
                    <span class="gf-desc">{i18n.settingsDirectionModeDesc ?? ""}</span>
                </div>
                <select
                    value={config.recognizer.directionMode}
                    on:change={onDirectionModeChange}
                >
                    <option value={4}>{i18n.settingsDirectionMode4 ?? "4 directions"}</option>
                    <option value={8}>{i18n.settingsDirectionMode8 ?? "8 directions"}</option>
                </select>
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsSampleDistance ?? "Sample distance"}</span>
                    <span class="gf-desc">{i18n.settingsSampleDistanceDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="1"
                    max="100"
                    step="0.5"
                    bind:value={sampleDistanceStr}
                    on:blur={commitSampleDistance}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsSimplifyTolerance ?? "Simplify tolerance"}</span>
                    <span class="gf-desc">{i18n.settingsSimplifyToleranceDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    bind:value={simplifyToleranceStr}
                    on:blur={commitSimplifyTolerance}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsMinimumSegmentLength ?? "Minimum segment length"}</span>
                    <span class="gf-desc">{i18n.settingsMinimumSegmentLengthDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="1"
                    max="500"
                    step="0.5"
                    bind:value={minimumSegmentLengthStr}
                    on:blur={commitMinimumSegmentLength}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsTurnAngleThreshold ?? "Turn angle threshold"}</span>
                    <span class="gf-desc">{i18n.settingsTurnAngleThresholdDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="1"
                    max="89"
                    step="1"
                    bind:value={turnAngleThresholdStr}
                    on:blur={commitTurnAngleThreshold}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsMaximumSegments ?? "Maximum segments"}</span>
                    <span class="gf-desc">{i18n.settingsMaximumSegmentsDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    bind:value={maximumSegmentsStr}
                    on:blur={commitMaximumSegments}
                />
            </label>
        </section>
    {/if}

    {#if activeTab === "display"}
        <section class="gf-section">
            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsShowTrail ?? "Show trail"}</span>
                    <span class="gf-desc">{i18n.settingsShowTrailDesc ?? ""}</span>
                </div>
                <input
                    type="checkbox"
                    checked={config.overlay.showTrail}
                    on:change={(e) => setShowTrail(e.currentTarget.checked)}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsShowHint ?? "Show hint"}</span>
                    <span class="gf-desc">{i18n.settingsShowHintDesc ?? ""}</span>
                </div>
                <input
                    type="checkbox"
                    checked={config.overlay.showHint}
                    on:change={(e) => setShowHint(e.currentTarget.checked)}
                />
            </label>

            <label class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsLineWidth ?? "Line width"}</span>
                    <span class="gf-desc">{i18n.settingsLineWidthDesc ?? ""}</span>
                </div>
                <input
                    type="number"
                    min="1"
                    max="20"
                    step="0.5"
                    bind:value={lineWidthStr}
                    on:blur={commitLineWidth}
                />
            </label>
        </section>
    {/if}

    {#if activeTab === "bindings"}
        <section class="gf-section">
            <p class="gf-info">{i18n.settingsBindingsDesc ?? ""}</p>
            <table class="gf-bindings">
                <thead>
                    <tr>
                        <th>{i18n.settingsBindingDirections ?? "Directions"}</th>
                        <th>{i18n.settingsBindingCommand ?? "Command"}</th>
                        <th>{i18n.settingsBindingEnabled ?? "Enabled"}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each config.bindings as binding (binding.id)}
                        <tr>
                            <td class="gf-mono">{binding.directions.join(" → ")}</td>
                            <td>{commandLabel(binding.commandId)}</td>
                            <td>
                                <input
                                    type="checkbox"
                                    checked={binding.enabled}
                                    on:change={(e) => setBindingEnabled(binding.id, e.currentTarget.checked)}
                                />
                                <span class="gf-state">
                                    {binding.enabled
                                        ? (i18n.settingsBindingEnabled ?? "Enabled")
                                        : (i18n.settingsBindingDisabled ?? "Disabled")}
                                </span>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </section>
    {/if}

    {#if activeTab === "data"}
        <section class="gf-section">
            <div class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsExport ?? "Export configuration"}</span>
                    <span class="gf-desc">{i18n.settingsExportDesc ?? ""}</span>
                </div>
                <button on:click={handleExport}>{i18n.settingsExport ?? "Export"}</button>
            </div>

            <div class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsImport ?? "Import configuration"}</span>
                    <span class="gf-desc">{i18n.settingsImportDesc ?? ""}</span>
                </div>
                <input type="file" accept="application/json,.json" on:change={handleImport} />
            </div>

            <div class="gf-row">
                <div class="gf-label">
                    <span class="gf-title">{i18n.settingsReset ?? "Restore defaults"}</span>
                    <span class="gf-desc">{i18n.settingsResetDesc ?? ""}</span>
                </div>
                <button class="gf-danger" on:click={handleReset}>{i18n.settingsReset ?? "Reset"}</button>
            </div>
        </section>
    {/if}
</div>

<style>
    .gesture-flow-settings {
        font-family: var(--b3-theme-font-family, system-ui, sans-serif);
        color: var(--b3-theme-on-background, #1f2329);
        padding: 8px 0;
    }
    h2 {
        margin: 0 0 12px;
        font-size: 18px;
        font-weight: 600;
    }
    .gf-tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--b3-theme-background-light, #e9e9ea);
        margin-bottom: 16px;
    }
    .gf-tabs button {
        background: transparent;
        border: none;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 13px;
        color: var(--b3-theme-on-surface, #626262);
        border-bottom: 2px solid transparent;
    }
    .gf-tabs button.active {
        color: var(--b3-theme-primary, #4285f4);
        border-bottom-color: var(--b3-theme-primary, #4285f4);
        font-weight: 600;
    }
    .gf-section {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .gf-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    .gf-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
    }
    .gf-title {
        font-size: 13px;
        font-weight: 500;
    }
    .gf-desc {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-row input[type="number"],
    .gf-row select {
        width: 140px;
        padding: 4px 8px;
        font-size: 13px;
        border: 1px solid var(--b3-theme-background-light, #e0e0e0);
        border-radius: 4px;
        background: var(--b3-theme-surface, #fff);
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
    }
    .gf-row button {
        padding: 6px 14px;
        font-size: 13px;
        border: 1px solid var(--b3-theme-primary, #4285f4);
        background: var(--b3-theme-primary, #4285f4);
        color: var(--b3-theme-on-primary, #fff);
        border-radius: 4px;
        cursor: pointer;
    }
    .gf-row button.gf-danger {
        background: var(--b3-card-error, #d23f31);
        border-color: var(--b3-card-error, #d23f31);
    }
    .gf-info {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        margin: 0 0 8px;
    }
    .gf-bindings {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }
    .gf-bindings th,
    .gf-bindings td {
        text-align: left;
        padding: 8px 10px;
        border-bottom: 1px solid var(--b3-theme-background-light, #e9e9ea);
    }
    .gf-bindings th {
        font-weight: 600;
        color: var(--b3-theme-on-surface, #626262);
    }
    .gf-mono {
        font-family: var(--b3-font-family-code, monospace);
        font-weight: 600;
    }
    .gf-state {
        margin-left: 8px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
</style>
