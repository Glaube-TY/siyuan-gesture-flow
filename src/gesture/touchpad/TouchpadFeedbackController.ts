import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { OverlayState, OverlayStatus } from "@/gesture/overlay/types";
import {
    TouchpadLiveState,
    TouchpadRecognitionResult,
} from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
import { TouchpadGestureSpec } from "@/gesture/touchpad/types";
import { touchpadDescriptorLabel, touchpadKindLabel } from "@/gesture/touchpad/labels";

/**
 * Touchpad feedback controller.
 *
 * Drives the shared {@link GestureOverlay} with compact, gesture-level
 * feedback (never low-level contact data):
 *
 *   - live:   "3指 滑动" while a gesture is being performed;
 *   - final:  "触控板 · 三指左滑" (or the bound command label beneath it)
 *             when a gesture completes;
 *   - cancel: hides the overlay.
 *
 * High-frequency live updates are coalesced through a single
 * `requestAnimationFrame` per frame (never one DOM write per contact frame).
 */
export class TouchpadFeedbackController {
    private readonly overlay: GestureOverlay;
    private readonly i18n: Record<string, string>;
    private latestLive: TouchpadLiveState | null = null;
    private rafId: number | null = null;

    constructor(overlay: GestureOverlay, i18n: Record<string, string>) {
        this.overlay = overlay;
        this.i18n = i18n;
    }

    /** A new live state arrived (throttled to the display refresh rate). */
    onLive(live: TouchpadLiveState): void {
        this.latestLive = live;
        this.scheduleFrame();
    }

    /** A gesture completed — show the final descriptor briefly. */
    onComplete(result: TouchpadRecognitionResult): void {
        if (!result.valid) {
            this.onCancel();
            return;
        }
        const spec = this.specFromResult(result);
        const descriptorLabel = spec ? touchpadDescriptorLabel(spec, this.i18n) : this.kindFallback(result);
        this.cancelFrame();
        this.overlay.showFinalThenHide(this.state(descriptorLabel, "complete", result.points ?? []));
        this.latestLive = null;
    }

    /** Cancel — hide the overlay. */
    onCancel(): void {
        this.cancelFrame();
        this.overlay.hide();
        this.latestLive = null;
    }

    destroy(): void {
        this.cancelFrame();
        this.overlay.destroy();
        this.latestLive = null;
    }

    // --------------------------------------------------------------- internals

    private scheduleFrame(): void {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.renderLive();
        });
    }

    private cancelFrame(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private renderLive(): void {
        const live = this.latestLive;
        if (!live) return;
        if (live.stage !== "POSSIBLE" && live.stage !== "TRACKING") return;
        const label =
            live.currentKind && live.fingerCount > 0
                ? `${live.fingerCount}${this.i18n.tpFingers ?? "指"} ${touchpadKindLabel(live.currentKind, this.i18n)}`
                : null;
        if (!label) return;
        this.overlay.show();
        this.overlay.update(this.state(label, "tracking", live.displayPath));
    }

    private state(
        descriptorLabel: string,
        status: OverlayStatus,
        normalizedPath: readonly { x: number; y: number }[],
    ): OverlayState {
        return {
            // Map the normalised touchpad trail into a virtual gesture area
            // at the centre of the screen so shapes keep a sane aspect ratio
            // (never stretch a touchpad path over the whole viewport).
            points: mapTrailToScreen(normalizedPath),
            directions: [],
            status,
            commandLabel: null,
            descriptorLabel,
        };
    }

    private specFromResult(result: TouchpadRecognitionResult): TouchpadGestureSpec | null {
        switch (result.kind) {
            case "tap":
                return { kind: "tap", fingerCount: result.fingerCount };
            case "press":
                return { kind: "press", fingerCount: result.fingerCount };
            case "hold":
                return { kind: "hold", fingerCount: result.fingerCount };
            case "swipe":
                if (result.directions.length !== 1) return null;
                return { kind: "swipe", fingerCount: result.fingerCount, direction: result.directions[0] };
            case "shape":
                if (result.directions.length === 0) return null;
                return { kind: "shape", fingerCount: result.fingerCount, directions: result.directions.slice() };
            case "anchorDraw":
                return {
                    kind: "anchorDraw",
                    fingerCount: result.fingerCount,
                    anchorCount: result.anchorCount ?? 1,
                    directions: result.directions.slice(),
                };
            case "pinch":
                if (!result.pinchDirection) return null;
                return { kind: "pinch", fingerCount: result.fingerCount, direction: result.pinchDirection };
            case "rotate":
                if (!result.rotateDirection) return null;
                return { kind: "rotate", fingerCount: result.fingerCount, direction: result.rotateDirection };
            default:
                return null;
        }
    }

    private kindFallback(result: TouchpadRecognitionResult): string {
        const spec = this.specFromResult(result);
        if (spec) return touchpadDescriptorLabel(spec, this.i18n);
        return result.kind;
    }
}

/**
 * Map a normalised (0..1) touchpad trail into a fixed virtual gesture area
 * centred on the screen, so the overlay shows a normal-proportion shape
 * without stretching it across the whole viewport.
 */
function mapTrailToScreen(path: readonly { x: number; y: number }[]): { x: number; y: number }[] {
    if (path.length === 0) return [];
    let vw = 0;
    let vh = 0;
    try {
        vw = window.innerWidth || 800;
        vh = window.innerHeight || 600;
    } catch {
        vw = 800;
        vh = 600;
    }
    const areaW = Math.min(480, vw * 0.45);
    const areaH = Math.min(320, vh * 0.45);
    const left = (vw - areaW) / 2;
    const top = (vh - areaH) / 2;
    return path.map((p) => ({
        x: left + Math.min(1, Math.max(0, p.x)) * areaW,
        y: top + Math.min(1, Math.max(0, p.y)) * areaH,
    }));
}
