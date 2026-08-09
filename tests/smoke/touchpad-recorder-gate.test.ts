import { describe, it, expect } from "vitest";
import {
    createReleaseGate,
    onGateFrame,
    canArmReleaseGate,
    RELEASE_QUIET_MS,
} from "../../src/settings/touchpadRecorderGate";

/**
 * Recorder release-gate logic (pure, no DOM).
 *
 * Regression: clicking 开始录制 while a finger is still down, then hearing no
 * frames for a while, must NEVER arm from mere inactivity — the gate only
 * arms after a CONFIRMED 0-contact frame plus the quiet gate.
 */
describe("touchpad recorder release gate", () => {
    it("finger not released cannot arm, even after a long silence", () => {
        // Clicked 开始 while 1 contact was present.
        const gate = createReleaseGate(1);
        expect(gate.zeroContactConfirmed).toBe(false);
        // 500 ms later with no new frames (finger held still): must NOT arm.
        const stillHeld = onGateFrame(gate, 1);
        expect(canArmReleaseGate(stillHeld, 500)).toBe(false);
    });

    it("0-contact frame starts the quiet gate; only after it elapses the gate arms", () => {
        const gate = createReleaseGate(1);
        const released = onGateFrame(gate, 0);
        expect(released.zeroContactConfirmed).toBe(true);
        // Quiet gate not yet elapsed → still preparing.
        expect(canArmReleaseGate(released, RELEASE_QUIET_MS - 1)).toBe(false);
        // Quiet gate elapsed → armed.
        expect(canArmReleaseGate(released, RELEASE_QUIET_MS)).toBe(true);
    });

    it("contacts reappearing during the quiet gate cancel arming", () => {
        const gate = createReleaseGate(1);
        const released = onGateFrame(gate, 0);
        // A finger comes back before the gate elapsed.
        const back = onGateFrame(released, 1);
        expect(canArmReleaseGate(back, RELEASE_QUIET_MS)).toBe(false);
        // Release again → gate re-arms from the fresh 0-contact frame.
        const releasedAgain = onGateFrame(back, 0);
        expect(canArmReleaseGate(releasedAgain, RELEASE_QUIET_MS)).toBe(true);
    });

    it("already at 0 contacts when preparing still needs the quiet gate", () => {
        const gate = createReleaseGate(0);
        expect(gate.zeroContactConfirmed).toBe(true);
        expect(canArmReleaseGate(gate, 0)).toBe(false);
        expect(canArmReleaseGate(gate, RELEASE_QUIET_MS)).toBe(true);
    });
});
