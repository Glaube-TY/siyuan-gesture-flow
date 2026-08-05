<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { ConfigManager, ConfigUpdatePatch } from "@/config/ConfigManager";
    import type { GestureFlowConfig } from "@/config/types";
    import type { SuppressionKey } from "@/gesture/types";
    import { parseNumber, DebouncedPatchScheduler } from "./settingsHelpers";
    import SettingSection from "./components/SettingSection.svelte";
    import SettingRow from "./components/SettingRow.svelte";

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

    const navItems = [
        { key: "general", label: () => i18n.settingsTabGeneral ?? "General" },
        { key: "recognition", label: () => i18n.settingsTabRecognition ?? "Recognition" },
        { key: "display", label: () => i18n.settingsTabDisplay ?? "Display" },
        { key: "bindings", label: () => i18n.settingsTabBindings ?? "Bindings" },
        { key: "data", label: () => i18n.settingsTabData ?? "Data" },
    ] as const;
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
                {#each config.bindings as binding, i (binding.id)}
                    <SettingRow last={i === config.bindings.length - 1}>
                        <svelte:fragment slot="info">
                            <div class="gf-binding-left">
                                {#each binding.directions as dir}
                                    <span class="gf-badge">{dir}</span>
                                {/each}
                            </div>
                            <span class="gf-binding-cmd">{commandLabel(binding.commandId)}</span>
                        </svelte:fragment>
                        <input
                            type="checkbox"
                            class="b3-switch"
                            checked={binding.enabled}
                            on:change={(e) => setBindingEnabled(binding.id, e.currentTarget.checked)}
                        />
                    </SettingRow>
                {/each}
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
    .gf-binding-left {
        display: flex;
        gap: 4px;
        margin-bottom: 2px;
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
    .gf-binding-cmd {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-surface, #1f2329);
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
