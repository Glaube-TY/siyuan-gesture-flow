import { GestureFlowConfig, ConfigBinding, TouchpadConfig, MouseShapeGestureSpec } from "./types";
import { SuppressionKey } from "@/gesture/types";
import { DirectionMode, Direction } from "@/gesture/recognition/DirectionVectorizer";

/**
 * Default gesture-flow configuration.
 *
 * Values match the previously hard-coded behaviour exactly so stage 5A
 * does not change any user-visible defaults:
 *
 * - enabled: true
 * - trigger: button 2 (right), activationDistance 16, suppressionKey Alt,
 *   timeoutMs 2000
 * - recognizer: sampleDistance 4, simplifyTolerance 2.8,
 *   minimumSegmentLength 18, turnAngleThreshold 42, maximumSegments 6,
 *   directionMode 4
 * - overlay: showTrail true, showHint true, lineWidth 3
 * - bindings: L/R/U/D → tabs.previous / tabs.next / scroll.top / scroll.bottom
 *
 * This constant is a single shared object.  Always obtain a fresh copy via
 * {@link createDefaultConfig} so external mutation cannot leak between
 * instances or tests.
 */
const DEFAULT_BINDINGS: ConfigBinding[] = [
    {
        id: "default-L",
        enabled: true,
        source: "mouse",
        gesture: { kind: "shape", button: 2, directions: ["L"] as Direction[] },
        action: { type: "builtin", commandId: "tabs.previous", commandParams: {} },
    },
    {
        id: "default-R",
        enabled: true,
        source: "mouse",
        gesture: { kind: "shape", button: 2, directions: ["R"] as Direction[] },
        action: { type: "builtin", commandId: "tabs.next", commandParams: {} },
    },
    {
        id: "default-U",
        enabled: true,
        source: "mouse",
        gesture: { kind: "shape", button: 2, directions: ["U"] as Direction[] },
        action: { type: "builtin", commandId: "scroll.top", commandParams: {} },
    },
    {
        id: "default-D",
        enabled: true,
        source: "mouse",
        gesture: { kind: "shape", button: 2, directions: ["D"] as Direction[] },
        action: { type: "builtin", commandId: "scroll.bottom", commandParams: {} },
    },
];

/** Default touchpad configuration (safe, conservative thresholds). */
export const DEFAULT_TOUCHPAD_CONFIG: Readonly<TouchpadConfig> = Object.freeze({
    enabled: false,
    safeMode: true,
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
});

const DEFAULT_CONFIG: Readonly<GestureFlowConfig> = Object.freeze({
    version: 2,
    enabled: true,
    trigger: {
        button: 2,
        activationDistance: 16,
        suppressionKey: "Alt" as SuppressionKey,
        timeoutMs: 2000,
    },
    recognizer: {
        sampleDistance: 4,
        simplifyTolerance: 2.8,
        minimumSegmentLength: 18,
        turnAngleThreshold: 42,
        maximumSegments: 6,
        directionMode: 4 as DirectionMode,
    },
    overlay: {
        showTrail: true,
        showHint: true,
        lineWidth: 3,
    },
    touchpad: DEFAULT_TOUCHPAD_CONFIG,
    bindings: DEFAULT_BINDINGS,
});

/**
 * Return a fully independent deep copy of the default config.
 *
 * `structuredClone` is preferred (available in modern browsers and Node 17+).
 * A JSON-based fallback is kept for environments where `structuredClone` is
 * unavailable — the default config contains only JSON-serialisable data, so
 * the two paths are equivalent here.
 */
export function createDefaultConfig(): GestureFlowConfig {
    return deepCloneConfig(DEFAULT_CONFIG as GestureFlowConfig);
}

/**
 * Produce a fully independent deep copy of a config.
 *
 * `bindings` (array), each binding's `directions` (array) and
 * `commandParams` (object) are all copied so the returned object shares no
 * references with the input.  This is the single deep-copy helper used by
 * ConfigManager to guarantee that {@link getConfig} / subscribe snapshots
 * can never be mutated by external code.
 */
export function deepCloneConfig(config: GestureFlowConfig): GestureFlowConfig {
    return {
        version: config.version,
        enabled: config.enabled,
        trigger: { ...config.trigger },
        recognizer: { ...config.recognizer },
        overlay: { ...config.overlay },
        touchpad: { ...config.touchpad },
        bindings: config.bindings.map(cloneBinding),
    };
}

/**
 * Deep-copy a single binding: directions and the nested action
 * (commandParams object / shortcut object) are copied so the returned
 * binding shares no references with the input.
 */
export function cloneBinding(b: ConfigBinding): ConfigBinding {
    if (b.action.type === "builtin") {
        return {
            id: b.id,
            enabled: b.enabled,
            source: b.source,
            gesture: cloneGesture(b.gesture),
            action: {
                type: "builtin",
                commandId: b.action.commandId,
                commandParams: { ...b.action.commandParams },
            },
        };
    }
    return {
        id: b.id,
        enabled: b.enabled,
        source: b.source,
        gesture: cloneGesture(b.gesture),
        action: {
            type: "shortcut",
            title: b.action.title,
            shortcut: { ...b.action.shortcut },
        },
    };
}

/** Deep-copy a binding's gesture descriptor. */
function cloneGesture(gesture: ConfigBinding["gesture"]): ConfigBinding["gesture"] {
    if ("button" in gesture) {
        const g = gesture as MouseShapeGestureSpec;
        return { kind: "shape", button: g.button, directions: g.directions.slice() };
    }
    const spec = gesture as import("@/gesture/touchpad/types").TouchpadGestureSpec;
    if (spec.kind === "swipe") return { kind: "swipe", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "pinch") return { kind: "pinch", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "rotate") return { kind: "rotate", fingerCount: spec.fingerCount, direction: spec.direction };
    if (spec.kind === "shape") return { kind: "shape", fingerCount: spec.fingerCount, directions: spec.directions.slice() };
    if (spec.kind === "anchorDraw") {
        return { kind: "anchorDraw", fingerCount: spec.fingerCount, anchorCount: spec.anchorCount, directions: spec.directions.slice() };
    }
    return { kind: spec.kind, fingerCount: spec.fingerCount };
}
