import { GestureSession } from "./GestureSession";
import { GestureState } from "./types";
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
    /** Segments shorter than this are merged away (px). */
    minimumSegmentLength: number;
    /** Heading change (degrees) required to start a new direction segment. */
    turnAngleThreshold: number;
    /** Maximum number of direction segments kept in the final sequence. */
    maximumSegments: number;
    /** 4 = U/D/L/R, 8 = adds four diagonals. */
    directionMode: DirectionMode;
}

/** Default recogniser parameters (matches stage 2 specification). */
export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
    sampleDistance: 4,
    minimumSegmentLength: 18,
    turnAngleThreshold: 42,
    maximumSegments: 6,
    directionMode: 4,
};

/** Output of a full recognition pass — used by the UI and for debugging. */
export interface RecognitionResult {
    /** Final merged direction sequence, e.g. ["R", "D", "L"]. */
    directions: Direction[];
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
 *   raw points → PathSampler → PathSimplifier → DirectionVectorizer → DirectionMatcher → directions
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

    constructor(config: RecognizerConfig = DEFAULT_RECOGNIZER_CONFIG) {
        this.sampler = new PathSampler(config.sampleDistance);
        this.simplifier = new PathSimplifier(config.minimumSegmentLength);
        this.vectorizer = new DirectionVectorizer(
            config.turnAngleThreshold,
            config.directionMode,
        );
        this.matcher = new DirectionMatcher(config.maximumSegments);
        this.minimumSegmentLength = config.minimumSegmentLength;
    }

    recognize(session: GestureSession): RecognitionResult {
        const rawPoints = session.points;
        const sampled = this.sampler.sample(rawPoints);
        const simplified = this.simplifier.simplify(sampled);

        // Reject paths whose total arc length is shorter than one minimum
        // segment — such a gesture is too short to carry a meaningful
        // direction and should not produce a false positive.
        if (pathLength(simplified) < this.minimumSegmentLength) {
            return {
                directions: [],
                segments: [],
                rawPointCount: rawPoints.length,
                sampledPointCount: sampled.length,
                simplifiedPointCount: simplified.length,
                cancelled: session.state === GestureState.CANCELLED,
                cancelReason: session.cancelReason,
            };
        }

        const segments = this.vectorizer.vectorize(simplified);
        const directions = this.matcher.match(segments);

        return {
            directions,
            segments,
            rawPointCount: rawPoints.length,
            sampledPointCount: sampled.length,
            simplifiedPointCount: simplified.length,
            cancelled: session.state === GestureState.CANCELLED,
            cancelReason: session.cancelReason,
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
