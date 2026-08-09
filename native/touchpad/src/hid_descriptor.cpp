#include "hid_descriptor.h"

#include <algorithm>
#include <cstring>

namespace gestureflow {

namespace {

bool UsageInRange(const HIDP_VALUE_CAPS& cap, USHORT usage) {
  if (cap.IsRange) {
    return usage >= cap.Range.UsageMin && usage <= cap.Range.UsageMax;
  }
  return cap.NotRange.Usage == usage;
}

bool ButtonUsageInRange(const HIDP_BUTTON_CAPS& cap, USHORT usage) {
  if (cap.IsRange) {
    return usage >= cap.Range.UsageMin && usage <= cap.Range.UsageMax;
  }
  return cap.NotRange.Usage == usage;
}

DescriptorParseResult MakeResult(bool success, DescriptorStage stage, LONG status,
                                 const char* reason) {
  DescriptorParseResult r;
  r.success = success;
  r.stage = stage;
  r.status = status;
  if (reason) r.reason = reason;
  return r;
}

const char* StageName(DescriptorStage stage) {
  switch (stage) {
    case DescriptorStage::kNotStarted: return "not-started";
    case DescriptorStage::kGetCaps: return "get-caps";
    case DescriptorStage::kValueCapsInput: return "value-caps-input";
    case DescriptorStage::kButtonCaps: return "button-caps";
    case DescriptorStage::kLinkCollectionNodes: return "link-collection-nodes";
    case DescriptorStage::kFingerCollections: return "finger-collections";
    case DescriptorStage::kContactFieldMap: return "contact-field-map";
    case DescriptorStage::kFeatureCaps: return "feature-caps";
    case DescriptorStage::kDone: return "done";
    default: return "unknown";
  }
}

}  // namespace

/** Normalise a raw value into [0,1] using the descriptor's logical range. */
double NormaliseRange(ULONG value, LONG logicalMin, LONG logicalMax) {
  if (logicalMax <= logicalMin) return 0.0;
  double v = (static_cast<double>(value) - logicalMin) /
             (static_cast<double>(logicalMax) - logicalMin);
  return std::max(0.0, std::min(1.0, v));
}

/**
 * Best-effort read of the actual Contact Count Maximum (usage 0x55) from the
 * device's Feature report.  Requires opening the HID collection with
 * CreateFile; on Precision Touchpads this can fail with access denied (the
 * device is claimed by the touchpad driver) -- never fatal.
 */
bool ReadContactCountMaximum(HANDLE device, PHIDP_PREPARSED_DATA preparsed,
                             const TouchpadDescriptor& desc, int& maxContacts) {
  if (!device || !preparsed || !desc.validContactCountMaxCap) return false;

  // RIDI_DEVICENAME: pcbSize is the size in WCHARs INCLUDING the null
  // terminator — NOT bytes.  A fixed `wchar_t[512]` with `sizeof()` (1024
  // bytes) misreports the buffer, so read the device path dynamically in two
  // steps: query the required length, allocate, then fetch.
  UINT nameChars = 0;
  if (GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, nullptr, &nameChars) ==
      static_cast<UINT>(-1)) {
    return false;
  }
  if (nameChars == 0 || nameChars > 32768) {
    return false;  // sanity guard against absurd lengths
  }
  std::vector<wchar_t> deviceName(nameChars, L'\0');
  UINT actualChars = nameChars;
  if (GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, deviceName.data(), &actualChars) ==
      static_cast<UINT>(-1)) {
    return false;
  }
  deviceName[nameChars - 1] = L'\0';  // defensive null termination

  HANDLE dev = CreateFileW(deviceName.data(), GENERIC_READ | GENERIC_WRITE,
                           FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0,
                           nullptr);
  if (dev == INVALID_HANDLE_VALUE) {
    return false;
  }
  bool ok = false;
  if (desc.featureReportByteLength > 0) {
    std::vector<BYTE> buffer(desc.featureReportByteLength, 0);
    buffer[0] = desc.contactCountMaxReportId;
    if (HidD_GetFeature(dev, buffer.data(), static_cast<ULONG>(buffer.size()))) {
      ULONG value = 0;
      if (HidP_GetUsageValue(HidP_Feature, kDigitizerUsagePage,
                             desc.contactCountMaxLinkCollection,
                             kUsageContactCountMaximum, &value, preparsed,
                             reinterpret_cast<char*>(buffer.data()),
                             static_cast<ULONG>(buffer.size())) == HIDP_STATUS_SUCCESS) {
        if (value > 0 && value < 100) {
          maxContacts = static_cast<int>(value);
          ok = true;
        }
      }
    }
  }
  CloseHandle(dev);
  return ok;
}

DescriptorParseResult ParseTouchpadDescriptor(PHIDP_PREPARSED_DATA preparsed,
                                              TouchpadDescriptor& out) {
  if (!preparsed) {
    return MakeResult(false, DescriptorStage::kNotStarted, 0, "null preparsed data");
  }

  // --- HIDP_CAPS -----------------------------------------------------------
  HIDP_CAPS caps = {};
  LONG status = HidP_GetCaps(preparsed, &caps);
  if (status != HIDP_STATUS_SUCCESS) {
    return MakeResult(false, DescriptorStage::kGetCaps, status, "HidP_GetCaps failed");
  }
  out.inputReportByteLength = caps.InputReportByteLength;
  out.featureReportByteLength = caps.FeatureReportByteLength;
  out.numberInputValueCaps = caps.NumberInputValueCaps;
  out.numberInputButtonCaps = caps.NumberInputButtonCaps;
  out.numberFeatureValueCaps = caps.NumberFeatureValueCaps;
  out.numberLinkCollectionNodes = caps.NumberLinkCollectionNodes;
  out.deviceUsagePage = caps.UsagePage;
  out.deviceUsage = caps.Usage;

  // --- Input Value caps ----------------------------------------------------
  std::vector<HIDP_VALUE_CAPS> valueCaps(caps.NumberInputValueCaps);
  USHORT valueCapsLength = caps.NumberInputValueCaps;
  if (valueCapsLength > 0) {
    status = HidP_GetValueCaps(HidP_Input, valueCaps.data(), &valueCapsLength, preparsed);
    if (status != HIDP_STATUS_SUCCESS) {
      return MakeResult(false, DescriptorStage::kValueCapsInput, status,
                        "HidP_GetValueCaps(Input) failed");
    }
  }

  // --- Input Button caps ---------------------------------------------------
  std::vector<HIDP_BUTTON_CAPS> buttonCaps(caps.NumberInputButtonCaps);
  USHORT buttonCapsLength = caps.NumberInputButtonCaps;
  if (buttonCapsLength > 0) {
    status = HidP_GetButtonCaps(HidP_Input, buttonCaps.data(), &buttonCapsLength, preparsed);
    if (status != HIDP_STATUS_SUCCESS) {
      return MakeResult(false, DescriptorStage::kButtonCaps, status,
                        "HidP_GetButtonCaps(Input) failed");
    }
  }

  // --- Link collection nodes ----------------------------------------------
  std::vector<HIDP_LINK_COLLECTION_NODE> nodes(caps.NumberLinkCollectionNodes);
  ULONG nodeCount = caps.NumberLinkCollectionNodes;
  if (nodeCount > 0) {
    status = HidP_GetLinkCollectionNodes(nodes.data(), &nodeCount, preparsed);
    if (status != HIDP_STATUS_SUCCESS) {
      return MakeResult(false, DescriptorStage::kLinkCollectionNodes, status,
                        "HidP_GetLinkCollectionNodes failed");
    }
  }

  // Diagnostic summaries.
  for (USHORT i = 0; i < valueCapsLength; i++) {
    const HIDP_VALUE_CAPS& cap = valueCaps[i];
    DescriptorCapSummary s;
    s.usagePage = cap.UsagePage;
    s.isRange = cap.IsRange != FALSE;
    s.usageMin = s.isRange ? cap.Range.UsageMin : cap.NotRange.Usage;
    s.usageMax = s.isRange ? cap.Range.UsageMax : cap.NotRange.Usage;
    s.reportId = cap.ReportID;
    s.linkCollection = cap.LinkCollection;
    s.reportCount = cap.ReportCount;
    s.bitSize = cap.BitSize;
    s.logicalMin = cap.LogicalMin;
    s.logicalMax = cap.LogicalMax;
    s.physicalMin = cap.PhysicalMin;
    s.physicalMax = cap.PhysicalMax;
    out.inputValueCaps.push_back(s);
  }
  for (USHORT i = 0; i < buttonCapsLength; i++) {
    const HIDP_BUTTON_CAPS& cap = buttonCaps[i];
    DescriptorButtonSummary s;
    s.usagePage = cap.UsagePage;
    s.isRange = cap.IsRange != FALSE;
    s.usageMin = s.isRange ? cap.Range.UsageMin : cap.NotRange.Usage;
    s.usageMax = s.isRange ? cap.Range.UsageMax : cap.NotRange.Usage;
    s.reportId = cap.ReportID;
    s.linkCollection = cap.LinkCollection;
    out.inputButtonCaps.push_back(s);
  }
  for (USHORT i = 0; i < nodeCount; i++) {
    const HIDP_LINK_COLLECTION_NODE& node = nodes[i];
    DescriptorNodeSummary s;
    s.index = i;
    s.linkUsagePage = node.LinkUsagePage;
    s.linkUsage = node.LinkUsage;
    s.parent = node.Parent;
    s.numberOfChildren = node.NumberOfChildren;
    s.firstChild = node.FirstChild;
    s.nextSibling = node.NextSibling;
    s.collectionType = node.CollectionType;
    out.linkCollectionNodes.push_back(s);
  }

  // --- Report-level caps (contact count / scan time) ------------------------
  for (USHORT i = 0; i < valueCapsLength; i++) {
    const HIDP_VALUE_CAPS& cap = valueCaps[i];
    if (cap.UsagePage != kDigitizerUsagePage) continue;
    if (UsageInRange(cap, kUsageContactCount)) {
      out.report.validContactCount = true;
      out.report.contactCountLinkCollection = cap.LinkCollection;
      out.report.contactCountReportId = cap.ReportID;
    } else if (UsageInRange(cap, kUsageScanTime)) {
      out.report.validScanTime = true;
      out.report.scanTimeLinkCollection = cap.LinkCollection;
      out.report.scanTimeReportId = cap.ReportID;
    }
  }
  if (!out.report.validContactCount) {
    return MakeResult(false, DescriptorStage::kValueCapsInput, 0,
                      "no Contact Count (0x0D/0x54) usage found");
  }

  // --- Finger collections --------------------------------------------------
  auto isFinger = [&nodes](USHORT index) {
    return index < nodes.size() &&
           nodes[index].LinkUsagePage == kDigitizerUsagePage &&
           nodes[index].LinkUsage == kUsageFinger;
  };
  // Whether collection `index` is the finger `finger` or a descendant of it.
  auto belongsToFinger = [&nodes](USHORT index, USHORT finger) {
    if (index >= nodes.size()) return false;
    USHORT cur = index;
    while (cur != finger) {
      if (cur >= nodes.size() || cur == 0) return false;  // hit root sentinel
      USHORT parent = nodes[cur].Parent;
      if (parent == cur || parent >= nodes.size()) return false;
      cur = parent;
    }
    return true;
  };

  std::vector<USHORT> fingerIndices;
  for (USHORT i = 0; i < nodeCount; i++) {
    if (isFinger(i)) fingerIndices.push_back(i);
  }
  out.fingerCollections = fingerIndices;
  if (fingerIndices.empty()) {
    return MakeResult(false, DescriptorStage::kFingerCollections, 0,
                      "no Finger logical collection (0x0D/0x22) found");
  }

  // --- Contact field map ---------------------------------------------------
  for (USHORT finger : fingerIndices) {
    ContactFieldMap field;
    field.fingerCollection = finger;
    field.reportId = 0;

    // Gather X / Y / Contact ID value caps belonging to this finger.
    for (USHORT i = 0; i < valueCapsLength; i++) {
      const HIDP_VALUE_CAPS& cap = valueCaps[i];
      if (!belongsToFinger(cap.LinkCollection, finger)) continue;
      if (cap.UsagePage == kGenericDesktopUsagePage) {
        if (UsageInRange(cap, kUsageX) && !field.validX) {
          field.validX = true;
          field.xCollection = cap.LinkCollection;
          field.xReportId = cap.ReportID;
          field.xLogicalMin = cap.LogicalMin;
          field.xLogicalMax = cap.LogicalMax;
          field.reportId = field.reportId ? field.reportId : cap.ReportID;
        } else if (UsageInRange(cap, kUsageY) && !field.validY) {
          field.validY = true;
          field.yCollection = cap.LinkCollection;
          field.yReportId = cap.ReportID;
          field.yLogicalMin = cap.LogicalMin;
          field.yLogicalMax = cap.LogicalMax;
        }
      } else if (cap.UsagePage == kDigitizerUsagePage &&
                 UsageInRange(cap, kUsageContactIdentifier)) {
        field.validId = true;
        field.idCollection = cap.LinkCollection;
        field.idReportId = cap.ReportID;
      }
    }

    // Tip Switch button caps belonging to this finger.
    for (USHORT i = 0; i < buttonCapsLength; i++) {
      const HIDP_BUTTON_CAPS& cap = buttonCaps[i];
      if (cap.UsagePage != kDigitizerUsagePage) continue;
      if (!ButtonUsageInRange(cap, kUsageTipSwitch)) continue;
      if (!belongsToFinger(cap.LinkCollection, finger)) continue;
      field.validTip = true;
      field.tipCollection = cap.LinkCollection;
      field.tipReportId = cap.ReportID;
      break;
    }

    field.usable = field.validX && field.validY && field.validId && field.validTip;
    // A contact map missing any GestureFlow-required field cannot be tracked.
    field.valid = field.usable;
    if (field.valid) {
      out.contacts.push_back(field);
    }
  }
  if (out.contacts.empty()) {
    return MakeResult(false, DescriptorStage::kContactFieldMap, 0,
                      "no contact field map could be built from finger collections");
  }

  // --- Feature caps (Contact Count Maximum 0x55) ----------------------------
  std::vector<HIDP_VALUE_CAPS> featureCaps(caps.NumberFeatureValueCaps);
  USHORT featureCapsLength = caps.NumberFeatureValueCaps;
  if (featureCapsLength > 0) {
    status = HidP_GetValueCaps(HidP_Feature, featureCaps.data(), &featureCapsLength, preparsed);
    if (status != HIDP_STATUS_SUCCESS) {
      return MakeResult(false, DescriptorStage::kFeatureCaps, status,
                        "HidP_GetValueCaps(Feature) failed");
    }
    for (USHORT i = 0; i < featureCapsLength; i++) {
      const HIDP_VALUE_CAPS& cap = featureCaps[i];
      if (cap.UsagePage != kDigitizerUsagePage) continue;
      if (UsageInRange(cap, kUsageContactCountMaximum)) {
        out.validContactCountMaxCap = true;
        out.contactCountMaxLinkCollection = cap.LinkCollection;
        out.contactCountMaxReportId = cap.ReportID;
        out.contactCountMaxLogicalMax = cap.LogicalMax;
        break;
      }
    }
  }

  out.valid = true;
  out.parseResult = MakeResult(true, DescriptorStage::kDone, 0, nullptr);
  out.parseResult.reason = StageName(DescriptorStage::kDone);
  return out.parseResult;
}

bool ParseReport(const TouchpadDescriptor& desc, PHIDP_PREPARSED_DATA preparsed,
                 const BYTE* report, ULONG length, RawReport& out) {
  if (!desc.valid || !report || length == 0) return false;
  out.reportId = report[0];

  auto matchesReport = [out](BYTE capReportId) {
    return capReportId == 0 || capReportId == out.reportId;
  };
  const char* r = reinterpret_cast<const char*>(report);

  // Contact Count (usage 0x0D/0x54).
  if (desc.report.validContactCount &&
      matchesReport(desc.report.contactCountReportId)) {
    ULONG value = 0;
    if (HidP_GetUsageValue(HidP_Input, kDigitizerUsagePage,
                           desc.report.contactCountLinkCollection, kUsageContactCount,
                           &value, preparsed, const_cast<char*>(r), length) == HIDP_STATUS_SUCCESS) {
      out.contactCount = static_cast<LONG>(value);
    }
  }

  // Scan Time (usage 0x0D/0x56).
  if (desc.report.validScanTime && matchesReport(desc.report.scanTimeReportId)) {
    ULONG value = 0;
    if (HidP_GetUsageValue(HidP_Input, kDigitizerUsagePage, desc.report.scanTimeLinkCollection,
                           kUsageScanTime, &value, preparsed, const_cast<char*>(r),
                           length) == HIDP_STATUS_SUCCESS) {
      out.scanTime = static_cast<LONG>(value);
    }
  }

  // Contacts.
  for (const ContactFieldMap& field : desc.contacts) {
    if (!matchesReport(field.reportId)) continue;

    ULONG x = 0;
    ULONG y = 0;
    bool xOk = field.validX &&
               HidP_GetUsageValue(HidP_Input, kGenericDesktopUsagePage, field.xCollection,
                                  kUsageX, &x, preparsed, const_cast<char*>(r),
                                  length) == HIDP_STATUS_SUCCESS;
    bool yOk = field.validY &&
               HidP_GetUsageValue(HidP_Input, kGenericDesktopUsagePage, field.yCollection,
                                  kUsageY, &y, preparsed, const_cast<char*>(r),
                                  length) == HIDP_STATUS_SUCCESS;

    if (!xOk && !yOk) {
      continue;  // this contact slot is not present in the current report
    }

    RawContact contact;
    contact.present = true;
    contact.x = xOk ? NormaliseRange(x, field.xLogicalMin, field.xLogicalMax) : 0.0;
    contact.xValid = xOk;
    contact.y = yOk ? NormaliseRange(y, field.yLogicalMin, field.yLogicalMax) : 0.0;
    contact.yValid = yOk;

    // Contact ID: HIDP success makes it valid EVEN WHEN the value is 0
    // (0 is a legal Precision Touchpad contact id, never "missing").
    if (field.validId && matchesReport(field.idReportId)) {
      ULONG cid = 0;
      if (HidP_GetUsageValue(HidP_Input, kDigitizerUsagePage, field.idCollection,
                             kUsageContactIdentifier, &cid, preparsed, const_cast<char*>(r),
                             length) == HIDP_STATUS_SUCCESS) {
        contact.id = static_cast<int>(cid);
        contact.idValid = true;
      }
    }

    if (field.validTip && matchesReport(field.tipReportId)) {
      // Tip Switch is a 1-bit button: use the button API.  A SUCCESSFUL read
      // makes tipValid true even when Tip is not set (a non-touching slot).
      // A FAILED API call leaves tipValid false — never treat it as released.
      USAGE usages[2] = {0, 0};
      ULONG usageLength = 2;
      if (HidP_GetUsages(HidP_Input, kDigitizerUsagePage, field.tipCollection, usages,
                         &usageLength, preparsed, const_cast<char*>(r),
                         length) == HIDP_STATUS_SUCCESS) {
        contact.tipValid = true;
        for (ULONG k = 0; k < usageLength; k++) {
          if (usages[k] == kUsageTipSwitch) {
            contact.tip = true;
            break;
          }
        }
      }
    }

    out.contacts.push_back(contact);
  }
  return true;
}

}  // namespace gestureflow
