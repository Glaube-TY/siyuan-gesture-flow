import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gesture-flow-loader-check-"));
const compiled = new Map();
let fixtureNumber = 0;
let checks = 0;
function fixture(options = {}) {
    const directory = path.join(testRoot, String(++fixtureNumber));
    const dataDir = path.join(directory, "workspace", "data");
    const plugins = path.join(dataDir, "plugins");
    const source = path.join(plugins, "siyuan-gesture-flow", "native", "gesture_flow_touchpad.node");
    const temp = path.join(directory, "temporary");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(temp, { recursive: true });
    if (!options.missing) fs.writeFileSync(source, "mock addon version one");
    const loads = [];
    let writes = 0;
    const mockFs = Object.assign(Object.create(fs), {
        writeFileSync(...args) { writes++; return fs.writeFileSync(...args); },
    }, options.fs);
    const processMock = { pid: process.pid, arch: options.arch ?? "x64", platform: "win32", env: {} };
    const webContents = new EventEmitter();
    if (options.observerFails) webContents.on = function (...args) {
        EventEmitter.prototype.on.apply(this, args);
        throw new Error("partial observer attachment");
    };
    const nodeRequire = (id) => {
        if (id === "fs") return mockFs;
        if (id === "os") return { tmpdir: () => options.temp ?? temp };
        if (id === "path") return path;
        if (id === "crypto") return crypto;
        if (id === "process") return processMock;
        if (id === "electron") return {};
        if (id === "@electron/remote") {
            if (options.noObserver) throw new Error("remote unavailable");
            return { getCurrentWindow: () => ({ webContents }) };
        }
        if (id.endsWith(".node")) {
            // Never pass this fixture's fake binaries to Node's actual DLL loader.
            assert.ok(!within(plugins, id), "required a workspace plugin binary");
            assert.ok(within(temp, id), "required a binary outside the isolated cache");
            loads.push(id);
            if (options.loadFails) throw Object.assign(new Error("mock load failure"), { code: "ERR_DLOPEN_FAILED" });
            return options.addon ?? { start() {}, stop() {}, capabilities: { precisionTouchpad: true, maxContacts: 5 } };
        }
        throw new Error(`unexpected require: ${id}`);
    };
    nodeRequire.resolve = (id) => id;
    const window = Object.assign(new EventTarget(), { require: nodeRequire, process: processMock });
    const document = new EventTarget();
    const context = vm.createContext({
        window, document, navigator: {}, process: processMock, Buffer, console, performance,
        EventTarget, HTMLElement: class {}, setTimeout, clearTimeout, setInterval, clearInterval,
        siyuan: { config: { system: { dataDir, container: "desktop" } } },
    });
    const modules = new Map();
    function load(filename) {
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        if (!compiled.has(filename)) {
            compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, "utf8"), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
                fileName: filename,
            }).outputText);
        }
        const localRequire = (id) => {
            if (id === "siyuan") return { globalCommand() {} };
            const resolved = id.startsWith("@/")
                ? path.join(root, "src", id.slice(2))
                : path.resolve(path.dirname(filename), id);
            return load(resolved.endsWith(".ts") ? resolved : resolved + ".ts");
        };
        vm.runInContext(`(function(require, module, exports) {${compiled.get(filename)}\n})`, context, { filename })(
            localRequire, module, module.exports,
        );
        return module.exports;
    }
    const bridge = load(path.join(root, "src/touchpad/nativeBridge.ts"));
    bridge.setNativeBridgeContext({ pluginName: "siyuan-gesture-flow" });
    return {
        source, plugins, temp, loads, bridge, window, document, processMock, mockFs, webContents,
        writes: () => writes,
        cache: () => load(path.join(root, "src/touchpad/nativeAddonCache.ts"))
            .prepareNativeAddonCache(source, plugins, nodeRequire),
        provider: () => load(path.join(root, "src/touchpad/ProviderRegistry.ts")).createTouchpadProvider({}),
        load: (file) => load(path.join(root, file)),
    };
}
function within(parent, child) {
    const relative = path.relative(parent, path.resolve(child));
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function check(name, run) {
    run();
    checks++;
    console.log(`  [OK] ${name}`);
}

try {
    check("verified cache outside plugins, stable SHA-256/PID path, immutable source", () => {
        const test = fixture();
        const original = fs.readFileSync(test.source);
        const first = test.cache();
        assert.equal(first.sourceFound, true);
        assert.equal(first.cacheReady, true);
        assert.ok(within(test.temp, first.cachePath));
        assert.ok(!within(test.plugins, first.cachePath));
        assert.equal(path.basename(path.dirname(first.cachePath)), String(process.pid));
        assert.equal(path.basename(first.cachePath), crypto.createHash("sha256").update(original).digest("hex") + ".node");
        assert.deepEqual(fs.readFileSync(first.cachePath), original);
        assert.equal(test.cache().cachePath, first.cachePath);
        assert.equal(test.writes(), 1);
        assert.deepEqual(fs.readFileSync(test.source), original);
        assert.ok(!fs.readdirSync(path.dirname(first.cachePath)).some((file) => file.endsWith(".tmp")));
    });
    check("changed addon content creates a different cache path and bridge", () => {
        const test = fixture();
        const first = test.bridge.loadNativeTouchpadBridge();
        const firstPath = test.loads[0];
        fs.writeFileSync(test.source, "mock addon version two");
        const second = test.bridge.loadNativeTouchpadBridge();
        assert.ok(first && second);
        assert.notEqual(first, second);
        assert.notEqual(test.loads[1], firstPath);
        assert.equal(fs.readFileSync(firstPath, "utf8"), "mock addon version one");
    });
    check("repeated provider creation reuses the verified cache and loaded bridge", () => {
        const test = fixture();
        assert.equal(test.provider().id, "windows-native");
        const first = test.bridge.loadNativeTouchpadBridge();
        assert.equal(test.provider().id, "windows-native");
        assert.equal(test.bridge.loadNativeTouchpadBridge(), first);
        assert.equal(test.loads.length, 1);
        assert.equal(test.writes(), 1);
        const diagnostics = test.bridge.getNativeLoaderDiagnostics();
        assert.equal(diagnostics.sourcePath, test.source);
        assert.equal(diagnostics.sourceFound, true);
        assert.equal(diagnostics.cacheReady, true);
        assert.equal(diagnostics.loadedPath, test.loads[0]);
    });
    check("corrupt existing cache is rejected without loading or overwriting it", () => {
        const test = fixture();
        const cached = test.cache().cachePath;
        fs.writeFileSync(cached, "corrupt cache");
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.loads.length, 0);
        assert.equal(test.provider().id, "electron-input-event");
        assert.equal(fs.readFileSync(cached, "utf8"), "corrupt cache");
        assert.match(test.bridge.getNativeLoaderDiagnostics().lastError, /integrity/);
    });
    check("already loaded bridge never bypasses a new integrity failure", () => {
        const test = fixture();
        assert.ok(test.bridge.loadNativeTouchpadBridge());
        fs.writeFileSync(test.loads[0], "corrupt cache");
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.loads.length, 1);
    });
    for (const code of ["ENOENT", "EACCES", "EPERM", "ENOSPC"]) {
        check(`${code} during cache copy safely falls back without loading`, () => {
            const test = fixture({ fs: {
                writeFileSync() { throw Object.assign(new Error("mock copy failure"), { code }); },
            } });
            assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
            assert.equal(test.provider().id, "electron-input-event");
            assert.equal(test.loads.length, 0);
            const diagnostics = test.bridge.getNativeLoaderDiagnostics();
            assert.equal(diagnostics.sourceFound, true);
            assert.equal(diagnostics.cacheReady, false);
            assert.match(diagnostics.lastError, new RegExp(code));
            assert.ok(!fs.readdirSync(path.dirname(diagnostics.cachePath)).some((file) => file.endsWith(".tmp")));
        });
    }
    check("missing addon safely falls back with sourceFound=false", () => {
        const test = fixture({ missing: true });
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.bridge.getNativeLoaderDiagnostics().sourceFound, false);
        assert.equal(test.loads.length, 0);
        assert.equal(test.provider().id, "electron-input-event");
    });
    check("unavailable Node filesystem capability never escapes the loader", () => {
        const test = fixture();
        const originalRequire = test.window.require;
        test.window.require = (id) => { if (id === "fs") throw null; return originalRequire(id); };
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.loads.length, 0);
        assert.equal(test.writes(), 0);
        assert.equal(test.provider().id, "electron-input-event");
    });
    check("unsupported architecture never copies or loads the addon", () => {
        const test = fixture({ arch: "arm64" });
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.match(test.bridge.getNativeLoaderDiagnostics().blockedReason, /architecture/);
        assert.equal(test.loads.length, 0);
        assert.equal(test.writes(), 0);
        assert.equal(test.provider().id, "electron-input-event");
    });
    check("dev injection is preserved without requiring or copying a DLL", () => {
        const test = fixture({ arch: "arm64", missing: true });
        test.window.__GESTURE_FLOW_NATIVE__ = { start() {}, stop() {}, capabilities: {} };
        assert.ok(test.bridge.loadNativeTouchpadBridge());
        assert.equal(test.bridge.getNativeLoaderDiagnostics().loadedPath, "global-injection");
        assert.equal(test.loads.length, 0);
        assert.equal(test.writes(), 0);
    });
    check("environment addon source also loads only through the external cache", () => {
        const test = fixture({ missing: true });
        const alternative = path.join(path.dirname(test.source), "development.node");
        fs.writeFileSync(alternative, "development addon");
        test.processMock.env.GESTURE_FLOW_NATIVE_MODULE = alternative;
        assert.ok(test.bridge.loadNativeTouchpadBridge());
        assert.equal(test.loads.length, 1);
        assert.notEqual(test.loads[0], alternative);
    });
    check("atomic publication accepts a matching concurrent writer", () => {
        const test = fixture({ fs: {
            linkSync(temporary, target) {
                fs.copyFileSync(temporary, target);
                throw Object.assign(new Error("mock concurrent writer"), { code: "EEXIST" });
            },
        } });
        assert.equal(test.cache().cacheReady, true);
    });
    check("atomic publication never overwrites a corrupt concurrent target", () => {
        const test = fixture({ fs: {
            linkSync(_temporary, target) {
                fs.writeFileSync(target, "corrupt concurrent target");
                throw Object.assign(new Error("mock concurrent writer"), { code: "EEXIST" });
            },
        } });
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.loads.length, 0);
        assert.equal(fs.readFileSync(test.bridge.getNativeLoaderDiagnostics().cachePath, "utf8"), "corrupt concurrent target");
    });
    check("incomplete temporary bytes never become a loadable target", () => {
        const test = fixture({ fs: { writeFileSync(fd) { fs.writeFileSync(fd, "truncated"); } } });
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.loads.length, 0);
        assert.equal(fs.existsSync(test.bridge.getNativeLoaderDiagnostics().cachePath), false);
    });
    check("cache root inside plugins is rejected before any write", () => {
        const test = fixture();
        const originalRequire = test.window.require;
        test.window.require = (id) => id === "os" ? { tmpdir: () => test.plugins } : originalRequire(id);
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.writes(), 0);
        assert.match(test.bridge.getNativeLoaderDiagnostics().lastError, /inside workspace plugins/);
    });
    check("redirected cache namespace is rejected without touching plugin files", () => {
        const test = fixture();
        fs.symlinkSync(test.plugins, path.join(test.temp, "siyuan-gesture-flow-native"), "junction");
        assert.equal(test.bridge.loadNativeTouchpadBridge(), null);
        assert.equal(test.writes(), 0);
        assert.match(test.bridge.getNativeLoaderDiagnostics().lastError, /redirected/);
    });
    for (const options of [
        { loadFails: true },
        { addon: { start() {}, stop() {}, get capabilities() { throw new Error("mock capability failure"); } } },
        { fs: { writeFileSync() { throw Object.assign(new Error("mock disk full"), { code: "ENOSPC" }); } } },
    ]) {
        check("native failure leaves actual mouse runtime initialization operational", () => {
            const test = fixture(options);
            const { GestureFlowRuntime } = test.load("src/runtime/GestureFlowRuntime.ts");
            const { createDefaultConfig } = test.load("src/config/defaults.ts");
            const instance = new GestureFlowRuntime({ target: test.document, overlayI18n: {}, i18n: {} });
            try {
                assert.doesNotThrow(() => instance.start(createDefaultConfig()));
                assert.equal(instance.getState(), "running");
                assert.ok(instance.adapter);
                assert.ok(test.bridge.getNativeLoaderDiagnostics().lastError);
            } finally {
                instance.dispose();
            }
        });
    }
    check("partial native start rolls back once while the real mouse runtime keeps running", () => {
        let starts = 0, stops = 0;
        const test = fixture({ addon: {
            start() { starts++; throw new Error("partial native start"); },
            stop() { stops++; return "stopped"; },
            capabilities: { precisionTouchpad: true, maxContacts: 5 },
        } });
        const { GestureFlowRuntime } = test.load("src/runtime/GestureFlowRuntime.ts");
        const { createDefaultConfig } = test.load("src/config/defaults.ts");
        const config = createDefaultConfig();
        config.touchpad.enabled = true;
        const errors = [];
        const instance = new GestureFlowRuntime({
            target: test.document, overlayI18n: {}, i18n: {}, onTouchpadError: (label) => errors.push(label),
        });
        try {
            instance.start(config);
            assert.equal(instance.getState(), "running");
            assert.ok(instance.adapter);
            assert.equal(starts, 1);
            assert.equal(stops, 1);
            assert.ok(errors.some((label) => label.includes("start failed")));
        } finally { instance.dispose(); }
        assert.equal(stops, 1);
    });
    check("native stop-pending is reported and repeated Stop safely retries", () => {
        let stops = 0;
        const test = fixture({ addon: {
            start() {},
            stop() { return ++stops === 1 ? "stop-pending" : "stopped"; },
            capabilities: { precisionTouchpad: true, maxContacts: 5 },
        } });
        const { WindowsNativeTouchpadProvider } = test.load("src/touchpad/WindowsNativeTouchpadProvider.ts");
        const errors = [];
        const provider = new WindowsNativeTouchpadProvider(test.bridge.loadNativeTouchpadBridge(), {
            onError: (error) => errors.push(error.label),
        });
        provider.start();
        provider.stop();
        assert.ok(errors.some((label) => label.includes("incomplete")));
        provider.stop();
        provider.stop();
        assert.equal(stops, 2);
    });
    check("touchpad attachment exception preserves the mouse feedback overlay", () => {
        const test = fixture();
        const { TouchpadGestureAdapter } = test.load("src/gesture/touchpad/TouchpadGestureAdapter.ts");
        const attach = TouchpadGestureAdapter.prototype.attach;
        TouchpadGestureAdapter.prototype.attach = function () { attach.call(this); throw new Error("attach failed"); };
        const { GestureFlowRuntime } = test.load("src/runtime/GestureFlowRuntime.ts");
        const { createDefaultConfig } = test.load("src/config/defaults.ts");
        const config = createDefaultConfig();
        config.touchpad.enabled = true;
        const instance = new GestureFlowRuntime({ target: test.document, overlayI18n: {}, i18n: {} });
        try {
            instance.start(config);
            assert.equal(instance.getState(), "running");
            assert.ok(instance.adapter);
            assert.equal(instance.controller.overlay.destroyed, false);
            assert.equal(instance.touchpadAdapter, null);
            assert.equal(instance.touchpadFeedback, null);
        } finally { instance.dispose(); }
    });
    check("normalized native start status and live lifecycle state are preserved, including void injection", () => {
        let result = "started";
        const caps = { lifecycleState: "stopped" };
        const test = fixture({ addon: { start: () => result, stop() {}, capabilities: caps } });
        const bridge = test.bridge.loadNativeTouchpadBridge();
        for (const state of ["stopped", "running", "stop-pending"]) {
            caps.lifecycleState = state;
            assert.equal(bridge.capabilities.lifecycleState, state);
        }
        for (result of ["started", "already-running", undefined]) assert.equal(bridge.start(() => {}), result);
    });
    check("already-running provider cannot bind frames, report active capture or stop the actual owner", () => {
        let callback, starts = 0, stops = 0;
        const caps = { lifecycleState: "stopped", rawContacts: true, multiContactGestures: true, maxContacts: 5 };
        const test = fixture({ addon: {
            capabilities: caps,
            start(fn) { starts++; if (caps.lifecycleState === "running") return "already-running"; callback = fn; caps.lifecycleState = "running"; return "started"; },
            stop() { stops++; caps.lifecycleState = "stopped"; return "stopped"; },
        } });
        const { WindowsNativeTouchpadProvider: Provider } = test.load("src/touchpad/WindowsNativeTouchpadProvider.ts");
        const bridge = test.bridge.loadNativeTouchpadBridge();
        let firstFrames = 0, secondFrames = 0;
        const first = new Provider(bridge, { onFrame() { firstFrames++; } });
        const second = new Provider(bridge, { onFrame() { secondFrames++; } });
        assert.equal(first.start(), "started");
        assert.equal(first.start(), "started");
        assert.equal(second.start(), "unavailable");
        assert.equal(second.capabilities.supportsRawContacts, false);
        assert.equal(second.capabilities.diagnostics.rawContactsActive, false);
        callback({ timestamp: 1, contacts: [] });
        assert.equal(firstFrames, 1); assert.equal(secondFrames, 0);
        second.stop(); second.dispose();
        assert.equal(stops, 0); assert.equal(starts, 2);
        first.stop(); first.stop();
        assert.equal(stops, 1);
    });
    check("an exception with a running module never rolls back another owner's capture", () => {
        let stops = 0;
        const test = fixture({ addon: {
            capabilities: { lifecycleState: "running", rawContacts: true },
            start() { throw new Error("other capture in use"); }, stop() { stops++; },
        } });
        const provider = test.provider();
        assert.equal(provider.start(), "unavailable");
        provider.dispose(); assert.equal(stops, 0);
    });
    check("one bounded pending retry recovers capture and the stale provider cannot stop its replacement", () => {
        let stops = 0, starts = 0;
        const caps = { lifecycleState: "stopped" };
        const test = fixture({ addon: {
            capabilities: caps,
            start() { starts++; caps.lifecycleState = "running"; return "started"; },
            stop() { caps.lifecycleState = ++stops === 1 ? "stop-pending" : "stopped"; return caps.lifecycleState; },
        } });
        const first = test.provider(); assert.equal(first.start(), "started"); first.stop();
        assert.equal(caps.lifecycleState, "stop-pending");
        const second = test.provider(); assert.equal(second.start(), "started");
        assert.equal(stops, 2); assert.equal(starts, 2);
        first.dispose(); assert.equal(stops, 2);
        second.dispose(); second.dispose(); assert.equal(stops, 3);
        assert.equal(test.loads.length, 1); assert.equal(test.writes(), 1);
    });
    for (const failure of ["throw", "already-running", "pending", "pending-stop-throws", "false-stopped", "observer-missing", "observer-attach-fails"]) {
        check("native startup " + failure + " falls back once, keeps mouse available and unloads the effective provider", () => {
            let starts = 0, stops = 0;
            const pending = ["pending", "pending-stop-throws", "false-stopped"].includes(failure);
            const caps = { lifecycleState: pending ? "stop-pending" : failure === "already-running" ? "running" : "stopped" };
            const test = fixture({ noObserver: failure === "observer-missing", observerFails: failure === "observer-attach-fails", addon: {
                capabilities: caps,
                start() { starts++; if (failure === "already-running") return "already-running"; throw new Error("partial native startup"); },
                stop() {
                    stops++;
                    if (failure === "pending-stop-throws") throw new Error("cannot finish stop");
                    if (failure === "false-stopped") return "stopped";
                    caps.lifecycleState = pending ? "stop-pending" : "stopped";
                    return caps.lifecycleState;
                },
            } });
            const { GestureFlowRuntime } = test.load("src/runtime/GestureFlowRuntime.ts");
            const { createDefaultConfig } = test.load("src/config/defaults.ts");
            const config = createDefaultConfig(); config.touchpad.enabled = true;
            const errors = [];
            const runtime = new GestureFlowRuntime({ target: test.document, overlayI18n: {}, i18n: {}, onTouchpadError: label => errors.push(label) });
            const none = failure.startsWith("observer-");
            try {
                assert.doesNotThrow(() => runtime.start(config));
                assert.equal(runtime.getState(), "running"); assert.ok(runtime.adapter);
                const effective = runtime.touchpadAdapter.capabilities;
                assert.equal(effective.providerType, none ? "none" : "electron-input-event");
                assert.equal(effective.supportsRawContacts, false);
                assert.equal(test.webContents.listenerCount("input-event"), none ? 0 : 1);
                assert.equal(starts, pending ? 0 : 1);
                assert.equal(stops, failure === "already-running" ? 0 : 1);
                if (pending) assert.ok(errors.some(label => label.includes("restart SiYuan")));
                assert.equal(test.loads.length, 1);
                assert.equal(test.writes(), 1);
            } finally { runtime.dispose(); runtime.dispose(); }
            assert.equal(test.webContents.listenerCount("input-event"), 0);
            assert.equal(stops, failure === "already-running" ? 0 : 1);
        });
    }
    check("native diagnostics failure during startup still selects Electron and keeps the mouse runtime", () => {
        let failed = false, stops = 0;
        const test = fixture({ addon: {
            get capabilities() { if (failed) throw new Error("diagnostics unavailable"); return { lifecycleState: "stopped" }; },
            start() { failed = true; throw new Error("native startup failed"); },
            stop() { stops++; return "stopped"; },
        } });
        const { GestureFlowRuntime } = test.load("src/runtime/GestureFlowRuntime.ts");
        const { createDefaultConfig } = test.load("src/config/defaults.ts");
        const config = createDefaultConfig(); config.touchpad.enabled = true;
        const runtime = new GestureFlowRuntime({ target: test.document, overlayI18n: {}, i18n: {} });
        try {
            assert.doesNotThrow(() => runtime.start(config));
            assert.equal(runtime.getState(), "running"); assert.ok(runtime.adapter);
            assert.equal(runtime.touchpadAdapter.capabilities.providerType, "electron-input-event");
            assert.equal(test.webContents.listenerCount("input-event"), 1);
        } finally { runtime.dispose(); }
        assert.equal(stops, 1); assert.equal(test.webContents.listenerCount("input-event"), 0);
    });
    check("N-API null guard precedes all API calls and producer shutdown stays first", () => {
        const source = fs.readFileSync(path.join(root, "native/touchpad/src/main.cpp"), "utf8");
        const callback = source.slice(source.indexOf("void CallJsFrame("), source.indexOf("// ------------------------------------------------------------- N-API exports"));
        const ownership = callback.indexOf("std::unique_ptr<NativeFrame>");
        const guard = callback.indexOf("if (!f || !env || !js_cb) return;");
        const firstApi = callback.search(/\bnapi_\w+\s*\(/);
        assert.ok(ownership >= 0 && guard > ownership && firstApi > guard);
        const stop = source.slice(source.indexOf("ThreadStopResult StopNative("), source.indexOf("napi_value GetCapabilities("));
        assert.ok(stop.indexOf("g_controller.Stop()") < stop.indexOf("napi_release_threadsafe_function"));
        assert.ok(stop.indexOf("g_rawCapture.Stop()") < stop.indexOf("napi_release_threadsafe_function"));
    });
    console.log(`Native loader checks passed (${checks}); all DLL loads were mocked.`);
} finally {
    // Every file was created by this test; no fixture binary was actually loaded.
    const resolved = fs.realpathSync(testRoot);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("gesture-flow-loader-check-"));
    fs.rmSync(resolved, { recursive: true, force: true });
}
