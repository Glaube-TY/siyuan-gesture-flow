import { Plugin, getFrontend, getBackend } from "siyuan";
import "./index.scss";
import { MouseGestureAdapter } from "@/gesture/input/MouseGestureAdapter";
import { DEFAULT_TRIGGER } from "@/gesture/types";
import { GestureEngine } from "@/gesture/GestureEngine";

/**
 * GestureFlow plugin entry.
 *
 * Stage 2 wires the GestureEngine to the mouse gesture input layer. When a
 * gesture completes, the engine runs the full recognition pipeline
 * (sample → simplify → vectorize → match) and logs the resulting direction
 * sequence to the console. No actions are executed yet.
 */
export default class GestureFlowPlugin extends Plugin {
    private adapter: MouseGestureAdapter | null = null;
    private engine: GestureEngine | null = null;

    onload(): void {
        console.log(`[${this.name}] loading`, this.i18n);
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);

        if (typeof document === "undefined") {
            return; // non-DOM environment, nothing to attach
        }

        this.engine = new GestureEngine();

        this.adapter = new MouseGestureAdapter(DEFAULT_TRIGGER, {
            onStateChange: (session) => {
                console.debug(`[${this.name}] state -> ${session.state}`, session.toJSON());
            },
            onComplete: (session) => {
                if (!this.engine) return;
                const result = this.engine.recognize(session);
                console.log(
                    `[${this.name}] gesture complete: ${result.valid ? `[${result.directions.join(", ")}]` : `invalid (${result.invalidReason})`}`,
                    { session: session.toJSON(), result },
                );
            },
            onCancel: (session) => {
                if (!this.engine) return;
                const result = this.engine.recognize(session);
                console.log(
                    `[${this.name}] gesture cancelled (${session.cancelReason}): ${result.valid ? `[${result.directions.join(", ")}]` : `invalid (${result.invalidReason})`}`,
                    { session: session.toJSON(), result },
                );
            },
        });
        this.adapter.attach(document);
    }

    onunload(): void {
        this.adapter?.detach();
        this.adapter = null;
        this.engine = null;
        console.log(`[${this.name}] unloading`);
    }
}
