import { GestureFlowConfig } from "@/config/types";
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
import { ConfigBinding } from "@/config/types";
import { GestureBinding } from "@/gesture/bindings/types";
import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";

/** Whether the plugin is running in development mode (concise debug logs). */
const IS_DEV = process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";

/**
 * Runtime state.
 *
 * - `stopped`  — no input listeners, no overlay, no command dispatch.
 * - `running`  — all components are attached and the gesture pipeline is
 *                active.
 * - `disabled` — the runtime was created with `enabled: false` (or
 *                restarted with such a config).  No input listeners are
 *                attached.  This is distinct from `stopped` so callers
 *                can distinguish "explicitly off" from "not yet started".
 */
export type RuntimeState = "stopped" | "running" | "disabled";

/**
 * Outcome of a {@link GestureFlowRuntime.restart} attempt.
 *
 * - `applied`   — the new config is now active; the previous runtime was
 *                 fully stopped first.
 * - `rolled-back` — the new config started but immediately failed; the
 *                 runtime attempted to restore the previous config and
 *                 reported the outcome via {@link rollbackConfig}.
 * - `failed`    — neither the new config nor the rollback could produce
 *                 a running runtime; the runtime is left in `stopped`.
 */
export type RestartResult =
    | { status: "applied"; config: GestureFlowConfig }
    | { status: "rolled-back"; config: GestureFlowConfig; rollbackConfig: GestureFlowConfig; error: string }
    | { status: "failed"; error: string };

/**
 * Options for constructing a {@link GestureFlowRuntime}.
 *
 * The runtime does not depend on `Plugin` directly — only on the DOM
 * target (usually `document`) and the i18n strings needed by the overlay.
 * This keeps it testable in isolation.
 */
export interface GestureFlowRuntimeOptions {
    /** DOM target the input adapter attaches to (typically `document`). */
    target: EventTarget;
    /** Localised strings for the overlay hint. */
    overlayI18n: OverlayI18n;
    /** i18n map used by the command label resolver. */
    i18n: Record<string, string>;
    /**
     * Optional SiYuan `App` provider forwarded to the
     * {@link SiyuanActionBridge} for `globalCommand`-based actions
     * (e.g. restore recently closed tab).  May be absent for probe/
     * test environments — app-dependent actions return `unavailable`.
     */
    app?: Parameters<typeof globalCommand>[1] | null;
    /**
     * Override the input-target exclusion predicate passed to the mouse
     * adapter.  Defaults to {@link defaultGestureIgnoreTarget}: elements
     * marked with `data-gesture-flow-recorder` (the settings gesture
     * recorder) are excluded so recording right-clicks never trigger
     * real gesture commands.
     */
    shouldIgnoreTarget?: (target: EventTarget | null) => boolean;
    /**
     * Optional dev-mode logger.  Defaults to a no-op in production and
     * `console.debug` in dev mode.  Receives concise outcome lines
     * (sessionId, commandId, status) — never full session points, DOM
     * objects, or credentials.
     */
    onLog?: (message: string) => void;
}

/**
 * Default input-target exclusion: targets inside an element marked with
 * `data-gesture-flow-recorder` are ignored by the global gesture
 * adapter.  The settings gesture recorder uses this marker so recording
 * with the right button never starts a real gesture or opens SiYuan's
 * context menu.  The filter is generic (marker-based) — it knows
 * nothing about directions or commands, and disappears with the
 * recorder DOM when the settings dialog closes.
 */
export function defaultGestureIgnoreTarget(target: EventTarget | null): boolean {
    return (
        target instanceof Element &&
        target.closest("[data-gesture-flow-recorder]") !== null
    );
}

/**
 * Owns the full gesture pipeline lifecycle.
 *
 * The runtime is the single place where `MouseGestureAdapter`,
 * `GestureFeedbackController`, `GestureOverlay`, `GestureEngine`,
 * `CommandRegistry`, `CommandExecutor`, `GestureActionExecutor`, and
 * `GestureBindingRegistry` are constructed and wired together.  Callers
 * (index.ts) only need to call {@link start} / {@link restart} / {@link stop}.
 *
 * Lifecycle guarantees:
 *
 * - {@link start} is idempotent — calling it twice with the same config
 *   does not create a second set of listeners or a second Canvas.
 * - {@link stop} is idempotent — it fully tears down the adapter
 *   (pointer listeners, contextmenu protection window, pending replay
 *   microtasks, RAF, timers) and the overlay (Canvas + hint element).
 * - {@link restart} always performs a full `stop` before `start` with
 *   the new config.  There is never a moment where two adapters or two
 *   Canvas elements coexist.
 * - When the config has `enabled: false`, {@link start} enters the
 *   `disabled` state without attaching any input listeners or creating
 *   any overlay.  A subsequent {@link restart} with `enabled: true`
 *   performs a full start.
 * - The adapter's `detach` invalidates old protection timers and replay
 *   tokens via generation counters, so any contextmenu replay microtask
 *   that was queued before the restart silently aborts.
 */
export class GestureFlowRuntime {
    private readonly target: EventTarget;
    private readonly overlayI18n: OverlayI18n;
    private readonly i18n: Record<string, string>;
    private readonly onLog: (message: string) => void;
    private readonly shouldIgnoreTarget: (target: EventTarget | null) => boolean;
    /** App provider forwarded to the action bridge (may be null). */
    private readonly app: Parameters<typeof globalCommand>[1] | null;

    private state: RuntimeState = "stopped";
    private config: GestureFlowConfig | null = null;

    // Owned components (created on start, destroyed on stop).
    private adapter: MouseGestureAdapter | null = null;
    private controller: GestureFeedbackController | null = null;
    private dispatcher: GestureActionExecutor | null = null;
    private commandExecutor: CommandExecutor | null = null;
    private shortcutExecutor: ShortcutExecutor | null = null;

    constructor(opts: GestureFlowRuntimeOptions) {
        this.target = opts.target;
        this.overlayI18n = opts.overlayI18n;
        this.i18n = opts.i18n;
        this.onLog = opts.onLog ?? defaultLog;
        this.shouldIgnoreTarget = opts.shouldIgnoreTarget ?? defaultGestureIgnoreTarget;
        this.app = opts.app ?? null;
    }

    /** Current runtime state. */
    getState(): RuntimeState {
        return this.state;
    }

    /**
     * Start the runtime with the given configuration.
     *
     * Idempotent: if already running with a config, calling `start`
     * again is a no-op (use {@link restart} to apply a new config).
     * If the config has `enabled: false`, the runtime enters the
     * `disabled` state without attaching any listeners.
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

    /**
     * Stop the runtime and tear down all components.
     *
     * Idempotent.  After `stop`, the runtime is in the `stopped` state
     * and can be started again with a fresh config.
     */
    stop(): void {
        this.doStop();
        this.state = "stopped";
        this.config = null;
    }

    /**
     * Restart the runtime with a new configuration.
     *
     * Always performs a full {@link stop} before {@link start} so there
     * is never a moment where two adapters or two Canvas elements
     * coexist.  If the new config fails to start, the runtime attempts
     * to restore the previous config; if that also fails, the runtime
     * is left in `stopped`.
     */
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
            // Attempt to roll back to the previous config.
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
                    // Rollback also failed — fall through to total failure.
                }
            }
            this.doStop();
            this.state = "stopped";
            this.config = null;
            return { status: "failed", error: label };
        }
    }

    // --------------------------------------------------------------- internals

    /**
     * Perform the actual start.  Assumes `config.enabled === true` and
     * the runtime is currently `stopped`.  Creates every component,
     * wires them together, and attaches the input adapter.
     */
    private doStart(config: GestureFlowConfig): void {
        if (typeof document === "undefined") {
            // Non-DOM environment (e.g. unit test without happy-dom) —
            // nothing to attach.  Mark as running so callers see the
            // intent, but no listeners are registered.
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
        const bindings = this.toGestureBindings(config.bindings);
        bindingRegistry.registerMany(bindings);

        // --- Action dispatcher (builtin commands + keyboard shortcuts) ---
        const shortcutExecutor = new ShortcutExecutor();
        this.shortcutExecutor = shortcutExecutor;
        const dispatcher = new GestureActionExecutor(
            bindingRegistry,
            commandExecutor,
            shortcutExecutor,
        );
        this.dispatcher = dispatcher;

        // --- Feedback controller ---
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
            { commandTitles },
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

        // --- Input adapter ---
        this.adapter = new MouseGestureAdapter(
            {
                button: config.trigger.button,
                activationDistance: config.trigger.activationDistance,
                suppressionKey: config.trigger.suppressionKey,
                timeoutMs: config.trigger.timeoutMs,
            },
            {
                onStateChange: (session) => {
                    this.onLog(`state -> ${session.state}`);
                    controller.onStateChange(session);
                },
                onUpdate: (session) => {
                    controller.onUpdate(session);
                },
                onComplete: (session) => {
                    controller.onComplete(session);
                },
                onCancel: (session) => {
                    controller.onCancel(session);
                    this.onLog(`gesture cancelled (${session.cancelReason})`);
                },
            },
            {
                shouldIgnoreTarget: this.shouldIgnoreTarget,
            },
        );
        this.adapter.attach(this.target);

        this.state = "running";
    }

    /**
     * Tear down all owned components.  Idempotent — safe to call even
     * when nothing is currently running.
     *
     * Order matters: the adapter is detached first so no new pointer
     * events can arrive while the controller and overlay are being
     * destroyed.  Detaching the adapter also invalidates any pending
     * contextmenu replay microtask via the adapter's lifecycle
     * generation counter, so a queued replay from the previous
     * interaction silently aborts instead of firing after the new
     * runtime is started.
     */
    private doStop(): void {
        if (this.adapter) {
            this.adapter.detach();
            this.adapter = null;
        }
        if (this.controller) {
            this.controller.destroy();
            this.controller = null;
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
     * Convert config-layer bindings to runtime-layer bindings.
     *
     * Config bindings use plain `Direction[]` and `commandParams`; the
     * runtime binding type is structurally identical but declared in a
     * separate module so the config layer does not depend on the
     * runtime.  This helper performs the trivial shape cast without
     * copying — the binding registry makes its own deep copies on
     * `registerMany`.
     */
    /**
     * Convert config-layer bindings to runtime-layer bindings.
     *
     * Config bindings use plain `Direction[]` and a nested `action`; the
     * runtime binding type is structurally identical but declared in a
     * separate module so the config layer does not depend on the
     * runtime.  The conversion is inlined (not delegated to a shared
     * helper) so the bundled runtime never depends on a cross-module
     * function reference that tree-shaking could drop.
     */
    private toGestureBindings(bindings: readonly ConfigBinding[]): GestureBinding[] {
        return bindings.map((b) => ({
            id: b.id,
            enabled: b.enabled,
            directions: b.directions.slice(),
            action:
                b.action.type === "builtin"
                    ? {
                          type: "builtin",
                          commandId: b.action.commandId,
                          commandParams: { ...b.action.commandParams },
                      }
                    : {
                          type: "shortcut",
                          shortcut: { ...b.action.shortcut },
                      },
        }));
    }

    /**
     * Handle a completed gesture by dispatching the bound command.
     *
     * Delegates all decision logic to {@link GestureCommandDispatcher}.
     * This method only logs a concise outcome line — it never prints
     * session points, DOM, or full result objects.
     */
    private async handleGestureComplete(
        session: GestureSession,
        result: RecognitionResult,
    ): Promise<void> {
        const dispatcher = this.dispatcher;
        if (!dispatcher) return;

        const dispatchResult = await dispatcher.dispatch(session, result);

        if (dispatchResult.status === "executed") {
            const detail =
                dispatchResult.actionType === "builtin"
                    ? dispatchResult.commandId
                    : "shortcut";
            this.onLog(
                `session ${session.id} → ${detail} → ${dispatchResult.result.status}`,
            );
        } else {
            this.onLog(
                `session ${session.id} skipped: ${dispatchResult.reason}`,
            );
        }
    }
}

/**
 * Default dev-mode logger.  In production IS_DEV is false so this is a
 * no-op; in dev mode it routes concise outcome lines to `console.debug`.
 */
function defaultLog(message: string): void {
    if (IS_DEV) {
        console.debug(`[GestureFlow] ${message}`);
    }
}
