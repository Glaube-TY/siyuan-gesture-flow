import { GesturePoint } from "../types";

/** A point after distance-based sampling (timestamp no longer needed). */
export interface SampledPoint {
    x: number;
    y: number;
}

/**
 * Resamples a raw gesture path so that consecutive points are approximately
 * `sampleDistance` apart (uniform arc-length spacing).
 *
 * Uniform spacing normalises point density regardless of pointer speed,
 * which makes downstream direction analysis more stable. The first and last
 * raw points are always retained so the overall extent of the gesture is
 * preserved.
 */
export class PathSampler {
    constructor(private readonly sampleDistance: number) {}

    sample(points: GesturePoint[]): SampledPoint[] {
        if (points.length === 0) return [];
        if (points.length === 1) return [{ x: points[0].x, y: points[0].y }];

        const step = this.sampleDistance;
        if (step <= 0) {
            return points.map((p) => ({ x: p.x, y: p.y }));
        }

        const result: SampledPoint[] = [{ x: points[0].x, y: points[0].y }];

        // Walk the polyline, emitting a point every `step` units of arc length.
        // `accumulated` = distance from the last emitted point to the end of the
        // previous raw segment (carried over into the next segment).
        let accumulated = 0;

        for (let i = 1; i < points.length; i++) {
            const ax = points[i - 1].x;
            const ay = points[i - 1].y;
            const bx = points[i].x;
            const by = points[i].y;
            const dx = bx - ax;
            const dy = by - ay;
            const segLen = Math.sqrt(dx * dx + dy * dy);
            if (segLen === 0) continue;

            const ux = dx / segLen;
            const uy = dy / segLen;

            // Position within this raw segment, starting from 0.
            let posInSeg = 0;
            let need = step - accumulated;
            let emitted = false;

            while (posInSeg + need <= segLen + 1e-9) {
                posInSeg += need;
                result.push({ x: ax + ux * posInSeg, y: ay + uy * posInSeg });
                accumulated = 0;
                need = step;
                emitted = true;
            }

            if (emitted) {
                // Leftover distance from the last emitted point to the segment end.
                accumulated = segLen - posInSeg;
            } else {
                // Nothing emitted: the full segment length carries over.
                accumulated += segLen;
            }
        }

        // Always retain the final raw point.
        const last = points[points.length - 1];
        const lastEmitted = result[result.length - 1];
        if (lastEmitted.x !== last.x || lastEmitted.y !== last.y) {
            result.push({ x: last.x, y: last.y });
        }

        return result;
    }
}
