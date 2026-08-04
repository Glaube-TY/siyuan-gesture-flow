import { Direction, Segment } from "./DirectionVectorizer";

/**
 * Post-processes raw direction segments into the final gesture sequence.
 *
 * Responsibilities:
 *
 * - Merge adjacent segments that share the same direction label.
 * - Enforce {@link maximumSegments}: sequences longer than the limit are
 *   truncated to the first N segments (compound gestures are never artificially
 *   capped to two directions).
 *
 * Also provides {@link equals} for comparing two direction sequences, used
 * later by the binding system to detect which gesture was performed and to
 * flag duplicate bindings.
 */
export class DirectionMatcher {
    constructor(private readonly maximumSegments: number) {}

    /**
     * Reduce a list of (possibly noisy) segments into a clean direction
     * sequence with no adjacent duplicates.
     */
    match(segments: Segment[]): Direction[] {
        if (segments.length === 0) return [];

        const directions: Direction[] = [segments[0].direction];
        for (let i = 1; i < segments.length; i++) {
            const prev = directions[directions.length - 1];
            if (segments[i].direction !== prev) {
                directions.push(segments[i].direction);
            }
        }

        if (directions.length > this.maximumSegments) {
            return directions.slice(0, this.maximumSegments);
        }
        return directions;
    }

    /**
     * Strict equality check between two direction sequences.
     * Two sequences match only when they have the same length and every
     * element is identical.
     */
    equals(a: Direction[], b: Direction[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /** Whether the direction sequence is empty (no meaningful gesture). */
    isEmpty(directions: Direction[]): boolean {
        return directions.length === 0;
    }
}
