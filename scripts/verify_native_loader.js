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
    const nodeRequire = (id) => {
        if (id === "fs") return mockFs;
        if (id === "os") return { tmpdir: () => options.temp ?? temp };
        if (id === "path") return path;
        if (id === "crypto") return crypto;
        if (id === "process") return processMock;
        if (id === "electron") return {};
        if (id === "@electron/remote") return { getCurrentWindow: () => ({ webContents }) };
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
        source, plugins, temp, loads, bridge, window, document, processMock, mockFs,
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
    check("N-API null guard precedes all API calls and producer shutdown stays first", () => {
        const source = fs.readFileSync(path.join(root, "native/touchpad/src/main.cpp"), "utf8");
        const callback = source.slice(source.indexOf("void CallJsFrame("), source.indexOf("// ------------------------------------------------------------- N-API exports"));
        const ownership = callback.indexOf("std::unique_ptr<NativeFrame>");
        const guard = callback.indexOf("if (!f || !env || !js_cb) return;");
        const firstApi = callback.search(/\bnapi_\w+\s*\(/);
        assert.ok(ownership >= 0 && guard > ownership && firstApi > guard);
        const stop = source.slice(source.indexOf("napi_value Stop("), source.indexOf("napi_value GetCapabilities("));
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
