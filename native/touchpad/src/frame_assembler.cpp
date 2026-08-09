#include "frame_assembler.h"

#include <algorithm>
#include <cmath>

namespace gestureflow {

namespace {
// Safety timeout for an incomplete pending frame, in SECONDS (matches the
// NowSeconds() timestamps fed into OnReport).
constexpr double kFrameTimeoutSeconds = 0.1;
}  // namespace

void FrameAssembler::Reset() {
  pending_ = false;
  expected_ = 0;
  scanTime_ = 0;
  lastReportTime_ = 0;
  contacts_.clear();
  previousFrameHadContacts_ = false;
  stats_ = ParserStats();
}

bool FrameAssembler::OnReport(const RawReport& report, double now, NativeFrame& out) {
  stats_.lastReportId = report.reportId;
  stats_.lastScanTime = report.scanTime;
  stats_.lastReportedContactCount = report.contactCount;

  bool emitted = false;

  // Safety timeout: force-resolve a pending frame that never completed.  An
  // incomplete frame is DROPPED (never emitted as a partial frame).
  if (pending_ && now - lastReportTime_ > kFrameTimeoutSeconds) {
    ResolvePending(IncompleteReason::kTimeout, out, emitted);
    if (emitted) return true;
  }

  if (report.contactCount > 0) {
    // Start a new physical frame (or the first report of one).  A leftover
    // pending frame is resolved first (emitted if complete, else dropped)
    // without discarding the incoming report.
    if (pending_) {
      ResolvePending(IncompleteReason::kSuperseded, out, emitted);
      if (emitted) return true;
    }
    pending_ = true;
    expected_ = report.contactCount;
    scanTime_ = report.scanTime;
    contacts_.clear();
    stats_.expectedFrameContacts = expected_;
    stats_.assembledContactCount = 0;
    AddContacts(report, now);
    TryComplete(out, emitted);
    return emitted;
  }

  if (report.contactCount == 0) {
    // contactCount == 0: Hybrid continuation (same frame) or genuine empty.
    if (pending_) {
      const bool sameScan =
          scanTime_ == report.scanTime || scanTime_ == 0 || report.scanTime == 0;
      if (sameScan) {
        stats_.hybridContinuationCount++;
        AddContacts(report, now);
        TryComplete(out, emitted);
        return emitted;
      }
      // Scan time changed without completing the expected count.
      ResolvePending(IncompleteReason::kScanChange, out, emitted);
      if (emitted) return true;
    }
    // No pending frame: this is a genuine empty report.
    if (previousFrameHadContacts_) {
      EmitEmpty(out, emitted, report);
    } else {
      // Quietly drop idle empty reports.
      stats_.emptyFrameCount++;
    }
    return emitted;
  }

  // contactCount < 0: no reliable Contact Count in this report.
  if (pending_) {
    // Compatible path: if the scan time matches the pending frame, treat it
    // as a continuation.
    const bool sameScan =
        scanTime_ == report.scanTime || scanTime_ == 0 || report.scanTime == 0;
    if (sameScan) {
      stats_.hybridContinuationCount++;
      AddContacts(report, now);
      TryComplete(out, emitted);
      return emitted;
    }
    ResolvePending(IncompleteReason::kScanChange, out, emitted);
    if (emitted) return true;
  }
  // Without a reliable count we must NOT emit an "all fingers up" frame.
  return emitted;
}

void FrameAssembler::AddContacts(const RawReport& report, double now) {
  lastReportTime_ = now;
  for (const RawContact& c : report.contacts) {
    // A tracked contact needs COMPLETE two-dimensional geometry plus a valid
    // Contact ID and Tip.  Contact ID 0 is a legal value (not "missing").
    // A slot with tip == false (unused HID null slot) is not an active
    // contact and must never fill the expected count.
    if (!c.present || !c.idValid || !c.xValid || !c.yValid || !c.tipValid || !c.tip) {
      if (c.present) stats_.invalidContactFieldCount++;
      continue;
    }
    NativeContact nc;
    nc.id = c.id;
    nc.x = std::max(0.0, std::min(1.0, c.x));
    nc.y = std::max(0.0, std::min(1.0, c.y));
    nc.touching = true;

    // Deduplicate by Contact ID — including id 0.  A continuation report may
    // repeat a contact id; update the last position instead of pushing a
    // duplicate.  A repeated id is also a validity anomaly (a real physical
    // frame must have unique ids), so count it for diagnostics.
    bool replaced = false;
    for (NativeContact& existing : contacts_) {
      if (existing.id == nc.id) {
        existing.x = nc.x;
        existing.y = nc.y;
        existing.touching = nc.touching;
        replaced = true;
        stats_.duplicateContactIdCount++;
        break;
      }
    }
    if (!replaced) {
      contacts_.push_back(nc);
    }

    if (c.idValid) stats_.contactIdParseSuccess = true;
    if (c.xValid && c.yValid) stats_.xyParseSuccess = true;
    if (c.tipValid) stats_.tipParseSuccess = true;
  }
  stats_.assembledContactCount = static_cast<LONG>(contacts_.size());
  stats_.activeContactCount = static_cast<LONG>(UniqueContactCount());
}

void FrameAssembler::TryComplete(NativeFrame& out, bool& emitted) {
  if (!pending_) return;
  if (expected_ > 0 && UniqueContactCount() == expected_) {
    EmitCompleteFrame(out, emitted);
  }
}

void FrameAssembler::ResolvePending(IncompleteReason reason, NativeFrame& out, bool& emitted) {
  if (!pending_) return;
  pending_ = false;
  if (expected_ > 0 && UniqueContactCount() == expected_) {
    EmitCompleteFrame(out, emitted);
  } else {
    DropIncompleteFrame(reason);
  }
}

void FrameAssembler::DropIncompleteFrame(IncompleteReason reason) {
  stats_.incompleteFrameDropCount++;
  switch (reason) {
    case IncompleteReason::kTimeout:
      stats_.incompleteTimeoutDropCount++;
      break;
    case IncompleteReason::kScanChange:
      stats_.incompleteScanChangeDropCount++;
      break;
    case IncompleteReason::kSuperseded:
      stats_.incompleteSupersededDropCount++;
      break;
  }
  stats_.lastDroppedExpectedCount = expected_;
  stats_.lastDroppedAssembledCount = static_cast<LONG>(UniqueContactCount());
  expected_ = 0;
  scanTime_ = 0;
  lastReportTime_ = 0;
  contacts_.clear();
}

/** Emit ONLY a fully assembled frame (unique contacts == expected count). */
void FrameAssembler::EmitCompleteFrame(NativeFrame& out, bool& emitted) {
  pending_ = false;
  lastReportTime_ = 0;
  const int unique = UniqueContactCount();
  out.timestamp = 0;  // set by the caller if needed
  out.contacts = std::move(contacts_);
  // A complete frame's contact count is its ACTUAL contact count, never the
  // expected metadata in place of the real number of contacts.
  out.contactCount = static_cast<int>(out.contacts.size());
  contacts_.clear();
  previousFrameHadContacts_ = true;
  stats_.completedFrameCount++;
  stats_.lastEmittedContactCount = out.contactCount;
  stats_.lastEmittedContactsLength = static_cast<LONG>(out.contacts.size());
  stats_.lastEmittedContactIds.clear();
  for (const NativeContact& c : out.contacts) {
    stats_.lastEmittedContactIds.push_back(c.id);
  }
  std::sort(stats_.lastEmittedContactIds.begin(), stats_.lastEmittedContactIds.end());
  emitted = true;
  (void)unique;
}

void FrameAssembler::EmitEmpty(NativeFrame& out, bool& emitted, const RawReport& report) {
  out.timestamp = 0;
  out.contacts.clear();
  out.contactCount = 0;
  previousFrameHadContacts_ = false;
  stats_.emptyFrameCount++;
  stats_.lastEmittedContactCount = 0;
  stats_.lastEmittedContactsLength = 0;
  stats_.lastEmittedContactIds.clear();
  (void)report;
  emitted = true;
}

int FrameAssembler::UniqueContactCount() const {
  std::vector<int> ids;
  ids.reserve(contacts_.size());
  for (const NativeContact& c : contacts_) ids.push_back(c.id);
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
  return static_cast<int>(ids.size());
}

bool ValidateNativeFrame(const NativeFrame& frame) {
  if (frame.contacts.empty()) {
    // Empty frame: contactCount must be 0 (or absent) — never a positive
    // "expected" count standing in for contacts that are not there.
    return frame.contactCount <= 0;
  }
  if (frame.contactCount >= 0 && frame.contactCount != static_cast<int>(frame.contacts.size())) {
    return false;
  }
  std::vector<int> ids;
  ids.reserve(frame.contacts.size());
  for (const NativeContact& c : frame.contacts) {
    if (!std::isfinite(static_cast<double>(c.id))) return false;
    if (!std::isfinite(c.x) || !std::isfinite(c.y)) return false;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) return false;
    ids.push_back(c.id);
  }
  std::sort(ids.begin(), ids.end());
  if (std::adjacent_find(ids.begin(), ids.end()) != ids.end()) return false;
  return true;
}

}  // namespace gestureflow
