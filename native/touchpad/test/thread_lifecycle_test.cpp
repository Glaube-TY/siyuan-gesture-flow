#include <windows.h>
#undef CreateWindowExW
#undef WaitForSingleObject
#undef WaitForMultipleObjects
#undef GetModuleHandleExW
#undef RegisterClassW
#undef GetClassInfoW
#undef UnregisterClassW
#undef GetRegisteredRawInputDevices
#undef RegisterRawInputDevices
#undef DefWindowProcW
#undef GetRawInputData
#include <atomic>
#include <array>
#include <cassert>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

// Inspect retained handles; no test seam is added to the shipped addon.
#define private public
#include "raw_input_capture.h"
#include "gestures_controller.h"
#undef private

using namespace gestureflow;
std::atomic<int> windowMode{0};
HANDLE entered = nullptr;
HANDLE releaseWorker = nullptr;
std::atomic<int> moduleMode{0}, classMode{0}, registrationMode{0};
std::atomic<int> registrations{0}, removals{0}, foregroundCleanups{0}, reads{0};
std::atomic<HINSTANCE> resolvedInstance{nullptr};
std::atomic<LPCWSTR> moduleAddress{nullptr};
std::atomic<HWND> createdWindow{nullptr};
HWND registeredTarget = nullptr;
const HWND foreignTarget = reinterpret_cast<HWND>(static_cast<UINT_PTR>(0x1234));

BOOL WINAPI LifecycleModuleHandle(DWORD flags, LPCWSTR address, HMODULE* module) {
  assert(flags == (GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT));
  moduleAddress = address;
  if (moduleMode) { SetLastError(ERROR_MOD_NOT_FOUND); return FALSE; }
  BOOL result = ::GetModuleHandleExW(flags, address, module);
  if (result) resolvedInstance = *module;
  return result;
}
ATOM WINAPI LifecycleRegisterClass(const WNDCLASSW* wc) {
  assert(wc->hInstance == resolvedInstance && reinterpret_cast<LPCWSTR>(wc->lpfnWndProc) == moduleAddress);
  if (classMode) { SetLastError(ERROR_ACCESS_DENIED); return 0; }
  return ::RegisterClassW(wc);
}
BOOL WINAPI LifecycleClassInfo(HINSTANCE instance, LPCWSTR name, LPWNDCLASSW wc) {
  assert(instance == resolvedInstance);
  return ::GetClassInfoW(instance, name, wc);
}
BOOL WINAPI LifecycleUnregisterClass(LPCWSTR name, HINSTANCE instance) {
  assert(instance == resolvedInstance);
  // A class with surviving windows cannot be unregistered.
  assert(!IsWindow(createdWindow));
  return ::UnregisterClassW(name, instance);
}
UINT WINAPI LifecycleRegisteredDevices(PRAWINPUTDEVICE devices, PUINT count, UINT size) {
  const int mode = registrationMode;
  if (!mode) return ::GetRegisteredRawInputDevices(devices, count, size);
  if (mode == 3 || mode == 6 || (mode == 10 && registrations)) { SetLastError(ERROR_ACCESS_DENIED); return static_cast<UINT>(-1); }
  const bool foreign = mode == 2 || mode == 5 || (mode == 4 && registrations);
  const HWND target = foreign ? foreignTarget : registeredTarget;
  const UINT required = (target || mode == 7) ? 1 : 0;
  if (!devices) { *count = required; return 0; }
  if (mode == 9) { *count += 1; SetLastError(ERROR_INSUFFICIENT_BUFFER); return static_cast<UINT>(-1); }
  assert(*count >= required && size == sizeof(RAWINPUTDEVICE));
  if (required) devices[0] = {0x0D, 0x05, RIDEV_INPUTSINK, target};
  *count = required;
  return required;
}
BOOL WINAPI LifecycleRegisterDevices(PCRAWINPUTDEVICE devices, UINT count, UINT size) {
  if (!registrationMode) return ::RegisterRawInputDevices(devices, count, size);
  assert(count == 1 && size == sizeof(RAWINPUTDEVICE));
  assert(devices[0].usUsagePage == 0x0D && devices[0].usUsage == 0x05);
  if (devices[0].dwFlags & RIDEV_REMOVE) {
    assert(registrationMode != 2 && registrationMode != 4 && registrationMode != 5 && registrationMode != 6);
    assert(devices[0].hwndTarget == nullptr);
    removals++; registeredTarget = nullptr;
  } else {
    assert(registrationMode != 2 && registrationMode != 3 && registrationMode != 7 && registrationMode != 9);
    if (registrationMode == 8) { SetLastError(ERROR_ACCESS_DENIED); return FALSE; }
    registrations++; registeredTarget = devices[0].hwndTarget;
  }
  return TRUE;
}
LRESULT WINAPI LifecycleDefWindowProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  if (msg == WM_INPUT) { assert(GET_RAWINPUT_CODE_WPARAM(wp) == RIM_INPUT); foregroundCleanups++; return 42; }
  return ::DefWindowProcW(hwnd, msg, wp, lp);
}
UINT WINAPI LifecycleRawInputData(HRAWINPUT input, UINT command, LPVOID data, PUINT size, UINT headerSize) {
  if (input == reinterpret_cast<HRAWINPUT>(static_cast<UINT_PTR>(0x4321))) {
    reads++; SetLastError(ERROR_INVALID_HANDLE); return static_cast<UINT>(-1);
  }
  return ::GetRawInputData(input, command, data, size, headerSize);
}
void ResetRegistration(int mode) {
  registrationMode = mode; registrations = 0; removals = 0; registeredTarget = nullptr;
}

HWND WINAPI LifecycleCreateWindow(DWORD ex, LPCWSTR cls, LPCWSTR title, DWORD style,
                                  int x, int y, int w, int h, HWND parent, HMENU menu,
                                  HINSTANCE instance, LPVOID data) {
  assert(instance == resolvedInstance);
  if (windowMode) SetEvent(entered);
  if (windowMode == 1) { SetLastError(ERROR_ACCESS_DENIED); return nullptr; }
  if (windowMode == 2) assert(::WaitForSingleObject(releaseWorker, 3000) == WAIT_OBJECT_0);
  const HWND result = ::CreateWindowExW(ex, cls, title, style, x, y, w, h, parent, menu, instance, data);
  createdWindow = result;
  return result;
}
DWORD WINAPI LifecycleWaitSingle(HANDLE handle, DWORD timeout) {
  return ::WaitForSingleObject(handle, timeout == 1500 && windowMode == 2 ? 40 : timeout);
}
DWORD WINAPI LifecycleWaitMultiple(DWORD count, const HANDLE* handles, BOOL all, DWORD timeout) {
  return ::WaitForMultipleObjects(count, handles, all, timeout == 3000 && windowMode == 2 ? 80 : timeout);
}

void ResetBarrier() {
  ResetEvent(entered);
  ResetEvent(releaseWorker);
}

DWORD WINAPI HeldWorker(LPVOID) {
  SetEvent(entered);
  return ::WaitForSingleObject(releaseWorker, 3000) == WAIT_OBJECT_0 ? 0 : 1;
}

LRESULT CALLBACK OldAddonWindowProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
  return DefWindowProcW(hwnd, message, wp, lp);
}

int main() {
  entered = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  releaseWorker = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  assert(entered && releaseWorker);
  {
    WNDCLASSW oldClass = {};
    oldClass.hInstance = GetModuleHandleW(nullptr);
    oldClass.lpszClassName = L"GestureFlowTouchpadCaptureWnd";
    oldClass.lpfnWndProc = OldAddonWindowProc;
    assert(RegisterClassW(&oldClass));
    RawInputCapture capture;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kFailed);
    assert(capture.lastError() == ERROR_CLASS_ALREADY_EXISTS);
    assert(UnregisterClassW(oldClass.lpszClassName, oldClass.hInstance));
  }
  {
    RawInputCapture capture;
    moduleMode = 1;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kFailed);
    assert(capture.lastError() == ERROR_MOD_NOT_FOUND);
    assert(!capture.thread_ && !capture.hwnd_ && !capture.moduleInstance_);
    moduleMode = 0; classMode = 1;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kFailed);
    assert(capture.lastError() == ERROR_ACCESS_DENIED);
    assert(!capture.thread_ && !capture.hwnd_ && !capture.classRegistered_);
    classMode = 0;
  }
  for (int mode : {1, 2, 3, 4, 7, 8, 9, 10}) {
    RawInputCapture capture;
    ResetRegistration(mode);
    if (mode == 9) registeredTarget = foreignTarget;
    const auto result = capture.Start([](const NativeFrame&) {});
    if (mode == 1) {
      assert(result == ThreadStartResult::kStarted);
      assert(capture.moduleInstance_ == resolvedInstance);
      assert(reinterpret_cast<HINSTANCE>(GetWindowLongPtrW(capture.hwnd_, GWLP_HINSTANCE)) == resolvedInstance);
      assert(capture.Stop() == ThreadStopResult::kStopped);
      assert(registrations == 1 && removals == 1);
    } else {
      assert(result == ThreadStartResult::kFailed);
      assert(!capture.thread_ && !capture.hwnd_ && !capture.moduleInstance_);
      assert(removals == 0);
      assert(registrations == ((mode == 4 || mode == 10) ? 1 : 0));
      assert(capture.lastError() != ERROR_SUCCESS);
    }
    assert(capture.Stop() == ThreadStopResult::kAlreadyStopped);
  }
  for (int mode : {5, 6}) {
    ResetRegistration(1);
    RawInputCapture capture;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kStarted);
    registrationMode = mode;
    assert(capture.Stop() == ThreadStopResult::kStopped);
    assert(removals == 0 && registrations == 1);
    assert(capture.Stop() == ThreadStopResult::kAlreadyStopped);
  }
  ResetRegistration(0);
  {
    RawInputCapture capture;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kStarted);
    const LPARAM invalidInput = 0x4321;
    auto before = capture.captureDiagSnapshot().wmInputCount;
    assert(SendMessageW(capture.hwnd_, WM_INPUT, RIM_INPUT, invalidInput) == 42);
    assert(foregroundCleanups == 1 && reads == 1);
    assert(capture.captureDiagSnapshot().wmInputCount == before + 1);
    assert(SendMessageW(capture.hwnd_, WM_INPUT, RIM_INPUTSINK, invalidInput) == 0);
    assert(foregroundCleanups == 1 && reads == 2);
    assert(capture.captureDiagSnapshot().wmInputCount == before + 2);
    assert(capture.Stop() == ThreadStopResult::kStopped);
  }
  {
    RawInputCapture capture;
    for (int i = 0; i < 5; ++i) {
      assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kStarted);
      assert(capture.Stop() == ThreadStopResult::kStopped);
      assert(capture.Stop() == ThreadStopResult::kAlreadyStopped);
    }
  }
  {
    RawInputCapture capture;
    windowMode = 1;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kFailed);
    assert(capture.lastError() == ERROR_ACCESS_DENIED);
    assert(capture.thread_ == nullptr && capture.hwnd_ == nullptr);
    assert(capture.Stop() == ThreadStopResult::kAlreadyStopped);
  }
  {
    RawInputCapture capture;
    windowMode = 2;
    ResetBarrier();
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kTimedOut);
    HANDLE oldThread = capture.thread_, oldStop = capture.stopEvent_, oldStart = capture.startEvent_;
    assert(oldThread && oldStop && oldStart);
    assert(capture.Stop() == ThreadStopResult::kPending);
    assert(capture.thread_ == oldThread && capture.stopEvent_ == oldStop && capture.startEvent_ == oldStart);
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kStopPending);
    SetEvent(releaseWorker);
    assert(::WaitForSingleObject(oldThread, 1000) == WAIT_OBJECT_0);
    assert(capture.Stop() == ThreadStopResult::kStopped);
    assert(capture.thread_ == nullptr && capture.stopEvent_ == nullptr && capture.startEvent_ == nullptr);
    windowMode = 0;
    assert(capture.Start([](const NativeFrame&) {}) == ThreadStartResult::kStarted);
    assert(capture.Stop() == ThreadStopResult::kStopped);
  }
  {
    RawInputCapture capture;
    windowMode = 2;
    ResetBarrier();
    ThreadStartResult result = ThreadStartResult::kStarted;
    std::thread starter([&] { result = capture.Start([](const NativeFrame&) {}); });
    assert(::WaitForSingleObject(entered, 1000) == WAIT_OBJECT_0);
    assert(capture.Stop() == ThreadStopResult::kPending);
    SetEvent(releaseWorker);
    starter.join();
    assert(result != ThreadStartResult::kStarted);
    auto stopped = capture.Stop();
    assert(stopped == ThreadStopResult::kStopped || stopped == ThreadStopResult::kAlreadyStopped);
    assert(capture.thread_ == nullptr);
    windowMode = 0;
  }
  {
    GesturesController controller;
    assert(controller.Start({}, {}, {}) == ThreadStartResult::kUnavailable);
    assert(controller.Stop() == ThreadStopResult::kAlreadyStopped);
    ResetBarrier();
    controller.stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    controller.startEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    controller.thread_ = CreateThread(nullptr, 0, HeldWorker, nullptr, 0, nullptr);
    assert(controller.thread_ && controller.stopEvent_ && controller.startEvent_);
    HANDLE oldThread = controller.thread_;
    assert(::WaitForSingleObject(entered, 1000) == WAIT_OBJECT_0);
    assert(controller.Stop() == ThreadStopResult::kPending);
    assert(controller.thread_ == oldThread && controller.stopEvent_ && controller.startEvent_);
    assert(controller.Start({}, {}, {}) == ThreadStartResult::kStopPending);
    SetEvent(releaseWorker);
    assert(::WaitForSingleObject(oldThread, 1000) == WAIT_OBJECT_0);
    assert(controller.Stop() == ThreadStopResult::kStopped);
    assert(controller.Stop() == ThreadStopResult::kAlreadyStopped);
  }
  CloseHandle(entered);
  CloseHandle(releaseWorker);
  std::cout << "Windows thread checks passed: cycles, stale window class, setup failure, timeout retention, concurrent Start/Stop, controller retry, module ownership, WM_INPUT cleanup, registration conflicts and changed-owner protection.\n";
}
