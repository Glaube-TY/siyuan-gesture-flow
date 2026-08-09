import { GestureFlowConfig, ConfigBinding } from "@/config/types";
import { MouseGestureAdapter } from "@/gesture/input/MouseGestureAdapter";
import { GestureEngine } from "@/gesture/GestureEngine";
import { GestureFeedbackController } from "@/gesture/GestureFeedbackController";
import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { OverlayI18n } from "@/gesture/overlay/types";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { CommandExecutor } from "@/commands/CommandExecutor";
import { SiyuanActionBridge } from "@/commands/SiyuanActionBridge";
import { globalCommand } from "siyuan";
import { GestureActionExecutor } from "@/actions/GestureActionExecutor";
import { ShortcutExecutor } from "@/shortcuts/ShortcutExecutor";
import { registerBuiltinCommands } from "@/commands/registerBuiltinCommands";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { createCommandLabelResolver } from "@/gesture/bindings/CommandLabelResolver";
import { GestureBinding } from "@/gesture/bindings/types";
import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";
import { mouseSignature, touchpadSignature, GestureSignatureKey } from "@/gesture/signature";
import { TouchpadGestureSpec, TouchpadGestureKind, hasDirections, specDirections } from "@/gesture/touchpad/types";
import { TouchpadGestureAdapter } from "@/gesture/touchpad/TouchpadGestureAdapter";
import { TouchpadFeedbackController } from "@/gesture/touchpad/TouchpadFeedbackController";
import { TouchpadRecognitionResult, TouchpadTrackerConfig } from "@/gesture/touchpad/recognition/TouchpadGestureTracker";
import { createTouchpadProvider } from "@/touchpad/ProviderRegistry";
import { dispatchAllowed, providerSupportsKind } from "@/gesture/conflict/TouchpadConflictPolicy";
import {
    publishTouchpadCapabilities,
    publishTouchpadFrame,
    publishTouchpadRawFrame,
    subscribeTouchpadDiagnosticsPolling,
    hasTouchpadRawFrameListeners,
    isTouchpadRecording,
} from "@/runtime/TouchpadRuntimeState";

/**
 * Runtime state.
 *
 * - `stopped`  — no input listeners, no overlay, no command dispatch.
 * - `running`  — all components are attached and the gesture pipeline is
 *                active.
 * - `disabled` — the runtime was created with `enabled: false` (or
 *                restarted with such a config).  No input listeners are
 *                attached.
 */
export type RuntimeState = "stopped" | "running" | "disabled";

/**
 * Outcome of a {@link GestureFlowRuntime.restart} attempt.
 */
export type RestartResult =
    | { status: "applied"; config: GestureFlowConfig }
    | { status: "rolled-back"; config: GestureFlowConfig; rollbackConfig: GestureFlowConfig; error: string }
    | { status: "failed"; error: string };

/**
 * Options for constructing a {@link GestureFlowRuntime}.
 */
export interface GestureFlowRuntimeOptions {
    /** DOM target the input adapters attach to (typically `document`). */
    target: EventTarget;
    /** Localised strings for the overlay hint. */
    overlayI18n: OverlayI18n;
    /** i18n map used by the command label resolver. */
    i18n: Record<string, string>;
    /** Optional SiYuan `App` provider forwarded to the action bridge. */
    app?: Parameters<typeof globalCommand>[1] | null;
    /**
     * Override the input-target exclusion predicate passed to the mouse
     * adapter.
     */
    shouldIgnoreTarget?: (target: EventTarget | null) => boolean;
    /**
     * Concise provider-error hook (touchpad init/native failures).  The
     * caller (index.ts) is responsible for logging — the runtime never
     * writes to the console itself.
     */
    onTouchpadError?: (label: string) => void;
}

/**
 * Default input-target exclusion: targets inside an element marked with
 * `data-gesture-flow-recorder` are ignored by the global mouse gesture
 * adapter.
 */
export function defaultGestureIgnoreTarget(target: EventTarget | null): boolean {
    return (
        target instanceof Element &&
        target.closest("[data-gesture-flow-recorder]") !== null
    );
}

/**
 * Owns the full gesture pipeline lifecycle for BOTH input sources.
 *
 * The mouse path is the mature, unchanged implementation (adapter →
 * feedback controller → overlay → dispatcher).  The touchpad path runs in
 * parallel with its own adapter + feedback controller over the same binding
 * registry / dispatcher, so both sources share the gesture engine, the
 * binding registry and the action executor.  Any touchpad provider failure is
 * contained to the touchpad path — the mouse path keeps working.
 */
export class GestureFlowRuntime {
    private readonly target: EventTarget;
    private readonly overlayI18n: OverlayI18n;
    private readonly i18n: Record<string, string>;
    private readonly shouldIgnoreTarget: (target: EventTarget | null) => boolean;
    /** App provider forwarded to the action bridge (may be null). */
    private readonly app: Parameters<typeof globalCommand>[1] | null;
    /** Concise touchpad provider-error hook (logging delegated to index.ts). */
    private readonly onTouchpadError: (label: string) => void;

    private state: RuntimeState = "stopped";
    private config: GestureFlowConfig | null = null;

    // Owned components (created on start, destroyed on stop).
    private adapter: MouseGestureAdapter | null = null;
    private controller: GestureFeedbackController | null = null;
    private touchpadAdapter: TouchpadGestureAdapter | null = null;
    private touchpadFeedback: TouchpadFeedbackController | null = null;
    private dispatcher: GestureActionExecutor | null = null;
    private commandExecutor: CommandExecutor | null = null;
    private shortcutExecutor: ShortcutExecutor | null = null;

    /** Touchpad session id counter (dedup namespace `t:`). */
    private touchpadSessionCounter = 0;
    /** Throttle for diagnostics publication (~30 Hz max). */
    private lastDiagnosticsPublish = 0;
    /** ~300 ms poll timer while the Touchpad settings tab is open. */
    private touchpadPollTimer: ReturnType<typeof setInterval> | null = null;
    private unsubscribeTouchpadPolling: (() => void) | null = null;

    constructor(opts: GestureFlowRuntimeOptions) {
        this.target = opts.target;
        this.overlayI18n = opts.overlayI18n;
        this.i18n = opts.i18n;
        this.shouldIgnoreTarget = opts.shouldIgnoreTarget ?? defaultGestureIgnoreTarget;
        this.app = opts.app ?? null;
        this.onTouchpadError = opts.onTouchpadError ?? (() => undefined);
    }

    /** Current runtime state. */
    getState(): RuntimeState {
        return this.state;
    }

    /**
     * Start the runtime with the given configuration.
     *
     * Idempotent: if already running with a config, calling `start` again is
     * a no-op (use {@link restart} to apply a new config).  If the config has
     * `enabled: false`, the runtime enters the `disabled` state.
     */
    start(config: GestureFlowConfig): void {
        if (this.state === "running" || this.state === "disabled") {
            return;
        }
        this.config = config;
        if (!config.enabled) {
            this.state = "disabled";
            return;
        }
        this.doStart(config);
    }

    /** Stop the runtime and tear down all components.  Idempotent. */
    stop(): void {
        this.doStop();
        this.state = "stopped";
        this.config = null;
    }

    /** Restart the runtime with a new configuration. */
    restart(newConfig: GestureFlowConfig): RestartResult {
        const previousConfig = this.config;
        this.doStop();
        this.state = "stopped";
        this.config = null;

        this.config = newConfig;
        if (!newConfig.enabled) {
            this.state = "disabled";
            return { status: "applied", config: newConfig };
        }
        try {
            this.doStart(newConfig);
            return { status: "applied", config: newConfig };
        } catch (err) {
            const label = err instanceof Error ? err.message : String(err);
            if (previousConfig && previousConfig.enabled) {
                try {
                    this.doStart(previousConfig);
                    return {
                        status: "rolled-back",
                        config: previousConfig,
                        rollbackConfig: newConfig,
                        error: label,
                    };
                } catch {
                    // rollback failed — fall through to total failure
                }
            }
            this.doStop();
            this.state = "stopped";
            this.config = null;
            return { status: "failed", error: label };
        }
    }

    // --------------------------------------------------------------- internals

    private doStart(config: GestureFlowConfig): void {
        if (typeof document === "undefined") {
            this.state = "running";
            return;
        }

        // --- Command system ---
        const bridge = new SiyuanActionBridge(this.app);
        const commandRegistry = new CommandRegistry();
        registerBuiltinCommands(commandRegistry, bridge);
        const commandExecutor = new CommandExecutor(commandRegistry);
        this.commandExecutor = commandExecutor;

        // --- Gesture bindings (from config) ---
        const bindingRegistry = new GestureBindingRegistry();
        bindingRegistry.registerMany(this.toGestureBindings(config.bindings));

        // --- Action dispatcher (builtin commands + keyboard shortcuts) ---
        const shortcutExecutor = new ShortcutExecutor();
        this.shortcutExecutor = shortcutExecutor;
        const dispatcher = new GestureActionExecutor(
            bindingRegistry,
            commandExecutor,
            shortcutExecutor,
        );
        this.dispatcher = dispatcher;

        // --- Mouse feedback (unchanged path) ---
        const engine = new GestureEngine({
            sampleDistance: config.recognizer.sampleDistance,
            simplifyTolerance: config.recognizer.simplifyTolerance,
            minimumSegmentLength: config.recognizer.minimumSegmentLength,
            turnAngleThreshold: config.recognizer.turnAngleThreshold,
            maximumSegments: config.recognizer.maximumSegments,
            directionMode: config.recognizer.directionMode,
        });

        const overlay = new GestureOverlay(this.overlayI18n, config.overlay);
        const commandTitles = new Map<string, string>(
            commandRegistry.list().map((c) => [c.id, c.title]),
        );
        const commandLabelResolver = createCommandLabelResolver(
            bindingRegistry,
            this.i18n,
            { commandTitles, button: config.trigger.button },
        );

        const controller = new GestureFeedbackController({
            engine,
            overlay,
            commandLabelResolver,
            onGestureComplete: (session, result) => {
                void this.handleGestureComplete(session, result);
            },
        });
        this.controller = controller;

        // --- Mouse input adapter (unchanged) ---
        this.adapter = new MouseGestureAdapter(
            {
                button: config.trigger.button,
                activationDistance: config.trigger.activationDistance,
                suppressionKey: config.trigger.suppressionKey,
                timeoutMs: config.trigger.timeoutMs,
            },
            {
                onStateChange: (session) => controller.onStateChange(session),
                onUpdate: (session) => controller.onUpdate(session),
                onComplete: (session) => controller.onComplete(session),
                onCancel: (session) => controller.onCancel(session),
            },
            {
                shouldIgnoreTarget: this.shouldIgnoreTarget,
            },
        );
        this.adapter.attach(this.target);

        // --- Touchpad path (independent lifecycle) ---
        this.startTouchpad(config, overlay);

        this.state = "running";
    }

    /** Start the touchpad provider + adapter when the feature is enabled. */
    private startTouchpad(
        config: GestureFlowConfig,
        overlay: GestureOverlay,
    ): void {
        // Always probe and publish the *potential* provider so the settings
        // page shows the real provider ("Electron 事件观察", "Windows 原生",
        // or "无") even while the touchpad feature is still disabled.  The
        // probe provider is never started — constructing it has no side
        // effects; only its capabilities are read.
        const probeProvider = createTouchpadProvider({});
        publishTouchpadCapabilities(probeProvider.capabilities);

        if (!config.touchpad.enabled) {
            return;
        }
        const trackerConfig = this.toTrackerConfig(config);
        const { kinds, minFingerCount, allowedFingerCounts } = touchpadKindsFromBindings(config.bindings);

        const feedback = new TouchpadFeedbackController(overlay, this.i18n);
        this.touchpadFeedback = feedback;

        const adapter = new TouchpadGestureAdapter(
            (providerEvents) => createTouchpadProvider(providerEvents),
            {
                onTerminal: (result) => {
                    this.handleTouchpadTerminal(config, result);
                },
                onLive: (live) => {
                    // While the settings recorder is active it renders its own
                    // trail — never draw a second one on the shared overlay.
                    if (!isTouchpadRecording()) {
                        feedback.onLive(live);
                    }
                    this.publishFrame();
                },
                onStatus: (capabilities) => {
                    // Capabilities are low-frequency state — ALWAYS stored so
                    // a settings page that opens later shows the real provider
                    // instead of "无".
                    publishTouchpadCapabilities(capabilities);
                },
                onFrame: (frame) => {
                    // Forward every raw frame to the settings recorder bus
                    // (only when a recorder subscriber exists — cheap at idle).
                    if (hasTouchpadRawFrameListeners()) {
                        publishTouchpadRawFrame(frame);
                    }
                },
                onError: (err) => {
                    // Provider init / native failure — the mouse path is
                    // unaffected.  Logging is delegated to index.ts.
                    this.onTouchpadError(err.label);
                },
            },
            trackerConfig,
        );
        adapter.setEnabledKinds(kinds, minFingerCount, allowedFingerCounts);
        this.touchpadAdapter = adapter;
        adapter.attach();
        // Belt-and-braces: publish the provider snapshot right away (the
        // provider's onStatus fires synchronously in start(), but this also
        // covers providers that only report asynchronously).
        publishTouchpadCapabilities(adapter.capabilities);

        // While the Touchpad settings tab is open, poll the native
        // diagnostics so WM_INPUT / HID report / descriptor state updates
        // even when no complete contact frame has been delivered.
        this.unsubscribeTouchpadPolling = subscribeTouchpadDiagnosticsPolling((active) => {
            this.setTouchpadPolling(active);
        });
    }

    /** Start/stop the ~300 ms native-diagnostics poll. */
    private setTouchpadPolling(active: boolean): void {
        if (this.touchpadPollTimer !== null) {
            clearInterval(this.touchpadPollTimer);
            this.touchpadPollTimer = null;
        }
        if (!active) return;
        this.touchpadPollTimer = setInterval(() => {
            const adapter = this.touchpadAdapter;
            if (!adapter) return;
            // Re-read capabilities (live getter) which embeds fresh parser
            // diagnostics from native.getDiagnostics().
            publishTouchpadCapabilities(adapter.capabilities);
        }, 300);
    }

    private toTrackerConfig(config: GestureFlowConfig): Partial<TouchpadTrackerConfig> {
        return {
            tapMaxDurationMs: config.touchpad.tapMaxDurationMs,
            tapMaxMovement: config.touchpad.tapMaxMovement,
            holdDurationMs: config.touchpad.holdDurationMs,
            holdMaxMovement: config.touchpad.holdMaxMovement,
            swipeMinDistance: config.touchpad.swipeMinDistance,
            shapeMinPathLength: config.touchpad.shapeMinPathLength,
            anchorMaxDrift: config.touchpad.anchorMaxDrift,
            anchorDrawActivation: config.touchpad.anchorDrawActivation,
            pinchThreshold: config.touchpad.pinchThreshold,
            rotateThresholdDeg: config.touchpad.rotateThresholdDeg,
            cooldownMs: config.touchpad.cooldownMs,
            directionMode: config.recognizer.directionMode,
        };
    }

    /**
     * A physical touchpad gesture ended (terminal signal; valid OR invalid).
     *
     * The visual lifecycle ALWAYS terminates here FIRST — a gesture that was
     * already shown on the overlay must get exactly one terminal feedback
     * (complete → delayed hide, or invalid → immediate hide).  Every action
     * gate below (descriptor, capability, safe-mode, signature, binding,
     * dispatch) must NEVER be able to leave a stale trail on the overlay.
     */
    private handleTouchpadTerminal(config: GestureFlowConfig, result: TouchpadRecognitionResult): void {
        this.touchpadFeedback?.onComplete(result);

        // Invalid results are terminal for feedback only — never dispatched.
        if (!result.valid) {
            return;
        }

        const dispatcher = this.dispatcher;
        if (!dispatcher) return;

        const spec = TouchpadGestureAdapter.resultToDescriptor(result);
        if (!spec) return;

        // Provider capability gate: never dispatch what the provider cannot
        // actually deliver.
        const caps = this.touchpadAdapter?.capabilities;
        if (caps && !providerSupportsKind(spec, caps)) {
            return;
        }

        // Safe-mode gate: 1/2-finger gestures stay with the system.
        const decision = dispatchAllowed(spec, config.touchpad.safeMode);
        if (!decision.allowed) {
            return;
        }

        const signature = TouchpadGestureAdapter.resultSignature(result);
        if (!signature) return;

        // No enabled binding → no action.  (Feedback already terminated above;
        // an unbound gesture simply shows its final descriptor and hides.)
        if (!dispatcher.hasEnabledBinding(signature)) return;

        void dispatcher.dispatchTouchpad({
            sessionId: ++this.touchpadSessionCounter,
            signature,
            directions: result.directions.slice(),
            points: result.points ?? [],
            durationMs: null,
        });
    }

    /** Throttled live-frame publication for the settings test area. */
    private publishFrame(): void {
        const adapter = this.touchpadAdapter;
        if (!adapter) return;
        const now = performance.now();
        if (now - this.lastDiagnosticsPublish < 33) {
            return; // ~30 Hz cap — never one publish per raw frame
        }
        this.lastDiagnosticsPublish = now;
        const live = adapter.getLiveState();
        publishTouchpadFrame({
            timestamp: now,
            contacts: live.contacts.map((c) => ({
                id: c.id,
                x: c.x,
                y: c.y,
                touching: c.touching,
            })),
            contactCount: adapter.contactCount ?? undefined,
            displayPath: live.displayPath.map((p) => ({ x: p.x, y: p.y })),
            displayContactPaths: live.displayContactPaths.map((c) => ({
                id: c.id,
                points: c.points.map((p) => ({ x: p.x, y: p.y })),
            })),
            event: adapter.eventDetail,
            eventLabel: adapter.eventLabel,
            currentKind: live.currentKind ?? null,
            stage: live.stage,
            releaseWatchdogActive: adapter.releaseWatchdogActive,
            releaseTailCount: live.releaseTailCount,
        });
    }

    /**
     * Tear down all owned components.  Idempotent.
     */
    private doStop(): void {
        if (this.touchpadPollTimer !== null) {
            clearInterval(this.touchpadPollTimer);
            this.touchpadPollTimer = null;
        }
        if (this.unsubscribeTouchpadPolling) {
            this.unsubscribeTouchpadPolling();
            this.unsubscribeTouchpadPolling = null;
        }
        if (this.adapter) {
            this.adapter.detach();
            this.adapter = null;
        }
        if (this.touchpadAdapter) {
            this.touchpadAdapter.detach();
            this.touchpadAdapter = null;
        }
        if (this.controller) {
            this.controller.destroy();
            this.controller = null;
        }
        if (this.touchpadFeedback) {
            this.touchpadFeedback.destroy();
            this.touchpadFeedback = null;
        }
        if (this.commandExecutor) {
            this.commandExecutor.reset();
            this.commandExecutor = null;
        }
        if (this.shortcutExecutor) {
            this.shortcutExecutor = null;
        }
        this.dispatcher = null;
    }

    /**
     * Convert config-layer bindings to runtime-layer (signature-keyed) ones.
     */
    private toGestureBindings(bindings: readonly ConfigBinding[]): GestureBinding[] {
        return bindings.map((b) => {
            const signature = bindingSignatureOf(b);
            return {
                id: b.id,
                enabled: b.enabled,
                signature,
                directions: bindingDirectionsOf(b),
                action:
                    b.action.type === "builtin"
                        ? {
                              type: "builtin",
                              commandId: b.action.commandId,
                              commandParams: { ...b.action.commandParams },
                          }
                        : {
                              type: "shortcut",
                              title: b.action.title,
                              shortcut: { ...b.action.shortcut },
                          },
            };
        });
    }

    private async handleGestureComplete(
        session: GestureSession,
        result: RecognitionResult,
    ): Promise<void> {
        const dispatcher = this.dispatcher;
        if (!dispatcher) return;
        await dispatcher.dispatch(session, result);
    }
}

/** Canonical signature of a config binding. */
function bindingSignatureOf(b: ConfigBinding): GestureSignatureKey {
    if (b.source === "mouse") {
        const g = b.gesture as import("@/config/types").MouseShapeGestureSpec;
        return mouseSignature(g.button, g.directions);
    }
    return touchpadSignature(b.gesture as TouchpadGestureSpec);
}

/** Direction sequence of a binding (empty when not direction-bearing). */
function bindingDirectionsOf(b: ConfigBinding): readonly import("@/gesture/recognition/DirectionVectorizer").Direction[] {
    if (b.source === "mouse") {
        const g = b.gesture as import("@/config/types").MouseShapeGestureSpec;
        return g.directions;
    }
    const spec = b.gesture as TouchpadGestureSpec;
    return hasDirections(spec) ? specDirections(spec) : [];
}

/** The set of touchpad gesture kinds bound + finger-count acquisition rules. */
function touchpadKindsFromBindings(bindings: readonly ConfigBinding[]): {
    kinds: Set<TouchpadGestureKind>;
    minFingerCount: number;
    allowedFingerCounts: Set<number> | undefined;
} {
    const kinds = new Set<TouchpadGestureKind>();
    const allowedFingerCounts = new Set<number>();
    let minFingerCount = Number.POSITIVE_INFINITY;
    for (const b of bindings) {
        if (b.source !== "touchpad") continue;
        const spec = b.gesture as TouchpadGestureSpec;
        if (!b.enabled) continue;
        kinds.add(spec.kind);
        allowedFingerCounts.add(spec.fingerCount);
        if (spec.fingerCount < minFingerCount) minFingerCount = spec.fingerCount;
    }
    if (minFingerCount === Number.POSITIVE_INFINITY) minFingerCount = 1;
    return {
        kinds,
        minFingerCount,
        allowedFingerCounts: allowedFingerCounts.size > 0 ? allowedFingerCounts : undefined,
    };
}
