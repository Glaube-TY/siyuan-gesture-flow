<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import { GestureEngine } from "@/gesture/GestureEngine";
    import type { GesturePoint } from "@/gesture/types";
    import type { Direction } from "@/gesture/recognition/DirectionVectorizer";
    import { directionSymbol } from "../directionLabels";

    /**
     * Local gesture recorder (stage 5B).
     *
     * A small canvas area where the user draws a gesture with the right
     * mouse button.  On release the trail is recognised through the
     * SAME {@link GestureEngine} pipeline used by the runtime
     * (`recognizePoints` — pure data, no session), and the resulting
     * direction sequence is dispatched to the parent binding editor.
     *
     * Isolation from the global gesture runtime:
     * - The container carries `data-gesture-flow-recorder`; the global
     *   MouseGestureAdapter (via the runtime's default ignore filter)
     *   skips these targets entirely, so recording never starts a real
     *   gesture, never runs a command, and never opens SiYuan's context
     *   menu.
     * - The recorder itself prevents the native context menu inside the
     *   recording area.
     *
     * Nothing is persisted here — the parent editor only saves through
     * the ConfigManager on explicit user action.
     */

    export let engine: GestureEngine;
    export let i18n: Record<string, string>;
    /** Current direction sequence (controlled by the parent editor). */
    export let directions: Direction[] = [];

    const dispatch = createEventDispatcher<{
        update: { directions: Direction[] };
        clear: Record<string, never>;
    }>();

    let container: HTMLDivElement;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | null = null;

    let recording = false;
    let status: "idle" | "recording" | "error" = "idle";
    let errorMessage = "";
    let points: GesturePoint[] = [];
    let pointerId: number | null = null;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cssW = 0;
    let cssH = 0;

    // ------------------------------------------------------------- listeners

    const onPointerDown = (e: PointerEvent) => {
        if (recording) return;
        if (e.button !== 2 || e.pointerType !== "mouse") return;
        e.preventDefault();
        startRecording(e);
    };
    const onPointerMove = (e: PointerEvent) => {
        if (!recording || e.pointerId !== pointerId) return;
        if ((e.buttons & 2) === 0) {
            cancelRecording(); // button released without pointerup (some platforms)
            return;
        }
        addPoint(e);
        scheduleDraw();
    };
    const onPointerUp = (e: PointerEvent) => {
        if (!recording || e.pointerId !== pointerId) return;
        if (e.button !== 2) return;
        const last = points[points.length - 1];
        if (!last || last.x !== e.clientX - rectLeft() || last.y !== e.clientY - rectTop()) {
            addPoint(e);
        }
        finishRecording();
    };
    const onPointerCancel = (e: PointerEvent) => {
        if (!recording || e.pointerId !== pointerId) return;
        cancelRecording();
    };
    const onLostPointerCapture = (e: PointerEvent) => {
        if (!recording || e.pointerId !== pointerId) return;
        cancelRecording();
    };
    const onContextMenu = (e: Event) => {
        // The recording area owns its right-click: no native menu, and
        // no SiYuan menu (capture phase + full propagation stop).
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (recording && e.key === "Escape") {
            cancelRecording();
        }
    };
    const onBlur = () => {
        if (recording) cancelRecording();
    };
    const onVisibilityChange = () => {
        if (document.hidden && recording) cancelRecording();
    };

    // --------------------------------------------------------------- helpers

    function rectLeft(): number {
        return container.getBoundingClientRect().left;
    }
    function rectTop(): number {
        return container.getBoundingClientRect().top;
    }

    function startRecording(e: PointerEvent): void {
        recording = true;
        status = "recording";
        errorMessage = "";
        points = [];
        pointerId = e.pointerId;
        addPoint(e);
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch {
            /* capture optional */
        }
        scheduleDraw();
    }

    function addPoint(e: PointerEvent): void {
        points.push({
            x: e.clientX - rectLeft(),
            y: e.clientY - rectTop(),
            t: typeof performance !== "undefined" ? performance.now() : e.timeStamp,
        });
    }

    function finishRecording(): void {
        const id = pointerId;
        recording = false;
        pointerId = null;
        try {
            canvas.releasePointerCapture(id as number);
        } catch {
            /* already released */
        }

        const result = engine.recognizePoints(points);
        scheduleDraw(); // final paint with the endpoint

        if (result.valid) {
            status = "idle";
            errorMessage = "";
            dispatch("update", { directions: result.directions });
        } else if (result.invalidReason === "too-short") {
            status = "error";
            errorMessage = i18n.gestureRecorderTooShort ?? "Trail too short";
        } else if (result.invalidReason === "too-many-segments") {
            status = "error";
            errorMessage = i18n.gestureRecorderTooMany ?? "Gesture too long";
        } else {
            status = "error";
            errorMessage = i18n.gestureRecorderUnrecognised ?? "Unrecognised";
        }
    }

    function cancelRecording(): void {
        recording = false;
        pointerId = null;
        points = [];
        status = "idle";
        errorMessage = "";
        draw(); // clear the trail
    }

    function clearGesture(): void {
        points = [];
        recording = false;
        pointerId = null;
        status = "idle";
        errorMessage = "";
        dispatch("clear", {});
        draw();
    }

    // ------------------------------------------------------------------ draw

    function resizeCanvas(): void {
        const rect = container.getBoundingClientRect();
        cssW = Math.max(1, rect.width);
        cssH = Math.max(1, rect.height);
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
        ctx = canvas.getContext("2d");
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function scheduleDraw(): void {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            draw();
        });
    }

    function draw(): void {
        const c = ctx;
        if (!c) return;
        c.clearRect(0, 0, cssW, cssH);
        if (points.length < 2) return;
        const themeColor =
            getComputedStyle(document.documentElement)
                .getPropertyValue("--b3-theme-primary")
                .trim() || "#4285f4";
        c.strokeStyle = themeColor;
        c.lineWidth = 2;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        c.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            c.lineTo(points[i].x, points[i].y);
        }
        c.stroke();
    }

    // ------------------------------------------------------------------ life

    onMount(() => {
        container.addEventListener("pointerdown", onPointerDown);
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerup", onPointerUp);
        container.addEventListener("pointercancel", onPointerCancel);
        container.addEventListener("lostpointercapture", onLostPointerCapture);
        container.addEventListener("contextmenu", onContextMenu, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onBlur);
        document.addEventListener("visibilitychange", onVisibilityChange);
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => resizeCanvas());
            resizeObserver.observe(container);
        }
        resizeCanvas();
    });

    onDestroy(() => {
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerup", onPointerUp);
        container.removeEventListener("pointercancel", onPointerCancel);
        container.removeEventListener("lostpointercapture", onLostPointerCapture);
        container.removeEventListener("contextmenu", onContextMenu, true);
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        recording = false;
        pointerId = null;
        points = [];
    });
</script>

<div
    class="gf-recorder"
    data-gesture-flow-recorder
    bind:this={container}
    role="button"
    tabindex="-1"
    aria-label={i18n.gestureRecorderHint ?? "Draw a gesture with the right button"}
>
    <canvas class="gf-recorder-canvas" bind:this={canvas}></canvas>
    <div class="gf-recorder-overlay">
        {#if status === "recording"}
            <span class="gf-recorder-status gf-recorder-status--recording">
                {i18n.gestureRecorderRecording ?? "Recording… release to finish"}
            </span>
        {:else if status === "error"}
            <span class="gf-recorder-status gf-recorder-status--error">{errorMessage}</span>
        {:else}
            <span class="gf-recorder-status">
                {i18n.gestureRecorderHint ?? "Hold right button and draw a gesture"}
            </span>
        {/if}
    </div>
    <div class="gf-recorder-dirs">
        {#if directions.length > 0}
            {#each directions as dir, i (i)}
                <span class="gf-badge gf-recorder-dir">{directionSymbol(dir)}</span>
            {/each}
            <button
                type="button"
                class="b3-button b3-button--text gf-recorder-clear"
                on:click={clearGesture}
            >
                {i18n.gestureRecorderClear ?? "Clear"}
            </button>
        {:else}
            <span class="gf-recorder-empty">{i18n.gestureRecorderEmpty ?? "No gesture recorded"}</span>
        {/if}
    </div>
</div>

<style>
    .gf-recorder {
        position: relative;
        width: 100%;
        height: 140px;
        border: 1px dashed var(--b3-border-color, #e9e9ea);
        border-radius: 8px;
        overflow: hidden;
        user-select: none;
        touch-action: none;
        background: transparent;
    }
    .gf-recorder-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
    }
    .gf-recorder-overlay {
        position: absolute;
        top: 8px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        pointer-events: none;
    }
    .gf-recorder-status {
        font-size: 12px;
        line-height: 1.5;
        padding: 2px 10px;
        border-radius: 10px;
        background: var(--b3-theme-surface, transparent);
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
    .gf-recorder-status--recording {
        color: var(--b3-theme-on-primary, #fff);
        background: var(--b3-theme-primary, #4285f4);
    }
    .gf-recorder-status--error {
        color: var(--b3-theme-on-surface, #1f2329);
        background: var(--b3-theme-surface, transparent);
    }
    .gf-recorder-dirs {
        position: absolute;
        bottom: 8px;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        pointer-events: none;
    }
    .gf-recorder-dir {
        min-width: 26px;
        height: 26px;
        font-size: 14px;
    }
    .gf-recorder-clear {
        pointer-events: auto;
        font-size: 12px;
        padding: 0 8px;
    }
    .gf-recorder-empty {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
    }
</style>



