#include "gestures_controller.h"

#include <roapi.h>

#if defined(GESTURE_FLOW_HAVE_TG_CONTROLLER) && GESTURE_FLOW_HAVE_TG_CONTROLLER && __has_include(<winrt/Windows.UI.Input.h>)
#define GESTURE_FLOW_HAVE_CPPWINRT 1
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.Input.h>
#else
#define GESTURE_FLOW_HAVE_CPPWINRT 0
#endif

#include <chrono>

namespace gestureflow {

namespace {

// Milliseconds (same steady clock).  The JS tracker treats frame timestamps
// as milliseconds, so pointer samples must not carry seconds.
double NowMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

ActionKind MapActionKind(int action) {
  // winrt::Windows::UI::Input::TouchpadGlobalAction enum values:
  // 0 ThreeFingerTap, 1 FourFingerTap, 2 FiveFingerTap,
  // 3 ThreeFingerPress, 4 FourFingerPress, 5 FiveFingerPress,
  // 6 ThreeFingerRelease, 7 FourFingerRelease, 8 FiveFingerRelease.
  if (action <= 2) return ActionKind::kTap;
  if (action <= 5) return ActionKind::kPress;
  return ActionKind::kRelease;
}

int ActionFingers(int action) {
  switch (action) {
    case 0: case 3: case 6: return 3;
    case 1: case 4: case 7: return 4;
    case 2: case 5: case 8: return 5;
    default: return 0;
  }
}

}  // namespace

GesturesController::GesturesController() = default;

GesturesController::~GesturesController() { Stop(); }

bool GesturesController::IsAvailable() {
#if GESTURE_FLOW_HAVE_CPPWINRT
  try {
    return winrt::Windows::UI::Input::TouchpadGesturesController::IsSupported();
  } catch (...) {
    return false;
  }
#else
  return false;
#endif
}

bool GesturesController::Start(PointerCallback onPointer, ActionCallback onAction,
                               const GesturesControllerConfig& config) {
  if (running_) return true;
  if (!config.any() || !IsAvailable()) return false;
  onPointer_ = std::move(onPointer);
  onAction_ = std::move(onAction);
  config_ = config;
  enabled_ = false;
  running_ = true;
  thread_ = CreateThread(nullptr, 0, &GesturesController::ThreadProc, this, 0, nullptr);
  if (!thread_) {
    running_ = false;
    return false;
  }
  return true;
}

void GesturesController::Stop() {
  if (!running_ && !thread_) return;
  running_ = false;
  enabled_ = false;
  if (thread_) {
    PostThreadMessageW(GetThreadId(thread_), WM_QUIT, 0, 0);
    DWORD wait = WaitForSingleObject(thread_, 1500);
    if (wait == WAIT_TIMEOUT) {
      TerminateThread(thread_, 0);
    }
    CloseHandle(thread_);
    thread_ = nullptr;
  }
}

void GesturesController::RunLoop() {
  HRESULT hr = RoInitialize(RO_INIT_SINGLETHREADED);
  bool roOk = SUCCEEDED(hr);
  if (!roOk) {
    // Without COM the controller cannot be created.
    running_ = false;
    return;
  }
#if GESTURE_FLOW_HAVE_CPPWINRT
  try {
    using namespace winrt::Windows::UI::Input;
    auto controller = TouchpadGesturesController::CreateForProcess();
    // Take over ONLY finger counts/kinds with enabled GestureFlow bindings.
    // Claiming all flags here used to swallow unrelated Windows gestures.
    TouchpadGesturesConfiguration supported{};
    if (config_.manipulations[0]) supported |= TouchpadGesturesConfiguration::ThreeFingerManipulations;
    if (config_.manipulations[1]) supported |= TouchpadGesturesConfiguration::FourFingerManipulations;
    if (config_.manipulations[2]) supported |= TouchpadGesturesConfiguration::FiveFingerManipulations;
    if (config_.actions[0]) supported |= TouchpadGesturesConfiguration::ThreeFingerActions;
    if (config_.actions[1]) supported |= TouchpadGesturesConfiguration::FourFingerActions;
    if (config_.actions[2]) supported |= TouchpadGesturesConfiguration::FiveFingerActions;
    controller.SupportedGestures(supported);
    controller.Enabled(true);
    winrt::event_token tokenPressed =
        controller.PointerPressed([this](auto&&, auto&& args) {          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    winrt::event_token tokenMoved =
        controller.PointerMoved([this](auto&&, auto&& args) {
          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    winrt::event_token tokenReleased =
        controller.PointerReleased([this](auto&&, auto&& args) {
          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    winrt::event_token tokenAction =
        controller.GlobalActionPerformed([this](auto&&, auto&& args) {
          if (!running_) return;
          int action = static_cast<int>(args.GestureType());
          int fingers = args.ContactCount() > 0
                            ? static_cast<int>(args.ContactCount())
                            : ActionFingers(action);
          if (onAction_) {
            onAction_(MapActionKind(action), fingers);
          }
        });
    // Controller creation + SupportedGestures + Enabled(true) + all event
    // subscriptions succeeded — only now is it genuinely active.
    enabled_ = true;
    // Keep the apartment alive and pump messages until stop.
    MSG msg;
    while (running_ && GetMessageW(&msg, nullptr, 0, 0) > 0) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    enabled_ = false;
    controller.Enabled(false);
    controller.PointerPressed(tokenPressed);
    controller.PointerMoved(tokenMoved);
    controller.PointerReleased(tokenReleased);
    controller.GlobalActionPerformed(tokenAction);
    controller = nullptr;
  } catch (...) {
    // Controller creation or event subscription failed -- degrade gracefully.
    enabled_ = false;
    running_ = false;
  }
#endif
  if (roOk) {
    RoUninitialize();
  }
}

DWORD WINAPI GesturesController::ThreadProc(LPVOID param) {
  GesturesController* self = static_cast<GesturesController*>(param);
  self->RunLoop();
  return 0;
}

}  // namespace gestureflow
