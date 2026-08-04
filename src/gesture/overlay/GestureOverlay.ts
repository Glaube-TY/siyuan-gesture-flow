import { OverlayI18n, OverlayState } from "./types";

/** Trail line width in CSS pixels (will become a setting later). */
const TRAIL_LINE_WIDTH = 3;

/** Offset of the hint from the pointer position (CSS px). */
const HINT_OFFSET = 14;

/** Duration the final result stays visible before hiding (ms). */
const COMPLETE_HIDE_DELAY = 300;

/**
 * CSS custom properties read from the SiYuan root for theming.
 *
 * `--b3-theme-primary` is the accent colour (used for the trail).
 * `--b3-theme-on-background` is the default text colour (hint text).
 * `--b3-theme-background` is the panel background (hint background).
 *
 * Each has a stable fallback so the overlay is readable even when the
 * CSS variables are not present (e.g. in tests or non-SiYuan pages).
 */
const THEME_VARS = {
    trailColor: ["--b3-theme-primary", "#4285f4"],
    hintColor: ["--b3-theme-on-background", "#1f2329"],
    hintBg: ["--b3-theme-surface", "#ffffff"],
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
 * The Canvas covers the entire viewport (`position: fixed; inset: 0`) and
 * never intercepts pointer events.  Internal pixel dimensions scale with
 * `devicePixelRatio` so the trail stays crisp on high-DPI displays; CSS
 * dimensions track `window.innerWidth`/`innerHeight` and a resize listener
 * keeps everything in sync.
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

    constructor(i18n: OverlayI18n) {
        this.i18n = i18n;
    }

    // --------------------------------------------------------------- lifecycle

    /**
     * Ensure the Canvas and hint element exist and are attached to
     * `document.body`.  Idempotent.
     */
    show(): void {
        if (this.destroyed) return;
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
            this.canvas.style.display = "block";
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
     */
    update(state: OverlayState): void {
        if (this.destroyed) return;
        this.current = state;
        if (!this.canvas || !this.ctx || !this.hint) {
            // Elements not yet created — create them now.
            this.show();
        }
        this.renderTrail(state.points);
        this.updateHint(state);
    }

    /**
     * Hide the overlay immediately (trail cleared, hint hidden).
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
     */
    showFinalThenHide(state: OverlayState): void {
        this.update(state);
        this.cancelHideTimer();
        this.hideTimer = setTimeout(() => {
            this.hide();
        }, COMPLETE_HIDE_DELAY);
    }

    // --------------------------------------------------------------- internals

    private createCanvas(): void {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
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
        hint.style.position = "fixed";
        hint.style.pointerEvents = "none";
        hint.style.zIndex = "100000";
        hint.style.display = "none";
        hint.style.padding = "4px 8px";
        hint.style.borderRadius = "4px";
        hint.style.fontFamily = "monospace";
        hint.style.fontSize = "13px";
        hint.style.fontWeight = "bold";
        hint.style.whiteSpace = "nowrap";
        hint.style.userSelect = "none";
        // Theme-aware colours
        hint.style.color = this.readThemeVar(THEME_VARS.hintColor);
        hint.style.backgroundColor = this.readThemeVar(THEME_VARS.hintBg);
        hint.style.border = `1px solid ${this.readThemeVar(THEME_VARS.hintBorder)}`;
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
        }
    }

    private renderTrail(points: { x: number; y: number }[]): void {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        if (points.length < 2) return;
        ctx.save();
        ctx.lineWidth = TRAIL_LINE_WIDTH;
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
        // Position near the last point
        const last = state.points[state.points.length - 1];
        if (!last) {
            hint.style.display = "none";
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
        // Clamp to viewport
        left = Math.max(0, Math.min(left, this.cssWidth - w));
        top = Math.max(0, Math.min(top, this.cssHeight - h));
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
}
