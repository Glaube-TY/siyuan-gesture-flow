/**
 * Windows Precision Touchpad HID usages (mirror of
 * `native/touchpad/src/hid_descriptor.h`).
 *
 * These constants MUST match the C++ side.  A regression test asserts the
 * values so that Width (0x48) is never mistaken for Contact Identifier again.
 *
 * Microsoft Windows Precision Touchpad HID protocol, Digitizers page 0x0D:
 *
 *   Tip Switch                0x42
 *   Confidence                0x47
 *   Width                     0x48
 *   Height                    0x49
 *   Contact Identifier        0x51
 *   Contact Count             0x54
 *   Contact Count Maximum     0x55  (Device Capabilities Feature report)
 *   Scan Time                 0x56
 *
 * Generic Desktop page 0x01:
 *
 *   X                         0x30
 *   Y                         0x31
 */
export const HID_DIGITIZER_USAGE_PAGE = 0x0d;
export const HID_GENERIC_DESKTOP_USAGE_PAGE = 0x01;

export const HID_TIP_SWITCH = 0x42;
export const HID_CONFIDENCE = 0x47;
export const HID_WIDTH = 0x48;
export const HID_HEIGHT = 0x49;
export const HID_CONTACT_IDENTIFIER = 0x51;
export const HID_CONTACT_COUNT = 0x54;
export const HID_CONTACT_COUNT_MAXIMUM = 0x55;
export const HID_SCAN_TIME = 0x56;

export const HID_X = 0x30;
export const HID_Y = 0x31;
