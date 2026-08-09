/**
 * Build the Windows native touchpad addon (N-API / ABI-stable).
 *
 * Produces:
 *   native/gesture_flow_touchpad.node   (built addon)
 *   dev/native/gesture_flow_touchpad.node   (for `pnpm build:dev` + dev deploy)
 *   dist/native/gesture_flow_touchpad.node  (for production `pnpm build`)
 *
 * Requirements:
 *   - Windows (win32)
 *   - MSVC Build Tools / Visual Studio with a C++ workload
 *   - node-gyp (installed as a devDependency)
 *   - Windows 11 SDK (optional — enables the TouchpadGesturesController
 *     path; without it the addon still builds as a Raw-Input-only provider)
 *
 * The addon is N-API v8, so it loads in both the system Node and the SiYuan
 * Electron renderer without recompiling per Electron ABI.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const NATIVE_DIR = path.join(ROOT, "native", "touchpad");
const OUTPUT_NAME = "gesture_flow_touchpad.node";
const ARTIFACT_SOURCE = path.join(NATIVE_DIR, "build", "Release", OUTPUT_NAME);

function fail(message) {
    console.error(`  [native] FAIL ${message}`);
    process.exit(1);
}

function ok(message) {
    console.log(`  [native] OK   ${message}`);
}

function findNodeGyp() {
    try {
        const resolved = require.resolve("node-gyp/bin/node-gyp.js");
        return resolved;
    } catch {
        return null;
    }
}

/** Find the newest Windows SDK cppwinrt include directory (optional). */
function findCppWinrtIncludeDir() {
    const candidates = [
        "C:\\Program Files (x86)\\Windows Kits\\10\\Include",
        "C:\\Program Files\\Windows Kits\\10\\Include",
    ];
    const versions = [];
    for (const base of candidates) {
        if (!fs.existsSync(base)) continue;
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const cppwinrt = path.join(base, entry.name, "cppwinrt");
            if (fs.existsSync(cppwinrt)) {
                versions.push({ dir: cppwinrt, version: entry.name });
            }
        }
    }
    if (versions.length === 0) return null;
    versions.sort((a, b) => (a.version < b.version ? 1 : -1));
    ok(`cppwinrt include: ${versions[0].dir}`);
    return versions[0].dir;
}

/**
 * Preflight the C++ toolchain so failures are clear and actionable instead
 * of a wall of node-gyp internals.
 *
 * Python is checked separately by {@link findWorkingPython} (the Windows
 * Store `python` alias is rejected there); here we only check MSVC.
 */
function preflightToolchain() {
    const missing = [];

    // node-gyp locates MSVC via vswhere (registry), not PATH, so check that
    // instead of `where cl.exe`.
    const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
    const hasMSVC =
        fs.existsSync(vswhere) &&
        spawnSync(
            vswhere,
            ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
            { encoding: "utf8", windowsHide: true },
        ).stdout?.trim().length > 0;
    if (!hasMSVC) {
        missing.push(
            "MSVC C++ toolchain (install 'Desktop development with C++' in Visual Studio Installer, " +
            "then run pnpm native:build from a Developer PowerShell, or " +
            "run: npm config set msvs_version 2022)",
        );
    }

    if (missing.length > 0) {
        console.error("  [native] Missing build requirements:");
        for (const item of missing) {
            console.error(`    - ${item}`);
        }
        console.error("  [native] The native addon cannot be compiled on this machine.");
        console.error("  [native] The plugin still works without it (Electron observer mode).");
        process.exit(1);
    }
}

/**
 * Locate a working Python 3 for node-gyp.
 *
 * Prefers an explicit `GESTURE_FLOW_PYTHON` / `PYTHON` env var, then the
 * standard python.org install location, then a `python`/`py` that actually
 * responds (the Windows Store `python.exe` alias stub does not, so it is
 * rejected).  Returns the absolute python.exe path or exits.
 */
function findWorkingPython() {
    const candidates = [];
    const env = process.env;
    if (env.GESTURE_FLOW_PYTHON) candidates.push(env.GESTURE_FLOW_PYTHON);
    if (env.PYTHON) candidates.push(env.PYTHON);
    // Common python.org install locations (%LOCALAPPDATA%\Programs\Python\Python3xx).
    const local = process.env.LOCALAPPDATA;
    if (local) {
        const pyRoot = path.join(local, "Programs", "Python");
        if (fs.existsSync(pyRoot)) {
            for (const entry of fs.readdirSync(pyRoot)) {
                const exe = path.join(pyRoot, entry, "python.exe");
                if (fs.existsSync(exe)) candidates.push(exe);
            }
        }
    }
    candidates.push("python", "py");

    for (const candidate of candidates) {
        // Absolute-path candidates are trusted directly; the bare `python`/`py`
        // names must resolve through stdout (the Windows Store alias stub
        // prints nothing and is rejected).  PYTHONIOENCODING=utf-8 ensures the
        // path is decoded correctly even when the username contains non-ASCII
        // characters (Python would otherwise emit it in the ANSI codepage).
        try {
            const probe = spawnSync(
                candidate,
                ["-c", "import sys; print(sys.executable, end='')"],
                { encoding: "utf8", windowsHide: true, timeout: 15000, env: { ...env, PYTHONIOENCODING: "utf-8" } },
            );
            if (probe.status === 0 && probe.stdout && probe.stdout.trim().length > 0) {
                const resolved =
                    candidate === "python" || candidate === "py"
                        ? probe.stdout.trim()
                        : candidate;
                ok(`python: ${resolved}`);
                return resolved;
            }
        } catch {
            // try the next candidate
        }
    }
    fail("could not find a working Python 3 for node-gyp (the Windows Store 'python' alias does not count)");
}

/**
 * Whether the SDK's cppwinrt projection actually contains the
 * `TouchpadGesturesController` runtime class (some SDKs only project the
 * interface, not the runtime class).
 */
function hasTouchpadGesturesControllerClass(cppwinrtDir) {
    const header = path.join(cppwinrtDir, "winrt", "Windows.UI.Input.h");
    if (!fs.existsSync(header)) {
        return false;
    }
    const content = fs.readFileSync(header, "utf8");
    return (
        content.includes("struct TouchpadGesturesController") &&
        content.includes("TouchpadGesturesConfiguration") &&
        content.includes("GlobalActionPerformed")
    );
}

/**
 * Write `native/touchpad/build_env.gypi` with the optional cppwinrt include
 * directory (used by binding.gyp for the TouchpadGesturesController path).
 */
function writeBuildEnv(cppwinrtDir, haveTgController) {
    const value = cppwinrtDir ? cppwinrtDir.replace(/\\/g, "/") : "";
    const gypi = {
        variables: {
            cppwinrt_dir: value,
            have_tg_controller: haveTgController ? 1 : 0,
        },
    };
    const target = path.join(NATIVE_DIR, "build_env.gypi");
    const body = JSON.stringify(gypi, null, 2) + "\n";
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== body) {
        fs.writeFileSync(target, body, "utf8");
    }
    if (value) {
        ok(`build_env.gypi cppwinrt_dir: ${value}`);
    } else {
        console.log("  [native] no cppwinrt include dir — TouchpadGesturesController disabled in this build");
    }
}

function copyIfChanged(source, target) {
    if (!fs.existsSync(source)) return false;
    if (fs.existsSync(target)) {
        const a = fs.readFileSync(source);
        const b = fs.readFileSync(target);
        if (a.equals(b)) return false;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return true;
}

if (process.platform !== "win32") {
    fail("native addon is Windows-only (platform: " + process.platform + ")");
}

if (!fs.existsSync(path.join(NATIVE_DIR, "binding.gyp"))) {
    fail(`binding.gyp not found at ${NATIVE_DIR}`);
}

const nodeGyp = findNodeGyp();
if (!nodeGyp) {
    fail("node-gyp is not installed — run `pnpm install` (node-gyp is a devDependency)");
}

preflightToolchain();
const resolvedPython = findWorkingPython();

const cppwinrtDir = findCppWinrtIncludeDir();
const tgControllerAvailable = cppwinrtDir
    ? hasTouchpadGesturesControllerClass(cppwinrtDir)
    : false;
writeBuildEnv(cppwinrtDir, tgControllerAvailable ? 1 : 0);
if (tgControllerAvailable) {
    ok("TouchpadGesturesController runtime class projected in this SDK");
} else {
    console.log(
        "  [native] TouchpadGesturesController not projected in this SDK - " +
        "3/4/5-finger actions + system-gesture takeover disabled; Raw Input contact frames remain active",
    );
}

console.log("  [native] node-gyp rebuild in", NATIVE_DIR);
const result = spawnSync(process.execPath, [nodeGyp, "rebuild", "--arch=x64", `--python=${resolvedPython}`], {
    cwd: NATIVE_DIR,
    stdio: "inherit",
    env: { ...process.env, npm_config_node_gyp: nodeGyp },
});
if (result.status !== 0) {
    fail(`node-gyp rebuild exited with code ${result.status}`);
}

if (!fs.existsSync(ARTIFACT_SOURCE)) {
    fail(`build did not produce ${ARTIFACT_SOURCE}`);
}

// 1. Repo-level artifact (used by `pnpm build`).
copyIfChanged(ARTIFACT_SOURCE, path.join(ROOT, "native", OUTPUT_NAME));
ok(`native/${OUTPUT_NAME}`);

// 2. Dev output (dev/native) so `pnpm build:dev` + dev deploy mirror it.
if (copyIfChanged(ARTIFACT_SOURCE, path.join(ROOT, "dev", "native", OUTPUT_NAME))) {
    ok(`dev/native/${OUTPUT_NAME}`);
} else {
    ok(`dev/native/${OUTPUT_NAME} (unchanged)`);
}

// 3. Production output (dist/native).
if (copyIfChanged(ARTIFACT_SOURCE, path.join(ROOT, "dist", "native", OUTPUT_NAME))) {
    ok(`dist/native/${OUTPUT_NAME}`);
} else {
    ok(`dist/native/${OUTPUT_NAME} (unchanged)`);
}

console.log("  [native] build complete.");
