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
import { registerBuiltinCommands } from "@/commands/registerBuiltinCommands";
import { GestureBindingRegistry } from "@/gesture/bindings/GestureBindingRegistry";
import { DEFAULT_BINDINGS } from "@/gesture/bindings/defaultBindings";
import { createCommandLabelResolver } from "@/gesture/bindings/CommandLabelResolver";
import { buildCommandContext } from "@/commands/types";
import { GestureState } from "@/gesture/types";

/** Whether the plugin is running in development mode (concise debug logs). */
const IS_DEV = process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";

/**
 * GestureFlow plugin entry.
 *
 * Stage 4 wires the command registry, gesture bindings, and the
 * SiyuanActionBridge to the existing feedback controller.  When a
 * gesture completes, the bound command is executed exactly once.
 */
export default class GestureFlowPlugin extends Plugin {
    private adapter: MouseGestureAdapter | null = null;
    private controller: GestureFeedbackController | null = null;
    private commandExecutor: CommandExecutor | null = null;
    private bindingRegistry: GestureBindingRegistry | null = null;

    onload(): void {
        console.log(`[${this.name}] loading`, this.i18n);
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);

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
        this.bindingRegistry = bindingRegistry;

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
                this.handleGestureComplete(session, result);
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
     * Handle a completed gesture by executing the bound command.
     *
     * Execution conditions (all must be true):
     * - session.state === COMPLETED
     * - result.valid === true
     * - result.invalidReason === null
     * - result.directions non-empty
     * - an enabled binding exists for the directions
     * - the binding references a registered command
     */
    private async handleGestureComplete(
        session: { id: number; state: GestureState; points: { x: number; y: number; t: number }[]; durationMs: number | null },
        result: { valid: boolean; invalidReason: string | null; directions: string[]; rawPointCount: number; sampledPointCount: number; simplifiedPointCount: number },
    ): Promise<void> {
        // Guard: only execute for valid completed gestures.
        if (session.state !== GestureState.COMPLETED) return;
        if (!result.valid || result.invalidReason !== null) return;
        if (result.directions.length === 0) return;

        const bindingRegistry = this.bindingRegistry;
        const commandExecutor = this.commandExecutor;
        if (!bindingRegistry || !commandExecutor) return;

        const resolved = bindingRegistry.resolve(result.directions as never);
        if (!resolved) return;

        const context = buildCommandContext(
            session.id,
            session.points,
            result as never,
            session.durationMs,
        );

        const execResult = await commandExecutor.execute(
            resolved.command.id,
            context,
            resolved.binding.commandParams,
        );

        if (IS_DEV) {
            console.debug(
                `[${this.name}] session ${session.id} → ${resolved.command.id} → ${execResult.status}`,
            );
        }
    }

    onunload(): void {
        this.adapter?.detach();
        this.adapter = null;
        this.controller?.destroy();
        this.controller = null;
        this.commandExecutor?.reset();
        this.commandExecutor = null;
        this.bindingRegistry = null;
        console.log(`[${this.name}] unloading`);
    }
}
