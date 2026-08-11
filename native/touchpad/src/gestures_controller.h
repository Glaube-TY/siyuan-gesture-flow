#ifndef GESTURE_FLOW_TOUCHPAD_GESTURES_CONTROLLER_H_
#define GESTURE_FLOW_TOUCHPAD_GESTURES_CONTROLLER_H_

#include <array>
#include <atomic>
#include <functional>
#include <windows.h>

#include "native_events.h"

namespace gestureflow {

/** Per-finger-count system gestures that this plugin is allowed to own. */
struct GesturesControllerConfig {
  // Indices 0/1/2 correspond to 3/4/5 fingers.
  std::array<bool, 3> manipulations = {false, false, false};
  std::array<bool, 3> actions = {false, false, false};

  bool any() const {
    for (bool enabled : manipulations) if (enabled) return true;
    for (bool enabled : actions) if (enabled) return true;
    return false;
  }
};

/**
 * Windows.UI.Input.TouchpadGesturesController integration.
 *
 * When supported this controller lets GestureFlow receive (and take over)
 * the system's 3/4/5-finger global gestures while SiYuan is the foreground
 * app.  It reports:
 *
 *   - contact-count pointer samples (PointerPressed/Moved/Released), and
 *   - 3/4/5-finger tap / press / release actions (GlobalActionPerformed).
 *
 * It runs on a dedicated STA thread with a message loop (WinRT events need
 * an apartment + pump).  Start/stop are fully reversible: stop disables the
 * controller, unsubscribes every event token, releases the instance and
 * joins the thread.
 *
 * If the cppwinrt projection header is unavailable the implementation
 * degrades to `IsAvailable() == false` without failing to compile.
 */
class GesturesController {
 public:
  using PointerCallback =
      std::function<void(int contactCount, double timestamp, double x, double y)>;
  using ActionCallback = std::function<void(ActionKind kind, int fingers)>;

  GesturesController();
  ~GesturesController();

  /** True when the controller API is available on this system (probe only). */
  static bool IsAvailable();

  bool Start(PointerCallback onPointer, ActionCallback onAction,
             const GesturesControllerConfig& config);
  void Stop();
  bool running() const { return running_; }

  /**
   * True only AFTER the worker thread really completed controller creation,
   * `SupportedGestures(...)`, `Enabled(true)` and the event subscriptions.
   * `IsAvailable()` alone is NOT enough — a WinRT init / enable failure must
   * leave this false.
   */
  bool enabled() const { return enabled_; }

 private:
  PointerCallback onPointer_;
  ActionCallback onAction_;
  GesturesControllerConfig config_;
  HANDLE thread_ = nullptr;
  std::atomic<bool> running_{false};
  std::atomic<bool> enabled_{false};

  void RunLoop();
  static DWORD WINAPI ThreadProc(LPVOID param);
};

}  // namespace gestureflow

#endif  // GESTURE_FLOW_TOUCHPAD_GESTURES_CONTROLLER_H_
