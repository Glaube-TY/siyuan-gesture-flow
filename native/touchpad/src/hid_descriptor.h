#ifndef GESTURE_FLOW_TOUCHPAD_HID_DESCRIPTOR_H_
#define GESTURE_FLOW_TOUCHPAD_HID_DESCRIPTOR_H_

// windows.h first: hidsdi.h/hidpi.h need USHORT/NTSTATUS defined before use.
#include <windows.h>
#include <hidsdi.h>
#include <string>
#include <vector>

namespace gestureflow {

// Digitizer usage page (0x0D).
constexpr USHORT kDigitizerUsagePage = 0x0D;
// Generic Desktop usage page (0x01).
constexpr USHORT kGenericDesktopUsagePage = 0x01;

// Digitizer usages (Microsoft Windows Precision Touchpad HID protocol).
constexpr USHORT kUsageTipSwitch = 0x42;             // 1-bit contact state (button)
constexpr USHORT kUsageConfidence = 0x47;            // contact confidence
constexpr USHORT kUsageWidth = 0x48;                 // contact width
constexpr USHORT kUsageHeight = 0x49;                // contact height
constexpr USHORT kUsageContactIdentifier = 0x51;     // contact id
constexpr USHORT kUsageContactCount = 0x54;          // per-frame contact count
constexpr USHORT kUsageContactCountMaximum = 0x55;   // device capability (Feature)
constexpr USHORT kUsageScanTime = 0x56;
// Finger logical collection usage (Digitizer page).
constexpr USHORT kUsageFinger = 0x22;

// Generic Desktop usages.
constexpr USHORT kUsageX = 0x30;
constexpr USHORT kUsageY = 0x31;

/** Where descriptor parsing failed (for diagnostics). */
enum class DescriptorStage {
  kNotStarted = 0,
  kGetCaps,
  kValueCapsInput,
  kButtonCaps,
  kLinkCollectionNodes,
  kFingerCollections,
  kContactFieldMap,
  kFeatureCaps,
  kDone,
};

/** Structured descriptor parse outcome (no more bare bool). */
struct DescriptorParseResult {
  bool success = false;
  DescriptorStage stage = DescriptorStage::kNotStarted;
  LONG status = 0;  // raw HIDP_STATUS / NTSTATUS
  std::string reason;
};

/** One contact (id/tip/x/y) belonging to a single Finger logical collection. */
struct ContactFieldMap {
  USHORT fingerCollection = 0;   // grouping Finger collection index
  BYTE reportId = 0;             // primary (X) report id
  bool valid = false;

  // Actual collections each field lives in (self or a descendant of the
  // Finger collection) -- used for reading, not just grouping.
  USHORT xCollection = 0;
  USHORT yCollection = 0;
  USHORT idCollection = 0;
  USHORT tipCollection = 0;
  BYTE xReportId = 0;
  BYTE yReportId = 0;
  BYTE idReportId = 0;
  BYTE tipReportId = 0;

  bool validX = false;
  bool validY = false;
  bool validId = false;
  bool validTip = false;

  /**
   * True when ALL fields GestureFlow requires (X, Y, Contact ID, Tip) exist.
   * A contact map missing any of them cannot be tracked.  `valid` is
   * `usable` (kept separately so diagnostics can show the breakdown).
   */
  bool usable = false;

  LONG xLogicalMin = 0;
  LONG xLogicalMax = 0;
  LONG yLogicalMin = 0;
  LONG yLogicalMax = 0;
};

/** Report-level caps (contact count + scan time). */
struct ReportCaps {
  BYTE reportId = 0;

  bool validContactCount = false;
  USHORT contactCountLinkCollection = 0;
  BYTE contactCountReportId = 0;

  bool validScanTime = false;
  USHORT scanTimeLinkCollection = 0;
  BYTE scanTimeReportId = 0;
};

/** Compact ValueCap summary for diagnostics. */
struct DescriptorCapSummary {
  USHORT usagePage = 0;
  bool isRange = false;
  USHORT usageMin = 0;
  USHORT usageMax = 0;
  BYTE reportId = 0;
  USHORT linkCollection = 0;
  USHORT reportCount = 0;
  USHORT bitSize = 0;
  LONG logicalMin = 0;
  LONG logicalMax = 0;
  LONG physicalMin = 0;
  LONG physicalMax = 0;
};

/** Compact ButtonCap summary for diagnostics. */
struct DescriptorButtonSummary {
  USHORT usagePage = 0;
  bool isRange = false;
  USHORT usageMin = 0;
  USHORT usageMax = 0;
  BYTE reportId = 0;
  USHORT linkCollection = 0;
};

/** Compact LinkCollectionNode summary for diagnostics. */
struct DescriptorNodeSummary {
  USHORT index = 0;
  USHORT linkUsagePage = 0;
  USHORT linkUsage = 0;
  USHORT parent = 0;
  USHORT numberOfChildren = 0;
  USHORT firstChild = 0;
  USHORT nextSibling = 0;
  ULONG collectionType = 0;
};

/** Everything the parser needs, built once from the preparsed descriptor. */
struct TouchpadDescriptor {
  bool valid = false;
  DescriptorParseResult parseResult;

  // HIDP_CAPS summary.
  ULONG inputReportByteLength = 0;
  ULONG featureReportByteLength = 0;
  USHORT numberInputValueCaps = 0;
  USHORT numberInputButtonCaps = 0;
  USHORT numberFeatureValueCaps = 0;
  USHORT numberLinkCollectionNodes = 0;
  USHORT deviceUsagePage = 0;
  USHORT deviceUsage = 0;

  ReportCaps report;

  // Feature cap for Contact Count Maximum (0x55).
  bool validContactCountMaxCap = false;
  USHORT contactCountMaxLinkCollection = 0;
  BYTE contactCountMaxReportId = 0;
  LONG contactCountMaxLogicalMax = 0;

  /** One entry per Finger logical collection (NOT per concurrent contact). */
  std::vector<ContactFieldMap> contacts;

  /** Actual Contact Count Maximum read from the device Feature report. */
  int maxContacts = 0;
  bool maxContactsFromDescriptor = false;

  // Diagnostic summaries (built once).
  std::vector<DescriptorCapSummary> inputValueCaps;
  std::vector<DescriptorButtonSummary> inputButtonCaps;
  std::vector<DescriptorNodeSummary> linkCollectionNodes;
  std::vector<USHORT> fingerCollections;
};

/** One parsed contact slot from a single HID report. */
struct RawContact {
  int id = 0;
  bool idValid = false;
  double x = 0.0;
  bool xValid = false;
  double y = 0.0;
  bool yValid = false;
  bool tip = false;
  bool tipValid = false;
  /**
   * True when the slot is occupied in this report (at least one coordinate
   * readable).  A slot is only a TRACKED contact when every validity flag is
   * true AND tip is down (see FrameAssembler::AddContacts).
   */
  bool present = false;
};

/** The per-report parse result handed to the frame assembler. */
struct RawReport {
  BYTE reportId = 0;
  LONG contactCount = -1;  // -1 = not readable in this report
  LONG scanTime = 0;       // 0 = not available
  std::vector<RawContact> contacts;
};

/**
 * Parse the preparsed descriptor into a {@link TouchpadDescriptor}.
 *
 * Builds the contact map from the HID link-collection tree: every "Finger"
 * logical collection (usage 0x0D/0x22) becomes one {@link ContactFieldMap},
 * gathering Contact ID / Tip / X / Y from its own and descendant
 * collections.  Also records a structured caps summary for diagnostics and
 * attempts to read the actual Contact Count Maximum from the device Feature
 * report.
 */
DescriptorParseResult ParseTouchpadDescriptor(PHIDP_PREPARSED_DATA preparsed,
                                              TouchpadDescriptor& out);

/**
 * Read one raw HID report against a {@link TouchpadDescriptor}.
 *
 * Only reads fields whose caps' report id matches the current report
 * (HidP_GetUsageValue returns HIDP_STATUS_INCOMPATIBLE_REPORT_ID otherwise).
 */
bool ParseReport(const TouchpadDescriptor& desc, PHIDP_PREPARSED_DATA preparsed,
                 const BYTE* report, ULONG length, RawReport& out);

/**
 * Best-effort read of the actual Contact Count Maximum (0x55) from the
 * device Feature report.  Requires opening the HID collection; may fail on
 * Precision Touchpads claimed by the driver -- never fatal.  On success
 * writes into `maxContacts` and returns true.
 */
bool ReadContactCountMaximum(HANDLE device, PHIDP_PREPARSED_DATA preparsed,
                             const TouchpadDescriptor& desc, int& maxContacts);

}  // namespace gestureflow

#endif  // GESTURE_FLOW_TOUCHPAD_HID_DESCRIPTOR_H_
