import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { setTimeout as wait } from "node:timers/promises";
import ts from "typescript";
import { compile } from "svelte/compiler";

// Load real TS lifecycle code without mounting Svelte or loading a native addon.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const modules = new Map();
function loadModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const localRequire = (id) => {
        if (id === "siyuan") return { Plugin: class {}, globalCommand() {}, showMessage() {} };
        if (id.endsWith(".scss")) return {};
        if (id.endsWith(".svelte")) return { default: class {} };
        if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
        const resolved = id.startsWith("@/")
            ? path.join(root, "src", id.slice(2))
            : path.resolve(path.dirname(filename), id);
        return loadModule(resolved.endsWith(".ts") ? resolved : resolved + ".ts");
    };
    vm.runInThisContext(`(function(require, module, exports) {${code}\n})`, { filename })(
        localRequire, module, module.exports,
    );
    return module.exports;
}
const load = (file) => loadModule(path.join(root, file));
const { GestureFlowRuntime } = load("src/runtime/GestureFlowRuntime.ts");
const { MouseGestureAdapter } = load("src/gesture/input/MouseGestureAdapter.ts");
const { TouchpadGestureAdapter } = load("src/gesture/touchpad/TouchpadGestureAdapter.ts");
const { TouchpadProvider } = load("src/touchpad/types.ts");
const { default: GestureFlowPlugin } = load("src/index.ts");
const confirms = load("src/settings/confirmDialog.ts");
const runtime = () => new GestureFlowRuntime({ target: new EventTarget(), overlayI18n: {}, i18n: {} });

// Every owned component is attempted even when any single cleanup throws.
for (let failing = 0; failing < 6; failing++) {
    const instance = runtime();
    const calls = [];
    const cleanup = (id) => () => {
        calls.push(id);
        if (id === failing) throw new Error("injected cleanup failure");
    };
    instance.unsubscribeTouchpadPolling = cleanup(0);
    instance.adapter = { detach: cleanup(1) };
    instance.touchpadAdapter = { dispose: cleanup(2) };
    instance.controller = { destroy: cleanup(3) };
    instance.touchpadFeedback = { destroy: cleanup(4) };
    instance.commandExecutor = { reset: cleanup(5) };
    instance.dispatcher = {};
    instance.shortcutExecutor = {};
    instance.config = {};
    assert.doesNotThrow(() => instance.dispose());
    assert.doesNotThrow(() => instance.dispose());
    assert.deepEqual(calls, [0, 1, 2, 3, 4, 5]);
    for (const field of ["unsubscribeTouchpadPolling", "adapter", "touchpadAdapter", "controller",
        "touchpadFeedback", "commandExecutor", "dispatcher", "shortcutExecutor", "config"]) {
        assert.equal(instance[field], null);
    }
    assert.equal(instance.getState(), "stopped");
}
const timerRuntime = runtime();
let ticks = 0;
timerRuntime.touchpadPollTimer = setInterval(() => ticks++, 1);
timerRuntime.dispose();
await wait(20);
assert.equal(ticks, 0);
assert.equal(timerRuntime.touchpadPollTimer, null);
const reentrantRuntime = runtime();
let resets = 0;
reentrantRuntime.unsubscribeTouchpadPolling = () => reentrantRuntime.dispose();
reentrantRuntime.commandExecutor = { reset: () => resets++ };
reentrantRuntime.dispose();
assert.equal(resets, 1);
const restartDuringCleanup = runtime();
restartDuringCleanup.unsubscribeTouchpadPolling = () => restartDuringCleanup.start({ enabled: false });
restartDuringCleanup.stop();
assert.equal(restartDuringCleanup.getState(), "stopped");
assert.equal(restartDuringCleanup.config, null);
const stoppedRuntime = runtime();
stoppedRuntime.start({ enabled: false });
stoppedRuntime.stop();
stoppedRuntime.start({ enabled: false });
assert.equal(stoppedRuntime.getState(), "disabled");

// Real mouse listeners are removed, and the actual provider disposal hook runs.
class TrackedTarget extends EventTarget {
    listeners = new Map();
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        this.listeners.get(type)?.delete(listener);
    }
    get count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
globalThis.window = new TrackedTarget();
globalThis.document = new TrackedTarget();
try {
    const target = new TrackedTarget();
    const instance = runtime();
    instance.adapter = new MouseGestureAdapter({}, {});
    instance.adapter.attach(target);
    assert.ok(target.count + window.count + document.count > 0);
    instance.dispose();
    assert.equal(target.count + window.count + document.count, 0);
} finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
}
class Provider extends TouchpadProvider {
    stops = 0;
    start() {}
    stop() { this.stops++; }
    get capabilities() { return { providerType: "none" }; }
}
for (const abortFails of [false, true]) {
    const provider = new Provider();
    const adapter = new TouchpadGestureAdapter(() => provider);
    adapter.attach();
    let watchdogTicks = 0;
    adapter.gestureWatchdogHandle = setTimeout(() => watchdogTicks++, 1);
    adapter.releaseWatchdogHandle = setTimeout(() => watchdogTicks++, 1);
    if (abortFails) adapter.tracker.abort = () => { throw new Error("injected abort failure"); };
    const instance = runtime();
    instance.touchpadAdapter = adapter;
    instance.dispose();
    instance.dispose();
    await wait(20);
    assert.equal(provider.stops, 1);
    assert.equal(watchdogTicks, 0);
    assert.equal(adapter.provider, null);
    assert.equal(adapter.attached, false);
}
const provider = new Provider();
let disposals = 0;
provider.dispose = () => disposals++;
const adapter = new TouchpadGestureAdapter(() => provider);
adapter.attach();
adapter.detach();
assert.equal(provider.stops, 1);
assert.equal(disposals, 0);
adapter.attach();
adapter.dispose();
adapter.dispose();
assert.equal(disposals, 1);

// Settings still flush before ConfigManager destruction; failures cannot skip it.
const originalWarn = console.warn;
const originalClose = confirms.closeAllSafeConfirms;
console.warn = () => {};
try {
    for (let failing = 0; failing < 5; failing++) {
        const calls = [];
        const cleanup = (id) => () => {
            calls.push(id);
            if (id === failing) throw new Error("injected unload failure");
        };
        confirms.closeAllSafeConfirms = cleanup(2);
        const plugin = {
            lifecycleToken: 1,
            configLoadPromise: Promise.resolve(),
            unsubscribeConfig: cleanup(0),
            settingsDialog: { destroy: cleanup(1) },
            runtime: { dispose: cleanup(3), stop() { assert.fail("unload called stop"); } },
            configManager: { destroy: cleanup(4) },
            commandCatalogSource: {},
        };
        assert.doesNotThrow(() => GestureFlowPlugin.prototype.onunload.call(plugin));
        assert.deepEqual(calls, [0, 1, 2, 3, 4]);
        assert.equal(plugin.lifecycleToken, 2);
        for (const field of ["configLoadPromise", "unsubscribeConfig", "settingsDialog", "runtime",
            "configManager", "commandCatalogSource"]) assert.equal(plugin[field], null);
        assert.doesNotThrow(() => GestureFlowPlugin.prototype.onunload.call(plugin));
        assert.deepEqual(calls, [0, 1, 2, 3, 4, 2]);
    }
} finally {
    console.warn = originalWarn;
    confirms.closeAllSafeConfirms = originalClose;
}
console.log("Runtime lifecycle checks passed: exception isolation, repeated disposal, timers, listeners, provider release, unload order.");

// Ordinary stops/restarts use the same cleanup guarantees as final disposal.
for (const operation of ["stop", "restart"]) {
    const instance = runtime();
    const attempts = [];
    instance.config = { enabled: false };
    instance.adapter = { detach() { attempts.push("mouse"); throw new Error("cleanup failure"); } };
    instance.touchpadAdapter = { detach() { attempts.push("touchpad"); } };
    instance.controller = { destroy() { attempts.push("feedback"); } };
    instance.commandExecutor = { reset() { attempts.push("commands"); } };
    const result = operation === "stop" ? instance.stop() : instance.restart({ enabled: false });
    assert.deepEqual(attempts, ["mouse", "touchpad", "feedback", "commands"]);
    if (operation === "restart") assert.equal(result.status, "applied");
    instance.stop();
    assert.equal(instance.getState(), "stopped");
}
for (const rollbackFails of [false, true]) {
    const instance = runtime();
    const previous = { enabled: true, name: "previous" };
    const next = { enabled: true, name: "next" };
    let cleanups = 0;
    let failuresEnabled = false;
    instance.doStart = (config) => {
        instance.adapter = { detach() { cleanups++; } };
        if (config === next || (rollbackFails && failuresEnabled)) throw new Error("startup failure");
        instance.state = "running";
    };
    instance.start(previous);
    failuresEnabled = true;
    assert.equal(instance.restart(next).status, rollbackFails ? "failed" : "rolled-back");
    assert.equal(instance.getState(), rollbackFails ? "stopped" : "running");
    assert.equal(instance.config, rollbackFails ? null : previous);
    assert.equal(cleanups, rollbackFails ? 3 : 2);
    instance.dispose();
}

// index.ts must catch load/start/restart/settings failures and reject late mounts.
const configModule = load("src/config/ConfigManager.ts");
const runtimeModule = load("src/runtime/GestureFlowRuntime.ts");
const savedConfigManager = configModule.ConfigManager;
const savedRuntime = runtimeModule.GestureFlowRuntime;
const unhandled = [];
const onUnhandled = (error) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
console.warn = () => {};
try {
    for (const scenario of ["unload-before-load", "load-rejection", "start-failure", "restart-failure", "settings-failure"]) {
        let resolve, reject;
        const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
        const counts = { starts: 0, stops: 0, disposals: 0, settings: 0, subscriptions: 0 };
        let subscribed;
        configModule.ConfigManager = class {
            isLoaded = false;
            load() { return pending; }
            subscribe(callback) { counts.subscriptions++; subscribed = callback; return () => {}; }
            destroy() {}
        };
        runtimeModule.GestureFlowRuntime = class {
            start() { counts.starts++; if (scenario === "start-failure") throw new Error("start failed"); }
            stop() { counts.stops++; }
            dispose() { counts.disposals++; }
            restart() { throw new Error("restart failed"); }
        };
        const plugin = new GestureFlowPlugin({ app: null });
        plugin.i18n = {};
        plugin.doOpenSetting = () => {
            counts.settings++;
            if (scenario === "settings-failure") throw new Error("settings failed");
        };
        plugin.onload();
        plugin.openSetting();
        if (scenario === "unload-before-load") plugin.onunload();
        if (scenario === "load-rejection") reject(new Error("load failed"));
        else resolve({ config: { enabled: false }, source: "storage" });
        await new Promise(setImmediate);
        if (scenario === "unload-before-load" || scenario === "load-rejection") {
            assert.equal(counts.starts, 0);
            assert.equal(counts.settings, 0);
            assert.equal(counts.subscriptions, 0);
        } else {
            assert.equal(counts.starts, 1);
            assert.equal(counts.subscriptions, 1);
        }
        if (scenario === "start-failure") assert.equal(counts.disposals, 1);
        if (scenario === "restart-failure") {
            assert.doesNotThrow(() => subscribed({ enabled: false }));
            assert.equal(counts.stops, 1);
        }
        plugin.onunload();
    }
    await new Promise(setImmediate);
    assert.deepEqual(unhandled, []);
} finally {
    process.removeListener("unhandledRejection", onUnhandled);
    configModule.ConfigManager = savedConfigManager;
    runtimeModule.GestureFlowRuntime = savedRuntime;
    console.warn = originalWarn;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
}
console.log("Stop/restart recovery and asynchronous plugin startup checks passed.");

// Execute the actual Svelte-compiled instance/update functions with isolated UI hooks.
// No DOM fragment or native DLL is created; mount dependencies use the real status bus.
const bus = load("src/runtime/TouchpadRuntimeState.ts");
function mountComponent(file, inspection, seed = "") {
    let mounts = [], destroyers = [], dispatched = [];
    const filename = path.join(root, file);
    let source = fs.readFileSync(filename, "utf8");
    source = source.replace(/<script lang="ts">([\s\S]*?)<\/script>/, (_, script) => {
        const instrumented = script + "\nexport function inspectForTest() { return " + inspection + "; }\n" + seed;
        return "<script>" + ts.transpileModule(instrumented, {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, verbatimModuleSyntax: true },
        }).outputText + "</script>";
    });
    const code = ts.transpileModule(compile(source, { filename, generate: "dom", discloseVersion: false }).js.code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const hooks = {
        onMount(fn) { mounts.push(fn); }, onDestroy(fn) { destroyers.push(fn); },
        createEventDispatcher: () => (type, detail) => dispatched.push({ type, detail }),
    };
    const internal = {
        globals: globalThis,
        SvelteComponent: class { $destroy() { for (const fn of destroyers.splice(0)) fn(); } },
        init(component, options, instance) {
            component.$$ = { ctx: [], dirty: Array(8).fill(-1), bound: {} };
            component.$$.ctx = instance(component, options.props, (index, value, ...rest) => {
                component.$$.ctx[index] = rest.length ? rest[rest.length - 1] : value;
                return value;
            });
            for (const fn of mounts.splice(0)) fn();
            component.$$.update?.();
        },
    };
    const module = { exports: {} };
    vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(id => {
        if (id === "svelte/internal") return internal;
        if (id === "svelte") return hooks;
        assert.ok(id.startsWith("@/"), "unexpected component dependency " + id);
        return load("src/" + id.slice(2) + ".ts");
    }, module, module.exports);
    const component = new module.exports.default({ props: { i18n: {}, trackerConfig: {} } });
    return { component, dispatched, update: () => component.$$.update?.() };
}
const originalRaf = globalThis.requestAnimationFrame, originalCancelRaf = globalThis.cancelAnimationFrame;
const pendingRafs = new Map();
let rafSequence = 0;
globalThis.requestAnimationFrame = callback => { const id = ++rafSequence; pendingRafs.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => pendingRafs.delete(id);
function flushRafs() { for (const [id, callback] of [...pendingRafs]) { pendingRafs.delete(id); callback(); } }
const caps = { providerType: "windows-native", supportsRawContacts: true, diagnostics: { parser: { assembler: { completedFrameCount: 1 } } } };
const snapshot = { timestamp: 1, contacts: [{ id: 1, x: 0.2, y: 0.3, touching: true }],
    displayPath: [{ x: 0.2, y: 0.3 }], displayContactPaths: [{ id: 1, points: [{ x: 0.2, y: 0.3 }] }],
    event: null, eventLabel: "old event", currentKind: "swipe", stage: "TRACKING" };
let area, recorder;
try {
    bus.publishTouchpadEnabled(true); bus.publishTouchpadCapabilities(caps);
    const unsubscribe = bus.subscribeTouchpadDiagnostics(() => {});
    bus.publishTouchpadFrame(snapshot); unsubscribe();
    area = mountComponent("src/settings/components/TouchpadTestArea.svelte",
        "{ mode, hintText, contacts, displayPath, displayContactPaths, contactCount, eventLabel, currentKind, stage }");
    assert.equal(area.component.inspectForTest().mode, "contacts");
    assert.equal(area.component.inspectForTest().contacts.length, 1);
    recorder = mountComponent("src/settings/components/TouchpadGestureRecorder.svelte",
        "{ touchpadEnabled, rawContacts, session, livePath, rawContactPaths, finalPath, finalContactPaths, finalContacts, pendingCompletion, lastPhysicalContactCount, waitTimer, prepareTimer, releaseWatchdogTimer }",
        "export function seedForTest() { session = 'WAIT_RELEASE'; livePath = [{x:0.2,y:0.3}]; rawContactPaths = [{id:1,points:livePath}]; finalPath = livePath; finalContactPaths = rawContactPaths; finalContacts = [{id:1,x:0.2,y:0.3}]; pendingCompletion = {} as any; lastPhysicalContactCount = 1; waitTimer = setTimeout(() => {}, 1000); prepareTimer = setTimeout(() => {}, 1000); releaseWatchdogTimer = setTimeout(() => {}, 1000); setTouchpadRecording(true); }");
    assert.equal(recorder.component.inspectForTest().rawContacts, true);
    recorder.component.seedForTest(); recorder.update();
    assert.equal(bus.isTouchpadRecording(), true);
    bus.publishTouchpadEnabled(false); flushRafs(); area.update(); recorder.update();
    const clearedArea = area.component.inspectForTest(), clearedRecorder = recorder.component.inspectForTest();
    assert.equal(clearedArea.mode, "disabled"); assert.equal(clearedArea.hintText, "触控板手势未启用");
    const english = JSON.parse(fs.readFileSync(path.join(root, "public/i18n/en.json"), "utf8"));
    area.component.$$set({ i18n: english }); area.update();
    assert.equal(area.component.inspectForTest().hintText, english.tpDisabled);
    for (const key of ["contacts", "displayPath", "displayContactPaths"]) assert.equal(clearedArea[key].length, 0);
    assert.equal(clearedArea.eventLabel, null); assert.equal(clearedArea.currentKind, null); assert.equal(clearedArea.stage, "IDLE");
    assert.equal(clearedRecorder.rawContacts, false); assert.equal(clearedRecorder.touchpadEnabled, false);
    assert.equal(clearedRecorder.session, "DISARMED"); assert.equal(clearedRecorder.lastPhysicalContactCount, 0);
    for (const key of ["livePath", "rawContactPaths", "finalPath", "finalContactPaths", "finalContacts"]) assert.equal(clearedRecorder[key].length, 0);
    for (const key of ["waitTimer", "prepareTimer", "releaseWatchdogTimer", "pendingCompletion"]) assert.equal(clearedRecorder[key], null);
    assert.equal(bus.isTouchpadRecording(), false); assert.equal(recorder.dispatched.length, 0);
    let rawFrames = 0; const unsubscribeRaw = bus.subscribeTouchpadRawFrames(() => rawFrames++);
    bus.publishTouchpadCapabilities(caps); bus.publishTouchpadFrame(snapshot); bus.publishTouchpadRawFrame({});
    assert.equal(rawFrames, 0); unsubscribeRaw();
    assert.equal(bus.getTouchpadDiagnostics().capabilities, null); assert.equal(bus.getTouchpadDiagnostics().latest, null);
    bus.publishTouchpadEnabled(true); flushRafs(); area.update(); recorder.update();
    assert.equal(area.component.inspectForTest().mode, "initializing");
    assert.equal(area.component.inspectForTest().hintText, english.tpInitializing);
    assert.equal(recorder.component.inspectForTest().rawContacts, false);
    bus.publishTouchpadCapabilities({ providerType: "none", supportsRawContacts: false });
    flushRafs(); area.update(); recorder.update(); assert.equal(area.component.inspectForTest().mode, "none");
    bus.publishTouchpadCapabilities(caps); flushRafs(); area.update(); recorder.update();
    assert.equal(recorder.component.inspectForTest().rawContacts, true);
    // Enabled state stays available to settings mounted after provider startup.
    assert.equal(bus.getTouchpadDiagnostics().capabilities, caps);
    bus.publishTouchpadCapabilities(null); flushRafs(); area.update(); recorder.update();
    assert.equal(recorder.component.inspectForTest().rawContacts, false);
    assert.equal(area.component.inspectForTest().mode, "initializing");
} finally {
    area?.component.$destroy(); recorder?.component.$destroy(); bus.publishTouchpadEnabled(false);
    if (originalRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = originalRaf;
    if (originalCancelRaf === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = originalCancelRaf;
}
assert.equal(bus.hasTouchpadDiagnosticsListeners(), false); assert.equal(bus.hasTouchpadRawFrameListeners(), false);
assert.equal(pendingRafs.size, 0);
for (const language of ["en", "zh-CN"]) {
    const i18n = JSON.parse(fs.readFileSync(path.join(root, "public/i18n", language + ".json"), "utf8"));
    assert.ok(i18n.tpDisabled); assert.ok(i18n.tpInitializing);
}
console.log("Touchpad status and compiled Svelte checks passed: disabled/initializing/unavailable, stale contacts/trails, recorder timers and subscriptions.");
