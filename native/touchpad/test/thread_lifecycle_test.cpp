#include <windows.h>
#undef CreateWindowExW
#undef WaitForSingleObject
#undef WaitForMultipleObjects
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

HWND WINAPI LifecycleCreateWindow(DWORD ex, LPCWSTR cls, LPCWSTR title, DWORD style,
                                  int x, int y, int w, int h, HWND parent, HMENU menu,
                                  HINSTANCE instance, LPVOID data) {
  if (windowMode) SetEvent(entered);
  if (windowMode == 1) { SetLastError(ERROR_ACCESS_DENIED); return nullptr; }
  if (windowMode == 2) assert(::WaitForSingleObject(releaseWorker, 3000) == WAIT_OBJECT_0);
  return ::CreateWindowExW(ex, cls, title, style, x, y, w, h, parent, menu, instance, data);
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
  std::cout << "Windows thread checks passed: cycles, stale window class, setup failure, timeout retention, concurrent Start/Stop, controller retry.\n";
}
