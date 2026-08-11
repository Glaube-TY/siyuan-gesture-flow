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
constexpr UINT kShutdownMessage = WM_APP + 0x475;

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

bool RawInputCapture::Start(FrameCallback callback) {
  if (running_) return true;
  callback_ = std::move(callback);
  {
    std::lock_guard<std::mutex> lock(stateMutex_);
    // A restart begins a new physical acquisition epoch.  Retaining a pending
    // hybrid frame or previous-contact latch across plugin restarts can emit a
    // bogus continuation/empty frame into the new tracker.
    InvalidateDescriptor();
  }
  startEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!startEvent_) return false;
  running_ = true;
  thread_ = CreateThread(nullptr, 0, &RawInputCapture::ThreadProc, this, 0, nullptr);
  if (!thread_) {
    running_ = false;
    CloseHandle(startEvent_);
    startEvent_ = nullptr;
    return false;
  }
  // Wait for the thread to create the window and register Raw Input.
  DWORD startWait = WaitForSingleObject(startEvent_, 3000);
  if (startWait != WAIT_OBJECT_0) {
    running_ = false;
    // Do not close startEvent_ until the setup thread is gone: it may still be
    // about to signal the handle.
    PostThreadMessageW(GetThreadId(thread_), WM_QUIT, 0, 0);
    DWORD wait = WaitForSingleObject(thread_, 1000);
    if (wait == WAIT_TIMEOUT) TerminateThread(thread_, 0);
    CloseHandle(thread_);
    thread_ = nullptr;
    CloseHandle(startEvent_);
    startEvent_ = nullptr;
    hwnd_ = nullptr;
    return false;
  }
  CloseHandle(startEvent_);
  startEvent_ = nullptr;
  if (!hwnd_) {
    // SetupOnThread failed (window creation or Raw Input registration).
    running_ = false;
    WaitForSingleObject(thread_, 1000);
    CloseHandle(thread_);
    thread_ = nullptr;
    return false;
  }
  return true;
}

void RawInputCapture::Stop() {
  if (!running_ && !thread_) return;
  running_ = false;
  if (thread_) {
    // Ask the owning thread to unregister + destroy its window.  DestroyWindow
    // from the JS thread fails because windows are thread-affine.
    if (hwnd_) {
      PostMessageW(hwnd_, kShutdownMessage, 0, 0);
    } else {
      PostThreadMessageW(GetThreadId(thread_), WM_QUIT, 0, 0);
    }
    DWORD wait = WaitForSingleObject(thread_, 1500);
    if (wait == WAIT_TIMEOUT) {
      TerminateThread(thread_, 0);
    }
    CloseHandle(thread_);
    thread_ = nullptr;
  }
  hwnd_ = nullptr;
}

/** Runs on the capture thread: create the window + register Raw Input. */
void RawInputCapture::SetupOnThread() {
  HINSTANCE hInst = GetModuleHandleW(nullptr);
  WNDCLASSW wc = {};
  wc.lpfnWndProc = &RawInputCapture::WndProc;
  wc.hInstance = hInst;
  wc.lpszClassName = L"GestureFlowTouchpadCaptureWnd";
  if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    SetEvent(startEvent_);
    return;
  }
  hwnd_ = CreateWindowExW(0, wc.lpszClassName, L"GestureFlowTouchpadCapture",
                          WS_OVERLAPPED, 0, 0, 0, 0, nullptr, nullptr, hInst, this);
  if (!hwnd_) {
    SetEvent(startEvent_);
    return;
  }
  if (!RegisterRawInput()) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
  SetEvent(startEvent_);
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
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
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
      case kShutdownMessage:
        self->UnregisterRawInput();
        DestroyWindow(hwnd);
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
  self->SetupOnThread();
  self->PumpMessages();
  return 0;
}

}  // namespace gestureflow
