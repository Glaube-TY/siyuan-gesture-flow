#ifndef GESTURE_FLOW_TOUCHPAD_NATIVE_EVENTS_H_
#define GESTURE_FLOW_TOUCHPAD_NATIVE_EVENTS_H_

#include <cstdint>
#include <cmath>
#include <string>
#include <vector>

namespace gestureflow {

/** A single contact delivered by the Raw Input path. */
struct NativeContact {
  int id = 0;
  double x = 0.0;      // normalised 0..1 (touchpad surface)
  double y = 0.0;      // normalised 0..1
  bool touching = true;
  double pressure = -1.0;  // -1 = n/a
  double width = -1.0;
  double height = -1.0;
};

/** 3/4/5-finger actions from the TouchpadGesturesController. */
enum class ActionKind : int {
  kNone = 0,
  kTap = 1,
  kPress = 2,
  kRelease = 3,
};

/** One native frame/event pushed to the JS side. */
struct NativeFrame {
  double timestamp = 0.0;
  std::vector<NativeContact> contacts;   // Raw Input path (empty otherwise)
  int contactCount = -1;                 // controller contact count (>= 0 when present)
  bool hasPointer = false;               // controller pointer sample present
  double pointerX = 0.0;
  double pointerY = 0.0;
  ActionKind actionKind = ActionKind::kNone;
  int actionFingers = 0;
};

/** Capabilities computed by native probes. */
struct NativeCapabilities {
  bool precisionTouchpad = false;
  int maxContacts = 0;
  bool gesturesControllerAvailable = false;
  /** True only when the controller really enabled (see GesturesController). */
  bool gesturesControllerEnabled = false;
  bool canOverrideSystemGestures = false;
  bool rawContacts = false;
  /** True when the raw contact map was parsed and frames can be delivered. */
  bool multiContactGestures = false;
  std::vector<int> supportedGestureFingerCounts;
  std::string loadInfo;
};

/**
 * Strict invariant every raw-contact frame must satisfy before it is handed
 * to JavaScript:
 *
 *   - contactCount == contacts.length (when contactCount is present);
 *   - every contact has finite id / x / y with x,y in [0,1];
 *   - all contact ids are unique (Contact ID 0 is a legal value).
 *
 * Frames that violate the invariant are DROPPED and counted (never sent), so
 * the JS tracker can trust a frame's contacts without guessing.
 */
bool ValidateNativeFrame(const NativeFrame& frame);

}  // namespace gestureflow

#endif  // GESTURE_FLOW_TOUCHPAD_NATIVE_EVENTS_H_
