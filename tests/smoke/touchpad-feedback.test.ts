import { describe, it, expect, vi, beforeEach } from "vitest";
import { TouchpadFeedbackController } from "../../src/gesture/touchpad/TouchpadFeedbackController";
import { GestureOverlay } from "../../src/gesture/overlay/GestureOverlay";
import { TouchpadGestureAdapter } from "../../src/gesture/touchpad/TouchpadGestureAdapter";
import { TouchpadRecognitionResult } from "../../src/gesture/touchpad/recognition/TouchpadGestureTracker";
import {
    TouchpadProvider,
    TouchpadProviderEvents,
    TouchpadFrame,
    TouchpadContact,
    TouchpadCapabilities,
} from "../../src/touchpad/types";
import { TouchpadGestureKind } from "../../src/gesture/touchpad/types";
import {
    isTouchpadRecording,
    setTouchpadRecording,
} from "../../src/runtime/TouchpadRuntimeState";

/**
 * Terminal feedback lifecycle smoke tests.
 *
 * The visual lifecycle of a touchpad gesture must NOT depend on whether a
 * binding exists or whether the final recognition is valid: a gesture that
 * was shown live must ALWAYS get a terminal feedback (complete → delayed
 * hide, or invalid → immediate hide).  The adapter must forward terminal
 * results (valid AND invalid) to the runtime, and the recorder gate must
 * suppress the shared overlay entirely.
 */

function mockOverlay(): {
    show: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    showFinalThenHide: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
} {
    return {
        show: vi.fn(),
        update: vi.fn(),
        hide: vi.fn(),
        showFinalThenHide: vi.fn(),
        destroy: vi.fn(),
    };
}

function validResult(): TouchpadRecognitionResult {
    return {
        valid: true,
        kind: "shape",
        fingerCount: 3,
        directions: ["R"],
        points: [
            { x: 0.1, y: 0.5 },
            { x: 0.9, y: 0.5 },
        ],
    };
}

function invalidResult(): TouchpadRecognitionResult {
    return {
        valid: false,
        kind: "tap",
        fingerCount: 3,
        directions: [],
        invalidReason: "too-short",
        points: [{ x: 0.5, y: 0.5 }],
    };
}

describe("touchpad feedback terminal lifecycle", () => {
    it("valid result → showFinalThenHide, never an immediate hide", () => {
        const overlay = mockOverlay();
        const controller = new TouchpadFeedbackController(overlay as unknown as GestureOverlay, {});
        controller.onComplete(validResult());
        expect(overlay.showFinalThenHide).toHaveBeenCalledTimes(1);
        expect(overlay.hide).not.toHaveBeenCalled();
    });

    it("invalid result → immediate hide, no delayed final", () => {
        const overlay = mockOverlay();
        const controller = new TouchpadFeedbackController(overlay as unknown as GestureOverlay, {});
        controller.onComplete(invalidResult());
        expect(overlay.hide).toHaveBeenCalledTimes(1);
        expect(overlay.showFinalThenHide).not.toHaveBeenCalled();
    });

    it("onCancel → immediate hide", () => {
        const overlay = mockOverlay();
        const controller = new TouchpadFeedbackController(overlay as unknown as GestureOverlay, {});
        controller.onCancel();
        expect(overlay.hide).toHaveBeenCalledTimes(1);
        expect(overlay.showFinalThenHide).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------- adapter side

class StubProvider extends TouchpadProvider {
    readonly id = "windows-native" as const;
    emit: ((frame: TouchpadFrame) => void) | null = null;

    get capabilities(): TouchpadCapabilities {
        return {
            providerType: "windows-native",
            platform: "test",
            precisionTouchpad: true,
            supportsRawContacts: true,
            multiContactGestures: true,
            maxContacts: 5,
            hardwareMaxContacts: 5,
            observedMaxContacts: 5,
            maxContactsKnown: true,
            supportsMultiFingerTap: true,
            supportsPress: false,
            canOverrideSystemGestures: false,
            observerMode: false,
            notes: [],
        };
    }

    start(): void {}
    stop(): void {}
}

function makeAdapter(events: TouchpadProviderEvents): {
    adapter: TouchpadGestureAdapter;
    provider: StubProvider;
} {
    let provider!: StubProvider;
    const adapter = new TouchpadGestureAdapter(
        (providerEvents) => {
            provider = new StubProvider();
            provider.emit = providerEvents.onFrame ?? null;
            return provider;
        },
        events,
    );
    adapter.attach();
    return { adapter, provider };
}

let t = 0;
function frame(contacts: TouchpadContact[], delta = 16): TouchpadFrame {
    t += delta;
    return { timestamp: t, contacts, source: "raw-contacts" };
}
function contact(id: number, x: number, y: number): TouchpadContact {
    return { id, x, y, touching: true };
}

describe("touchpad adapter terminal forwarding", () => {
    beforeEach(() => {
        t = 0;
        setTouchpadRecording(false);
    });

    it("forwards VALID terminal results (bound or not is the runtime's call)", () => {
        const terminals: TouchpadRecognitionResult[] = [];
        const { provider } = makeAdapter({ onTerminal: (r) => terminals.push(r) });
        provider.emit!(
            frame([contact(1, 0.4, 0.5), contact(2, 0.5, 0.5), contact(3, 0.4, 0.6)]),
        );
        provider.emit!(
            frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5), contact(3, 0.6, 0.6)]),
        );
        provider.emit!(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)]));
        expect(terminals.length).toBe(1);
        expect(terminals[0].valid).toBe(true);
    });

    it("forwards INVALID terminal results too (must still hide the trail)", () => {
        const terminals: TouchpadRecognitionResult[] = [];
        const { adapter, provider } = makeAdapter({ onTerminal: (r) => terminals.push(r) });
        // rotate-only kinds: a straight 2-finger move cannot match → invalid.
        adapter.setEnabledKinds(new Set<TouchpadGestureKind>(["rotate"]), 1);
        provider.emit!(frame([contact(1, 0.4, 0.5), contact(2, 0.5, 0.5)]));
        provider.emit!(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)]));
        provider.emit!(frame([]));
        expect(terminals.length).toBe(1);
        expect(terminals[0].valid).toBe(false);
        expect(terminals[0].invalidReason).toBe("too-short");
    });

    it("recorder gate suppresses terminals entirely", () => {
        const terminals: TouchpadRecognitionResult[] = [];
        const { provider } = makeAdapter({ onTerminal: (r) => terminals.push(r) });
        const feed = () => {
            provider.emit!(
                frame([contact(1, 0.4, 0.5), contact(2, 0.5, 0.5), contact(3, 0.4, 0.6)]),
            );
            provider.emit!(
                frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5), contact(3, 0.6, 0.6)]),
            );
            provider.emit!(frame([contact(1, 0.6, 0.5), contact(2, 0.7, 0.5)]));
        };
        setTouchpadRecording(true);
        feed();
        expect(terminals.length).toBe(0);
        setTouchpadRecording(false);
        feed();
        expect(terminals.length).toBe(1);
    });

    it("isTouchpadRecording reflects the gate", () => {
        expect(isTouchpadRecording()).toBe(false);
        setTouchpadRecording(true);
        expect(isTouchpadRecording()).toBe(true);
        setTouchpadRecording(false);
        expect(isTouchpadRecording()).toBe(false);
    });
});
