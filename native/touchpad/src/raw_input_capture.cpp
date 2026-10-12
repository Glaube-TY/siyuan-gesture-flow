#include "raw_input_capture.h"

// hidsdi.h defines NTSTATUS and transitively includes hidpi.h + hidusage.h,
// which is the intended user-mode include for the HID parser (HidP_*).
#include <hidsdi.h>
#include <winuser.h>
#include <algorithm>
#include <chrono>

namespace gestureflow {

namespace {
constexpr USHORT kTouchpadUsage = 0x05;

double NowSeconds() {
  using namespace std::chrono;
  return duration<double>(steady_clock::now().time_since_epoch()).count();
}

// Milliseconds (same steady clock).  The JS tracker treats frame timestamps
// as milliseconds (cooldownMs / tapMaxDurationMs / settleWindowMs), so raw
// contact frames MUST NOT carry seconds — a seconds-based cooldown of 120
// would block the next gesture for ~2 minutes after the first one completes.
double NowMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}
}  // namespace

RawInputCapture::RawInputCapture() = default;

RawInputCapture::~RawInputCapture() { Stop(); }

ThreadStartResult RawInputCapture::Start(FrameCallback callback) {
  std::unique_lock<std::mutex> lock(lifecycleMutex_);
  if (thread_) return running_ && !stopRequested_
      ? ThreadStartResult::kAlreadyRunning : ThreadStartResult::kStopPending;
  {
    std::lock_guard<std::mutex> stateLock(stateMutex_);
    InvalidateDescriptor();
  }
  lastError_ = ERROR_SUCCESS;
  stopRequested_ = false;
  startSucceeded_ = false;
  running_ = false;
  callback_ = std::move(callback);
  stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  startEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!stopEvent_ || !startEvent_) {
    lastError_ = GetLastError();
    if (stopEvent_) CloseHandle(stopEvent_);
    if (startEvent_) CloseHandle(startEvent_);
    stopEvent_ = startEvent_ = nullptr;
    callback_ = {};
    return ThreadStartResult::kFailed;
  }
  thread_ = CreateThread(nullptr, 0, &RawInputCapture::ThreadProc, this, 0, nullptr);
  if (!thread_) {
    lastError_ = GetLastError();
    CloseHandle(startEvent_);
    CloseHandle(stopEvent_);
    startEvent_ = stopEvent_ = nullptr;
    callback_ = {};
    return ThreadStartResult::kFailed;
  }
  // Stop can signal cancellation while Start waits; it cannot close these handles yet.
  startWaiting_ = true;
  HANDLE events[] = {startEvent_, stopEvent_};
  lock.unlock();
  const DWORD wait = WaitForMultipleObjects(2, events, FALSE, 3000);
  lock.lock();
  startWaiting_ = false;
  if (wait == WAIT_OBJECT_0 && startSucceeded_ && !stopRequested_) {
    return ThreadStartResult::kStarted;
  }
  if (wait == WAIT_FAILED) lastError_ = GetLastError();
  const auto stopped = StopLocked();
  if (wait == WAIT_TIMEOUT) return ThreadStartResult::kTimedOut;
  return stopped == ThreadStopResult::kPending
      ? ThreadStartResult::kStopPending : ThreadStartResult::kFailed;
}

void RawInputCapture::RequestStopLocked() {
  stopRequested_ = true;
  running_ = false;
  if (stopEvent_ && !SetEvent(stopEvent_)) lastError_ = GetLastError();
}

void RawInputCapture::RequestStop() {
  std::lock_guard<std::mutex> lock(lifecycleMutex_);
  RequestStopLocked();
}

ThreadStopResult RawInputCapture::Stop() {
  std::lock_guard<std::mutex> lock(lifecycleMutex_);
  return StopLocked();
}

ThreadStopResult RawInputCapture::StopLocked() {
  RequestStopLocked();
  if (!thread_) return ThreadStopResult::kAlreadyStopped;
  const DWORD wait = WaitForSingleObject(thread_, 1500);
  if (wait != WAIT_OBJECT_0 || startWaiting_) {
    if (wait == WAIT_FAILED) lastError_ = GetLastError();
    return ThreadStopResult::kPending;
  }
  CloseHandle(thread_);
  CloseHandle(startEvent_);
  CloseHandle(stopEvent_);
  thread_ = startEvent_ = stopEvent_ = nullptr;
  callback_ = {};
  return ThreadStopResult::kStopped;
}

bool RawInputCapture::SetupOnThread() {
  if (stopRequested_) return false;
  HINSTANCE hInst = GetModuleHandleW(nullptr);
  WNDCLASSW wc = {};
  wc.lpfnWndProc = &RawInputCapture::WndProc;
  wc.hInstance = hInst;
  wc.lpszClassName = L"GestureFlowTouchpadCaptureWnd";
  classRegistered_ = RegisterClassW(&wc) != 0;
  if (!classRegistered_) {
    lastError_ = GetLastError();
    WNDCLASSW existing = {};
    // Older cached DLLs can have incompatible window userdata layouts.
    if (lastError_ != ERROR_CLASS_ALREADY_EXISTS ||
        !GetClassInfoW(hInst, wc.lpszClassName, &existing) ||
        existing.lpfnWndProc != &RawInputCapture::WndProc) return false;
  }
  if (stopRequested_) return false;
  hwnd_ = CreateWindowExW(0, wc.lpszClassName, L"GestureFlowTouchpadCapture",
                          WS_OVERLAPPED, 0, 0, 0, 0, nullptr, nullptr, hInst, this);
  if (!hwnd_) {
    lastError_ = GetLastError();
    return false;
  }
  if (stopRequested_ || !RegisterRawInput()) {
    if (!stopRequested_) lastError_ = GetLastError();
    return false;
  }
  registered_ = true;
  return true;
}

void RawInputCapture::CleanupOnThread() {
  if (hwnd_) {
    if (registered_) UnregisterRawInput();
    registered_ = false;
    if (!DestroyWindow(hwnd_)) lastError_ = GetLastError();
    hwnd_ = nullptr;
  }
  if (classRegistered_) {
    if (!UnregisterClassW(L"GestureFlowTouchpadCaptureWnd", GetModuleHandleW(nullptr))) {
      lastError_ = GetLastError();
    }
    classRegistered_ = false;
  }
}

bool RawInputCapture::RegisterRawInput() {
  RAWINPUTDEVICE rid = {};
  rid.usUsagePage = kDigitizerUsagePage;
  rid.usUsage = kTouchpadUsage;
  rid.dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY;
  rid.hwndTarget = hwnd_;
  return RegisterRawInputDevices(&rid, 1, sizeof(rid)) != FALSE;
}

void RawInputCapture::UnregisterRawInput() {
  RAWINPUTDEVICE rid = {};
  rid.usUsagePage = kDigitizerUsagePage;
  rid.usUsage = kTouchpadUsage;
  rid.dwFlags = RIDEV_REMOVE;
  rid.hwndTarget = nullptr;
  RegisterRawInputDevices(&rid, 1, sizeof(rid));
}

void RawInputCapture::PumpMessages() {
  while (!stopRequested_) {
    const DWORD wait = MsgWaitForMultipleObjectsEx(1, &stopEvent_, 250,
                                                  QS_ALLINPUT, MWMO_INPUTAVAILABLE);
    if (wait == WAIT_OBJECT_0) return;
    if (wait == WAIT_FAILED) { lastError_ = GetLastError(); return; }
    MSG msg;
    while (!stopRequested_ && PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) return;
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
  }
}

LRESULT CALLBACK RawInputCapture::WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  RawInputCapture* self = nullptr;
  if (msg == WM_NCCREATE) {
    auto* cs = reinterpret_cast<CREATESTRUCTW*>(lp);
    self = static_cast<RawInputCapture*>(cs->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
  } else {
    self = reinterpret_cast<RawInputCapture*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  }
  if (self) {
    switch (msg) {
      case WM_INPUT:
        // Count EVERY WM_INPUT that reaches the window proc, before any
        // parsing, so a parse failure can never hide whether Raw Input data
        // actually arrived.
        self->RecordWmInput();
        self->HandleInput(reinterpret_cast<HRAWINPUT>(lp));
        return 0;
      case WM_INPUT_DEVICE_CHANGE:
        self->HandleDeviceChange(wp, reinterpret_cast<HANDLE>(lp));
        return 0;
      case WM_DESTROY:
        self->hwnd_ = nullptr;
        PostQuitMessage(0);
        return 0;
      default:
        break;
    }
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

void RawInputCapture::HandleDeviceChange(WPARAM change, HANDLE device) {
  if (!running_) return;
  std::lock_guard<std::mutex> lock(stateMutex_);

  // Raw Input registration is usage-wide and survives device arrivals/removals;
  // registering again here can itself trigger another notification and causes
  // the descriptor/assembler to restart between every movement sample on some
  // precision-touchpad drivers.  Arrivals are parsed lazily on their first
  // WM_INPUT.  Removals discard only that device's state.
  if (change == GIDC_ARRIVAL) {
    captureDiag_.deviceArrivalCount++;
    return;
  }
  if (change != GIDC_REMOVAL) return;

  captureDiag_.deviceRemovalCount++;
  if (device != nullptr) {
    deviceStates_.erase(device);
    if (diagnosticDevice_ == device) diagnosticDevice_ = nullptr;
    if (lastInputDevice_ == device) lastInputDevice_ = nullptr;
  }
  captureDiag_.deviceContextCount = static_cast<ULONG>(deviceStates_.size());
}

void RawInputCapture::InvalidateDescriptor() {
  deviceStates_.clear();
  diagnosticDevice_ = nullptr;
  lastInputDevice_ = nullptr;
  captureDiag_.deviceContextCount = 0;
}

void RawInputCapture::RecordWmInput() {
  std::lock_guard<std::mutex> lock(stateMutex_);
  captureDiag_.wmInputCount++;
}

void RawInputCapture::HandleInput(HRAWINPUT rawInput) {
  if (!callback_ || !running_) return;

  // Descriptor parsing/frame assembly happens on the capture thread while
  // native.getDiagnostics() runs on the JS thread.  Keep every vector/counter
  // access synchronized so opening the diagnostics panel cannot race a HID
  // report and crash the addon.
  std::lock_guard<std::mutex> lock(stateMutex_);

  UINT size = 0;
  if (GetRawInputData(rawInput, RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER)) ==
      static_cast<UINT>(-1)) {
    return;
  }
  std::vector<uint8_t> buffer(size);
  if (GetRawInputData(rawInput, RID_INPUT, buffer.data(), &size, sizeof(RAWINPUTHEADER)) != size) {
    return;
  }
  captureDiag_.rawInputReadSuccessCount++;

  const RAWINPUT* raw = reinterpret_cast<const RAWINPUT*>(buffer.data());
  if (raw->header.dwType != RIM_TYPEHID || raw->data.hid.dwCount == 0) {
    return;
  }
  captureDiag_.rawInputHidPacketCount++;
  captureDiag_.lastDwSizeHid = raw->data.hid.dwSizeHid;
  captureDiag_.lastDwCount = raw->data.hid.dwCount;
  captureDiag_.rawInputHidReportCount += raw->data.hid.dwCount;

  // Preparsed data for HidP_* parsing (from the Raw Input device handle).
  captureDiag_.preparsedDataRequestCount++;
  UINT psize = 0;
  if (GetRawInputDeviceInfoW(raw->header.hDevice, RIDI_PREPARSEDDATA, nullptr, &psize) ==
      static_cast<UINT>(-1)) {
    return;
  }
  std::vector<BYTE> ppBuffer(psize);
  if (GetRawInputDeviceInfoW(raw->header.hDevice, RIDI_PREPARSEDDATA, ppBuffer.data(), &psize) !=
      psize) {
    return;
  }
  captureDiag_.preparsedDataSuccessCount++;
  PHIDP_PREPARSED_DATA preparsed = reinterpret_cast<PHIDP_PREPARSED_DATA>(ppBuffer.data());

  // Descriptors and Hybrid Reporting state are device-specific.  Multiple TLC
  // handles may interleave even for one physical precision touchpad; preserve
  // every device's parser instead of resetting the global state on each switch.
  if (lastInputDevice_ != nullptr && lastInputDevice_ != raw->header.hDevice) {
    captureDiag_.deviceSwitchCount++;
  }
  lastInputDevice_ = raw->header.hDevice;
  diagnosticDevice_ = raw->header.hDevice;
  auto [stateIt, inserted] = deviceStates_.try_emplace(raw->header.hDevice);
  DeviceCaptureState& state = stateIt->second;
  if (inserted) {
    state.assembler.Reset();
    captureDiag_.deviceContextCount = static_cast<ULONG>(deviceStates_.size());
  }

  // Parse the report descriptor once and cache the contact map.  Counters are
  // recorded BEFORE/independent of the parse so failures are diagnosable.
  if (!state.descriptorValid) {
    captureDiag_.descriptorParseAttemptCount++;
    state.descriptor = TouchpadDescriptor();
    DescriptorParseResult result = ParseTouchpadDescriptor(preparsed, state.descriptor);
    state.descriptorValid = result.success;
    if (state.descriptorValid) {
      captureDiag_.descriptorParseSuccessCount++;
      // Best-effort read of the real Contact Count Maximum (0x55) from the
      // device Feature report; never fatal if access is denied.
      if (ReadContactCountMaximum(raw->header.hDevice, preparsed, state.descriptor,
                                  state.descriptor.maxContacts)) {
        state.descriptor.maxContactsFromDescriptor = true;
      }
    } else {
      captureDiag_.descriptorParseFailureCount++;
    }
  }
  if (!state.descriptorValid) {
    return;
  }

  // A single WM_INPUT can carry multiple HID reports (dwCount reports of
  // dwSizeHid bytes each).  Every report must be parsed and fed to the frame
  // assembler -- dropping reports 2..N would lose hybrid-mode contacts.
  const DWORD reportCount = raw->data.hid.dwCount;
  const DWORD reportSize = raw->data.hid.dwSizeHid;

  const BYTE* base = raw->data.hid.bRawData;
  for (DWORD i = 0; i < reportCount; ++i) {
    const BYTE* report = base + i * reportSize;
    RawReport parsed;
    if (!ParseReport(state.descriptor, preparsed, report, reportSize, parsed)) {
      continue;
    }
    NativeFrame frame;
    if (state.assembler.OnReport(parsed, NowSeconds(), frame)) {
      // Strict invariant: a frame violating contactCount/contacts consistency,
      // non-finite coordinates or unique ids is DROPPED — never sent to JS.
      if (!ValidateNativeFrame(frame)) {
        captureDiag_.invalidFrameDropCount++;
        continue;
      }
      frame.timestamp = NowMs();
      callback_(frame);
      captureDiag_.callbackDeliveryCount++;
    }
  }
}

RawCaptureDiagnostics RawInputCapture::captureDiagSnapshot() const {
  std::lock_guard<std::mutex> lock(stateMutex_);
  return captureDiag_;
}

ParserStats RawInputCapture::parserStatsSnapshot() const {
  std::lock_guard<std::mutex> lock(stateMutex_);
  auto selected = deviceStates_.find(diagnosticDevice_);
  if (selected != deviceStates_.end()) return selected->second.assembler.stats();
  for (const auto& entry : deviceStates_) {
    if (entry.second.descriptorValid) return entry.second.assembler.stats();
  }
  return ParserStats();
}

TouchpadDescriptor RawInputCapture::descriptorSnapshot() const {
  std::lock_guard<std::mutex> lock(stateMutex_);
  auto selected = deviceStates_.find(diagnosticDevice_);
  if (selected != deviceStates_.end() && selected->second.descriptorValid) {
    return selected->second.descriptor;
  }
  for (const auto& entry : deviceStates_) {
    if (entry.second.descriptorValid) return entry.second.descriptor;
  }
  return TouchpadDescriptor();
}

TouchpadDescriptorStatus RawInputCapture::descriptorStatus() const {
  std::lock_guard<std::mutex> lock(stateMutex_);
  TouchpadDescriptorStatus status;
  for (const auto& entry : deviceStates_) {
    const TouchpadDescriptor& descriptor = entry.second.descriptor;
    if (!entry.second.descriptorValid) continue;
    status.valid = true;
    status.contactFieldCount = std::max(status.contactFieldCount, descriptor.contacts.size());
    status.maxContacts = std::max(status.maxContacts, descriptor.maxContacts);
  }
  return status;
}

DWORD WINAPI RawInputCapture::ThreadProc(LPVOID param) {
  RawInputCapture* self = static_cast<RawInputCapture*>(param);
  try {
    self->startSucceeded_ = self->SetupOnThread() && !self->stopRequested_;
    self->running_ = self->startSucceeded_.load();
    SetEvent(self->startEvent_);
    if (self->startSucceeded_ && !self->stopRequested_) self->PumpMessages();
  } catch (...) {
    self->lastError_ = ERROR_UNHANDLED_EXCEPTION;
    self->startSucceeded_ = false;
    SetEvent(self->startEvent_);
  }
  self->running_ = false;
  self->CleanupOnThread();
  return 0;
}

}  // namespace gestureflow
