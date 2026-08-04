import { GestureState, GestureTriggerConfig } from "../types";
import { GestureSession } from "../GestureSession";

/** Callbacks emitted by an input adapter as a gesture progresses. */
export interface GestureAdapterEvents {
    /** Fired whenever the session state changes. */
    onStateChange?(session: GestureSession): void;
    /** Fired when a new point is added during TRACKING. */
    onUpdate?(session: GestureSession): void;
    /** Fired when the gesture finishes normally (TRACKING -> COMPLETED). */
    onComplete?(session: GestureSession): void;
    /** Fired when the gesture is cancelled. */
    onCancel?(session: GestureSession): void;
}

/**
 * Abstract base for gesture input adapters.
 *
 * An adapter translates a specific class of DOM input (mouse, touchpad, ...)
 * into the common GestureSession state machine. Concrete adapters must attach
 * every listener in {@link attach} and remove every one of them in {@link detach}
 * so that the plugin can clean up fully on unload.
 */
export abstract class InputAdapter {
    protected readonly config: GestureTriggerConfig;
    protected readonly events: GestureAdapterEvents;
    protected session: GestureSession | null = null;

    constructor(config: GestureTriggerConfig, events: GestureAdapterEvents) {
        this.config = config;
        this.events = events;
    }

    /** Attach input listeners to the given target. */
    abstract attach(target: EventTarget): void;

    /** Remove all listeners and abort any in-progress gesture. */
    abstract detach(): void;

    /** Whether a gesture is currently in progress (PENDING or TRACKING). */
    get active(): boolean {
        const state = this.session?.state;
        return state === GestureState.PENDING || state === GestureState.TRACKING;
    }
}
