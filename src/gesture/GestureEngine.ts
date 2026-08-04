import { GestureSession } from "./GestureSession";
import { GestureState, InvalidReason } from "./types";
import { PathSampler } from "./recognition/PathSampler";
import { PathSimplifier } from "./recognition/PathSimplifier";
import {
    Direction,
    DirectionMode,
    Segment,
    DirectionVectorizer,
} from "./recognition/DirectionVectorizer";
import { DirectionMatcher } from "./recognition/DirectionMatcher";

/** Configuration for the gesture recognition pipeline. */
export interface RecognizerConfig {
    /** Distance between resampled points (px). */
    sampleDistance: number;
    /** RDP tolerance — maximum perpendicular deviation kept (px). */
    simplifyTolerance: number;
    /** Segments shorter than this are merged away (px). */
    minimumSegmentLength: number;
    /** Heading change (degrees) required to start a new direction segment. */
    turnAngleThreshold: number;
    /** Maximum number of direction segments allowed in the final sequence. */
    maximumSegments: number;
    /** 4 = U/D/L/R, 8 = adds four diagonals. */
    directionMode: DirectionMode;
}

/** Default recogniser parameters (matches stage 2 specification). */
export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
    sampleDistance: 4,
    simplifyTolerance: 2.8,
    minimumSegmentLength: 18,
    turnAngleThreshold: 42,
    maximumSegments: 6,
    directionMode: 4,
};

/** Output of a full recognition pass — used by the UI and for debugging. */
export interface RecognitionResult {
    /** Whether the gesture produced a usable direction sequence. */
    valid: boolean;
    /** Why the gesture was rejected (null when valid). */
    invalidReason: InvalidReason | null;
    /** Final merged direction sequence (empty when invalid). */
    directions: Direction[];
    /** Full merged direction sequence before maximum-segments validation. */
    rawDirections: Direction[];
    /** Raw segments before adjacent-duplicate merging (debugging). */
    segments: Segment[];
    /** Number of raw input points from the gesture session. */
    rawPointCount: number;
    /** Number of points after uniform resampling. */
    sampledPointCount: number;
    /** Number of points after simplification. */
    simplifiedPointCount: number;
    /** Whether the session ended in CANCELLED. */
    cancelled: boolean;
    /** Cancel reason if the session was cancelled. */
    cancelReason: GestureSession["cancelReason"];
}

/**
 * Orchestrates the full recognition pipeline:
 *
 *   raw points → PathSampler → PathSimplifier (RDP) → DirectionVectorizer → DirectionMatcher → directions
 *
 * The engine is stateless: every call to {@link recognize} runs the complete
 * pipeline on the provided session and returns a fresh result.
 */
export class GestureEngine {
    private readonly sampler: PathSampler;
    private readonly simplifier: PathSimplifier;
    private readonly vectorizer: DirectionVectorizer;
    private readonly matcher: DirectionMatcher;
    private readonly minimumSegmentLength: number;
    private readonly maximumSegments: number;

    constructor(config: RecognizerConfig = DEFAULT_RECOGNIZER_CONFIG) {
        this.sampler = new PathSampler(config.sampleDistance);
        this.simplifier = new PathSimplifier(
            config.simplifyTolerance,
            config.minimumSegmentLength,
        );
        this.vectorizer = new DirectionVectorizer(
            config.turnAngleThreshold,
            config.directionMode,
        );
        this.matcher = new DirectionMatcher();
        this.minimumSegmentLength = config.minimumSegmentLength;
        this.maximumSegments = config.maximumSegments;
    }

    recognize(session: GestureSession): RecognitionResult {
        const rawPoints = session.points;
        const sampled = this.sampler.sample(rawPoints);
        const simplified = this.simplifier.simplify(sampled);

        const isCancelled = session.state === GestureState.CANCELLED;

        // --- Run the full pipeline regardless of cancellation state so that
        //     debugging data (rawDirections, segments, point counts) is always
        //     available.  The "natural" invalid reason is computed first;
        //     cancellation overrides it as the primary reason afterwards.
        const pathTooShort = pathLength(simplified) < this.minimumSegmentLength;

        let segments: Segment[] = [];
        let rawDirections: Direction[] = [];

        if (!pathTooShort) {
            segments = this.vectorizer.vectorize(simplified);
            rawDirections = this.matcher.match(segments);
        }

        // Determine the "natural" invalid reason (before cancel override).
        let naturalReason: InvalidReason | null;
        if (pathTooShort) {
            naturalReason = "too-short";
        } else if (rawDirections.length === 0) {
            naturalReason = "empty";
        } else if (rawDirections.length > this.maximumSegments) {
            naturalReason = "too-many-segments";
        } else {
            naturalReason = null;
        }

        // --- Cancelled sessions: override to "cancelled" as the primary
        //     reason.  Short paths and too-many-segments are still computed
        //     for debugging, but the main invalidReason must be "cancelled".
        if (isCancelled) {
            return {
                valid: false,
                invalidReason: "cancelled",
                directions: [],
                rawDirections,
                segments,
                rawPointCount: rawPoints.length,
                sampledPointCount: sampled.length,
                simplifiedPointCount: simplified.length,
                cancelled: true,
                cancelReason: session.cancelReason,
            };
        }

        if (naturalReason !== null) {
            return {
                valid: false,
                invalidReason: naturalReason,
                directions: [],
                rawDirections,
                segments,
                rawPointCount: rawPoints.length,
                sampledPointCount: sampled.length,
                simplifiedPointCount: simplified.length,
                cancelled: false,
                cancelReason: null,
            };
        }

        return {
            valid: true,
            invalidReason: null,
            directions: rawDirections,
            rawDirections,
            segments,
            rawPointCount: rawPoints.length,
            sampledPointCount: sampled.length,
            simplifiedPointCount: simplified.length,
            cancelled: false,
            cancelReason: null,
        };
    }

    /** Compare two direction sequences for equality (delegates to matcher). */
    matches(a: Direction[], b: Direction[]): boolean {
        return this.matcher.equals(a, b);
    }
}

/** Total arc length of a polyline (sum of consecutive point distances). */
function pathLength(points: { x: number; y: number }[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
}
