import { describe, it, expect } from "vitest";
import {
    HID_TIP_SWITCH,
    HID_CONTACT_IDENTIFIER,
    HID_CONTACT_COUNT,
    HID_CONTACT_COUNT_MAXIMUM,
    HID_SCAN_TIME,
    HID_X,
    HID_Y,
    HID_WIDTH,
    HID_HEIGHT,
} from "../../src/touchpad/hidUsages";

/**
 * HID usage regression guard (mirrors native/touchpad/src/hid_descriptor.h).
 *
 * Prevents Width (0x48) or Contact Count (0x51) from being mistaken for
 * Contact Identifier again, and pins the Precision Touchpad usage IDs the
 * parser relies on.
 */
describe("Precision Touchpad HID usages", () => {
    it("Contact Identifier is 0x51 (NOT Width 0x48)", () => {
        expect(HID_CONTACT_IDENTIFIER).toBe(0x51);
        expect(HID_CONTACT_IDENTIFIER).not.toBe(HID_WIDTH);
        expect(HID_CONTACT_IDENTIFIER).not.toBe(HID_HEIGHT);
    });

    it("Contact Count is 0x54 (NOT 0x51)", () => {
        expect(HID_CONTACT_COUNT).toBe(0x54);
        expect(HID_CONTACT_COUNT).not.toBe(0x51);
        expect(HID_CONTACT_COUNT).not.toBe(HID_CONTACT_IDENTIFIER);
    });

    it("Contact Count Maximum is 0x55", () => {
        expect(HID_CONTACT_COUNT_MAXIMUM).toBe(0x55);
        expect(HID_CONTACT_COUNT_MAXIMUM).not.toBe(HID_CONTACT_COUNT);
    });

    it("Tip Switch is 0x42", () => {
        expect(HID_TIP_SWITCH).toBe(0x42);
    });

    it("Scan Time is 0x56", () => {
        expect(HID_SCAN_TIME).toBe(0x56);
    });

    it("X/Y are 0x30/0x31 on the Generic Desktop page", () => {
        expect(HID_X).toBe(0x30);
        expect(HID_Y).toBe(0x31);
        expect(HID_WIDTH).toBe(0x48);
        expect(HID_HEIGHT).toBe(0x49);
    });
});
