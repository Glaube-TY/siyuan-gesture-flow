<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        subscribeTouchpadDiagnostics,
        getTouchpadDiagnostics,
        type TouchpadDiagnostics,
        type TouchpadEventDetail,
    } from "@/runtime/TouchpadRuntimeState";
    import type { TouchpadCapabilities } from "@/touchpad/types";

    /**
     * Live touchpad test area (settings diagnostics).
     *
     * Subscribes to the renderer-wide diagnostics bus and renders the latest
     * snapshot.  Rendering is coalesced through a single
     * `requestAnimationFrame` (never one DOM write per contact frame) and
     * stops entirely when this component is destroyed — no high-frequency UI
     * updates happen while the settings page is closed.
     *
     * The hint text and the rendered data depend on the provider type:
     *   - native raw-contacts → per-contact dots;
     *   - Electron observer → event type / delta / scale (NO fake contacts);
     *   - none → "no provider" hint.
     */

    export let i18n: Record<string, string>;

    let contacts: Array<{ id: number; x: number; y: number; touching: boolean }> = [];
    let displayPath: Array<{ x: number; y: number }> = [];
    let displayContactPaths: Array<{ id: number; points: Array<{ x: number; y: number }> }> = [];
    let event: TouchpadEventDetail | null = null;
    let eventLabel: string | null = null;
    let currentKind: string | null = null;
    let stage: string = "IDLE";
    let caps: TouchpadCapabilities | null = null;
    let contactCount: number | null = null;

    let rafId: number | null = null;
    let unsubscribe: (() => void) | null = null;
    let latest: TouchpadDiagnostics | null = null;

    function scheduleRender(): void {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            render();
        });
    }

    function render(): void {
        const d = latest;
        if (!d) return;
        caps = d.capabilities;
        if (d.latest) {
            contacts = d.latest.contacts;
            contactCount = d.latest.contactCount ?? null;
            displayPath = d.latest.displayPath ?? [];
            displayContactPaths = d.latest.displayContactPaths ?? [];
            event = d.latest.event;
            eventLabel = d.latest.eventLabel;
            currentKind = d.latest.currentKind;
            stage = d.latest.stage;
        }
    }

    /** SVG polyline points for the display trail (viewBox 0 0 1000 1000). */
    $: trailPoints = displayPath
        .map((p) => `${(p.x * 1000).toFixed(1)},${(p.y * 1000).toFixed(1)}`)
        .join(" ");

    /** Per-contact thin trails (display only). */
    $: contactTrailPolylines = displayContactPaths.map((c) =>
        c.points
            .map((p) => `${(p.x * 1000).toFixed(1)},${(p.y * 1000).toFixed(1)}`)
            .join(" "),
    );

    onMount(() => {
        latest = getTouchpadDiagnostics();
        render();
        unsubscribe = subscribeTouchpadDiagnostics((diag) => {
            latest = diag;
            scheduleRender();
        });
    });

    onDestroy(() => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
    });

    function pct(v: number): string {
        return `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
    }

    function fmt(v: number): string {
        return v.toFixed(2);
    }

    // Explicit reactive declarations so Svelte tracks the dependencies
    // (`caps`, `contacts`, `contactCount`, `event`) instead of relying on
    // plain functions that Svelte cannot introspect in templates.
    $: nativeRaw =
        caps?.providerType === "windows-native" && caps?.supportsRawContacts === true;

    /** Whether the native HID descriptor contact map has parsed + frames flow. */
    $: hasDeliveredFrames =
        (caps?.diagnostics?.parser?.assembler?.completedFrameCount ?? 0) > 0;

    /** Contacts that are actually touching (active dots). */
    $: touchingContacts = contacts.filter((c) => c.touching !== false);

    /** Active contact count: device-reported count, else touching count. */
    $: activeCount = contactCount ?? touchingContacts.length;

    /** Rendering mode derived from the provider capabilities. */
    $: mode = nativeRaw
        ? hasDeliveredFrames
            ? "contacts"
            : "native-raw"
        : caps?.providerType === "electron-input-event"
            ? "observer"
            : caps?.providerType === "windows-native"
                ? "controller"
                : "none";

    /** Provider-appropriate hint text (never the wrong "touch the pad" hint). */
    $: hintText =
        mode === "contacts"
            ? (i18n.tpTestIdle ?? "将手指放到触控板上开始测试")
            : mode === "native-raw"
                ? (i18n.tpTestNativeRawHint ?? "在触控板上放置并移动 1～5 根手指进行检测")
                : mode === "observer"
                    ? (i18n.tpTestObserverHint ?? "使用双指滚动、捏合或点击测试触控板事件")
                    : mode === "controller"
                        ? (i18n.tpTestControllerHint ?? "放置三/四/五指以测试系统手势")
                        : (i18n.tpTestNoProvider ?? "当前没有可用的触控板输入提供器");

    // Live Raw Input counters for the native-raw state.
    $: rawWmInput = caps?.diagnostics?.parser?.capture?.wmInputCount ?? 0;
    $: rawHidReports = caps?.diagnostics?.parser?.capture?.rawInputHidReportCount ?? 0;
    $: rawDescriptorParsed = caps?.diagnostics?.parser?.descriptor?.parsed === true;
    $: rawDescriptorReason = caps?.diagnostics?.parser?.descriptor?.parse?.reason ?? "";
    $: rawBuildId = caps?.diagnostics?.parser?.buildId ?? "";

    /** Format a scroll delta / scale value for display. */
    function fmtDelta(v: number | undefined): string {
        return v === undefined ? "" : v.toFixed(2);
    }

    $: fmtEventDetail = (() => {
        if (!event) return "";
        const parts: string[] = [];
        if (event.type) parts.push(event.type);
        if (event.state) parts.push(event.state);
        if (event.deltaX !== undefined || event.deltaY !== undefined) {
            parts.push(`dx=${fmtDelta(event.deltaX)} dy=${fmtDelta(event.deltaY)}`);
        }
        if (event.scale !== undefined) {
            parts.push(`scale=${fmtDelta(event.scale)}`);
        }
        if (event.fingerCount !== undefined) {
            parts.push(`${event.fingerCount}-finger`);
        }
        return parts.join(" · ");
    })();
</script>

<div class="gf-tp-test">
    <div class="gf-tp-test-head">
        <span class="gf-tp-test-label">{i18n.tpTestArea ?? "触控测试区"}</span>
        {#if mode === "observer"}
            <span class="gf-tp-test-note">{i18n.tpTestNoContacts ?? "当前输入源不提供逐触点数据"}</span>
        {/if}
    </div>

    <div
        class="gf-tp-test-pad"
        class:gf-tp-test-pad--live={mode === "contacts"}
        class:gf-tp-test-pad--observer={mode === "observer"}
        class:gf-tp-test-pad--raw={mode === "native-raw"}
    >
        {#if mode === "contacts"}
            <svg
                class="gf-tp-test-trail"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                {#each contactTrailPolylines as pts (pts)}
                    <polyline
                        points={pts}
                        fill="none"
                        stroke="var(--b3-theme-primary, #4285f4)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        opacity="0.35"
                    />
                {/each}
                {#if trailPoints}
                    <polyline
                        points={trailPoints}
                        fill="none"
                        stroke="var(--b3-theme-primary, #4285f4)"
                        stroke-width="5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        opacity="0.7"
                    />
                {/if}
            </svg>
            {#each touchingContacts as c (c.id)}
                <div
                    class="gf-tp-contact"
                    style={`left:${pct(c.x)};top:${pct(c.y)}`}
                    title={`id=${c.id}`}
                >
                    <span class="gf-tp-contact-id">{c.id}</span>
                </div>
            {/each}
        {:else if mode === "native-raw"}
            <div class="gf-tp-test-native-raw">
                <span class="gf-tp-test-native-raw-title">
                    {i18n.tpTestNativeRawStarted ?? "Windows 原生触控板输入已启动"}
                </span>
                <span class="gf-tp-test-native-raw-line">
                    WM_INPUT: <strong>{rawWmInput}</strong>
                    · HID Reports: <strong>{rawHidReports}</strong>
                </span>
                <span class="gf-tp-test-native-raw-line">
                    HID 描述符:
                    {rawDescriptorParsed
                        ? (i18n.tpYes ?? "已完成")
                        : (rawDescriptorReason || (i18n.tpDescriptorWaiting ?? "等待解析"))}
                </span>
                <span class="gf-tp-test-native-raw-line gf-tp-test-native-raw-hint">
                    {hintText}
                </span>
            </div>
        {:else if (mode === "observer" || mode === "controller") && event}
            <div class="gf-tp-test-event">
                <span class="gf-tp-test-event-badge">{eventLabel ?? event.type}</span>
            </div>
        {:else}
            <div class="gf-tp-test-idle">{hintText}</div>
        {/if}
    </div>

    <div class="gf-tp-test-meta">
        <span class="gf-tp-meta-item">
            {i18n.tpContactCount ?? "触点数量"}:
            <strong>{activeCount}</strong>
        </span>
        {#each touchingContacts as c (c.id)}
            <span class="gf-tp-meta-item">
                #{c.id} ({fmt(c.x)}, {fmt(c.y)})
            </span>
        {/each}
        {#if mode === "native-raw"}
            <span class="gf-tp-meta-item">Native Build: {rawBuildId || "?"}</span>
        {/if}
        {#if currentKind}
            <span class="gf-tp-meta-item">
                {i18n.tpCurrentKind ?? "识别手势"}: <strong>{currentKind}</strong>
            </span>
        {/if}
        {#if event && fmtEventDetail}
            <span class="gf-tp-meta-item">{i18n.tpEventLabel ?? "事件"}: {fmtEventDetail}</span>
        {/if}
        <span class="gf-tp-meta-item">
            {i18n.tpStage ?? "阶段"}: {stage}
        </span>
    </div>
</div>

<style>
    .gf-tp-test {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .gf-tp-test-head {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .gf-tp-test-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-test-note {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-tp-test-pad {
        position: relative;
        width: 100%;
        height: 120px;
        border: 1px dashed var(--b3-border-color, #e9e9ea);
        border-radius: 8px;
        overflow: hidden;
        background: var(--b3-theme-surface, transparent);
    }
    .gf-tp-test-trail {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        display: block;
    }
    .gf-tp-test-pad--live {
        border-style: solid;
        border-color: var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-test-pad--observer {
        border-color: var(--b3-theme-secondary, #f29900);
    }
    .gf-tp-test-pad--raw {
        border-color: var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-test-native-raw {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px;
        text-align: center;
        font-size: 12px;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-test-native-raw-title {
        font-weight: 600;
        color: var(--b3-theme-primary, #4285f4);
    }
    .gf-tp-test-native-raw-line {
        line-height: 1.5;
        color: var(--b3-theme-on-surface, #1f2329);
    }
    .gf-tp-test-native-raw-hint {
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-tp-contact {
        position: absolute;
        width: 16px;
        height: 16px;
        margin: -8px 0 0 -8px;
        border-radius: 50%;
        background: var(--b3-theme-primary, #4285f4);
        color: var(--b3-theme-on-primary, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 600;
        box-shadow: 0 0 0 2px var(--b3-theme-surface, #fff);
    }
    .gf-tp-contact-id {
        line-height: 1;
    }
    .gf-tp-test-idle,
    .gf-tp-test-event {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-tp-test-event-badge {
        padding: 3px 10px;
        border-radius: 10px;
        background: var(--b3-theme-primary-lightest, #e8f0fe);
        color: var(--b3-theme-primary, #4285f4);
        font-weight: 600;
    }
    .gf-tp-test-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-size: 12px;
        color: var(--b3-theme-on-surface, #1f2329);
        min-height: 16px;
    }
    .gf-tp-meta-item {
        white-space: nowrap;
    }
</style>
