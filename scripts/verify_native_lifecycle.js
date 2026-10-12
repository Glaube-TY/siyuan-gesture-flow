import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const native = path.join(root, "native/touchpad/src");
if (process.argv[2] === "--smoke-child") {
    const addon = createRequire(import.meta.url)(process.argv[3]);
    const baseline = addon.capabilities.tsfnReleaseCount;
    assert.equal(addon.stop(), "already-stopped");
    for (let cycle = 1; cycle <= 10; cycle++) {
        assert.equal(addon.start(() => {}, { manipulationFingerCounts: [], actionFingerCounts: [] }), "started");
        assert.equal(addon.start(() => {}, {}), "already-running");
        assert.equal(addon.capabilities.lifecycleState, "running");
        assert.equal(addon.stop(), "stopped");
        assert.equal(addon.stop(), "already-stopped");
        assert.equal(addon.capabilities.tsfnReleaseCount, baseline + cycle);
        assert.equal(addon.capabilities.tsfnActive, false);
        assert.equal(addon.capabilities.lifecycleState, "stopped");
    }
    console.log("Windows addon smoke passed: 10 real Start/Stop cycles, one TSFN release per cycle; no gesture takeover.");
} else {
    const raw = fs.readFileSync(path.join(native, "raw_input_capture.cpp"), "utf8");
    const controller = fs.readFileSync(path.join(native, "gestures_controller.cpp"), "utf8");
    const main = fs.readFileSync(path.join(native, "main.cpp"), "utf8");
    for (const source of [raw, controller]) {
        assert.ok(!source.includes("TerminateThread"));
        assert.ok(!source.includes("PostThreadMessageW"));
        assert.ok(source.includes("MsgWaitForMultipleObjectsEx"));
        assert.ok(source.includes("startWaiting_"));
        assert.ok(source.includes("if (wait != WAIT_OBJECT_0 || startWaiting_)"));
        assert.ok(source.indexOf("return ThreadStopResult::kPending") < source.indexOf("CloseHandle(thread_)"));
    }
    assert.match(raw, /if \(self->startSucceeded_ && !self->stopRequested_\) self->PumpMessages\(\)/);
    assert.ok(raw.indexOf("self->CleanupOnThread()") > raw.indexOf("self->PumpMessages()"));
    assert.ok(controller.includes("winrt::auto_revoke"));
    assert.ok(controller.includes("RoUninitialize()"));
    const stop = main.slice(main.indexOf("ThreadStopResult StopNative("), main.indexOf("napi_value StatusValue("));
    assert.ok(stop.indexOf("g_acceptFrames = false") < stop.indexOf("g_rawCapture.Stop()"));
    assert.ok(stop.indexOf("ThreadStopResult::kPending") < stop.indexOf("napi_release_threadsafe_function"));
    assert.ok(stop.indexOf("g_releaseFailed) return ThreadStopResult::kPending") < stop.indexOf("napi_release_threadsafe_function"));
    assert.ok(main.includes("if (g_state == AddonState::kStopping)"));
    assert.ok(main.includes("if (!f || !env || !js_cb) return;"));
    assert.ok(main.includes("RawInputCapture& g_rawCapture = *new RawInputCapture()"));
    console.log("Native lifecycle static checks passed: event cancellation, pending-state retention, TSFN ordering and null guard.");

    if (process.platform !== "win32") {
        console.log("Windows execution is performed by the Windows CI job; this host ran static checks only.");
    } else {
        const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "gesture-flow-native-lifecycle-"));
        try {
            const vswhere = "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe";
            const locate = spawnSync(vswhere, ["-latest", "-products", "*", "-requires",
                "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
            { encoding: "utf8", windowsHide: true });
            assert.equal(locate.status, 0, locate.stderr);
            const vcvars = path.join(locate.stdout.trim(), "VC/Auxiliary/Build/vcvars64.bat");
            assert.ok(fs.existsSync(vcvars), "MSVC environment unavailable");
            const executable = path.join(isolated, "thread_lifecycle_test.exe");
            const quote = (arg) => `"${arg}"`;
            const inputs = [
                path.join(root, "native/touchpad/test/thread_lifecycle_test.cpp"),
                ...["raw_input_capture.cpp", "gestures_controller.cpp", "hid_descriptor.cpp", "frame_assembler.cpp"]
                    .map((file) => path.join(native, file)),
            ];
            const command = `${quote(vcvars)} >nul && cl.exe /nologo /EHsc /std:c++17 /utf-8 ` +
                `/DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 /DGESTURE_FLOW_HAVE_TG_CONTROLLER=0 ` +
                `/I${quote(native)} /FI${quote(path.join(root, "native/touchpad/test/lifecycle_test_api.h"))} ` +
                `/Fe:${quote(executable)} /Fo:${quote(isolated + "/")} ${inputs.map(quote).join(" ")} ` +
                "user32.lib hid.lib runtimeobject.lib ole32.lib windowsapp.lib";
            const compile = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
                cwd: isolated, encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout: 45000,
            });
            assert.equal(compile.status, 0, compile.stdout + compile.stderr);
            const threads = spawnSync(executable, [], { encoding: "utf8", windowsHide: true, timeout: 15000 });
            assert.equal(threads.status, 0, threads.stdout + threads.stderr);
            console.log(threads.stdout.trim());
            const binary = path.join(isolated, "gesture_flow_touchpad.node");
            fs.copyFileSync(path.join(root, "native/gesture_flow_touchpad.node"), binary);
            const smoke = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--smoke-child", binary], {
                encoding: "utf8", windowsHide: true, timeout: 20000,
            });
            assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);
            console.log(smoke.stdout.trim());
        } finally {
            // Both test processes have exited before removing their own isolated files.
            const resolved = fs.realpathSync(isolated);
            assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith("gesture-flow-native-lifecycle-"));
            fs.rmSync(resolved, { recursive: true, force: true });
        }
    }
}
