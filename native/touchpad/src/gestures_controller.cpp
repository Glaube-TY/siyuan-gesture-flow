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

ThreadStartResult GesturesController::Start(PointerCallback onPointer, ActionCallback onAction,
                                          const GesturesControllerConfig& config) {
  std::unique_lock<std::mutex> lock(lifecycleMutex_);
  if (thread_) return running_ && !stopRequested_
      ? ThreadStartResult::kAlreadyRunning : ThreadStartResult::kStopPending;
  if (!config.any() || !IsAvailable()) return ThreadStartResult::kUnavailable;
  onPointer_ = std::move(onPointer);
  onAction_ = std::move(onAction);
  config_ = config;
  enabled_ = running_ = false;
  lastError_ = ERROR_SUCCESS;
  stopRequested_ = startSucceeded_ = false;
  stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  startEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!stopEvent_ || !startEvent_) {
    lastError_ = GetLastError();
    if (stopEvent_) CloseHandle(stopEvent_);
    if (startEvent_) CloseHandle(startEvent_);
    stopEvent_ = startEvent_ = nullptr;
    onPointer_ = {}; onAction_ = {};
    return ThreadStartResult::kFailed;
  }
  thread_ = CreateThread(nullptr, 0, &GesturesController::ThreadProc, this, 0, nullptr);
  if (!thread_) {
    lastError_ = GetLastError();
    CloseHandle(startEvent_); CloseHandle(stopEvent_);
    startEvent_ = stopEvent_ = nullptr;
    onPointer_ = {}; onAction_ = {};
    return ThreadStartResult::kFailed;
  }
  startWaiting_ = true;
  HANDLE events[] = {startEvent_, stopEvent_};
  lock.unlock();
  const DWORD wait = WaitForMultipleObjects(2, events, FALSE, 3000);
  lock.lock();
  startWaiting_ = false;
  if (wait == WAIT_OBJECT_0 && startSucceeded_ && !stopRequested_) return ThreadStartResult::kStarted;
  if (wait == WAIT_FAILED) lastError_ = GetLastError();
  const auto stopped = StopLocked();
  if (wait == WAIT_TIMEOUT) return ThreadStartResult::kTimedOut;
  return stopped == ThreadStopResult::kPending
      ? ThreadStartResult::kStopPending : ThreadStartResult::kFailed;
}

void GesturesController::RequestStopLocked() {
  stopRequested_ = true;
  running_ = enabled_ = false;
  if (stopEvent_ && !SetEvent(stopEvent_)) lastError_ = GetLastError();
}

void GesturesController::RequestStop() {
  std::lock_guard<std::mutex> lock(lifecycleMutex_);
  RequestStopLocked();
}

ThreadStopResult GesturesController::Stop() {
  std::lock_guard<std::mutex> lock(lifecycleMutex_);
  return StopLocked();
}

ThreadStopResult GesturesController::StopLocked() {
  RequestStopLocked();
  if (!thread_) return ThreadStopResult::kAlreadyStopped;
  const DWORD wait = WaitForSingleObject(thread_, 1500);
  if (wait != WAIT_OBJECT_0 || startWaiting_) {
    if (wait == WAIT_FAILED) lastError_ = GetLastError();
    return ThreadStopResult::kPending;
  }
  CloseHandle(thread_); CloseHandle(startEvent_); CloseHandle(stopEvent_);
  thread_ = startEvent_ = stopEvent_ = nullptr;
  onPointer_ = {}; onAction_ = {};
  return ThreadStopResult::kStopped;
}

void GesturesController::RunLoop() {
  HRESULT hr = RoInitialize(RO_INIT_SINGLETHREADED);
  bool roOk = SUCCEEDED(hr);
  if (!roOk) {
    // Without COM the controller cannot be created.
    lastError_ = static_cast<DWORD>(hr);
    running_ = false;
    SetEvent(startEvent_);
    return;
  }
#if GESTURE_FLOW_HAVE_CPPWINRT
  try {
    if (stopRequested_) { SetEvent(startEvent_); RoUninitialize(); return; }
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
    auto tokenPressed =
        controller.PointerPressed(winrt::auto_revoke, [this](auto&&, auto&& args) {          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    auto tokenMoved =
        controller.PointerMoved(winrt::auto_revoke, [this](auto&&, auto&& args) {
          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    auto tokenReleased =
        controller.PointerReleased(winrt::auto_revoke, [this](auto&&, auto&& args) {
          if (!running_) return;
          auto pt = args.CurrentPosition();
          if (onPointer_) {
            onPointer_(static_cast<int>(args.ContactCount()), NowMs(),
                       static_cast<double>(pt.X), static_cast<double>(pt.Y));
          }
        });
    auto tokenAction =
        controller.GlobalActionPerformed(winrt::auto_revoke, [this](auto&&, auto&& args) {
          if (!running_) return;
          int action = static_cast<int>(args.GestureType());
          int fingers = args.ContactCount() > 0
                            ? static_cast<int>(args.ContactCount())
                            : ActionFingers(action);
          if (onAction_) {
            onAction_(MapActionKind(action), fingers);
          }
        });
    if (!stopRequested_) controller.Enabled(true);
    startSucceeded_ = !stopRequested_.load();
    running_ = enabled_ = startSucceeded_.load();
    SetEvent(startEvent_);
    while (!stopRequested_ && startSucceeded_) {
      const DWORD wait = MsgWaitForMultipleObjectsEx(1, &stopEvent_, 250,
                                                    QS_ALLINPUT, MWMO_INPUTAVAILABLE);
      if (wait == WAIT_OBJECT_0) break;
      if (wait == WAIT_FAILED) { lastError_ = GetLastError(); break; }
      MSG msg;
      while (!stopRequested_ && PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_QUIT) { stopRequested_ = true; break; }
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
      }
    }
    running_ = enabled_ = false;
    controller.Enabled(false);
    tokenPressed.revoke();
    tokenMoved.revoke();
    tokenReleased.revoke();
    tokenAction.revoke();
    controller = nullptr;
  } catch (const winrt::hresult_error& error) {
    lastError_ = static_cast<DWORD>(error.code().value);
    startSucceeded_ = false;
  } catch (...) {
    lastError_ = ERROR_UNHANDLED_EXCEPTION;
    startSucceeded_ = false;
  }
#endif
  running_ = enabled_ = false;
  SetEvent(startEvent_);
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
