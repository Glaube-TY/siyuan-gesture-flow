import { SampledPoint } from "./PathSampler";

/**
 * Removes too-short and jittery segments from a sampled path.
 *
 * The simplifier works in three passes:
 *
 * 1. **Collinear removal** — points whose neighbours form a nearly straight
 *    line (turn angle below a small threshold) are dropped.  This reduces a
 *    dense uniform-sampled path to its corner points without losing any
 *    significant turn.
 *
 * 2. **Jitter removal** — a small back-and-forth detour (A → B → C where
 *    B is a short reversal and C is close to A) is collapsed by skipping B.
 *
 * 3. **Short-segment merging** — any remaining segment shorter than
 *    `minimumSegmentLength` is merged into its neighbour.
 *
 * The first and last points are always preserved so the overall extent of the
 * gesture is never lost.
 */
export class PathSimplifier {
    constructor(private readonly minimumSegmentLength: number) {}

    simplify(points: SampledPoint[]): SampledPoint[] {
        if (points.length <= 2) return points.slice();

        let result = this.removeCollinearPoints(points, 5);
        result = this.removeJitter(result);
        result = this.mergeShortSegments(result);
        return result;
    }

    // ------------------------------------------------------------------ passes

    /**
     * Remove interior points that are (nearly) collinear with their neighbours.
     * A point is kept only when the turn angle at that point exceeds
     * `angleThresholdDeg`.  The first and last points are always kept.
     */
    private removeCollinearPoints(
        points: SampledPoint[],
        angleThresholdDeg: number,
    ): SampledPoint[] {
        if (points.length <= 2) return points.slice();
        const thresholdRad = (angleThresholdDeg * Math.PI) / 180;
        const result: SampledPoint[] = [points[0]];

        for (let i = 1; i < points.length - 1; i++) {
            const a = points[i - 1];
            const b = points[i];
            const c = points[i + 1];
            if (turnAngleRad(a, b, c) > thresholdRad) {
                result.push(b);
            }
        }

        result.push(points[points.length - 1]);
        return result;
    }

    /**
     * Remove small back-and-forth detours: A → B → C where both A→B and B→C
     * are short and the turn at B is a near-reversal (> 90°), and the direct
     * path A→C is long enough to be meaningful.
     */
    private removeJitter(points: SampledPoint[]): SampledPoint[] {
        if (points.length <= 2) return points.slice();
        const minLen = this.minimumSegmentLength;
        const result: SampledPoint[] = [points[0]];

        let i = 1;
        while (i < points.length) {
            const a = result[result.length - 1];
            const b = points[i];
            const c = i + 1 < points.length ? points[i + 1] : null;

            if (c) {
                const abLen = distance(a, b);
                const bcLen = distance(b, c);
                if (abLen < minLen && bcLen < minLen) {
                    const acLen = distance(a, c);
                    const turn = turnAngleDeg(a, b, c);
                    if (acLen >= minLen && turn > 90) {
                        // B is a short reversal detour — skip it.
                        i += 2;
                        continue;
                    }
                }
            }

            result.push(b);
            i++;
        }

        // Ensure the final raw point is present.
        const last = points[points.length - 1];
        const lastResult = result[result.length - 1];
        if (last.x !== lastResult.x || last.y !== lastResult.y) {
            result.push(last);
        }
        return result;
    }

    /**
     * Iteratively remove the shortest segment below the threshold by dropping
     * one of its endpoints.  Repeats until no segment is too short.
     */
    private mergeShortSegments(points: SampledPoint[]): SampledPoint[] {
        if (points.length <= 2) return points.slice();
        const minLen = this.minimumSegmentLength;
        const pts = points.slice();

        let improved = true;
        while (improved && pts.length > 2) {
            improved = false;
            let minIdx = -1;
            let shortest = Infinity;
            for (let i = 0; i < pts.length - 1; i++) {
                const d = distance(pts[i], pts[i + 1]);
                if (d < shortest) {
                    shortest = d;
                    minIdx = i;
                }
            }
            if (shortest < minLen && minIdx >= 0) {
                let removeAt: number;
                if (minIdx === 0) {
                    removeAt = 1;
                } else if (minIdx === pts.length - 2) {
                    removeAt = pts.length - 2;
                } else {
                    const prevLen = distance(pts[minIdx - 1], pts[minIdx]);
                    const nextLen = distance(pts[minIdx + 1], pts[minIdx + 2]);
                    removeAt = nextLen >= prevLen ? minIdx + 1 : minIdx;
                }
                if (removeAt > 0 && removeAt < pts.length - 1) {
                    pts.splice(removeAt, 1);
                    improved = true;
                }
            }
        }
        return pts;
    }
}

// ----------------------------------------------------------------- utilities

function distance(a: SampledPoint, b: SampledPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Turn angle at vertex B for the polyline A → B → C, in radians (0–π).
 * 0 = straight ahead (collinear, same direction), π = full reversal.
 * Computed from the incoming direction (A→B) and outgoing direction (B→C).
 */
function turnAngleRad(a: SampledPoint, b: SampledPoint, c: SampledPoint): number {
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 === 0 || m2 === 0) return 0;
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    return Math.acos(cos);
}

/** Same as {@link turnAngleRad} but returns degrees (0–180). */
function turnAngleDeg(a: SampledPoint, b: SampledPoint, c: SampledPoint): number {
    return (turnAngleRad(a, b, c) * 180) / Math.PI;
}
