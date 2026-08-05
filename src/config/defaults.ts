import { GestureFlowConfig, ConfigBinding } from "./types";
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
const DEFAULT_CONFIG: Readonly<GestureFlowConfig> = Object.freeze({
    version: 1,
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
    bindings: [
        {
            id: "default-L",
            enabled: true,
            directions: ["L"] as Direction[],
            commandId: "tabs.previous",
            commandParams: {},
        },
        {
            id: "default-R",
            enabled: true,
            directions: ["R"] as Direction[],
            commandId: "tabs.next",
            commandParams: {},
        },
        {
            id: "default-U",
            enabled: true,
            directions: ["U"] as Direction[],
            commandId: "scroll.top",
            commandParams: {},
        },
        {
            id: "default-D",
            enabled: true,
            directions: ["D"] as Direction[],
            commandId: "scroll.bottom",
            commandParams: {},
        },
    ],
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
        bindings: config.bindings.map(cloneBinding),
    };
}

/** Deep-copy a single binding (directions + commandParams included). */
export function cloneBinding(b: ConfigBinding): ConfigBinding {
    return {
        id: b.id,
        enabled: b.enabled,
        directions: b.directions.slice(),
        commandId: b.commandId,
        commandParams: { ...b.commandParams },
    };
}
