#include <node_api.h>

#include <windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include "gestures_controller.h"
#include "native_events.h"
#include "raw_input_capture.h"

namespace gestureflow {
namespace {

napi_env g_env = nullptr;
napi_threadsafe_function g_tsfn = nullptr;
RawInputCapture g_rawCapture;
GesturesController g_controller;
bool g_started = false;
bool g_rawActive = false;
std::atomic<int> g_maxContactsSeen{0};
std::atomic<unsigned long> g_deliveryQueueDropCount{0};

// Compile-time build identifier so the settings page can confirm which .node
// binary is actually loaded (not a release version).
constexpr const char* kNativeBuildId = "native-" __DATE__ "-" __TIME__;

double NowMsDouble() {
  return static_cast<double>(GetTickCount64());
}

// Small napi object helpers (defined below; declared here for early use).
void SetInt(napi_value obj, const char* name, int value);
void SetBool(napi_value obj, const char* name, bool value);
void SetStr(napi_value obj, const char* name, const char* value);

void UpdateMaxContactsSeen(int value) {
  int current = g_maxContactsSeen.load();
  while (value > current &&
         !g_maxContactsSeen.compare_exchange_weak(current, value)) {
  }
}

// ------------------------------------------------------------- probe helpers

bool FindPrecisionTouchpad() {
  UINT count = 0;
  if (GetRawInputDeviceList(nullptr, &count, sizeof(RAWINPUTDEVICELIST)) == static_cast<UINT>(-1)) {
    return false;
  }
  if (count == 0) return false;
  std::vector<RAWINPUTDEVICELIST> devices(count);
  if (GetRawInputDeviceList(devices.data(), &count, sizeof(RAWINPUTDEVICELIST)) == static_cast<UINT>(-1)) {
    return false;
  }
  for (UINT i = 0; i < count; i++) {
    RID_DEVICE_INFO info = {};
    info.cbSize = sizeof(info);
    UINT size = sizeof(info);
    if (GetRawInputDeviceInfoW(devices[i].hDevice, RIDI_DEVICEINFO, &info, &size) != size) {
      continue;
    }
    if (info.dwType == RIM_TYPEHID && info.hid.usUsagePage == 0x0D && info.hid.usUsage == 0x05) {
      return true;
    }
  }
  return false;
}

NativeCapabilities ProbeCapabilities() {
  NativeCapabilities caps;
  caps.precisionTouchpad = FindPrecisionTouchpad();
  caps.gesturesControllerAvailable = GesturesController::IsAvailable();
  // System-gesture takeover is real only after the controller thread really
  // enabled it — IsAvailable() is merely a probe.
  caps.gesturesControllerEnabled = g_controller.enabled();
  caps.canOverrideSystemGestures = caps.gesturesControllerEnabled;
  caps.rawContacts = g_rawActive;
  // Raw multi-contact input is available once the HID descriptor contact map
  // has been parsed (independent of the Windows 11 controller).
  const TouchpadDescriptorStatus desc = g_rawCapture.descriptorStatus();
  caps.multiContactGestures = desc.valid && desc.contactFieldCount > 0;
  if (desc.maxContacts > 0) caps.maxContacts = desc.maxContacts;
  if (caps.gesturesControllerAvailable) {
    caps.supportedGestureFingerCounts = {3, 4, 5};
  }
  return caps;
}

// ------------------------------------------------------------- frame emitter

// Called by the Raw Input / controller threads with a NativeFrame*.
void EmitFrame(NativeFrame* frame) {
  if (!g_tsfn) {
    delete frame;
    return;
  }
  // A bounded non-blocking queue prevents a stalled renderer from blocking
  // the Raw Input thread or growing native memory without limit.
  napi_status status =
      napi_call_threadsafe_function(g_tsfn, frame, napi_tsfn_nonblocking);
  if (status != napi_ok) {
    g_deliveryQueueDropCount.fetch_add(1);
    delete frame;
  }
}

void OnRawFrame(const NativeFrame& frame) {
  UpdateMaxContactsSeen(frame.contactCount);
  UpdateMaxContactsSeen(static_cast<int>(frame.contacts.size()));
  auto* f = new NativeFrame(frame);
  EmitFrame(f);
}

void OnPointer(int contactCount, double timestamp, double x, double y) {
  UpdateMaxContactsSeen(contactCount);
  auto* f = new NativeFrame();
  f->timestamp = timestamp;
  f->contactCount = contactCount;
  // Pointer samples carry no per-contact geometry -- the JS side treats them
  // as diagnostics only (contact count) and never feeds them to the tracker.
  f->hasPointer = true;
  f->pointerX = x;
  f->pointerY = y;
  EmitFrame(f);
}

void OnAction(ActionKind kind, int fingers) {
  auto* f = new NativeFrame();
  f->timestamp = NowMsDouble();
  f->actionKind = kind;
  f->actionFingers = fingers;
  EmitFrame(f);
}

// ------------------------------------------------------------- JS-side call

// Runs on the JS thread (dispatched by the TSFN).
void CallJsFrame(napi_env env, napi_value js_cb, void* /*context*/, void* data) {
  std::unique_ptr<NativeFrame> f(static_cast<NativeFrame*>(data));
  napi_value global;
  napi_get_global(env, &global);

  napi_value arg;
  napi_create_object(env, &arg);
  napi_value ts;
  napi_create_double(env, f->timestamp, &ts);
  napi_set_named_property(env, arg, "timestamp", ts);

  napi_value contacts;
  napi_create_array_with_length(env, f->contacts.size(), &contacts);
  for (size_t i = 0; i < f->contacts.size(); i++) {
    const NativeContact& c = f->contacts[i];
    napi_value obj;
    napi_create_object(env, &obj);
    napi_value v;
    napi_create_int32(env, c.id, &v);
    napi_set_named_property(env, obj, "id", v);
    napi_create_double(env, c.x, &v);
    napi_set_named_property(env, obj, "x", v);
    napi_create_double(env, c.y, &v);
    napi_set_named_property(env, obj, "y", v);
    napi_get_boolean(env, c.touching, &v);
    napi_set_named_property(env, obj, "touching", v);
    if (c.pressure >= 0) {
      napi_create_double(env, c.pressure, &v);
      napi_set_named_property(env, obj, "pressure", v);
    }
    napi_set_element(env, contacts, i, obj);
  }
  napi_set_named_property(env, arg, "contacts", contacts);

  if (f->contactCount >= 0) {
    napi_value cc;
    napi_create_int32(env, f->contactCount, &cc);
    napi_set_named_property(env, arg, "contactCount", cc);
  }
  if (f->hasPointer) {
    napi_value pointer;
    napi_create_object(env, &pointer);
    napi_value vx;
    napi_create_double(env, f->pointerX, &vx);
    napi_set_named_property(env, pointer, "x", vx);
    napi_value vy;
    napi_create_double(env, f->pointerY, &vy);
    napi_set_named_property(env, pointer, "y", vy);
    napi_value vstate;
    napi_create_string_utf8(env, "moved", NAPI_AUTO_LENGTH, &vstate);
    napi_set_named_property(env, pointer, "state", vstate);
    napi_set_named_property(env, arg, "pointer", pointer);
  }
  if (f->actionKind != ActionKind::kNone) {
    napi_value action;
    napi_create_object(env, &action);
    const char* kind = f->actionKind == ActionKind::kTap    ? "tap"
                       : f->actionKind == ActionKind::kPress ? "press"
                                                             : "release";
    napi_value kindValue;
    napi_create_string_utf8(env, kind, NAPI_AUTO_LENGTH, &kindValue);
    napi_set_named_property(env, action, "kind", kindValue);
    napi_value fc;
    napi_create_int32(env, f->actionFingers, &fc);
    napi_set_named_property(env, action, "fingerCount", fc);
    napi_set_named_property(env, arg, "nativeAction", action);
  }

  // Node 22.13+ / Node 24's napi_call_function takes a result pointer
  // (Node 24 headers declare 6 params).  The result is intentionally unused.
  napi_value callResult;
  napi_call_function(env, global, js_cb, 1, &arg, &callResult);
}

// ------------------------------------------------------------- N-API exports

void ReadFingerCounts(napi_env env, napi_value options, const char* name,
                      std::array<bool, 3>& out) {
  bool has = false;
  if (napi_has_named_property(env, options, name, &has) != napi_ok || !has) return;
  napi_value value;
  if (napi_get_named_property(env, options, name, &value) != napi_ok) return;
  bool isArray = false;
  if (napi_is_array(env, value, &isArray) != napi_ok || !isArray) return;
  uint32_t length = 0;
  if (napi_get_array_length(env, value, &length) != napi_ok) return;
  for (uint32_t i = 0; i < length; ++i) {
    napi_value item;
    int32_t count = 0;
    if (napi_get_element(env, value, i, &item) == napi_ok &&
        napi_get_value_int32(env, item, &count) == napi_ok &&
        count >= 3 && count <= 5) {
      out[static_cast<size_t>(count - 3)] = true;
    }
  }
}

GesturesControllerConfig ReadControllerConfig(napi_env env, size_t argc,
                                              napi_value* args) {
  GesturesControllerConfig config;
  if (argc < 2) return config;
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, args[1], &type) != napi_ok || type != napi_object) {
    return config;
  }
  ReadFingerCounts(env, args[1], "manipulationFingerCounts", config.manipulations);
  ReadFingerCounts(env, args[1], "actionFingerCounts", config.actions);
  return config;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "start(callback) requires a callback");
    return nullptr;
  }
  napi_valuetype type;
  napi_typeof(env, args[0], &type);
  if (type != napi_function) {
    napi_throw_type_error(env, nullptr, "start(callback) requires a function");
    return nullptr;
  }
  if (g_started) {
    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
  }
  g_env = env;
  napi_value resourceName;
  napi_create_string_utf8(env, "GestureFlowTouchpad", NAPI_AUTO_LENGTH, &resourceName);
  if (napi_create_threadsafe_function(env, args[0], nullptr, resourceName, 256, 1, nullptr,
                                      nullptr, nullptr, CallJsFrame, &g_tsfn) != napi_ok) {
    napi_throw_error(env, nullptr, "failed to create thread-safe function");
    return nullptr;
  }

  g_started = true;
  const GesturesControllerConfig controllerConfig =
      ReadControllerConfig(env, argc, args);
  // Raw Input contact frames (best effort).
  g_rawActive = g_rawCapture.Start(OnRawFrame);
  // TouchpadGesturesController 3/4/5-finger actions (best effort).
  g_controller.Start(OnPointer, OnAction, controllerConfig);

  napi_value undef;
  napi_get_undefined(env, &undef);
  return undef;
}

napi_value Stop(napi_env env, napi_callback_info info) {
  (void)info;
  if (!g_started) {
    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
  }
  g_started = false;
  g_controller.Stop();
  g_rawCapture.Stop();
  g_rawActive = false;
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_abort);
    g_tsfn = nullptr;
  }
  napi_value undef;
  napi_get_undefined(env, &undef);
  return undef;
}

napi_value GetCapabilities(napi_env env, napi_callback_info info) {
  (void)info;
  g_env = env;
  NativeCapabilities caps = ProbeCapabilities();
  napi_value out;
  napi_create_object(env, &out);
  napi_value v;
  napi_get_boolean(env, caps.precisionTouchpad, &v);
  napi_set_named_property(env, out, "precisionTouchpad", v);
  const int maxContactsSeen = g_maxContactsSeen.load();
  napi_create_int32(env, std::max(caps.maxContacts, maxContactsSeen), &v);
  napi_set_named_property(env, out, "maxContacts", v);
  // Separate the authoritative hardware cap (descriptor / Feature report)
  // from the runtime observed max so the JS layer never conflates them.
  napi_create_int32(env, caps.maxContacts, &v);
  napi_set_named_property(env, out, "hardwareMaxContacts", v);
  napi_create_int32(env, maxContactsSeen, &v);
  napi_set_named_property(env, out, "observedMaxContacts", v);
  napi_get_boolean(env, caps.gesturesControllerAvailable, &v);
  napi_set_named_property(env, out, "gesturesControllerAvailable", v);
  napi_get_boolean(env, caps.gesturesControllerEnabled, &v);
  napi_set_named_property(env, out, "gesturesControllerEnabled", v);
  napi_get_boolean(env, caps.canOverrideSystemGestures, &v);
  napi_set_named_property(env, out, "canOverrideSystemGestures", v);
  napi_get_boolean(env, g_rawActive, &v);
  napi_set_named_property(env, out, "rawContacts", v);
  napi_get_boolean(env, caps.multiContactGestures, &v);
  napi_set_named_property(env, out, "multiContactGestures", v);
  napi_value counts;
  napi_create_array_with_length(env, caps.supportedGestureFingerCounts.size(), &counts);
  for (size_t i = 0; i < caps.supportedGestureFingerCounts.size(); i++) {
    napi_create_int32(env, caps.supportedGestureFingerCounts[i], &v);
    napi_set_element(env, counts, static_cast<uint32_t>(i), v);
  }
  napi_set_named_property(env, out, "supportedGestureFingerCounts", counts);
  SetStr(out, "nativeBuildId", kNativeBuildId);
  return out;
}

// ------------------------------------------------------------- diagnostics

// Serializers for the descriptor diagnostic summaries.
static void SerializeValueCap(napi_value arr, uint32_t index, const DescriptorCapSummary& c) {
  napi_value o;
  napi_create_object(g_env, &o);
  SetInt(o, "usagePage", c.usagePage);
  SetBool(o, "isRange", c.isRange);
  SetInt(o, "usageMin", c.usageMin);
  SetInt(o, "usageMax", c.usageMax);
  SetInt(o, "reportId", c.reportId);
  SetInt(o, "linkCollection", c.linkCollection);
  SetInt(o, "reportCount", c.reportCount);
  SetInt(o, "bitSize", c.bitSize);
  SetInt(o, "logicalMin", static_cast<int>(c.logicalMin));
  SetInt(o, "logicalMax", static_cast<int>(c.logicalMax));
  SetInt(o, "physicalMin", static_cast<int>(c.physicalMin));
  SetInt(o, "physicalMax", static_cast<int>(c.physicalMax));
  napi_set_element(g_env, arr, index, o);
}

static void SerializeButtonCap(napi_value arr, uint32_t index, const DescriptorButtonSummary& c) {
  napi_value o;
  napi_create_object(g_env, &o);
  SetInt(o, "usagePage", c.usagePage);
  SetBool(o, "isRange", c.isRange);
  SetInt(o, "usageMin", c.usageMin);
  SetInt(o, "usageMax", c.usageMax);
  SetInt(o, "reportId", c.reportId);
  SetInt(o, "linkCollection", c.linkCollection);
  napi_set_element(g_env, arr, index, o);
}

static void SerializeNode(napi_value arr, uint32_t index, const DescriptorNodeSummary& n) {
  napi_value o;
  napi_create_object(g_env, &o);
  SetInt(o, "index", n.index);
  SetInt(o, "linkUsagePage", n.linkUsagePage);
  SetInt(o, "linkUsage", n.linkUsage);
  SetInt(o, "parent", n.parent);
  SetInt(o, "numberOfChildren", n.numberOfChildren);
  SetInt(o, "firstChild", n.firstChild);
  SetInt(o, "nextSibling", n.nextSibling);
  SetInt(o, "collectionType", static_cast<int>(n.collectionType));
  napi_set_element(g_env, arr, index, o);
}

static void SerializeContactMap(napi_value arr, uint32_t index, const ContactFieldMap& c) {
  napi_value o;
  napi_create_object(g_env, &o);
  SetInt(o, "fingerCollection", c.fingerCollection);
  SetInt(o, "reportId", c.reportId);
  SetBool(o, "validX", c.validX);
  SetBool(o, "validY", c.validY);
  SetBool(o, "validId", c.validId);
  SetBool(o, "validTip", c.validTip);
  SetBool(o, "usable", c.usable);
  SetInt(o, "xLogicalMin", static_cast<int>(c.xLogicalMin));
  SetInt(o, "xLogicalMax", static_cast<int>(c.xLogicalMax));
  SetInt(o, "yLogicalMin", static_cast<int>(c.yLogicalMin));
  SetInt(o, "yLogicalMax", static_cast<int>(c.yLogicalMax));
  napi_set_element(g_env, arr, index, o);
}

napi_value GetDiagnostics(napi_env env, napi_callback_info info) {
  (void)info;
  g_env = env;
  napi_value out;
  napi_create_object(env, &out);
  SetStr(out, "buildId", kNativeBuildId);

  // --- capture (independent of descriptor parse success) -------------------
  const RawCaptureDiagnostics cd = g_rawCapture.captureDiagSnapshot();
  napi_value capture;
  napi_create_object(env, &capture);
  SetInt(capture, "wmInputCount", static_cast<int>(cd.wmInputCount));
  SetInt(capture, "rawInputReadSuccessCount", static_cast<int>(cd.rawInputReadSuccessCount));
  SetInt(capture, "rawInputHidPacketCount", static_cast<int>(cd.rawInputHidPacketCount));
  SetInt(capture, "rawInputHidReportCount", static_cast<int>(cd.rawInputHidReportCount));
  SetInt(capture, "dwSizeHid", static_cast<int>(cd.lastDwSizeHid));
  SetInt(capture, "dwCount", static_cast<int>(cd.lastDwCount));
  SetInt(capture, "preparsedDataRequestCount", static_cast<int>(cd.preparsedDataRequestCount));
  SetInt(capture, "preparsedDataSuccessCount", static_cast<int>(cd.preparsedDataSuccessCount));
  SetInt(capture, "descriptorParseAttemptCount", static_cast<int>(cd.descriptorParseAttemptCount));
  SetInt(capture, "descriptorParseSuccessCount", static_cast<int>(cd.descriptorParseSuccessCount));
  SetInt(capture, "descriptorParseFailureCount", static_cast<int>(cd.descriptorParseFailureCount));
  SetInt(capture, "deviceContextCount", static_cast<int>(cd.deviceContextCount));
  SetInt(capture, "deviceSwitchCount", static_cast<int>(cd.deviceSwitchCount));
  SetInt(capture, "deviceArrivalCount", static_cast<int>(cd.deviceArrivalCount));
  SetInt(capture, "deviceRemovalCount", static_cast<int>(cd.deviceRemovalCount));
  SetInt(capture, "callbackDeliveryCount", static_cast<int>(cd.callbackDeliveryCount));
  SetInt(capture, "invalidFrameDropCount", static_cast<int>(cd.invalidFrameDropCount));
  SetInt(capture, "deliveryQueueDropCount",
         static_cast<int>(g_deliveryQueueDropCount.load()));
  napi_set_named_property(env, out, "capture", capture);

  // --- descriptor (structured, even when the parse failed) -----------------
  const TouchpadDescriptor d = g_rawCapture.descriptorSnapshot();
  napi_value desc;
  napi_create_object(env, &desc);
  SetBool(desc, "parsed", d.valid);

  napi_value parse;
  napi_create_object(env, &parse);
  SetBool(parse, "success", d.parseResult.success);
  SetInt(parse, "stage", static_cast<int>(d.parseResult.stage));
  SetStr(parse, "reason", d.parseResult.reason.c_str());
  SetInt(parse, "status", static_cast<int>(d.parseResult.status));
  napi_set_named_property(env, desc, "parse", parse);

  napi_value capsObj;
  napi_create_object(env, &capsObj);
  SetInt(capsObj, "inputReportByteLength", static_cast<int>(d.inputReportByteLength));
  SetInt(capsObj, "featureReportByteLength", static_cast<int>(d.featureReportByteLength));
  SetInt(capsObj, "numberInputValueCaps", d.numberInputValueCaps);
  SetInt(capsObj, "numberInputButtonCaps", d.numberInputButtonCaps);
  SetInt(capsObj, "numberFeatureValueCaps", d.numberFeatureValueCaps);
  SetInt(capsObj, "numberLinkCollectionNodes", d.numberLinkCollectionNodes);
  SetInt(capsObj, "deviceUsagePage", d.deviceUsagePage);
  SetInt(capsObj, "deviceUsage", d.deviceUsage);
  napi_set_named_property(env, desc, "caps", capsObj);

  napi_value cc;
  napi_create_object(env, &cc);
  SetBool(cc, "valid", d.report.validContactCount);
  SetInt(cc, "linkCollection", d.report.contactCountLinkCollection);
  SetInt(cc, "reportId", d.report.contactCountReportId);
  napi_set_named_property(env, desc, "contactCount", cc);

  napi_value st;
  napi_create_object(env, &st);
  SetBool(st, "valid", d.report.validScanTime);
  SetInt(st, "linkCollection", d.report.scanTimeLinkCollection);
  SetInt(st, "reportId", d.report.scanTimeReportId);
  napi_set_named_property(env, desc, "scanTime", st);

  napi_value cm;
  napi_create_object(env, &cm);
  SetBool(cm, "valid", d.validContactCountMaxCap);
  SetInt(cm, "linkCollection", d.contactCountMaxLinkCollection);
  SetInt(cm, "reportId", d.contactCountMaxReportId);
  SetInt(cm, "logicalMax", static_cast<int>(d.contactCountMaxLogicalMax));
  napi_set_named_property(env, desc, "contactCountMax", cm);

  SetInt(desc, "maxContacts", d.maxContacts);
  SetBool(desc, "maxContactsFromDescriptor", d.maxContactsFromDescriptor);
  SetInt(desc, "fingerCollectionCount", static_cast<int>(d.fingerCollections.size()));
  SetInt(desc, "contactFieldCount", static_cast<int>(d.contacts.size()));

  napi_value fingers;
  napi_create_array_with_length(env, d.fingerCollections.size(), &fingers);
  for (size_t i = 0; i < d.fingerCollections.size(); i++) {
    napi_value v;
    napi_create_int32(env, d.fingerCollections[i], &v);
    napi_set_element(env, fingers, static_cast<uint32_t>(i), v);
  }
  napi_set_named_property(env, desc, "fingerCollections", fingers);

  napi_value vcaps;
  napi_create_array_with_length(env, d.inputValueCaps.size(), &vcaps);
  for (size_t i = 0; i < d.inputValueCaps.size(); i++) {
    SerializeValueCap(vcaps, static_cast<uint32_t>(i), d.inputValueCaps[i]);
  }
  napi_set_named_property(env, desc, "valueCaps", vcaps);

  napi_value bcaps;
  napi_create_array_with_length(env, d.inputButtonCaps.size(), &bcaps);
  for (size_t i = 0; i < d.inputButtonCaps.size(); i++) {
    SerializeButtonCap(bcaps, static_cast<uint32_t>(i), d.inputButtonCaps[i]);
  }
  napi_set_named_property(env, desc, "buttonCaps", bcaps);

  napi_value nodes;
  napi_create_array_with_length(env, d.linkCollectionNodes.size(), &nodes);
  for (size_t i = 0; i < d.linkCollectionNodes.size(); i++) {
    SerializeNode(nodes, static_cast<uint32_t>(i), d.linkCollectionNodes[i]);
  }
  napi_set_named_property(env, desc, "linkNodes", nodes);

  napi_value cmap;
  napi_create_array_with_length(env, d.contacts.size(), &cmap);
  for (size_t i = 0; i < d.contacts.size(); i++) {
    SerializeContactMap(cmap, static_cast<uint32_t>(i), d.contacts[i]);
  }
  napi_set_named_property(env, desc, "contactMap", cmap);

  napi_set_named_property(env, out, "descriptor", desc);

  // --- assembler stats -----------------------------------------------------
  const ParserStats s = g_rawCapture.parserStatsSnapshot();
  napi_value asm_;
  napi_create_object(env, &asm_);
  SetInt(asm_, "lastReportId", s.lastReportId);
  SetInt(asm_, "lastScanTime", static_cast<int>(s.lastScanTime));
  SetInt(asm_, "lastReportedContactCount", static_cast<int>(s.lastReportedContactCount));
  SetInt(asm_, "expectedFrameContacts", static_cast<int>(s.expectedFrameContacts));
  SetInt(asm_, "assembledContactCount", static_cast<int>(s.assembledContactCount));
  SetInt(asm_, "activeContactCount", static_cast<int>(s.activeContactCount));
  SetInt(asm_, "hybridContinuationCount", static_cast<int>(s.hybridContinuationCount));
  SetInt(asm_, "completedFrameCount", static_cast<int>(s.completedFrameCount));
  SetInt(asm_, "emptyFrameCount", static_cast<int>(s.emptyFrameCount));
  SetInt(asm_, "incompleteFrameDropCount", static_cast<int>(s.incompleteFrameDropCount));
  SetInt(asm_, "incompleteTimeoutDropCount", static_cast<int>(s.incompleteTimeoutDropCount));
  SetInt(asm_, "incompleteScanChangeDropCount", static_cast<int>(s.incompleteScanChangeDropCount));
  SetInt(asm_, "incompleteSupersededDropCount", static_cast<int>(s.incompleteSupersededDropCount));
  SetInt(asm_, "lastDroppedExpectedCount", static_cast<int>(s.lastDroppedExpectedCount));
  SetInt(asm_, "lastDroppedAssembledCount", static_cast<int>(s.lastDroppedAssembledCount));
  SetInt(asm_, "duplicateContactIdCount", static_cast<int>(s.duplicateContactIdCount));
  SetInt(asm_, "invalidContactFieldCount", static_cast<int>(s.invalidContactFieldCount));
  SetInt(asm_, "lastEmittedContactCount", static_cast<int>(s.lastEmittedContactCount));
  SetInt(asm_, "lastEmittedContactsLength", static_cast<int>(s.lastEmittedContactsLength));
  napi_value lastIds;
  napi_create_array_with_length(env, s.lastEmittedContactIds.size(), &lastIds);
  for (size_t i = 0; i < s.lastEmittedContactIds.size(); i++) {
    napi_value v;
    napi_create_int32(env, s.lastEmittedContactIds[i], &v);
    napi_set_element(env, lastIds, static_cast<uint32_t>(i), v);
  }
  napi_set_named_property(env, asm_, "lastEmittedContactIds", lastIds);
  SetBool(asm_, "contactIdParseSuccess", s.contactIdParseSuccess);
  SetBool(asm_, "tipParseSuccess", s.tipParseSuccess);
  SetBool(asm_, "xyParseSuccess", s.xyParseSuccess);
  napi_set_named_property(env, out, "assembler", asm_);

  return out;
}

// ------------------------------------------------------------- N-API helpers

void SetInt(napi_value obj, const char* name, int value) {
  napi_value v;
  napi_create_int32(g_env, value, &v);
  napi_set_named_property(g_env, obj, name, v);
}

void SetBool(napi_value obj, const char* name, bool value) {
  napi_value v;
  napi_get_boolean(g_env, value, &v);
  napi_set_named_property(g_env, obj, name, v);
}

void SetStr(napi_value obj, const char* name, const char* value) {
  napi_value v;
  napi_create_string_utf8(g_env, value, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(g_env, obj, name, v);
}

}  // namespace
}  // namespace gestureflow

// ------------------------------------------------------------- module init

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
      {"capabilities", nullptr, nullptr, gestureflow::GetCapabilities, nullptr, nullptr, napi_enumerable, nullptr},
      {"start", nullptr, gestureflow::Start, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"stop", nullptr, gestureflow::Stop, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"getDiagnostics", nullptr, gestureflow::GetDiagnostics, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };
  napi_value result;
  napi_create_object(env, &result);
  napi_define_properties(env, result, 4, props);
  napi_value id;
  napi_create_string_utf8(env, "gesture_flow_touchpad", NAPI_AUTO_LENGTH, &id);
  napi_set_named_property(env, result, "id", id);
  return result;
}
