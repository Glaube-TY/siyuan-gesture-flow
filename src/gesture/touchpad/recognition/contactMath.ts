import { Direction } from "@/gesture/recognition/DirectionVectorizer";
import { TouchpadContact } from "@/touchpad/types";

/**
 * Pure geometry helpers for touchpad contact analysis.
 *
 * All coordinate inputs are normalised touchpad-surface coordinates (0..1),
 * so every threshold in the config is expressed in the same normalised
 * space.  These functions never touch the DOM or the provider.
 */

/** Average position of all active contacts. */
export function centroid(contacts: readonly Pick<TouchpadContact, "x" | "y">[]): { x: number; y: number } {
    if (contacts.length === 0) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (const c of contacts) {
        sx += c.x;
        sy += c.y;
    }
    return { x: sx / contacts.length, y: sy / contacts.length };
}

/** Distance between two points (normalised units). */
export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Sum of pairwise distances between all contacts (stable multi-finger spread). */
export function pairwiseSpread(contacts: readonly Pick<TouchpadContact, "x" | "y">[]): number {
    let total = 0;
    for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
            total += dist(contacts[i], contacts[j]);
        }
    }
    return contacts.length < 2 ? 0 : total;
}

/** Total arc length of a polyline. */
export function pathLength(points: readonly { x: number; y: number }[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += dist(points[i - 1], points[i]);
    }
    return total;
}

/** Straightness ratio of a path: end-to-end distance / total arc length (0..1). */
export function straightness(points: readonly { x: number; y: number }[]): number {
    if (points.length < 2) return 1;
    const len = pathLength(points);
    if (len === 0) return 1;
    const end = dist(points[0], points[points.length - 1]);
    return Math.max(0, Math.min(1, end / len));
}

/**
 * Quantise a 2D displacement to a {@link Direction}.
 *
 * Mirrors the GestureEngine's 8-direction quantisation (screen coords,
 * y increases downward): angle 0 → R, π/2 → D.
 */
export function classifyDirection(dx: number, dy: number, mode: 4 | 8 = 8): Direction {
    if (dx === 0 && dy === 0) return "R";
    let a = Math.atan2(dy, dx);
    while (a < 0) a += 2 * Math.PI;
    while (a >= 2 * Math.PI) a -= 2 * Math.PI;
    const deg = (a * 180) / Math.PI;
    if (mode === 4) {
        if (deg < 45 || deg >= 315) return "R";
        if (deg < 135) return "D";
        if (deg < 225) return "L";
        return "U";
    }
    if (deg < 22.5 || deg >= 337.5) return "R";
    if (deg < 67.5) return "DR";
    if (deg < 112.5) return "D";
    if (deg < 157.5) return "DL";
    if (deg < 202.5) return "L";
    if (deg < 247.5) return "UL";
    if (deg < 292.5) return "U";
    return "UR";
}

/** Signed smallest angle difference between two angles, radians, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
}

/**
 * Heading angle of the vector between two points (radians, 0 = east).
 * Mirrors the GestureEngine's heading().
 */
export function heading(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Largest per-contact displacement from a reference position map. */
export function maxContactDisplacement(
    contacts: readonly Pick<TouchpadContact, "id" | "x" | "y">[],
    reference: ReadonlyMap<number, { x: number; y: number }>,
): { max: number; byId: Map<number, number> } {
    const byId = new Map<number, number>();
    let max = 0;
    for (const c of contacts) {
        const ref = reference.get(c.id);
        if (ref) {
            const d = dist(ref, c);
            byId.set(c.id, d);
            if (d > max) max = d;
        }
    }
    return { max, byId };
}

/**
 * Split contacts into anchor(s) and a single tracer for AnchorDraw.
 *
 * The anchor is the contact with the smallest displacement; when
 * `anchorCount > 1`, the `anchorCount` least-moving contacts are the
 * anchors.  The tracer is the most-moving contact.  Returns null when the
 * tracer is indistinguishable (e.g. all contacts move together).
 */
export function classifyAnchorTracer(
    contacts: readonly Pick<TouchpadContact, "id" | "x" | "y">[],
    displacementById: ReadonlyMap<number, number>,
    anchorCount: number,
): { anchors: number[]; tracer: number } | null {
    if (contacts.length < 2) return null;
    const sorted = contacts
        .map((c) => ({ id: c.id, d: displacementById.get(c.id) ?? 0 }))
        .sort((a, b) => a.d - b.d);
    const count = Math.max(1, Math.min(anchorCount, contacts.length - 1));
    const anchors = sorted.slice(0, count).map((s) => s.id);
    const tracer = sorted[sorted.length - 1];
    // The tracer must actually move more than the least-moving anchor,
    // otherwise there is no anchor/tracer distinction at all.
    if (tracer.d - sorted[0].d < 1e-9) return null;
    return { anchors, tracer: tracer.id };
}

/**
 * Full-trajectory stability of one contact: how far it strayed from its
 * start position over the WHOLE gesture, and how much path it travelled.
 *
 * A contact that moves far away and returns to the start has a tiny FINAL
 * displacement but a large {@link maxDistanceFromStart} — it is NOT an
 * anchor.  True anchors stay within `anchorMaxDrift` of their start for the
 * entire gesture.
 */
export interface ContactStability {
    /** Max distance any trail sample was from the contact's start position. */
    maxDistanceFromStart: number;
    /** Total arc length of the contact's trail. */
    totalPathLength: number;
}

/** Compute {@link ContactStability} from a contact's sampled trail. */
export function contactTrailStability(
    trail: readonly { x: number; y: number }[],
    start: { x: number; y: number },
): ContactStability {
    let maxDistanceFromStart = 0;
    let totalPathLength = 0;
    for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        const d = dist(start, p);
        if (d > maxDistanceFromStart) maxDistanceFromStart = d;
        if (i > 0) {
            totalPathLength += dist(trail[i - 1], p);
        }
    }
    return { maxDistanceFromStart, totalPathLength };
}

/**
 * Generalised anchor/moving split based on FULL-TRAJECTORY stability.
 *
 * `anchorIds` are the contacts whose entire trail stayed within
 * `anchorMaxDrift` of their start position; `movingIds` are the rest.  This
 * deliberately allows any count of anchors (0..N-1) and any count of moving
 * contacts (1..N), e.g. 1 anchor + 2 moving, or 2 anchors + 1 moving.
 *
 * Returns null when there is no meaningful split (no anchor, or no moving
 * contact — which would not be an anchorDraw at all).
 */
export function classifyAnchorGroups(
    contacts: readonly Pick<TouchpadContact, "id" | "x" | "y">[],
    startPositions: ReadonlyMap<number, { x: number; y: number }>,
    contactTrails: ReadonlyMap<number, readonly { x: number; y: number }[]>,
    anchorMaxDrift: number,
): { anchorIds: number[]; movingIds: number[] } | null {
    if (contacts.length < 2) return null;
    const anchorIds: number[] = [];
    const movingIds: number[] = [];
    for (const c of contacts) {
        const start = startPositions.get(c.id);
        const trail = contactTrails.get(c.id);
        if (!start) {
            movingIds.push(c.id);
            continue;
        }
        if (!trail || trail.length === 0) {
            anchorIds.push(c.id);
            continue;
        }
        const { maxDistanceFromStart } = contactTrailStability(trail, start);
        if (maxDistanceFromStart <= anchorMaxDrift) {
            anchorIds.push(c.id);
        } else {
            movingIds.push(c.id);
        }
    }
    if (anchorIds.length === 0 || movingIds.length === 0) return null;
    return { anchorIds, movingIds };
}
