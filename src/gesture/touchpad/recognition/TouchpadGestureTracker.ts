import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { GesturePoint } from "@/gesture/types";
import { TouchpadContact, TouchpadFrame } from "@/touchpad/types";
import {
    TouchpadGestureKind,
    PinchDirection,
    RotateDirection,
} from "@/gesture/touchpad/types";
import { GestureEngine, DEFAULT_RECOGNIZER_CONFIG } from "@/gesture/GestureEngine";
import {
    angleDelta,
    centroid,
    classifyDirection,
    classifyAnchorGroups,
    contactTrailStability,
    heading,
    maxContactDisplacement,
    pairwiseSpread,
    pathLength,
    straightness,
} from "./contactMath";

/**
 * Pure touchpad gesture recognizer.
 *
 * Consumes raw contact frames (normalised 0..1) and drives a gesture state
 * machine:
 *
 *   IDLE --first contact(s)--> POSSIBLE --enough motion/activations--> TRACKING
 *   TRACKING --all contacts up--> COMPLETED -> COOLDOWN -> IDLE
 *   POSSIBLE/TRACKING --cancel/too-short--> reset to IDLE
 *
 * A physical gesture completes exactly once: the result is returned by the
 * `feed()` call that observes the empty frame (all contacts lifted), then the
 * tracker enforces a short cooldown so inertia / jitter can never trigger a
 * second dispatch.
 *
 * The tracker is stateless between gestures and has no dependency on the
 * provider or the DOM — it is exercised directly by the smoke tests.
 *
 * Recognition precedence when several kinds could match:
 *   tap → hold → anchorDraw → pinch → rotate → swipe → shape
 */

export type TouchpadTrackerStage =
    | "IDLE"
    | "POSSIBLE"
    | "TRACKING"
    | "COMPLETED"
    | "WAIT_RELEASE"
    | "COOLDOWN";

/**
 * Path recognizer: turns a sampled path into a direction sequence.
 *
 * The default implementation runs the normalised path (scaled into a
 * 400-unit logical space) through the shared {@link GestureEngine} so shape /
 * anchorDraw reuse exactly the same pipeline as the mouse.
 */
export type PathRecognizer = (
    points: readonly GesturePoint[],
    directionMode: 4 | 8,
) => Direction[];

/** Scale factor from normalised [0,1] coordinates to the engine's pixel space. */
const PATH_SCALE = 400;

/** The recognised outcome of a completed touchpad gesture. */
export interface TouchpadRecognitionResult {
    valid: boolean;
    kind: TouchpadGestureKind;
    /** Final finger count at completion. */
    fingerCount: number;
    /** Direction sequence (swipe / shape / anchorDraw). */
    directions: Direction[];
    /** Present for anchorDraw. */
    anchorCount?: number;
    /** Present for pinch. */
    pinchDirection?: PinchDirection;
    /** Present for rotate. */
    rotateDirection?: RotateDirection;
    /**
     * Sampled trail of the recognised gesture (normalised 0..1) — the
     * centroid trail, or the tracer's own trail for anchorDraw.  Used to
     * build the command context.
     */
    points?: readonly { x: number; y: number }[];
    /** Why the gesture did not match (when `valid === false`). */
    invalidReason?: "too-short" | "no-match";
}

/** Tracker configuration (all movement thresholds in normalised 0..1 units). */
export interface TouchpadTrackerConfig {
    tapMaxDurationMs: number;
    tapMaxMovement: number;
    holdDurationMs: number;
    holdMaxMovement: number;
    swipeMinDistance: number;
    shapeMinPathLength: number;
    anchorMaxDrift: number;
    anchorDrawActivation: number;
    pinchThreshold: number;
    rotateThresholdDeg: number;
    cooldownMs: number;
    directionMode: 4 | 8;
    /**
     * Minimum finger count before a gesture is tracked at all (derived by
     * the adapter from the enabled bindings; 1 = track everything).
     */
    minFingerCount: number;
    /**
     * Optional fixed finger count (recorder mode): only EXACTLY this many
     * fingers may begin a gesture; other counts are ignored (too few) or
     * rejected as a mismatch (too many).
     */
    requiredFingerCount?: number;
    /**
     * Optional set of allowed acquisition counts (runtime mode with several
     * finger-count bindings, e.g. {3, 4}).  During POSSIBLE, before movement
     * starts, the count may upgrade within this set; once TRACKING the count
     * is locked.
     */
    allowedFingerCounts?: Set<number>;
    /**
     * Finger-acquisition settle window (ms): in POSSIBLE, before significant
     * movement, the finger count may settle/upgrade within this window.
     */
    settleWindowMs: number;
    /**
     * A contact held STILL for at least this long before the remaining fingers
     * join is treated as a pre-qualified AnchorDraw anchor ("先按住，再绘制").
     * Internal — not exposed on the settings page.
     */
    anchorPreHoldMs: number;
    /**
     * Maximum sampled points kept per contact trail / centroid path (bounds
     * memory at high frame rates).
     */
    maxTrailPoints: number;
}

export const DEFAULT_TRACKER_CONFIG: TouchpadTrackerConfig = {
    tapMaxDurationMs: 220,
    tapMaxMovement: 0.03,
    holdDurationMs: 500,
    holdMaxMovement: 0.04,
    swipeMinDistance: 0.15,
    shapeMinPathLength: 0.15,
    anchorMaxDrift: 0.02,
    anchorDrawActivation: 0.12,
    pinchThreshold: 0.15,
    rotateThresholdDeg: 25,
    cooldownMs: 120,
    directionMode: 8,
    minFingerCount: 1,
    settleWindowMs: 80,
    anchorPreHoldMs: 220,
    maxTrailPoints: 256,
};

/** Live snapshot for the diagnostics UI / overlay (no high-frequency logging). */
export interface TouchpadLiveState {
    stage: TouchpadTrackerStage;
    fingerCount: number;
    /** Whether a GestureRun is currently active (fingers locked and tracking). */
    runActive: boolean;
    /** The locked finger count of the active run (null when idle). */
    lockedFingerCount: number | null;
    maxContacts: number;
    currentKind: TouchpadGestureKind | null;
    centroid: { x: number; y: number };
    contacts: readonly TouchpadContact[];
    /**
     * Read-only visualisation trail (normalised 0..1), downsampled for the
     * UI.  This is a display-only copy -- recognition never uses it.
     */
    displayPath: readonly { x: number; y: number }[];
    /**
     * Whether {@link displayPath} is the anchorDraw tracer's own trail
     * (otherwise it is the centroid path).
     */
    displayPathIsTracer: boolean;
    /**
     * Per-contact display trails (normalised 0..1, downsampled) so the UI can
     * show each finger's real motion.  Display-only.
     */
    displayContactPaths: Array<{ id: number; points: { x: number; y: number }[] }>;
    /**
     * Contact ids currently classified as stationary anchors (display-only).
     * Populated during pre-acquisition and while a run is active.
     */
    displayAnchorIds: readonly number[];
    /**
     * Contact ids currently classified as the moving group (display-only).
     */
    displayMovingIds: readonly number[];
    /**
     * Finger-count mismatch signal ("too-many" / "too-few") from the last
     * acquisition/gesture — cleared on a fresh candidate.
     */
    mismatch: "too-many" | "too-few" | null;
    /**
     * Contact count of the most recent release-tail frame while in
     * WAIT_RELEASE (internal diagnostics); null otherwise.
     */
    releaseTailCount: number | null;
}

/** UI display trail point cap (display only, independent of recognition). */
const DISPLAY_MAX_POINTS = 160;

/** Downsample a trail for display via uniform stride sampling. */
function sampleDisplayPoints(
    points: readonly { x: number; y: number }[],
    max: number,
): { x: number; y: number }[] {
    if (points.length === 0) return [];
    if (points.length <= max) {
        return points.map((p) => ({ x: p.x, y: p.y }));
    }
    const stride = points.length / max;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < max; i++) {
        const idx = Math.min(points.length - 1, Math.floor(i * stride));
        out.push({ x: points[idx].x, y: points[idx].y });
    }
    return out;
}

interface GestureRun {
    startTime: number;
    startPositions: Map<number, { x: number; y: number }>;
    centroidPath: GesturePoint[];
    /** Per-contact sampled trails (id → trail). */
    contactTrails: Map<number, GesturePoint[]>;
    startSpread: number;
    lastAngle: number | null;
    angleAccum: number;
    /** Locked at start — never changes during the physical gesture. */
    fingerCount: number;
    /**
     * The most recent contact frame with the FULL locked finger count.
     * Classification uses this, never the staggered-release tail.
     */
    lastFullContacts: TouchpadContact[];
    /**
     * Bounded history of full locked-count contact frames.  Used to build the
     * moving-group centroid path for generalised AnchorDraw (N moving
     * contacts).
     */
    fullContactFrames: Array<{
        timestamp: number;
        contacts: Array<{ id: number; x: number; y: number }>;
    }>;
    /**
     * Contact ids that were already held STILL for `anchorPreHoldMs` when this
     * run began (pre-qualified AnchorDraw anchors).  Empty when all fingers
     * landed together.
     */
    preQualifiedAnchorIds: number[];
}

/**
 * Lightweight pre-acquisition contact record: a finger that exists below the
 * required finger count.  Only current contacts are kept (no full trails).
 */
interface PreContactState {
    id: number;
    firstSeenTime: number;
    startX: number;
    startY: number;
    maxDrift: number;
    lastX: number;
    lastY: number;
}

/**
 * Kinds the settings auto-recorder analyses.
 *
 * `swipe` is intentionally absent: a straight gesture is recorded as a
 * one-segment `shape`, so the user never has to choose between Swipe and
 * Shape.  `press` is absent because the recognizer has no press
 * classification yet.  Existing swipe/press BINDINGS keep working — the
 * runtime still reads and dispatches them.
 */
export const AUTO_RECORD_KINDS: Set<TouchpadGestureKind> = new Set([
    "tap",
    "hold",
    "pinch",
    "rotate",
    "anchorDraw",
    "shape",
]);

/**
 * Tracking state for the staggered release tail after a gesture completes
 * (or a finger-count mismatch aborts acquisition).
 *
 * WAIT_RELEASE normally ends on an explicit `contacts = []` frame.  On
 * hardware that never emits a zero frame the state machine recovers via
 * release-tail progression (the contact count falls, then rises again = a
 * fresh acquisition) or a release-recovery timeout — see
 * {@link TouchpadGestureTracker.releaseTimedOut}.
 */
interface ReleaseTail {
    /** Finger count of the completed/locked gesture (metadata). */
    lockedFingerCount: number;
    /** Contact count of the most recent release-tail frame. */
    lastReleaseContactCount: number;
    /** Lowest contact count observed during this release tail. */
    minimumReleaseContactCount: number;
    /** Timestamp of the most recent release-tail frame (native monotonic ms). */
    lastReleaseFrameTimestamp: number;
    /** Contact ids observed during the release tail (auxiliary acquisition signal). */
    lastReleaseContactIds: Set<number>;
}

export class TouchpadGestureTracker {
    private config: TouchpadTrackerConfig;
    /**
     * Gesture kinds to analyse.  When `null`, every kind is analysed
     * (diagnostics / recorder mode).  When empty, no shape analysis runs.
     */
    private enabledKinds: Set<TouchpadGestureKind> | null;
    private readonly pathRecognizer: PathRecognizer;

    private stage: TouchpadTrackerStage = "IDLE";
    private run: GestureRun | null = null;
    private currentKind: TouchpadGestureKind | null = null;
    private lastContacts: TouchpadContact[] = [];
    private lastCentroid: { x: number; y: number } = { x: 0, y: 0 };
    private cooldownUntil = 0;
    private lastMismatch: "too-many" | "too-few" | null = null;
    /** Timestamp of the most recently fed frame (native monotonic ms). */
    private lastFrameTimestamp = 0;
    /** Release-tail tracking while waiting for all contacts to lift. */
    private releaseTail: ReleaseTail | null = null;
    /**
     * Lightweight pre-acquisition contact history (below the required finger
     * count).  Lets a finger that was already held STILL qualify as an
     * AnchorDraw anchor before the remaining fingers join.
     */
    private preContacts = new Map<number, PreContactState>();

    constructor(
        config?: Partial<TouchpadTrackerConfig>,
        enabledKinds?: Set<TouchpadGestureKind> | null,
        pathRecognizer?: PathRecognizer,
    ) {
        this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
        this.enabledKinds = enabledKinds === undefined ? null : enabledKinds;
        this.pathRecognizer = pathRecognizer ?? defaultRecognizeDirections;
    }

    /** Replace the tracker configuration at runtime. */
    updateConfig(config: Partial<TouchpadTrackerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /** Replace the set of analysed kinds at runtime. */
    setEnabledKinds(kinds: Set<TouchpadGestureKind> | null): void {
        this.enabledKinds = kinds;
    }

    get currentConfig(): TouchpadTrackerConfig {
        return { ...this.config };
    }

    /** The kind set being analysed (null = diagnostics/all). */
    get enabledKindsSet(): Set<TouchpadGestureKind> | null {
        return this.enabledKinds;
    }

    /** Current live state (for diagnostics / feedback). */
    getLiveState(): TouchpadLiveState {
        const run = this.run;
        let displayPath: { x: number; y: number }[] = [];
        let displayPathIsTracer = false;
        const displayContactPaths: { id: number; points: { x: number; y: number }[] }[] = [];
        let displayAnchorIds: number[] = [];
        let displayMovingIds: number[] = [];
        if (run) {
            const tracer = this.resolveDisplayTracer(run);
            if (tracer) {
                displayPath = sampleDisplayPoints(tracer, DISPLAY_MAX_POINTS);
                displayPathIsTracer = true;
            } else if (run.centroidPath.length > 0) {
                displayPath = sampleDisplayPoints(run.centroidPath, DISPLAY_MAX_POINTS);
            }
            for (const [id, trail] of run.contactTrails) {
                if (trail.length < 1) continue;
                displayContactPaths.push({ id, points: sampleDisplayPoints(trail, DISPLAY_MAX_POINTS) });
            }
            const roles = this.resolveAnchorRoles(run);
            if (roles) {
                displayAnchorIds = roles.anchorIds.slice();
                displayMovingIds = roles.movingIds.slice();
            }
        } else {
            // Pre-acquisition: a finger already held still for anchorPreHoldMs
            // shows as an anchor candidate before the run begins.
            const now = this.lastFrameTimestamp;
            for (const [id, pc] of this.preContacts) {
                if (now - pc.firstSeenTime >= this.config.anchorPreHoldMs && pc.maxDrift <= this.config.anchorMaxDrift) {
                    displayAnchorIds.push(id);
                }
            }
        }
        return {
            stage: this.stage,
            fingerCount: this.run?.fingerCount ?? 0,
            runActive: this.run !== null,
            lockedFingerCount: this.run?.fingerCount ?? null,
            maxContacts: Math.max(0, this.lastContacts.length),
            currentKind: this.currentKind,
            centroid: { ...this.lastCentroid },
            contacts: this.lastContacts.map((c) => ({ ...c })),
            displayPath,
            displayPathIsTracer,
            displayContactPaths,
            mismatch: this.lastMismatch,
            releaseTailCount: this.releaseTail?.lastReleaseContactCount ?? null,
            displayAnchorIds,
            displayMovingIds,
        };
    }

    /**
     * Display trail for anchorDraw: prefer the moving group's path once a
     * real stationary anchor exists.  Returns null otherwise so the caller
     * falls back to the centroid path.
     */
    private resolveDisplayTracer(run: GestureRun): GesturePoint[] | null {
        const roles = this.resolveAnchorRoles(run);
        if (!roles) return null;
        const points = this.movingGroupPath(run, new Set(roles.movingIds));
        return points.length >= 2 ? points : null;
    }

    /** Abort the current run (e.g. window blur / escape). */
    abort(): void {
        this.run = null;
        this.currentKind = null;
        this.stage = "IDLE";
        this.lastContacts = [];
        this.lastMismatch = null;
        this.releaseTail = null;
        this.preContacts.clear();
    }

    /**
     * Clear pre-acquisition contact history.  Called by the recorder when it
     * enters a fresh ARMED epoch so a finger that was held before arming (e.g.
     * the click that pressed 开始录制) can never become a pre-qualified anchor.
     */
    resetAcquisitionHistory(): void {
        this.preContacts.clear();
    }

    /**
     * Feed a raw-contact frame.
     *
     * Returns a completed result exactly once per physical gesture.
     *
     * Lifecycle:
     *   IDLE --allowed count--> POSSIBLE --movement--> TRACKING
     *   TRACKING --first finger drop (count < locked)--> completed
     *   completed --> WAIT_RELEASE --all contacts up--> COOLDOWN --> IDLE
     *
     * The finger count is LOCKED when the run begins and never changes: a
     * staggered release (3 → 2 → 1 → 0) completes the N-finger gesture at the
     * first drop and the remaining fingers are release-tail ignored.
     */
    feed(frame: TouchpadFrame): TouchpadRecognitionResult | null {
        if (frame.source !== "raw-contacts") {
            return null;
        }
        const contacts = frame.contacts.filter((c) => c.touching !== false);
        // Defensive input invariant: a raw frame with duplicate contact ids is
        // invalid (the native layer must guarantee unique ids).  Never build a
        // run from it — a Map keyed by id would silently overwrite a contact.
        if (frame.source === "raw-contacts") {
            const seen = new Set<number>();
            for (const c of contacts) {
                if (seen.has(c.id)) return null;
                seen.add(c.id);
            }
        }
        const now = frame.timestamp;
        this.lastFrameTimestamp = now;
        if (contacts.length > 0) {
            this.lastContacts = contacts.map((c) => ({ ...c }));
            this.lastCentroid = centroid(contacts);
        }
        // Pre-acquisition history only accumulates in IDLE (no active run, no
        // release tail, no cooldown) — an in-flight gesture or its release
        // tail must never leak into the next acquisition epoch.
        if (this.stage === "IDLE") {
            this.updatePreContacts(contacts, now);
        }

        if (this.stage === "COOLDOWN") {
            if (now >= this.cooldownUntil) {
                this.stage = "IDLE";
            } else {
                return null;
            }
        }

        // WAIT_RELEASE: the release tail is ignored until either an explicit
        // empty frame, a fresh acquisition (contact count rises again after the
        // release fall), or a recovery timeout (the adapter calls
        // releaseTimedOut()).  handleWaitRelease returns true when this frame
        // was consumed by the latch; false means a new acquisition was detected
        // and we fall through to the normal acquisition path.
        if (this.stage === "WAIT_RELEASE") {
            if (this.handleWaitRelease(contacts, now)) {
                return null;
            }
        }

        if (contacts.length === 0) {
            // All fingers lifted without a stagger — complete now and cool
            // down directly (no release tail to wait for).
            if (this.stage === "POSSIBLE" || this.stage === "TRACKING") {
                const result = this.finishRun(now);
                this.enterCooldown(now);
                return result;
            }
            return null;
        }

        const count = contacts.length;

        if (this.stage === "IDLE") {
            if (!this.acquisitionAllowed(count)) {
                return null; // not enough / not an allowed count
            }
            this.beginRun(contacts, now);
            return null;
        }

        if (this.stage === "POSSIBLE") {
            const run = this.run;
            if (!run) return null;
            if (count === run.fingerCount) {
                this.updateRun(contacts, now);
                return null;
            }
            if (count > run.fingerCount) {
                if (this.canUpgradeCount(count, run, now)) {
                    // e.g. 3 → 4 before movement, and 4 is allowed: re-arm at
                    // the higher count (pre-roll discarded).
                    this.beginRun(contacts, now);
                    return null;
                }
                this.mismatchAndWait("too-many", contacts, now);
                return null;
            }
            // count < locked: a transient dip while the fingers are still
            // settling (before movement) is IGNORED — the locked-count run
            // survives.  Real devices can briefly misreport the contact count
            // during acquisition, and discarding the run on every blip made
            // 3-finger recordings show dots but no trail and never complete.
            if (this.stillSettling(run, now)) {
                return null;
            }
            // Movement already started (or the settle window elapsed), then a
            // finger dropped: the physical gesture ended.
            const result = this.finishRun(now);
            this.enterWaitRelease(contacts, now, run.fingerCount);
            return result;
        }

        // TRACKING — locked finger count.
        const run = this.run;
        if (!run) return null;
        if (count === run.fingerCount) {
            this.updateRun(contacts, now);
            return null;
        }
        if (count < run.fingerCount) {
            // N-finger physical gesture ended at the first finger drop.
            const result = this.finishRun(now);
            this.enterWaitRelease(contacts, now, run.fingerCount);
            return result;
        }
        // count > locked → finger-count mismatch.
        this.mismatchAndWait("too-many", contacts, now);
        return null;
    }

    /** Minimum finger count across enabled kinds (or 1 for diagnostics). */
    private minFingerCount(): number {
        return this.enabledKinds === null ? 1 : this.config.minFingerCount;
    }

    /** Whether `count` may begin a gesture under the current constraints. */
    private acquisitionAllowed(count: number): boolean {
        if (this.config.requiredFingerCount !== undefined) {
            return count === this.config.requiredFingerCount;
        }
        if (this.config.allowedFingerCounts) {
            return this.config.allowedFingerCounts.has(count);
        }
        return count >= this.minFingerCount();
    }

    /** Whether the count may upgrade during POSSIBLE (settle window). */
    private canUpgradeCount(count: number, run: GestureRun, now: number): boolean {
        if (!this.stillSettling(run, now)) return false;
        if (this.config.requiredFingerCount !== undefined) {
            return count === this.config.requiredFingerCount;
        }
        return this.config.allowedFingerCounts?.has(count) ?? false;
    }

    /** True while the fingers are still settling (no significant movement yet). */
    private stillSettling(run: GestureRun, now: number): boolean {
        if (now - run.startTime > this.config.settleWindowMs) return false;
        const { max } = maxContactDisplacement(this.lastContacts, run.startPositions);
        return max < this.config.swipeMinDistance * 0.6;
    }

    private beginRun(contacts: TouchpadContact[], now: number): void {
        if (!this.acquisitionAllowed(contacts.length)) {
            // e.g. required = 3 but only 2 fingers remain — just wait.
            this.run = null;
            this.stage = "IDLE";
            this.lastMismatch = null;
            return;
        }
        const startPositions = new Map<number, { x: number; y: number }>();
        for (const c of contacts) {
            startPositions.set(c.id, { x: c.x, y: c.y });
        }
        const c = centroid(contacts);
        const contactTrails = new Map<number, GesturePoint[]>();
        for (const contact of contacts) {
            contactTrails.set(contact.id, [{ x: contact.x, y: contact.y, t: now }]);
        }
        const preQualifiedAnchorIds = this.snapshotPreQualifiedAnchors(contacts, now);
        // Pre-acquisition history is consumed by the run snapshot.
        this.preContacts.clear();
        this.run = {
            startTime: now,
            startPositions,
            centroidPath: [{ x: c.x, y: c.y, t: now }],
            contactTrails,
            startSpread: pairwiseSpread(contacts),
            lastAngle: null,
            angleAccum: 0,
            fingerCount: contacts.length,
            lastFullContacts: contacts.map((ct) => ({ ...ct })),
            fullContactFrames: [{ timestamp: now, contacts: contacts.map((ct) => ({ id: ct.id, x: ct.x, y: ct.y })) }],
            preQualifiedAnchorIds,
        };
        this.currentKind = null;
        this.lastMismatch = null;
        this.stage = "POSSIBLE";
    }

    /** Track lightweight pre-acquisition contact history. */
    private updatePreContacts(contacts: TouchpadContact[], now: number): void {
        const present = new Set<number>();
        for (const c of contacts) present.add(c.id);
        for (const id of [...this.preContacts.keys()]) {
            if (!present.has(id)) this.preContacts.delete(id);
        }
        for (const c of contacts) {
            const pc = this.preContacts.get(c.id);
            if (pc) {
                pc.lastX = c.x;
                pc.lastY = c.y;
                const d = Math.hypot(c.x - pc.startX, c.y - pc.startY);
                if (d > pc.maxDrift) pc.maxDrift = d;
            } else {
                this.preContacts.set(c.id, {
                    id: c.id,
                    firstSeenTime: now,
                    startX: c.x,
                    startY: c.y,
                    maxDrift: 0,
                    lastX: c.x,
                    lastY: c.y,
                });
            }
        }
    }

    /**
     * Contacts that were already held STILL for `anchorPreHoldMs` when the run
     * begins → pre-qualified AnchorDraw anchors ("先按住，再绘制").
     */
    private snapshotPreQualifiedAnchors(contacts: TouchpadContact[], now: number): number[] {
        const qualified: number[] = [];
        for (const c of contacts) {
            const pc = this.preContacts.get(c.id);
            if (
                pc &&
                now - pc.firstSeenTime >= this.config.anchorPreHoldMs &&
                pc.maxDrift <= this.config.anchorMaxDrift
            ) {
                qualified.push(c.id);
            }
        }
        return qualified;
    }

    private updateRun(contacts: TouchpadContact[], now: number): void {
        const run = this.run;
        if (!run) return;
        // fingerCount is LOCKED — never updated from contacts.length.
        run.lastFullContacts = contacts.map((c) => ({ ...c }));

        // Bounded full-contact frame history (for moving-group centroid path).
        if (run.fullContactFrames.length < this.config.maxTrailPoints) {
            run.fullContactFrames.push({
                timestamp: now,
                contacts: contacts.map((c) => ({ id: c.id, x: c.x, y: c.y })),
            });
        }

        const c = centroid(contacts);
        if (run.centroidPath.length < this.config.maxTrailPoints) {
            run.centroidPath.push({ x: c.x, y: c.y, t: now });
        }

        for (const contact of contacts) {
            const trail = run.contactTrails.get(contact.id);
            if (trail) {
                if (trail.length < this.config.maxTrailPoints) {
                    trail.push({ x: contact.x, y: contact.y, t: now });
                }
            } else {
                run.contactTrails.set(contact.id, [{ x: contact.x, y: contact.y, t: now }]);
            }
        }

        // Rotation accumulation (unwrap-safe).
        if (contacts.length >= 2) {
            const a = heading(contacts[0], contacts[1]);
            if (run.lastAngle !== null) {
                run.angleAccum += angleDelta(run.lastAngle, a);
            }
            run.lastAngle = a;
        }

        // Stage transitions.
        const { max: maxDisp } = maxContactDisplacement(contacts, run.startPositions);
        const cPathLen = pathLength(run.centroidPath);
        const isAnchor = this.anchorCandidate(contacts, run);

        if (this.stage === "POSSIBLE") {
            const movedEnough =
                maxDisp >= this.config.swipeMinDistance * 0.6 ||
                cPathLen >= this.config.shapeMinPathLength * 0.6 ||
                isAnchor;
            if (movedEnough) {
                this.stage = "TRACKING";
            }
            this.currentKind = this.estimateKind(contacts, run, now, cPathLen, maxDisp, isAnchor);
        } else if (this.stage === "TRACKING") {
            this.currentKind = this.estimateKind(contacts, run, now, cPathLen, maxDisp, isAnchor);
        }
    }

    private estimateKind(
        contacts: TouchpadContact[],
        run: GestureRun,
        now: number,
        cPathLen: number,
        maxDisp: number,
        isAnchor: boolean,
    ): TouchpadGestureKind | null {
        const kinds = this.enabledKinds;
        const all = kinds === null;
        const duration = now - run.startTime;
        const cfg = this.config;

        if ((all || kinds?.has("tap")) && duration <= cfg.tapMaxDurationMs && maxDisp <= cfg.tapMaxMovement) {
            return "tap";
        }
        if ((all || kinds?.has("hold")) && duration >= cfg.holdDurationMs && maxDisp <= cfg.holdMaxMovement) {
            return "hold";
        }
        // anchorDraw BEFORE pinch: a stationary contact (esp. a pre-held one)
        // is a stronger signal than a spread change — one finger held + one
        // finger drawing must NOT be misread as a pinch.
        if ((all || kinds?.has("anchorDraw")) && isAnchor && cPathLen >= cfg.anchorDrawActivation) {
            return "anchorDraw";
        }
        if ((all || kinds?.has("pinch")) && contacts.length >= 2) {
            const spread = pairwiseSpread(contacts);
            if (run.startSpread > 0) {
                const ratio = spread / run.startSpread;
                if (ratio >= 1 + cfg.pinchThreshold || ratio <= 1 - cfg.pinchThreshold) {
                    return "pinch";
                }
            }
        }
        if ((all || kinds?.has("rotate")) && contacts.length >= 2 && Math.abs(run.angleAccum) >= (cfg.rotateThresholdDeg * Math.PI) / 180) {
            return "rotate";
        }
        if ((all || kinds?.has("swipe")) && cPathLen >= cfg.swipeMinDistance && straightness(run.centroidPath) >= 0.7) {
            return "swipe";
        }
        if ((all || kinds?.has("shape")) && cPathLen >= cfg.shapeMinPathLength) {
            return "shape";
        }
        return null;
    }

    /** Whether at least one contact stayed put (whole trail) while another moved. */
    private anchorCandidate(contacts: TouchpadContact[], run: GestureRun): boolean {
        if (contacts.length < 2) return false;
        return (
            classifyAnchorGroups(contacts, run.startPositions, run.contactTrails, this.config.anchorMaxDrift) !== null
        );
    }

    private finishRun(now: number): TouchpadRecognitionResult {
        const run = this.run;
        this.run = null;
        const result = run ? this.classify(run, now) : this.noMatch(0);
        this.currentKind = null;
        this.lastMismatch = null;
        return result;
    }

    /** Enter WAIT_RELEASE: ignore release tails until all contacts lift. */
    private enterWaitRelease(contacts: TouchpadContact[], now: number, lockedFingerCount: number): void {
        this.stage = "WAIT_RELEASE";
        this.releaseTail = {
            lockedFingerCount,
            lastReleaseContactCount: contacts.length,
            minimumReleaseContactCount: contacts.length,
            lastReleaseFrameTimestamp: now,
            lastReleaseContactIds: new Set(contacts.map((c) => c.id)),
        };
    }

    /** Abort a candidate/gesture as a finger-count mismatch and wait for release. */
    private mismatchAndWait(reason: "too-many" | "too-few", contacts: TouchpadContact[], now: number): void {
        this.lastMismatch = reason;
        this.run = null;
        this.currentKind = null;
        this.stage = "WAIT_RELEASE";
        this.releaseTail = {
            lockedFingerCount: contacts.length,
            lastReleaseContactCount: contacts.length,
            minimumReleaseContactCount: contacts.length,
            lastReleaseFrameTimestamp: now,
            lastReleaseContactIds: new Set(contacts.map((c) => c.id)),
        };
        // A mismatched acquisition cannot contribute pre-qualified anchors.
        this.preContacts.clear();
    }

    /**
     * Handle a frame while in WAIT_RELEASE.
     *
     * Returns true when the frame was consumed by the release latch (either
     * still releasing, or resolved to COOLDOWN by an explicit zero frame).
     * Returns false ONLY when the latch resolved as a fresh acquisition — the
     * caller must then re-enter the normal acquisition path with this frame.
     */
    private handleWaitRelease(contacts: TouchpadContact[], now: number): boolean {
        const tail = this.releaseTail;
        if (contacts.length > 0) {
            if (tail) {
                const prevLast = tail.lastReleaseContactCount;
                tail.lastReleaseFrameTimestamp = now;
                tail.lastReleaseContactCount = contacts.length;
                if (contacts.length < tail.minimumReleaseContactCount) {
                    tail.minimumReleaseContactCount = contacts.length;
                }
                // Acquisition check runs against the PREVIOUS release count and
                // the ids seen so far (before this frame's ids are added).
                if (this.isNewAcquisition(contacts, tail, prevLast)) {
                    this.releaseTail = null;
                    this.stage = "IDLE";
                    return false;
                }
                for (const c of contacts) {
                    tail.lastReleaseContactIds.add(c.id);
                }
            }
            return true;
        }
        // Explicit zero frame — the normal, most reliable release signal.
        this.releaseTail = null;
        this.enterCooldown(now);
        return true;
    }

    /**
     * Whether a contact frame observed while in WAIT_RELEASE signals the start
     * of a NEW physical gesture rather than the continuation of the release
     * tail.
     *
     * Primary rule (contact-count progression): the count rose back above the
     * minimum observed during the release — fingers were lifted, then placed
     * again.  Secondary rule (contact ids): every id in this frame is new
     * relative to the release tail, i.e. the fingers were fully lifted and
     * re-placed.  Contact ids are only an enhancement because hardware may
     * reuse ids, so progression remains the primary rule.  Contact ID 0 is a
     * legal value and participates normally.
     */
    private isNewAcquisition(contacts: TouchpadContact[], tail: ReleaseTail, prevLastContactCount: number): boolean {
        if (contacts.length > tail.minimumReleaseContactCount && contacts.length > prevLastContactCount) {
            return true;
        }
        for (const c of contacts) {
            if (tail.lastReleaseContactIds.has(c.id)) return false;
        }
        return contacts.length >= tail.minimumReleaseContactCount;
    }

    /**
     * Recovery API for the adapter's release watchdog: the physical release
     * sequence ended WITHOUT an explicit zero frame (the device stopped
     * reporting).  Clears all release state and enters COOLDOWN based on the
     * last frame's timestamp, so the next acquisition is safe.  No-op outside
     * WAIT_RELEASE.
     */
    releaseTimedOut(): void {
        if (this.stage !== "WAIT_RELEASE") return;
        this.releaseTail = null;
        this.run = null;
        this.currentKind = null;
        this.lastContacts = [];
        this.lastMismatch = null;
        this.preContacts.clear();
        this.stage = "COOLDOWN";
        this.cooldownUntil = this.lastFrameTimestamp + this.config.cooldownMs;
    }

    /** Final classification using the accumulated run data. */
    private classify(run: GestureRun, now: number): TouchpadRecognitionResult {
        const cfg = this.config;
        const kinds = this.enabledKinds;
        const all = kinds === null;
        const duration = now - run.startTime;
        // Use the last FULL-N-contact frame (never the release tail).
        const finalContacts = run.lastFullContacts;
        const { max: finalMaxDisp } = maxContactDisplacement(finalContacts, run.startPositions);
        const finalSpreadValue = pairwiseSpread(finalContacts);
        const trail = () => run.centroidPath.map((p) => ({ x: p.x, y: p.y }));

        // --- tap ---
        if (this.wants(all, kinds, "tap")) {
            if (duration <= cfg.tapMaxDurationMs && finalMaxDisp <= cfg.tapMaxMovement) {
                return {
                    valid: true,
                    kind: "tap",
                    fingerCount: run.fingerCount,
                    directions: [],
                    points: trail(),
                };
            }
        }

        // --- hold ---
        if (this.wants(all, kinds, "hold")) {
            if (duration >= cfg.holdDurationMs && finalMaxDisp <= cfg.holdMaxMovement) {
                return {
                    valid: true,
                    kind: "hold",
                    fingerCount: run.fingerCount,
                    directions: [],
                    points: trail(),
                };
            }
        }

        // --- anchorDraw (BEFORE pinch/rotate/swipe/shape): a stationary
        //     contact — especially a pre-held anchor — is a stronger signal
        //     than a spread/angle change, so "one finger held + one finger
        //     drawing" is never misread as a pinch. ---
        if (this.wants(all, kinds, "anchorDraw")) {
            const draw = this.findAnchorDraw(run);
            if (draw && draw.pathLength >= cfg.anchorDrawActivation) {
                const dirs = this.recognizePath(draw.points);
                if (dirs.length > 0) {
                    return {
                        valid: true,
                        kind: "anchorDraw",
                        fingerCount: run.fingerCount,
                        directions: dirs,
                        anchorCount: draw.anchorCount,
                        points: draw.points.map((p) => ({ x: p.x, y: p.y })),
                    };
                }
            }
        }

        // --- pinch ---
        if (this.wants(all, kinds, "pinch") && run.fingerCount >= 2) {
            if (finalSpreadValue > 0 && run.startSpread > 0) {
                const ratio = finalSpreadValue / run.startSpread;
                if (ratio >= 1 + cfg.pinchThreshold) {
                    return { valid: true, kind: "pinch", fingerCount: run.fingerCount, directions: [], pinchDirection: "out", points: trail() };
                }
                if (ratio <= 1 - cfg.pinchThreshold) {
                    return { valid: true, kind: "pinch", fingerCount: run.fingerCount, directions: [], pinchDirection: "in", points: trail() };
                }
            }
        }

        // --- rotate ---
        if (this.wants(all, kinds, "rotate") && run.fingerCount >= 2) {
            const absAngle = Math.abs(run.angleAccum);
            if (absAngle >= (cfg.rotateThresholdDeg * Math.PI) / 180) {
                return {
                    valid: true,
                    kind: "rotate",
                    fingerCount: run.fingerCount,
                    directions: [],
                    rotateDirection: run.angleAccum > 0 ? "cw" : "ccw",
                    points: trail(),
                };
            }
        }

        // --- swipe ---
        if (this.wants(all, kinds, "swipe")) {
            const cLen = pathLength(run.centroidPath);
            const str = straightness(run.centroidPath);
            if (cLen >= cfg.swipeMinDistance && str >= 0.7) {
                const first = run.centroidPath[0];
                const last = run.centroidPath[run.centroidPath.length - 1];
                const dir = classifyDirection(last.x - first.x, last.y - first.y, cfg.directionMode);
                return { valid: true, kind: "swipe", fingerCount: run.fingerCount, directions: [dir], points: trail() };
            }
        }

        // --- shape ---
        if (this.wants(all, kinds, "shape")) {
            const cLen = pathLength(run.centroidPath);
            if (cLen >= cfg.shapeMinPathLength) {
                const dirs = this.recognizePath(run.centroidPath);
                if (dirs.length > 0) {
                    return { valid: true, kind: "shape", fingerCount: run.fingerCount, directions: dirs, points: trail() };
                }
                return { valid: false, kind: "shape", fingerCount: run.fingerCount, directions: [], invalidReason: "no-match", points: trail() };
            }
        }

        return { valid: false, kind: "tap", fingerCount: run.fingerCount, directions: [], invalidReason: "too-short", points: trail() };
    }

    /**
     * Resolve the anchor/moving split for AnchorDraw.
     *
     * When the run has PRE-QUALIFIED anchors ("先按住，再绘制"), they are kept
     * as long as their full run trail stays within `anchorMaxDrift * 1.5`
     * (tolerating finger micro-jitter); the remaining contacts form the moving
     * group.  If no pre-qualified anchor survives (or none existed), fall back
     * to the full-trajectory auto classification of
     * {@link classifyAnchorGroups} — fingers landing together with some that
     * stay still still become anchorDraw.
     */
    private resolveAnchorRoles(run: GestureRun): { anchorIds: number[]; movingIds: number[] } | null {
        const contacts = run.lastFullContacts;
        if (contacts.length < 2) return null;
        if (run.preQualifiedAnchorIds.length > 0) {
            const revokeThreshold = this.config.anchorMaxDrift * 1.5;
            const present = new Set(contacts.map((c) => c.id));
            const anchors = run.preQualifiedAnchorIds.filter((id) => {
                if (!present.has(id)) return false;
                const start = run.startPositions.get(id);
                const trail = run.contactTrails.get(id);
                if (!start) return false;
                if (!trail || trail.length === 0) return true;
                return contactTrailStability(trail, start).maxDistanceFromStart <= revokeThreshold;
            });
            const movingIds = contacts.filter((c) => !anchors.includes(c.id)).map((c) => c.id);
            if (anchors.length > 0 && movingIds.length > 0) {
                return { anchorIds: anchors, movingIds };
            }
            // All pre-qualified anchors were revoked — fall back to auto.
        }
        return classifyAnchorGroups(contacts, run.startPositions, run.contactTrails, this.config.anchorMaxDrift);
    }

    /**
     * Identify the anchor/moving groups for AnchorDraw from the FULL
     * per-contact trajectories.  The moving group's path (single contact
     * trail, or the moving-group centroid from the full-contact frame
     * history) is what gets recognised.
     */
    private findAnchorDraw(run: GestureRun): {
        anchorCount: number;
        movingCount: number;
        pathLength: number;
        points: GesturePoint[];
    } | null {
        const roles = this.resolveAnchorRoles(run);
        if (!roles) return null;
        const points = this.movingGroupPath(run, new Set(roles.movingIds));
        if (points.length < 2) return null;
        return {
            anchorCount: roles.anchorIds.length,
            movingCount: roles.movingIds.length,
            pathLength: pathLength(points),
            points,
        };
    }

    /**
     * Path of the moving contacts for AnchorDraw.
     *
     * - 1 moving contact → that contact's own sampled trail (richest detail).
     * - N moving contacts → centroid of the moving contacts per full-contact
     *   frame, built from {@link GestureRun.fullContactFrames}.
     */
    private movingGroupPath(run: GestureRun, movingIds: Set<number>): GesturePoint[] {
        if (movingIds.size === 1) {
            const id = movingIds.values().next().value as number;
            const trail = run.contactTrails.get(id);
            return trail ? trail.slice() : [];
        }
        if (run.fullContactFrames.length === 0) {
            return run.centroidPath.slice();
        }
        const out: GesturePoint[] = [];
        for (const f of run.fullContactFrames) {
            let sx = 0;
            let sy = 0;
            let n = 0;
            for (const c of f.contacts) {
                if (movingIds.has(c.id)) {
                    sx += c.x;
                    sy += c.y;
                    n++;
                }
            }
            if (n === 0) continue;
            out.push({ x: sx / n, y: sy / n, t: f.timestamp });
        }
        return out;
    }

    /** Run the sampled path through the shared GestureEngine pipeline. */
    private recognizePath(points: readonly GesturePoint[]): Direction[] {
        if (points.length < 2) return [];
        return this.pathRecognizer(points, this.config.directionMode);
    }

    private wants(all: boolean, kinds: Set<TouchpadGestureKind> | null, kind: TouchpadGestureKind): boolean {
        return all || (kinds?.has(kind) ?? false);
    }

    private enterCooldown(now: number): void {
        this.stage = "COOLDOWN";
        this.cooldownUntil = now + this.config.cooldownMs;
        this.lastContacts = [];
        this.lastMismatch = null;
        this.preContacts.clear();
    }

    private noMatch(fingerCount: number): TouchpadRecognitionResult {
        return { valid: false, kind: "tap", fingerCount, directions: [], invalidReason: "too-short" };
    }
}

/**
 * Default path recognizer: run the normalised path (scaled into a
 * 400-unit logical space so the engine's pixel thresholds make sense) through
 * the shared {@link GestureEngine} pipeline — the same sampler → simplifier →
 * vectorizer → matcher used by the mouse.
 */
export function defaultRecognizeDirections(
    points: readonly GesturePoint[],
    directionMode: 4 | 8,
): Direction[] {
    const mapped: GesturePoint[] = points.map((p) => ({ x: p.x * PATH_SCALE, y: p.y * PATH_SCALE, t: p.t }));
    const engine = new GestureEngine({ ...DEFAULT_RECOGNIZER_CONFIG, directionMode });
    const result = engine.recognizePoints(mapped);
    return result.valid ? result.directions : [];
}
