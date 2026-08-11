#ifndef GESTURE_FLOW_TOUCHPAD_RAW_INPUT_CAPTURE_H_
#define GESTURE_FLOW_TOUCHPAD_RAW_INPUT_CAPTURE_H_

#include <atomic>
#include <functional>
#include <mutex>
#include <unordered_map>
#include <windows.h>

#include "frame_assembler.h"
#include "hid_descriptor.h"
#include "native_events.h"

namespace gestureflow {

/**
 * Raw Input / WM_INPUT counters, recorded BEFORE descriptor parsing so a
 * parse failure can never hide whether touchpad data actually reached us.
 */
struct RawCaptureDiagnostics {
  ULONG wmInputCount = 0;               // WM_INPUT entered WndProc
  ULONG rawInputReadSuccessCount = 0;   // GetRawInputData succeeded
  ULONG rawInputHidPacketCount = 0;     // RIM_TYPEHID packet
  ULONG rawInputHidReportCount = 0;     // dwCount reports seen (accumulated)
  DWORD lastDwSizeHid = 0;
  DWORD lastDwCount = 0;
  ULONG preparsedDataRequestCount = 0;
  ULONG preparsedDataSuccessCount = 0;
  ULONG descriptorParseAttemptCount = 0;
  ULONG descriptorParseSuccessCount = 0;
  ULONG descriptorParseFailureCount = 0;
  ULONG deviceContextCount = 0;          // distinct Raw Input handles cached
  ULONG deviceSwitchCount = 0;           // interleaved handle transitions
  ULONG deviceArrivalCount = 0;          // WM_INPUT_DEVICE_CHANGE / GIDC_ARRIVAL
  ULONG deviceRemovalCount = 0;          // WM_INPUT_DEVICE_CHANGE / GIDC_REMOVAL
  ULONG callbackDeliveryCount = 0;      // complete frames handed to JS
  ULONG invalidFrameDropCount = 0;      // frames rejected by ValidateNativeFrame
};

/** Cheap capability snapshot that does not copy diagnostic vectors. */
struct TouchpadDescriptorStatus {
  bool valid = false;
  size_t contactFieldCount = 0;
  int maxContacts = 0;
};

/**
 * Raw Input (WM_INPUT) Precision Touchpad capture.
 *
 * Registers a hidden message window with RIDEV_INPUTSINK | RIDEV_DEVNOTIFY
 * for the digitizer usage page (0x0D) and decodes HID reports with the HID
 * parser API (HidP_*).  The report descriptor is parsed ONCE into a
 * {@link TouchpadDescriptor} contact map; each report is decoded against
 * that map and passed through a {@link FrameAssembler} so Hybrid Reporting
 * Mode (one physical frame split across multiple reports) yields a single
 * complete frame.  A dedicated thread runs the message loop.
 *
 * Start/stop are fully reversible: stopping destroys the window, unregisters
 * the device, and joins the thread.
 */
class RawInputCapture {
 public:
  using FrameCallback = std::function<void(const NativeFrame&)>;

  RawInputCapture();
  ~RawInputCapture();

  /** Start capture.  Returns false when registration failed. */
  bool Start(FrameCallback callback);

  /** Stop capture and release all resources.  Safe to call twice. */
  void Stop();

  bool running() const { return running_.load(); }

  /** Raw-input counters (independent of descriptor parse success). */
  RawCaptureDiagnostics captureDiagSnapshot() const;

  /** Parser/assembler diagnostics (for native.getDiagnostics()). */
  ParserStats parserStatsSnapshot() const;

  /** Parsed descriptor (for native.getDiagnostics()). */
  TouchpadDescriptor descriptorSnapshot() const;

  /** Minimal descriptor data used by the capabilities getter. */
  TouchpadDescriptorStatus descriptorStatus() const;

 private:
  FrameCallback callback_;
  HWND hwnd_ = nullptr;
  HANDLE thread_ = nullptr;
  HANDLE startEvent_ = nullptr;
  std::atomic<bool> running_{false};

  /** Guards descriptor, assembler and diagnostics read from the JS thread. */
  mutable std::mutex stateMutex_;

  /**
   * HID descriptors and Hybrid Reporting assembly state belong to one Raw
   * Input device handle.  Precision-touchpad stacks can expose multiple TLC
   * handles that interleave WM_INPUT; one global parser would be reset on every
   * transition and could only ever deliver the first stationary sample.
   */
  struct DeviceCaptureState {
    TouchpadDescriptor descriptor;
    bool descriptorValid = false;
    FrameAssembler assembler;
  };
  std::unordered_map<HANDLE, DeviceCaptureState> deviceStates_;
  /** Most recently observed device, used only for detailed diagnostics. */
  HANDLE diagnosticDevice_ = nullptr;
  HANDLE lastInputDevice_ = nullptr;
  RawCaptureDiagnostics captureDiag_;

  void InvalidateDescriptor();
  void RecordWmInput();

  /** Create the hidden window + register Raw Input ON the capture thread. */
  void SetupOnThread();
  bool RegisterRawInput();
  void UnregisterRawInput();
  void PumpMessages();
  static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);
  void HandleInput(HRAWINPUT rawInput);
  void HandleDeviceChange(WPARAM change, HANDLE device);
  static DWORD WINAPI ThreadProc(LPVOID param);
};

}  // namespace gestureflow

#endif  // GESTURE_FLOW_TOUCHPAD_RAW_INPUT_CAPTURE_H_
