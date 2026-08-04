import { Plugin, getFrontend, getBackend } from "siyuan";
import "./index.scss";
import { MouseGestureAdapter } from "@/gesture/input/MouseGestureAdapter";
import { DEFAULT_TRIGGER } from "@/gesture/types";
import { GestureEngine } from "@/gesture/GestureEngine";
import { GestureFeedbackController } from "@/gesture/GestureFeedbackController";
import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { OverlayI18n } from "@/gesture/overlay/types";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { CommandExecutor } from "@/commands/CommandExecutor";
import { SiyuanActionBridge } from "@/commands/SiyuanActionBridge";
import { GestureCommandDispatcher } from "@/commands/GestureCommandDispatcher";
import { registerBuiltinCommands } from "@/commands/registerBuiltinCommands";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "@/gesture/bindings/defaultBindings";
import { createCommandLabelResolver } from "@/gesture/bindings/CommandLabelResolver";
import { GestureSession } from "@/gesture/GestureSession";
import { RecognitionResult } from "@/gesture/GestureEngine";

/** Whether the plugin is running in development mode (concise debug logs). */
const IS_DEV = process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";

/**
 * GestureFlow plugin entry.
 *
 * Stage 4 wires the command registry, gesture bindings, and the
 * SiyuanActionBridge to the existing feedback controller.  When a
 * gesture completes, the bound command is executed exactly once via
 * the {@link GestureCommandDispatcher}.
 *
 * Responsibilities kept in this file:
 * - Instance creation and wiring.
 * - Adapter → controller callback connection.
 * - Concise development-only logging (sessionId, commandId, status).
 * - Unload cleanup.
 *
 * All dispatch decisions live in {@link GestureCommandDispatcher}; this
 * file does not inspect session state or recognition results directly.
 */
export default class GestureFlowPlugin extends Plugin {
    private adapter: MouseGestureAdapter | null = null;
    private controller: GestureFeedbackController | null = null;
    private dispatcher: GestureCommandDispatcher | null = null;
    private commandExecutor: CommandExecutor | null = null;

    onload(): void {
        if (IS_DEV) {
            console.log(`[${this.name}] loading (frontend: ${getFrontend()}, backend: ${getBackend()})`);
        }

        if (typeof document === "undefined") {
            return; // non-DOM environment, nothing to attach
        }

        // --- Command system ---
        const bridge = new SiyuanActionBridge();

        const commandRegistry = new CommandRegistry();
        registerBuiltinCommands(commandRegistry, bridge);

        const commandExecutor = new CommandExecutor(commandRegistry);
        this.commandExecutor = commandExecutor;

        // --- Gesture bindings ---
        const bindingRegistry = new GestureBindingRegistry(commandRegistry);
        bindingRegistry.registerMany(DEFAULT_BINDINGS);

        // --- Dispatcher (owns the dispatch decision tree) ---
        const dispatcher = new GestureCommandDispatcher(bindingRegistry, commandExecutor);
        this.dispatcher = dispatcher;

        // --- Feedback controller ---
        const engine = new GestureEngine();

        const overlayI18n: OverlayI18n = {
            gestureTooLong: this.i18n?.gestureTooLong ?? "Gesture too long",
            gestureUnrecognised: this.i18n?.gestureUnrecognised ?? "Unrecognised",
        };

        const overlay = new GestureOverlay(overlayI18n);
        const commandLabelResolver = createCommandLabelResolver(
            bindingRegistry,
            this.i18n ?? {},
        );

        const controller = new GestureFeedbackController({
            engine,
            overlay,
            commandLabelResolver,
            onGestureComplete: (session, result) => {
                // Fire-and-forget — the dispatcher's promise never rejects
                // (the executor converts all errors into `failed` results).
                // Awaited only to log the outcome in dev mode.
                void this.handleGestureComplete(session, result);
            },
        });
        this.controller = controller;

        // --- Input adapter ---
        this.adapter = new MouseGestureAdapter(DEFAULT_TRIGGER, {
            onStateChange: (session) => {
                if (IS_DEV) {
                    console.debug(`[${this.name}] state -> ${session.state}`);
                }
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
                if (IS_DEV) {
                    console.debug(`[${this.name}] gesture cancelled (${session.cancelReason})`);
                }
            },
        });
        this.adapter.attach(document);
    }

    /**
     * Handle a completed gesture by dispatching the bound command.
     *
     * Delegates all decision logic to {@link GestureCommandDispatcher}.
     * This method only logs a concise outcome line in dev mode — it
     * never prints session points, DOM, or full result objects.
     */
    private async handleGestureComplete(
        session: GestureSession,
        result: RecognitionResult,
    ): Promise<void> {
        const dispatcher = this.dispatcher;
        if (!dispatcher) return;

        const dispatchResult = await dispatcher.dispatch(session, result);

        if (IS_DEV) {
            if (dispatchResult.status === "executed") {
                console.debug(
                    `[${this.name}] session ${session.id} → ${dispatchResult.commandId} → ${dispatchResult.result.status}`,
                );
            } else {
                console.debug(
                    `[${this.name}] session ${session.id} skipped: ${dispatchResult.reason}`,
                );
            }
        }
    }

    onunload(): void {
        this.adapter?.detach();
        this.adapter = null;
        this.controller?.destroy();
        this.controller = null;
        this.dispatcher = null;
        this.commandExecutor?.reset();
        this.commandExecutor = null;
        if (IS_DEV) {
            console.log(`[${this.name}] unloading`);
        }
    }
}
