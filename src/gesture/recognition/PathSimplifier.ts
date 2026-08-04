import { SampledPoint } from "./PathSampler";

/**
 * Simplifies a sampled path using Ramer–Douglas–Peucker (RDP) and jitter
 * removal.
 *
 * Pipeline:
 *
 * 1. **Reversal anchor detection** — identifies near-180° direction reversals
 *    that RDP cannot detect (collinear points have zero perpendicular
 *    distance to the chord).  Anchors split the path into sub-paths so the
 *    reversal point is always preserved.
 *
 * 2. **RDP simplification** — reduces dense uniform-sampled points to their
 *    corner points while preserving the overall shape within `tolerance`.
 *    Unlike per-point local-angle removal (which collapses every small-turn
 *    interior point and thereby flattens smooth arcs into diagonals), RDP
 *    keeps the characteristic points of a curve because it measures the
 *    perpendicular deviation from the chord, not the local turn angle.
 *
 * 3. **Jitter removal** — a small back-and-forth detour (A → B → C where
 *    B is a short reversal and C is close to A) is collapsed by skipping B.
 *    C is retained and re-evaluated against A in the next iteration.
 *
 * 4. **Short-segment merging** — any remaining segment shorter than
 *    `minimumSegmentLength` is merged into its neighbour by dropping an
 *    endpoint.
 *
 * The first and last points are always preserved so the overall extent of the
 * gesture is never lost.
 */
export class PathSimplifier {
    constructor(
        private readonly tolerance: number,
        private readonly minimumSegmentLength: number,
    ) {}

    simplify(points: SampledPoint[]): SampledPoint[] {
        if (points.length <= 2) return points.slice();

        // Detect reversal anchors before RDP — standard RDP cannot perceive
        // direction reversals on a straight line because all collinear points
        // have zero perpendicular distance to the chord.
        const anchors = detectReversalAnchors(points, this.minimumSegmentLength);

        let rdpResult: SampledPoint[];
        if (anchors.length === 0) {
            rdpResult = rdp(points, this.tolerance);
        } else {
            // Split at anchors and run RDP on each sub-path, always keeping
            // the anchor points as sub-path endpoints.
            const indices = [0, ...anchors, points.length - 1];
            rdpResult = [];
            for (let s = 0; s < indices.length - 1; s++) {
                const start = indices[s];
                const end = indices[s + 1];
                const subPath = points.slice(start, end + 1);
                const simplified = rdp(subPath, this.tolerance);
                // Append, skipping the first point if it duplicates the last
                // point of the previous sub-path (shared endpoint).
                if (rdpResult.length > 0) {
                    const last = rdpResult[rdpResult.length - 1];
                    if (simplified.length > 0 && simplified[0].x === last.x && simplified[0].y === last.y) {
                        rdpResult.push(...simplified.slice(1));
                    } else {
                        rdpResult.push(...simplified);
                    }
                } else {
                    rdpResult.push(...simplified);
                }
            }
        }

        let result = this.removeJitter(rdpResult);
        result = this.mergeShortSegments(result);
        return result;
    }

    // ------------------------------------------------------------------ passes

    /**
     * Remove small back-and-forth detours: A → B → C where both A→B and B→C
     * are short and the turn at B is a near-reversal (> 90°), and the direct
     * path A→C is long enough to be meaningful.
     *
     * Only B is skipped; C is kept and re-examined against A in the next
     * iteration so that legitimate subsequent turns are never lost.
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
                        // B is a short reversal detour — skip B only.
                        // C will be reconsidered in the next iteration
                        // against the same `a`.
                        i += 1;
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

// ----------------------------------------------------------------- RDP

/**
 * Iterative Ramer–Douglas–Peucker simplification.
 *
 * Uses an explicit stack instead of recursion to avoid call-stack overflow
 * on long gesture paths.  Returns a new array containing only the points
 * whose perpendicular distance from the chord exceeds `tolerance` (plus the
 * two endpoints, which are always kept).
 */
function rdp(points: SampledPoint[], tolerance: number): SampledPoint[] {
    const n = points.length;
    if (n <= 2) return points.slice();

    const keep = new Array<boolean>(n).fill(false);
    keep[0] = true;
    keep[n - 1] = true;

    const stack: Array<[number, number]> = [[0, n - 1]];
    while (stack.length > 0) {
        const [start, end] = stack.pop()!;
        if (end - start < 2) continue;

        const ax = points[start].x;
        const ay = points[start].y;
        const bx = points[end].x;
        const by = points[end].y;

        let dmax = 0;
        let index = -1;
        for (let i = start + 1; i < end; i++) {
            const d = perpendicularDistance(points[i], ax, ay, bx, by);
            if (d > dmax) {
                dmax = d;
                index = i;
            }
        }

        if (dmax > tolerance && index !== -1) {
            keep[index] = true;
            stack.push([start, index]);
            stack.push([index, end]);
        }
    }

    const result: SampledPoint[] = [];
    for (let i = 0; i < n; i++) {
        if (keep[i]) result.push(points[i]);
    }
    return result;
}

/**
 * Perpendicular distance from point `p` to the infinite line through
 * `(ax, ay)` and `(bx, by)`.  When the two reference points coincide the
 * ordinary Euclidean distance is returned instead.
 */
function perpendicularDistance(
    p: SampledPoint,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        const px = p.x - ax;
        const py = p.y - ay;
        return Math.sqrt(px * px + py * py);
    }
    return Math.abs(dy * p.x - dx * p.y + bx * ay - by * ax) / Math.sqrt(lenSq);
}

// ----------------------------------------------------------------- utilities

function distance(a: SampledPoint, b: SampledPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Turn angle at vertex B for the polyline A → B → C, in degrees (0–180).
 * 0 = straight ahead (collinear, same direction), 180 = full reversal.
 */
function turnAngleDeg(a: SampledPoint, b: SampledPoint, c: SampledPoint): number {
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 === 0 || m2 === 0) return 0;
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    return (Math.acos(cos) * 180) / Math.PI;
}

// ------------------------------------------------------------- reversal anchors

/**
 * Detect reversal anchor points in a sampled path.
 *
 * A reversal anchor is a point where the path direction reverses (near 180°
 * turn).  These points are critical because standard RDP cannot detect them —
 * all points on a straight line have zero perpendicular distance to the
 * chord, so RDP deletes the reversal point and collapses the path.
 *
 * Detection uses an **adaptive window**: for each interior point, the function
 * looks back and forward until the accumulated distance reaches
 * `minimumSegmentLength`.  This produces stable incoming and outgoing heading
 * vectors that are immune to short (2–5px) jitter.
 *
 * Only points where both the incoming and outgoing window vectors have
 * length >= `minimumSegmentLength` are considered, ensuring short detours
 * don't generate spurious anchors.  Smooth arcs are not affected because the
 * heading changes gradually — at no single point does the windowed heading
 * jump by more than the reversal threshold.
 *
 * @returns Sorted array of anchor indices (into the input `points` array).
 */
function detectReversalAnchors(
    points: SampledPoint[],
    minimumSegmentLength: number,
    reversalAngleDeg = 150,
): number[] {
    const n = points.length;
    if (n < 5) return [];

    const anchors: number[] = [];
    const reversalCos = Math.cos((reversalAngleDeg * Math.PI) / 180);
    const minDistSq = minimumSegmentLength * minimumSegmentLength;

    for (let i = 1; i < n - 1; i++) {
        // --- Look backward until we've covered at least minimumSegmentLength.
        let backIdx = i - 1;
        let backDx = points[i].x - points[backIdx].x;
        let backDy = points[i].y - points[backIdx].y;
        while (backIdx > 0 && backDx * backDx + backDy * backDy < minDistSq) {
            backIdx--;
            backDx = points[i].x - points[backIdx].x;
            backDy = points[i].y - points[backIdx].y;
        }
        const v1Len = Math.sqrt(backDx * backDx + backDy * backDy);
        if (v1Len < minimumSegmentLength) continue; // not enough path behind

        // --- Look forward until we've covered at least minimumSegmentLength.
        let fwdIdx = i + 1;
        let fwdDx = points[fwdIdx].x - points[i].x;
        let fwdDy = points[fwdIdx].y - points[i].y;
        while (fwdIdx < n - 1 && fwdDx * fwdDx + fwdDy * fwdDy < minDistSq) {
            fwdIdx++;
            fwdDx = points[fwdIdx].x - points[i].x;
            fwdDy = points[fwdIdx].y - points[i].y;
        }
        const v2Len = Math.sqrt(fwdDx * fwdDx + fwdDy * fwdDy);
        if (v2Len < minimumSegmentLength) continue; // not enough path ahead

        // --- Check if the heading reversed.
        // dot < reversalCos means the angle between v1 and v2 is > reversalAngleDeg.
        const dot = backDx * fwdDx + backDy * fwdDy;
        const cos = dot / (v1Len * v2Len);
        if (cos < reversalCos) {
            // Avoid duplicate anchors too close together — require at least
            // minimumSegmentLength distance from the last anchor.
            if (anchors.length > 0) {
                const lastIdx = anchors[anchors.length - 1];
                const dx = points[i].x - points[lastIdx].x;
                const dy = points[i].y - points[lastIdx].y;
                if (dx * dx + dy * dy < minDistSq) continue;
            }
            anchors.push(i);
        }
    }

    return anchors;
}
