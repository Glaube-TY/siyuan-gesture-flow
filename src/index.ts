import { Plugin, getFrontend, getBackend } from "siyuan";
import "./index.scss";

/**
 * GestureFlow plugin entry.
 *
 * Stage 0 only ensures the plugin loads/unloads cleanly.
 * Gesture input, recognition, overlay and actions are added in later stages.
 */
export default class GestureFlowPlugin extends Plugin {
    onload(): void {
        console.log(`[${this.name}] loading`, this.i18n);
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);
    }

    onunload(): void {
        console.log(`[${this.name}] unloading`);
    }
}
