<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { ConfigManager } from "@/config/ConfigManager";
    import type { GestureFlowConfig } from "@/config/types";
    import {
        subscribeTouchpadDiagnostics,
        getTouchpadDiagnostics,
        setTouchpadDiagnosticsPolling,
    } from "@/runtime/TouchpadRuntimeState";
    import type { TouchpadCapabilities } from "@/touchpad/types";
    import SettingSection from "./SettingSection.svelte";
    import SettingRow from "./SettingRow.svelte";

    /**
     * Touchpad settings page (user-facing).
     *
     * Only three areas:
     *   1. 触控板 — enable + safe mode.
     *   2. 状态 — a single concise status line.
     *   3. 说明 — point users to the Bindings page.
     *
     * All low-level diagnostics (Raw Input / HID / Native) are kept in the
     * native API and are only rendered here in development builds.
     */

    export let configManager: ConfigManager;
    export let i18n: Record<string, string>;
    export let config: GestureFlowConfig;
    export let onStatus: (message: string, isError: boolean) => void = () => {};

    let caps: TouchpadCapabilities | null = null;
    let unsubscribe: (() => void) | null = null;

    onMount(() => {
        setTouchpadDiagnosticsPolling(true);
        const initial = getTouchpadDiagnostics();
        if (initial.capabilities) caps = initial.capabilities;
        unsubscribe = subscribeTouchpadDiagnostics((diag) => {
            if (diag.capabilities) caps = diag.capabilities;
        });
    });

    onDestroy(() => {
        setTouchpadDiagnosticsPolling(false);
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
    });

    async function setTouchpadEnabled(enabled: boolean): Promise<void> {
        const result = await configManager.updateConfig({
            touchpad: { ...config.touchpad, enabled },
        });
        if (result.status === "error") {
            onStatus(result.message, true);
        } else {
            onStatus(i18n.settingsSaveSuccess ?? "Saved", false);
        }
    }

    async function setSafeMode(safeMode: boolean): Promise<void> {
        const result = await configManager.updateConfig({
            touchpad: { ...config.touchpad, safeMode },
        });
        if (result.status === "error") {
            onStatus(result.message, true);
        }
    }

    /** Single concise status line (no native paths / debug fields). */
    $: statusLine =
        caps?.providerType === "windows-native"
            ? caps?.multiContactGestures === true
                ? `${i18n.tpReady ?? "触控板已就绪"} · ${i18n.tpProviderNative ?? "Windows 原生"} · ${i18n.tpSupportsUpTo ?? "支持最多"} ${caps.maxContacts || "?"} ${i18n.tpFingers ?? "指"}`
                : `${i18n.tpReady ?? "触控板已就绪"} · ${i18n.tpSupportsMultiFinger ?? "支持多指手势"}`
            : caps?.providerType === "electron-input-event"
                ? `${i18n.tpReady ?? "触控板已就绪"} · ${i18n.tpObserverMode ?? "事件观察模式"}`
                : (i18n.tpNotDetected ?? "未检测到支持的触控板");

    /** Development-only compact diagnostics (hidden in production). */
    const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
</script>

<SettingSection title={i18n.tpSectionMain ?? "触控板"}>
    <SettingRow title={i18n.tpEnable ?? "启用触控板"} description={i18n.tpEnableDesc ?? ""}>
        <input
            type="checkbox"
            class="b3-switch"
            checked={config.touchpad.enabled}
            on:change={(e) => void setTouchpadEnabled(e.currentTarget.checked)}
        />
    </SettingRow>
    <SettingRow
        title={i18n.tpSafeMode ?? "安全模式"}
        description={i18n.tpSafeModeDesc ?? ""}
        last
    >
        <input
            type="checkbox"
            class="b3-switch"
            checked={config.touchpad.safeMode}
            on:change={(e) => void setSafeMode(e.currentTarget.checked)}
        />
    </SettingRow>
</SettingSection>

<SettingSection title={i18n.tpSectionStatus ?? "状态"}>
    <p class="gf-tp-status-line">{statusLine}</p>
</SettingSection>

<SettingSection title={i18n.tpSectionManage ?? "管理手势"}>
    <p class="gf-tp-manage-text">
        {i18n.tpManageInBindings ?? "触控板手势请在「绑定」页面中新增和管理。"}
    </p>
</SettingSection>

{#if isDev}
    <details class="gf-tp-advanced">
        <summary class="gf-tp-advanced-summary">开发诊断</summary>
        {#if caps?.diagnostics?.parser}
            <p class="gf-tp-notes">
                <span class="gf-tp-note">
                    {caps.diagnostics.parser.buildId ?? "?"}
                    {#if caps.diagnostics.parser.capture}
                        · WM_INPUT={caps.diagnostics.parser.capture.wmInputCount ?? 0}
                        / HID reports={caps.diagnostics.parser.capture.rawInputHidReportCount ?? 0}
                        / desc={caps.diagnostics.parser.capture.descriptorParseSuccessCount ?? 0}
                    {/if}
                    · parsed={caps.diagnostics.parser.descriptor?.parsed === true}
                    {#if caps.diagnostics.parser.descriptor?.parse && !caps.diagnostics.parser.descriptor?.parsed}
                        · 失败: {caps.diagnostics.parser.descriptor.parse.reason}
                    {/if}
                </span>
            </p>
        {/if}
    </details>
{/if}

<style>
    .gf-tp-status-line {
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-manage-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-tp-advanced {
        margin-top: 4px;
    }
    .gf-tp-advanced-summary {
        font-size: 13px;
        cursor: pointer;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-notes {
        margin: 4px 0 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .gf-tp-note {
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
</style>
