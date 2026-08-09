// FrameAssembler invariant regression tests (standalone, no HID / no JS).
//
// Build: node-gyp target `frame_assembler_test` (see binding.gyp).  Run:
//   native/touchpad/build/Release/frame_assembler_test.exe
// Prints "PASS: N" and exits 0 on success, prints failures and exits 1.

#include <cstdio>
#include <vector>

#include "frame_assembler.h"

using namespace gestureflow;

namespace {

int g_checks = 0;

void Check(bool ok, const char* name) {
  g_checks++;
  if (!ok) {
    std::printf("FAIL: %s\n", name);
    std::exit(1);
  }
}

RawContact UsableContact(int id, double x, double y) {
  RawContact c;
  c.id = id;
  c.idValid = true;
  c.x = x;
  c.xValid = true;
  c.y = y;
  c.yValid = true;
  c.tip = true;
  c.tipValid = true;
  c.present = true;
  return c;
}

}  // namespace

int main() {
  // --- test 1: single-finger hybrid, expected=3, 3 reports ------------------
  {
    FrameAssembler a;
    NativeFrame out;
    bool emitted = false;

    RawReport r1;
    r1.contactCount = 3;
    r1.scanTime = 1;
    r1.contacts.push_back(UsableContact(0, 0.1, 0.2));

    RawReport r2;
    r2.contactCount = 0;
    r2.scanTime = 1;
    r2.contacts.push_back(UsableContact(1, 0.3, 0.4));

    RawReport r3;
    r3.contactCount = 0;
    r3.scanTime = 1;
    r3.contacts.push_back(UsableContact(2, 0.5, 0.6));

    Check(!a.OnReport(r1, 1.0, out) || emitted, "hybrid r1 should stay pending");
    emitted = false;
    out = NativeFrame();
    Check(!a.OnReport(r2, 1.001, out) || emitted, "hybrid r2 should stay pending");
    emitted = false;
    out = NativeFrame();
    Check(a.OnReport(r3, 1.002, out), "hybrid r3 must emit the complete frame");
    Check(out.contacts.size() == 3, "hybrid emits exactly 3 contacts");
    Check(out.contactCount == 3, "hybrid contactCount == 3");
    Check(ValidateNativeFrame(out), "hybrid frame passes the invariant");
    // All three ids preserved, including id 0.
    bool ids[3] = {false, false, false};
    for (const NativeContact& c : out.contacts) ids[c.id] = true;
    Check(ids[0] && ids[1] && ids[2], "ids 0/1/2 all present (id 0 is legal)");
  }

  // --- test 2: timeout must NOT emit a partial frame ------------------------
  {
    FrameAssembler a;
    NativeFrame out;
    RawReport r;
    r.contactCount = 3;
    r.scanTime = 1;
    r.contacts.push_back(UsableContact(0, 0.1, 0.2));
    Check(!a.OnReport(r, 1.0, out), "expected=3 with only id 0 stays pending");

    // A later report well past the 0.1 s timeout triggers the drop path.
    RawReport later;
    later.contactCount = 0;
    later.scanTime = 2;
    bool emitted = false;
    out = NativeFrame();
    Check(!a.OnReport(later, 1.5, out), "timeout must not emit a partial frame");
    Check(a.stats().incompleteTimeoutDropCount == 1, "timeout drop counted");
    Check(a.stats().lastDroppedExpectedCount == 3, "lastDroppedExpectedCount == 3");
    Check(a.stats().lastDroppedAssembledCount == 1, "lastDroppedAssembledCount == 1");
  }

  // --- test 3: new scan before completion drops the old frame ---------------
  {
    FrameAssembler a;
    NativeFrame out;
    RawReport r1;
    r1.contactCount = 3;
    r1.scanTime = 1;
    r1.contacts.push_back(UsableContact(0, 0.1, 0.2));
    Check(!a.OnReport(r1, 1.0, out), "pending after first report");

    RawReport r2;
    r2.contactCount = 3;
    r2.scanTime = 2;
    r2.contacts.push_back(UsableContact(0, 0.1, 0.2));
    r2.contacts.push_back(UsableContact(1, 0.3, 0.4));
    r2.contacts.push_back(UsableContact(2, 0.5, 0.6));
    bool emitted = false;
    out = NativeFrame();
    Check(a.OnReport(r2, 1.01, out), "new scan with a complete parallel frame emits");
    Check(out.contacts.size() == 3, "superseding frame emits its own 3 contacts");
    Check(a.stats().incompleteSupersededDropCount == 1, "superseded drop counted");
  }

  // --- test 4: contact ID 0 is a legal value (covered by test 1) ------------
  {
    // Explicit parallel check with id 0 present.
    FrameAssembler a;
    NativeFrame out;
    RawReport r;
    r.contactCount = 3;
    r.contacts.push_back(UsableContact(0, 0.1, 0.2));
    r.contacts.push_back(UsableContact(1, 0.3, 0.4));
    r.contacts.push_back(UsableContact(2, 0.5, 0.6));
    Check(a.OnReport(r, 1.0, out), "parallel emits immediately");
    Check(out.contacts.size() == 3 && out.contactCount == 3, "parallel 3/3");
  }

  // --- test 5: duplicate ids make the frame invalid (never emitted) ---------
  {
    FrameAssembler a;
    NativeFrame out;
    RawReport r;
    r.contactCount = 3;
    r.contacts.push_back(UsableContact(0, 0.1, 0.2));
    r.contacts.push_back(UsableContact(0, 0.3, 0.4));  // duplicate id
    r.contacts.push_back(UsableContact(1, 0.5, 0.6));
    Check(!a.OnReport(r, 1.0, out), "duplicate-id report must NOT emit");
    Check(a.stats().duplicateContactIdCount >= 1, "duplicate id counted");
  }

  // --- test 6: parallel report with all contacts emits immediately ----------
  {
    FrameAssembler a;
    NativeFrame out;
    RawReport r;
    r.contactCount = 3;
    r.contacts.push_back(UsableContact(0, 0.1, 0.2));
    r.contacts.push_back(UsableContact(1, 0.3, 0.4));
    r.contacts.push_back(UsableContact(2, 0.5, 0.6));
    Check(a.OnReport(r, 1.0, out), "parallel emits immediately");
    Check(ValidateNativeFrame(out), "parallel frame passes the invariant");
  }

  // --- ValidateNativeFrame edge cases ---------------------------------------
  {
    NativeFrame bad;
    bad.contactCount = 3;
    bad.contacts.push_back(NativeContact{});
    Check(!ValidateNativeFrame(bad), "contactCount=3 with 1 contact is invalid");

    NativeFrame dup;
    dup.contactCount = 2;
    NativeContact c0;
    c0.id = 0;
    c0.x = 0.1;
    c0.y = 0.2;
    NativeContact c1;
    c1.id = 0;
    c1.x = 0.3;
    c1.y = 0.4;
    dup.contacts.push_back(c0);
    dup.contacts.push_back(c1);
    Check(!ValidateNativeFrame(dup), "duplicate ids are invalid");

    NativeFrame outOfRange;
    outOfRange.contactCount = 1;
    NativeContact oc;
    oc.id = 1;
    oc.x = 1.5;  // out of [0,1]
    oc.y = 0.5;
    outOfRange.contacts.push_back(oc);
    Check(!ValidateNativeFrame(outOfRange), "out-of-range coordinate is invalid");

    NativeFrame emptyOk;
    emptyOk.contactCount = 0;
    Check(ValidateNativeFrame(emptyOk), "empty frame is valid");
  }

  std::printf("PASS: %d checks\n", g_checks);
  return 0;
}
