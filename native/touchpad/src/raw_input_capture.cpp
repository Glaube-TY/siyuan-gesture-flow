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

bool RawInputCapture::Start(FrameCallback callback) {
  if (running_) return true;
  callback_ = std::move(callback);
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
  WaitForSingleObject(startEvent_, 3000);
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
    PostThreadMessageW(GetThreadId(thread_), WM_QUIT, 0, 0);
    DWORD wait = WaitForSingleObject(thread_, 1500);
    if (wait == WAIT_TIMEOUT) {
      TerminateThread(thread_, 0);
    }
    CloseHandle(thread_);
    thread_ = nullptr;
  }
  if (hwnd_) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
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
        self->captureDiag_.wmInputCount++;
        self->HandleInput(reinterpret_cast<HRAWINPUT>(lp));
        return 0;
      case WM_INPUT_DEVICE_CHANGE:
        self->HandleDeviceChange();
        return 0;
      case WM_QUIT:
        PostQuitMessage(0);
        return 0;
      default:
        break;
    }
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

void RawInputCapture::HandleDeviceChange() {
  // The touchpad may have been unplugged/replugged -- re-register so capture
  // resumes when the device comes back, and drop the cached descriptor.
  if (running_) {
    InvalidateDescriptor();
    RegisterRawInput();
  }
}

void RawInputCapture::InvalidateDescriptor() {
  descriptorValid_ = false;
  descriptor_ = TouchpadDescriptor();
  assembler_.Reset();
}

void RawInputCapture::HandleInput(HRAWINPUT rawInput) {
  if (!callback_ || !running_) return;

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

  // Parse the report descriptor once and cache the contact map.  Counters are
  // recorded BEFORE/independent of the parse so failures are diagnosable.
  if (!descriptorValid_) {
    captureDiag_.descriptorParseAttemptCount++;
    descriptor_ = TouchpadDescriptor();
    DescriptorParseResult result = ParseTouchpadDescriptor(preparsed, descriptor_);
    descriptorValid_ = result.success;
    if (descriptorValid_) {
      captureDiag_.descriptorParseSuccessCount++;
      // Best-effort read of the real Contact Count Maximum (0x55) from the
      // device Feature report; never fatal if access is denied.
      if (ReadContactCountMaximum(raw->header.hDevice, preparsed, descriptor_,
                                  descriptor_.maxContacts)) {
        descriptor_.maxContactsFromDescriptor = true;
      }
    } else {
      captureDiag_.descriptorParseFailureCount++;
    }
  }
  if (!descriptorValid_) {
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
    if (!ParseReport(descriptor_, preparsed, report, reportSize, parsed)) {
      continue;
    }
    NativeFrame frame;
    if (assembler_.OnReport(parsed, NowSeconds(), frame)) {
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

DWORD WINAPI RawInputCapture::ThreadProc(LPVOID param) {
  RawInputCapture* self = static_cast<RawInputCapture*>(param);
  self->SetupOnThread();
  self->PumpMessages();
  return 0;
}

}  // namespace gestureflow
