import { Plugin, getFrontend, getBackend } from "siyuan";
import "./index.scss";
import { MouseGestureAdapter } from "@/gesture/input/MouseGestureAdapter";
import { DEFAULT_TRIGGER } from "@/gesture/types";
import { GestureEngine } from "@/gesture/GestureEngine";
import { GestureFeedbackController } from "@/gesture/GestureFeedbackController";
import { GestureOverlay } from "@/gesture/overlay/GestureOverlay";
import { OverlayI18n } from "@/gesture/overlay/types";

/** Whether the plugin is running in development mode (concise debug logs). */
const IS_DEV = process.env.DEV_MODE === "true" || process.env.NODE_ENV === "development";

/**
 * GestureFlow plugin entry.
 *
 * Stage 3 wires the visual feedback layer (Canvas trail + hint) to the
 * gesture input and recognition pipeline.  The {@link GestureFeedbackController}
 * coalesces high-frequency pointer events into a single RAF-driven redraw
 * and live recognition pass.
 */
export default class GestureFlowPlugin extends Plugin {
    private adapter: MouseGestureAdapter | null = null;
    private controller: GestureFeedbackController | null = null;

    onload(): void {
        console.log(`[${this.name}] loading`, this.i18n);
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);

        if (typeof document === "undefined") {
            return; // non-DOM environment, nothing to attach
        }

        const engine = new GestureEngine();

        const overlayI18n: OverlayI18n = {
            gestureTooLong: this.i18n?.gestureTooLong ?? "Gesture too long",
            gestureUnrecognised: this.i18n?.gestureUnrecognised ?? "Unrecognised",
        };

        const overlay = new GestureOverlay(overlayI18n);
        const controller = new GestureFeedbackController(engine, overlay);
        this.controller = controller;

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
                if (IS_DEV) {
                    const result = engine.recognize(session);
                    console.debug(
                        `[${this.name}] gesture complete: ${result.valid ? `[${result.directions.join(", ")}]` : `invalid (${result.invalidReason})`}`,
                    );
                }
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

    onunload(): void {
        this.adapter?.detach();
        this.adapter = null;
        this.controller?.destroy();
        this.controller = null;
        console.log(`[${this.name}] unloading`);
    }
}
