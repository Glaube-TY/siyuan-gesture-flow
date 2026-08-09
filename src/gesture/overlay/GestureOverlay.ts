import { OverlayI18n, OverlayState } from "./types";
import { OverlayConfig } from "@/config/types";

/** Default trail line width in CSS pixels (used when config omits lineWidth). */
const DEFAULT_TRAIL_LINE_WIDTH = 3;

/** Offset of the hint from the pointer position (CSS px). */
const HINT_OFFSET = 14;

/** Duration the final result stays visible before hiding (ms). */
const COMPLETE_HIDE_DELAY = 300;

/** Maximum hint width so long command names do not stretch the viewport. */
const HINT_MAX_WIDTH = 240;

/**
 * CSS custom property names read from the SiYuan root for theming.
 *
 * The hint element uses `var(name, fallback)` directly in its inline style so
 * the browser re-resolves the value automatically when the theme changes.
 * Canvas trail colour is resolved at draw time via `getComputedStyle` because
 * Canvas has no CSS cascade.
 */
const THEME_VARS = {
    /** Canvas trail colour — resolved at draw time. */
    trailColor: ["--b3-theme-primary", "#4285f4"],
    /** Hint text colour — used via `var()`. */
    hintColor: ["--b3-theme-on-background", "#1f2329"],
    /** Hint background — used via `var()`. */
    hintBg: ["--b3-theme-surface", "#ffffff"],
    /** Hint border — used via `var()`. */
    hintBorder: ["--b3-theme-primary-light", "#d0e3ff"],
} as const;

/**
 * Renders the live gesture trail on a Canvas and shows a direction-sequence
 * hint element.
 *
 * The overlay owns exactly one `<canvas>` and one hint `<div>`, both created
 * lazily on first `show()` and removed on `destroy()`.  Creation and
 * destruction are idempotent — repeated `show()`/`destroy()` cycles do not
 * produce duplicate elements.
 *
 * **Timer safety**: {@link show} defensively cancels any pending hide timer
 * so a new gesture starting during the previous gesture's hide-delay window
 * is never hidden by the stale timer.  At most one hide timer exists at any
 * time.
 *
 * **Theme**: the hint element uses CSS `var()` for colours so the browser
 * re-resolves them automatically on theme switch.  Canvas trail colour is
 * read at draw time via `getComputedStyle`.
 */
export class GestureOverlay {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private hint: HTMLDivElement | null = null;
    private dpr = 1;
    private cssWidth = 0;
    private cssHeight = 0;
    private resizeHandler: (() => void) | null = null;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    private current: OverlayState | null = null;
    private readonly i18n: OverlayI18n;
    private destroyed = false;
    /**
     * Current overlay configuration.  Mutable via {@link updateConfig} so
     * the runtime can apply setting changes without recreating the
     * overlay.  All fields are primitives, so a shallow copy is enough
     * to isolate the overlay from external mutations.
     */
    private config: OverlayConfig;

    constructor(i18n: OverlayI18n, config?: OverlayConfig) {
        this.i18n = i18n;
        this.config = config
            ? { ...config }
            : { showTrail: true, showHint: true, lineWidth: DEFAULT_TRAIL_LINE_WIDTH };
    }

    /**
     * Replace the overlay configuration.  Applied immediately — the next
     * render uses the new values.  Does not recreate the Canvas or hint
     * elements; if `showTrail`/`showHint` were off and are now on, the
     * elements will be created lazily on the next {@link show}/{@link update}.
     *
     * If `showTrail` is turned off while a trail is currently drawn, the
     * Canvas is cleared immediately so the old trail does not linger.
     * If `showHint` is turned off while the hint is visible, the hint is
     * hidden immediately.
     */
    updateConfig(config: OverlayConfig): void {
        this.config = { ...config };
        if (!this.config.showTrail && this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        }
        if (!this.config.showHint && this.hint) {
            this.hint.style.display = "none";
        }
    }

    // --------------------------------------------------------------- lifecycle

    /**
     * Ensure the Canvas and hint element exist, are attached to
     * `document.body`, and are ready for a new gesture.
     *
     * Defensively cancels any pending hide timer from a previous gesture so
     * the new gesture is never hidden by a stale callback.  Idempotent.
     *
     * When `showTrail` is false the Canvas is still created (so that a
     * later `updateConfig({ showTrail: true })` can draw without extra
     * plumbing) but kept hidden via `display: none`.  When `showHint` is
     * false the hint element is created but kept hidden the same way.
     * Recognition is never affected by these flags — only rendering.
     */
    show(): void {
        if (this.destroyed) return;
        // Cancel any stale hide timer from a previous gesture's
        // showFinalThenHide().  This is the critical defence against the
        // timer-competition bug where gesture B's trail is hidden by
        // gesture A's delayed hide.
        this.cancelHideTimer();
        if (!this.canvas) {
            this.createCanvas();
        }
        if (!this.hint) {
            this.createHint();
        }
        if (!this.resizeHandler) {
            this.resizeHandler = () => this.handleResize();
            window.addEventListener("resize", this.resizeHandler);
        }
        this.handleResize();
        if (this.canvas) {
            this.canvas.style.display = this.config.showTrail ? "block" : "none";
        }
    }

    /**
     * Remove all DOM elements, cancel timers, and detach listeners.
     * Idempotent.
     */
    destroy(): void {
        this.destroyed = true;
        this.cancelHideTimer();
        if (this.resizeHandler) {
            window.removeEventListener("resize", this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.canvas) {
            this.canvas.remove();
            this.canvas = null;
            this.ctx = null;
        }
        if (this.hint) {
            this.hint.remove();
            this.hint = null;
        }
        this.current = null;
    }

    // --------------------------------------------------------------- rendering

    /**
     * Update the overlay with a new state snapshot and redraw.
     *
     * Honours the {@link OverlayConfig.showTrail} and {@link OverlayConfig.showHint}
     * flags: when `showTrail` is false the Canvas is cleared and hidden;
     * when `showHint` is false the hint element is hidden.  Recognition
     * and command dispatch are never affected — they happen in the
     * feedback controller and dispatcher, not here.
     */
    update(state: OverlayState): void {
        if (this.destroyed) return;
        this.current = state;
        if (!this.canvas || !this.ctx || !this.hint) {
            // Elements not yet created — create them now.
            this.show();
        }
        if (this.config.showTrail) {
            this.renderTrail(state.points);
        } else {
            // Trail disabled — clear any previous drawing and hide the
            // canvas so it never intercepts hit-testing (although it is
            // already pointer-events:none, hiding is cleaner).
            if (this.ctx && this.canvas) {
                this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
            }
            if (this.canvas) {
                this.canvas.style.display = "none";
            }
        }
        if (this.config.showHint) {
            this.updateHint(state);
        } else {
            if (this.hint) {
                this.hint.style.display = "none";
            }
        }
    }

    /**
     * Hide the overlay immediately (trail cleared, hint hidden).
     * Cancels any pending hide timer.
     */
    hide(): void {
        this.cancelHideTimer();
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        }
        if (this.hint) {
            this.hint.style.display = "none";
        }
        this.current = null;
    }

    /**
     * Show the final result, then hide after {@link COMPLETE_HIDE_DELAY} ms.
     * Cancels any previous hide timer first so at most one timer exists.
     */
    showFinalThenHide(state: OverlayState): void {
        this.update(state);
        this.cancelHideTimer();
        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            this.hide();
        }, COMPLETE_HIDE_DELAY);
    }

    // --------------------------------------------------------------- internals

    private createCanvas(): void {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.setAttribute("data-gesture-flow-overlay", "trail");
        canvas.style.position = "fixed";
        canvas.style.inset = "0";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "99999";
        canvas.style.display = "block";
        const body = document.body;
        if (body) {
            body.appendChild(canvas);
        } else {
            document.documentElement.appendChild(canvas);
        }
        const ctx = canvas.getContext("2d");
        this.canvas = canvas;
        this.ctx = ctx;
    }

    private createHint(): void {
        const hint = document.createElement("div");
        hint.setAttribute("aria-hidden", "true");
        hint.setAttribute("data-gesture-flow-overlay", "hint");
        hint.style.position = "fixed";
        hint.style.pointerEvents = "none";
        hint.style.zIndex = "100000";
        hint.style.display = "none";
        hint.style.padding = "4px 8px";
        hint.style.borderRadius = "4px";
        hint.style.fontFamily = "monospace";
        hint.style.fontSize = "13px";
        hint.style.fontWeight = "bold";
        // pre-line: preserves newlines in textContent (for command label)
        // while collapsing other whitespace.  This lets `dirText\ncommandLabel`
        // render as two lines without using innerHTML.
        hint.style.whiteSpace = "pre-line";
        hint.style.userSelect = "none";
        hint.style.maxWidth = `${HINT_MAX_WIDTH}px`;
        // Theme-aware colours via CSS var() — the browser re-resolves these
        // automatically when SiYuan switches between light and dark themes.
        // Using setProperty because `style.color = "var(...)"` is not reliably
        // accepted by all DOM implementations (including happy-dom).
        hint.style.setProperty("color", cssVar(THEME_VARS.hintColor));
        hint.style.setProperty("background-color", cssVar(THEME_VARS.hintBg));
        hint.style.setProperty("border", `1px solid ${cssVar(THEME_VARS.hintBorder)}`);
        const body = document.body;
        if (body) {
            body.appendChild(hint);
        } else {
            document.documentElement.appendChild(hint);
        }
        this.hint = hint;
    }

    private handleResize(): void {
        if (!this.canvas) return;
        this.dpr = window.devicePixelRatio || 1;
        this.cssWidth = window.innerWidth;
        this.cssHeight = window.innerHeight;
        // CSS size
        this.canvas.style.width = `${this.cssWidth}px`;
        this.canvas.style.height = `${this.cssHeight}px`;
        // Internal pixel size
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        // Reset transform and apply DPR scale (avoids cumulative scaling)
        if (this.ctx) {
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
        // Redraw current trail if any
        if (this.current) {
            this.renderTrail(this.current.points);
            // Reposition hint so it stays within the new viewport bounds.
            if (this.hint && this.hint.style.display !== "none") {
                const last = this.current.points[this.current.points.length - 1];
                if (last) {
                    this.positionHint(this.hint, last.x, last.y);
                }
            }
        }
    }

    private renderTrail(points: { x: number; y: number }[]): void {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        if (points.length < 2) return;
        ctx.save();
        ctx.lineWidth = this.config.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = this.readThemeVar(THEME_VARS.trailColor);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    private updateHint(state: OverlayState): void {
        const hint = this.hint;
        if (!hint) return;
        const text = this.hintText(state);
        if (text === null) {
            hint.style.display = "none";
            return;
        }
        hint.textContent = text;
        hint.style.display = "block";
        // Position near the last point, or centre the hint when the source
        // provides no screen coordinates (e.g. touchpad gestures).
        const last = state.points[state.points.length - 1];
        if (!last) {
            this.positionHint(hint, this.cssWidth / 2, this.cssHeight / 3);
            return;
        }
        this.positionHint(hint, last.x, last.y);
    }

    private hintText(state: OverlayState): string | null {
        const status = state.status;
        if (status === "idle") {
            return null;
        }
        if (status === "too-long") {
            return this.i18n.gestureTooLong;
        }
        if (status === "empty") {
            return this.i18n.gestureUnrecognised;
        }
        // A descriptor label (touchpad tap/pinch/rotate/anchorDraw) wins over
        // the raw direction sequence.
        if (state.descriptorLabel) {
            return state.commandLabel
                ? `${state.descriptorLabel}\n${state.commandLabel}`
                : state.descriptorLabel;
        }
        // tracking or complete
        if (state.directions.length === 0) {
            return null;
        }
        const dirText = state.directions.join(" → ");
        if (state.commandLabel) {
            return `${dirText}\n${state.commandLabel}`;
        }
        return dirText;
    }

    /**
     * Position the hint near (x, y) with an offset, clamped so it never
     * overflows the viewport.
     */
    private positionHint(hint: HTMLElement, x: number, y: number): void {
        // Default: below and to the right of the pointer.
        let left = x + HINT_OFFSET;
        let top = y + HINT_OFFSET;
        // Measure hint size (it's already display:block)
        const rect = hint.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        // Flip horizontally if it would overflow the right edge.
        if (left + w > this.cssWidth) {
            left = x - HINT_OFFSET - w;
        }
        // Flip vertically if it would overflow the bottom edge.
        if (top + h > this.cssHeight) {
            top = y - HINT_OFFSET - h;
        }
        // Clamp to viewport (handles tiny windows where hint > viewport)
        left = Math.max(0, Math.min(left, Math.max(0, this.cssWidth - w)));
        top = Math.max(0, Math.min(top, Math.max(0, this.cssHeight - h)));
        hint.style.left = `${Math.round(left)}px`;
        hint.style.top = `${Math.round(top)}px`;
    }

    private cancelHideTimer(): void {
        if (this.hideTimer !== null) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    /**
     * Read a SiYuan CSS custom property from the document root, falling back
     * to the provided default if the variable is empty or unavailable.
     *
     * Used for the Canvas trail colour which cannot use CSS `var()` directly.
     */
    private readThemeVar(entry: readonly [string, string]): string {
        const [varName, fallback] = entry;
        if (typeof getComputedStyle === "function") {
            const root = document.documentElement;
            const value = getComputedStyle(root).getPropertyValue(varName).trim();
            if (value) {
                return value;
            }
        }
        return fallback;
    }

    // --------------------------------------------------------------- test access

    /** @internal Exposed for tests — whether the Canvas is currently mounted. */
    get canvasMounted(): boolean {
        return this.canvas !== null;
    }

    /** @internal Exposed for tests — whether the hint is currently mounted. */
    get hintMounted(): boolean {
        return this.hint !== null;
    }

    /** @internal Exposed for tests — current DPR. */
    get currentDpr(): number {
        return this.dpr;
    }

    /** @internal Exposed for tests — current CSS width. */
    get currentCssWidth(): number {
        return this.cssWidth;
    }

    /** @internal Exposed for tests — current CSS height. */
    get currentCssHeight(): number {
        return this.cssHeight;
    }

    /** @internal Exposed for tests — whether the hint is visible. */
    get hintVisible(): boolean {
        return this.hint !== null && this.hint.style.display !== "none";
    }

    /** @internal Exposed for tests — current hint text. */
    get hintTextValue(): string | null {
        return this.hint?.textContent ?? null;
    }

    /** @internal Exposed for tests — canvas internal pixel width. */
    get canvasPixelWidth(): number {
        return this.canvas?.width ?? 0;
    }

    /** @internal Exposed for tests — canvas internal pixel height. */
    get canvasPixelHeight(): number {
        return this.canvas?.height ?? 0;
    }

    /** @internal Exposed for tests — whether a hide timer is pending. */
    get hasPendingHideTimer(): boolean {
        return this.hideTimer !== null;
    }

    /** @internal Exposed for tests — the 2D context (for mock verification). */
    get renderContext(): CanvasRenderingContext2D | null {
        return this.ctx;
    }
}

/**
 * Build a `var(name, fallback)` CSS value string for inline styles.
 *
 * Using `var()` in inline styles lets the browser re-resolve the colour
 * automatically when the SiYuan theme changes, without needing a
 * MutationObserver or theme-change listener.
 */
function cssVar(entry: readonly [string, string]): string {
    const [varName, fallback] = entry;
    return `var(${varName}, ${fallback})`;
}
