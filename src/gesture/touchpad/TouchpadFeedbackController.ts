import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { OverlayState, OverlayStatus } from "@/gesture/overlay/types";
import {
    TouchpadLiveState,
    TouchpadRecognitionResult,
    defaultRecognizeDirections,
} from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
import {
    TouchpadGestureSpec,
    canonicalContactPaths,
} from "@/gesture/touchpad/types";
import { touchpadDescriptorLabel, touchpadKindLabel } from "@/gesture/touchpad/labels";

/**
 * Touchpad feedback controller.
 *
 * Drives the shared {@link GestureOverlay} with gesture-level labels and one
 * visual trail per physical touchpad contact:
 *
 *   - live:   "3指 滑动" while a gesture is being performed;
 *   - final:  "触控板 · 三指左滑" (or the bound command label beneath it)
 *             when a gesture completes;
 *   - cancel: hides the overlay.
 *
 * High-frequency live updates are coalesced through a single
 * `requestAnimationFrame` per frame (never one DOM write per contact frame).
 */
export interface TouchpadFeedbackOptions {
    /** Resolve an exact touchpad descriptor to its configured action label. */
    commandLabelResolver?: ((spec: TouchpadGestureSpec) => string | null) | null;
    /** Must match runtime recognition so live preview signatures are identical. */
    directionMode?: 4 | 8;
}

export class TouchpadFeedbackController {
    private readonly overlay: GestureOverlay;
    private readonly i18n: Record<string, string>;
    private latestLive: TouchpadLiveState | null = null;
    private rafId: number | null = null;
    private readonly commandLabelResolver: ((spec: TouchpadGestureSpec) => string | null) | null;
    private readonly directionMode: 4 | 8;

    constructor(
        overlay: GestureOverlay,
        i18n: Record<string, string>,
        options: TouchpadFeedbackOptions = {},
    ) {
        this.overlay = overlay;
        this.i18n = i18n;
        this.commandLabelResolver = options.commandLabelResolver ?? null;
        this.directionMode = options.directionMode ?? 8;
    }

    /** A new live state arrived (throttled to the display refresh rate). */
    onLive(live: TouchpadLiveState): void {
        if (live.stage !== "POSSIBLE" && live.stage !== "TRACKING") {
            // Non-active snapshots are terminal for the live trail. Ignoring
            // them left the previous Canvas drawing visible indefinitely.
            this.onCancel();
            return;
        }
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
        const commandLabel = spec ? this.commandLabelResolver?.(spec) ?? null : null;
        const finalContactPaths =
            this.latestLive?.fingerCount === result.fingerCount
                ? this.latestLive.displayContactPaths
                : [];
        this.cancelFrame();
        this.overlay.showFinalThenHide(
            this.state(
                descriptorLabel,
                "complete",
                result.points ?? [],
                finalContactPaths,
                commandLabel,
            ),
        );
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
        const previewSpec = this.specFromLive(live);
        const commandLabel = previewSpec
            ? this.commandLabelResolver?.(previewSpec) ?? null
            : null;
        this.overlay.show();
        this.overlay.update(
            this.state(
                label,
                "tracking",
                live.displayPath,
                live.displayContactPaths,
                commandLabel,
            ),
        );
    }

    private state(
        descriptorLabel: string,
        status: OverlayStatus,
        normalizedPath: readonly { x: number; y: number }[],
        normalizedContactPaths: ReadonlyArray<{
            id: number;
            points: readonly { x: number; y: number }[];
        }> = [],
        commandLabel: string | null = null,
    ): OverlayState {
        return {
            // Map the normalised touchpad trail into a virtual gesture area
            // at the centre of the screen so shapes keep a sane aspect ratio
            // (never stretch a touchpad path over the whole viewport).
            points: mapTrailToScreen(normalizedPath),
            contactPaths: normalizedContactPaths.map((path) => ({
                id: path.id,
                points: mapTrailToScreen(path.points),
            })),
            directions: [],
            status,
            commandLabel,
            descriptorLabel,
        };
    }

    /** Build the exact candidate descriptor currently visible in the overlay. */
    private specFromLive(live: TouchpadLiveState): TouchpadGestureSpec | null {
        const kind = live.currentKind;
        const fingerCount = live.lockedFingerCount ?? live.fingerCount;
        if (!kind || fingerCount <= 0) return null;

        if (kind === "tap" || kind === "hold" || kind === "press") {
            return { kind, fingerCount } as TouchpadGestureSpec;
        }

        if (kind === "shape" || kind === "swipe" || kind === "anchorDraw") {
            const directions = recognizeDisplayPath(live.displayPath, this.directionMode);
            if (directions.length === 0) return null;
            if (kind === "swipe") {
                if (directions.length !== 1) return null;
                return { kind, fingerCount, direction: directions[0] };
            }
            if (kind === "anchorDraw") {
                return {
                    kind,
                    fingerCount,
                    anchorCount: Math.max(1, live.displayAnchorIds.length),
                    directions,
                };
            }
            return { kind, fingerCount, directions };
        }

        if (kind === "multiShape") {
            if (live.displayContactPaths.length !== fingerCount) return null;
            const paths = live.displayContactPaths.map((path) =>
                recognizeDisplayPath(path.points, 8),
            );
            if (paths.some((path) => path.length === 0)) return null;
            return { kind, fingerCount, paths: canonicalContactPaths(paths) };
        }

        if (kind === "pinch") {
            const direction = inferPinchDirection(live.displayContactPaths);
            return direction ? { kind, fingerCount, direction } : null;
        }

        if (kind === "rotate") {
            const direction = inferRotateDirection(live.displayContactPaths);
            return direction ? { kind, fingerCount, direction } : null;
        }

        return null;
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
            case "multiShape":
                if (!result.contactDirections || result.contactDirections.length !== result.fingerCount) return null;
                return {
                    kind: "multiShape",
                    fingerCount: result.fingerCount,
                    paths: result.contactDirections.map((path) => path.slice()),
                };
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

type DisplayContactPath = {
    id: number;
    points: readonly { x: number; y: number }[];
};

function recognizeDisplayPath(
    path: readonly { x: number; y: number }[],
    directionMode: 4 | 8,
) {
    return defaultRecognizeDirections(
        path.map((point, index) => ({ ...point, t: index })),
        directionMode,
    );
}

function inferPinchDirection(
    paths: ReadonlyArray<DisplayContactPath>,
): "in" | "out" | null {
    const start = endpointSpread(paths, false);
    const end = endpointSpread(paths, true);
    if (start <= 0 || end <= 0 || Math.abs(end - start) < 1e-6) return null;
    return end > start ? "out" : "in";
}

function endpointSpread(paths: ReadonlyArray<DisplayContactPath>, useLast: boolean): number {
    const points = paths
        .map((path) => useLast ? path.points[path.points.length - 1] : path.points[0])
        .filter((point): point is { x: number; y: number } => point !== undefined);
    if (points.length < 2) return 0;
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            total += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
            pairs += 1;
        }
    }
    return pairs > 0 ? total / pairs : 0;
}

function inferRotateDirection(
    paths: ReadonlyArray<DisplayContactPath>,
): "cw" | "ccw" | null {
    const usable = paths.filter((path) => path.points.length >= 2);
    if (usable.length < 2) return null;

    let pair: readonly [DisplayContactPath, DisplayContactPath] | null = null;
    let farthest = -1;
    for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
            const a = usable[i].points[0];
            const b = usable[j].points[0];
            const distance = Math.hypot(b.x - a.x, b.y - a.y);
            if (distance > farthest) {
                farthest = distance;
                pair = [usable[i], usable[j]];
            }
        }
    }
    if (!pair) return null;

    const frameCount = Math.min(pair[0].points.length, pair[1].points.length);
    let previous = contactPairHeading(pair[0].points[0], pair[1].points[0]);
    let accumulated = 0;
    for (let index = 1; index < frameCount; index++) {
        const current = contactPairHeading(pair[0].points[index], pair[1].points[index]);
        let delta = current - previous;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        accumulated += delta;
        previous = current;
    }
    if (Math.abs(accumulated) < 1e-6) return null;
    return accumulated > 0 ? "cw" : "ccw";
}

function contactPairHeading(
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
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
