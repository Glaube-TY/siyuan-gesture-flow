import { SampledPoint } from "./PathSampler";

/**
 * Direction label for a gesture segment.
 *
 * Four-direction mode uses only U / D / L / R.
 * Eight-direction mode additionally uses the four diagonals.
 */
export type Direction = "U" | "D" | "L" | "R" | "UL" | "UR" | "DL" | "DR";

/** A recognised straight segment of the gesture path. */
export interface Segment {
    direction: Direction;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    /** Euclidean length of the segment. */
    length: number;
    /** Heading angle in radians (0 = east, π/2 = south / down). */
    angle: number;
}

/** Number of cardinal / intercardinal directions to quantise to. */
export type DirectionMode = 4 | 8;

/**
 * Splits a simplified polyline into direction segments.
 *
 * The vectorizer walks the path step by step (point[i-1] → point[i]) and
 * compares each step's heading to the current segment's reference heading.
 * When the step heading deviates by more than {@link turnAngleThreshold}
 * degrees, the segment is closed at the previous point and a new one begins.
 * Each closed segment is quantised to a {@link Direction} according to
 * {@link directionMode}.
 *
 * Using per-step headings (rather than the accumulated heading from the
 * segment start) correctly handles reversal paths where the gesture returns
 * to its origin.
 *
 * Screen coordinates are assumed (y increases downward), so an angle of 0
 * maps to R (east) and π/2 maps to D (south).
 */
export class DirectionVectorizer {
    private readonly turnThresholdRad: number;

    constructor(
        turnAngleThresholdDeg: number,
        private readonly directionMode: DirectionMode,
    ) {
        this.turnThresholdRad = (turnAngleThresholdDeg * Math.PI) / 180;
    }

    vectorize(points: SampledPoint[]): Segment[] {
        if (points.length < 2) return [];

        const segments: Segment[] = [];
        let startIdx = 0;

        // Reference heading = heading of the first step.
        let refAngle = heading(points[0], points[1]);

        for (let i = 2; i < points.length; i++) {
            const stepAngle = heading(points[i - 1], points[i]);
            const diff = angleDifference(refAngle, stepAngle);

            if (Math.abs(diff) > this.turnThresholdRad) {
                // Close the segment at the previous point.
                segments.push(this.makeSegment(points, startIdx, i - 1));
                startIdx = i - 1;
                refAngle = stepAngle;
            }
        }

        // Close the final segment.
        if (startIdx < points.length - 1) {
            segments.push(this.makeSegment(points, startIdx, points.length - 1));
        }

        return segments;
    }

    // -------------------------------------------------------------- internals

    private makeSegment(
        points: SampledPoint[],
        startIdx: number,
        endIdx: number,
    ): Segment {
        const a = points[startIdx];
        const b = points[endIdx];
        const angle = heading(a, b);
        return {
            direction: this.quantize(angle),
            startX: a.x,
            startY: a.y,
            endX: b.x,
            endY: b.y,
            length: distance(a, b),
            angle,
        };
    }

    /**
     * Quantise a heading angle to a cardinal / intercardinal direction.
     *
     * @param angle radians, 0 = east (R), π/2 = south (D).
     */
    private quantize(angle: number): Direction {
        // Normalise to [0, 2π).
        let a = angle;
        while (a < 0) a += 2 * Math.PI;
        while (a >= 2 * Math.PI) a -= 2 * Math.PI;

        const deg = (a * 180) / Math.PI;

        if (this.directionMode === 4) {
            // Centre each 90° bin on the cardinal direction.
            // R: [337.5, 360) ∪ [0, 22.5)   -- but for 4-dir use 45° bins
            // Simplified: divide into four 90° quadrants centred on R/D/L/U.
            if (deg < 45 || deg >= 315) return "R";
            if (deg < 135) return "D";
            if (deg < 225) return "L";
            return "U";
        }

        // Eight-direction.
        if (deg < 22.5 || deg >= 337.5) return "R";
        if (deg < 67.5) return "DR";
        if (deg < 112.5) return "D";
        if (deg < 157.5) return "DL";
        if (deg < 202.5) return "L";
        if (deg < 247.5) return "UL";
        if (deg < 292.5) return "U";
        return "UR";
    }
}

// ----------------------------------------------------------------- utilities

function heading(a: SampledPoint, b: SampledPoint): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
}

function distance(a: SampledPoint, b: SampledPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Signed smallest difference between two angles, in radians.
 * Result is in (-π, π].
 */
function angleDifference(a: number, b: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
}
