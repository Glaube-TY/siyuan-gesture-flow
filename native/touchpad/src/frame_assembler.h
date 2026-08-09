#ifndef GESTURE_FLOW_TOUCHPAD_FRAME_ASSEMBLER_H_
#define GESTURE_FLOW_TOUCHPAD_FRAME_ASSEMBLER_H_

#include "hid_descriptor.h"
#include "native_events.h"

namespace gestureflow {

/** Parser/assembler diagnostics (read via native.getDiagnostics()). */
struct ParserStats {
  BYTE lastReportId = 0;
  LONG lastScanTime = 0;
  LONG lastReportedContactCount = -1;
  LONG expectedFrameContacts = 0;
  LONG assembledContactCount = 0;
  LONG activeContactCount = 0;
  ULONG hybridContinuationCount = 0;
  ULONG completedFrameCount = 0;
  ULONG emptyFrameCount = 0;
  bool contactIdParseSuccess = false;
  bool tipParseSuccess = false;
  bool xyParseSuccess = false;

  // --- incomplete-frame / validity diagnostics -----------------------------
  ULONG incompleteFrameDropCount = 0;
  ULONG incompleteTimeoutDropCount = 0;
  ULONG incompleteScanChangeDropCount = 0;
  ULONG incompleteSupersededDropCount = 0;
  LONG lastDroppedExpectedCount = 0;
  LONG lastDroppedAssembledCount = 0;
  ULONG duplicateContactIdCount = 0;
  ULONG invalidContactFieldCount = 0;
  LONG lastEmittedContactCount = 0;
  LONG lastEmittedContactsLength = 0;
  std::vector<int> lastEmittedContactIds;
};

/** Why a pending physical frame was dropped without emitting. */
enum class IncompleteReason {
  kTimeout,      // safety timeout while still incomplete
  kScanChange,   // scan time moved on before the frame completed
  kSuperseded,   // a new physical frame started before this one completed
};

/**
 * Aggregates raw HID reports into complete physical touchpad frames.
 *
 * Windows Precision Touchpads may use Hybrid Reporting Mode: one physical
 * frame is split across several HID reports --
 *
 *   report A: scanTime = T, contactCount = 3, contact 1
 *   report B: scanTime = T, contactCount = 0, contact 2   (continuation)
 *   report C: scanTime = T, contactCount = 0, contact 3   (continuation)
 *
 * A report with contactCount == 0 and the same scan time as the pending
 * frame is a continuation.  The frame is completed when the expected number
 * of contacts is collected, when the scan time changes, or after a short
 * safety timeout.  Only complete frames are emitted to JavaScript.
 *
 * Non-hybrid devices (every report carries all contact slots) complete a
 * frame immediately and are handled by the same code path.
 */
class FrameAssembler {
 public:
  void Reset();

  /**
   * Feed one parsed report.  Returns true and fills `out` when a complete
   * frame is emitted (or a genuine empty frame signalling all contacts up).
   */
  bool OnReport(const RawReport& report, double now, NativeFrame& out);

  const ParserStats& stats() const { return stats_; }

 private:
  bool pending_ = false;
  LONG expected_ = 0;
  LONG scanTime_ = 0;
  double lastReportTime_ = 0;
  std::vector<NativeContact> contacts_;
  bool previousFrameHadContacts_ = false;

  void AddContacts(const RawReport& report, double now);
  void TryComplete(NativeFrame& out, bool& emitted);
  void ResolvePending(IncompleteReason reason, NativeFrame& out, bool& emitted);
  void DropIncompleteFrame(IncompleteReason reason);
  void EmitCompleteFrame(NativeFrame& out, bool& emitted);
  void EmitEmpty(NativeFrame& out, bool& emitted, const RawReport& report);
  int UniqueContactCount() const;

  ParserStats stats_;
};

}  // namespace gestureflow

#endif  // GESTURE_FLOW_TOUCHPAD_FRAME_ASSEMBLER_H_
