import { Plugin, getFrontend, getBackend } from "siyuan";
import "./index.scss";
import { MouseGestureAdapter } from "@/gesture/input/MouseGestureAdapter";
import { DEFAULT_TRIGGER } from "@/gesture/types";

/**
 * GestureFlow plugin entry.
 *
 * Stage 1 wires the mouse gesture input layer. The adapter drives the
 * IDLE -> PENDING -> TRACKING -> COMPLETED/CANCELLED state machine and only
 * logs the complete GestureSession to the console; no actions are executed yet.
 */
export default class GestureFlowPlugin extends Plugin {
    private adapter: MouseGestureAdapter | null = null;

    onload(): void {
        console.log(`[${this.name}] loading`, this.i18n);
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);

        if (typeof document === "undefined") {
            return; // non-DOM environment, nothing to attach
        }

        this.adapter = new MouseGestureAdapter(DEFAULT_TRIGGER, {
            onStateChange: (session) => {
                console.debug(`[${this.name}] state -> ${session.state}`, session.toJSON());
            },
            onComplete: (session) => {
                console.log(`[${this.name}] gesture complete`, session);
            },
            onCancel: (session) => {
                console.log(`[${this.name}] gesture cancelled (${session.cancelReason})`, session);
            },
        });
        this.adapter.attach(document);
    }

    onunload(): void {
        this.adapter?.detach();
        this.adapter = null;
        console.log(`[${this.name}] unloading`);
    }
}
