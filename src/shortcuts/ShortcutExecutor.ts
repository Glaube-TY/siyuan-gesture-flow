import type { ShortcutSpec } from "./types";
import { eventKeyFor } from "./shortcutUtils";

/**
 * Sends synthetic keyboard shortcuts (stage 6A).
 *
 * This executor is UI-independent: it only knows how to turn a
 * {@link ShortcutSpec} into a synthetic `keydown` KeyboardEvent and
 * dispatch it.  It never touches the settings UI, the config, or the
 * runtime.
 *
 * Dispatch semantics:
 * - The target is the current `document.activeElement` when available,
 *   falling back to `document` otherwise.
 * - The event is `bubbles: true` and `cancelable: true`.
 * - `key` reflects real keyboard semantics rebuilt from the persisted
 *   base key + modifiers (`1`+Shift → `!`, letters+Shift → uppercase)
 *   via {@link eventKeyFor}; `code` / `keyCode` stay the physical base
 *   key's values.
 * - `keyCode` and `which` are set to the spec's numeric key code.  Some
 *   environments drop these read-only fields in the constructor, so a
 *   local, tested compatibility fill is applied — the globals
 *   (`KeyboardEvent.prototype`) are never patched.
 * - Only a single `keydown` is sent per dispatch (no `keyup`, no
 *   `click`), and no real system-level keystrokes are ever sent.
 *
 * Result semantics:
 * - `dispatched`: the event was dispatched to a target.  Dispatching a
 *   synthetic event does NOT mean any plugin handled it — `isTrusted`
 *   is inherently false and some plugins reject synthetic events.
 * - `unavailable`: no dispatch target could be picked.
 * - `failed`: dispatch threw.
 */
export type ShortcutExecutionResult =
    | { status: "dispatched"; target: string }
    | { status: "unavailable"; reason: string }
    | { status: "failed"; reason: string; error?: string };

export class ShortcutExecutor {
    /**
     * Dispatch one synthetic keydown for the given shortcut.
     *
     * @returns the execution result — never throws.
     */
    dispatch(spec: ShortcutSpec): ShortcutExecutionResult {
        try {
            const target = this.pickTarget();
            if (!target) {
                return { status: "unavailable", reason: "no dispatch target" };
            }

            const event = this.buildKeydownEvent(spec);
            target.dispatchEvent(event);
            return { status: "dispatched", target: this.describeTarget(target) };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return { status: "failed", reason: "dispatch threw", error };
        }
    }

    /**
     * Pick the dispatch target: the current focused element when it is a
     * usable EventTarget, otherwise the document.
     */
    private pickTarget(): EventTarget | null {
        if (typeof document === "undefined") {
            return null;
        }
        const active = document.activeElement;
        if (active && typeof (active as EventTarget).dispatchEvent === "function") {
            return active as EventTarget;
        }
        return document;
    }

    private describeTarget(target: EventTarget): string {
        if (target === document) return "document";
        if (target instanceof HTMLElement) {
            const name = target.tagName.toLowerCase();
            const id = target.id ? `#${target.id}` : "";
            return `${name}${id}`;
        }
        return "activeElement";
    }

    private buildKeydownEvent(spec: ShortcutSpec): KeyboardEvent {
        const event = new KeyboardEvent("keydown", {
            key: eventKeyFor(spec),
            code: spec.code,
            bubbles: true,
            cancelable: true,
            composed: true,
            ctrlKey: spec.ctrlKey,
            altKey: spec.altKey,
            shiftKey: spec.shiftKey,
            metaKey: spec.metaKey,
            repeat: false,
        });
        // The spec is the authority for the numeric key code.  Some
        // environments do not preserve the read-only keyCode/which from
        // the constructor — fill them on the instance only, never on the
        // prototype.
        const specKeyCode = spec.keyCode;
        if (event.keyCode !== specKeyCode) {
            Object.defineProperty(event, "keyCode", {
                value: specKeyCode,
                configurable: true,
            });
        }
        if (event.which !== specKeyCode) {
            Object.defineProperty(event, "which", {
                value: specKeyCode,
                configurable: true,
            });
        }
        // Human-readable key for listeners that read e.key.  The stored
        // canonical key is the physical base; real keyboards report the
        // shifted variant under Shift ("!" for 1+Shift, "P" for
        // p+Shift), so eventKeyFor restores it.  Everything else (F6,
        // ArrowLeft, Space…) keeps its canonical form — display-only
        // transformations never leak into the event.
        const eventKey = eventKeyFor(spec);
        if (event.key !== eventKey) {
            Object.defineProperty(event, "key", {
                value: eventKey,
                configurable: true,
            });
        }
        return event;
    }
}
