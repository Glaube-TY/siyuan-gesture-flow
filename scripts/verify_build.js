/**
 * Build artifact verification.
 *
 * Checks both the `dist` directory and `package.zip` for required and
 * forbidden files.  Exits with code 1 on any violation.
 *
 * Uses `adm-zip` (pure JavaScript) to read ZIP entries — no dependency on
 * system `tar`, `unzip`, or PowerShell, so it works identically on Windows,
 * Linux, and GitHub Actions runners.
 *
 * Usage:  node scripts/verify_build.js
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const ZIP_PATH = path.join(ROOT, "package.zip");

const REQUIRED_FILES = [
    "index.js",
    "plugin.json",
    "icon.png",
    "preview.png",
    "README.md",
    "README.zh-CN.md",
];

const REQUIRED_GLOBS = [
    // At least one i18n JSON file must exist
    "i18n/*.json",
];

const FORBIDDEN_FILES = [
    "kernel.js",
    "kernel.js.map",
    ".env",
    ".siyuan-dev-target.json",
];

const FORBIDDEN_PATTERNS = [
    /Hello/i,
    /^plugin-sample/i,
];

// Patterns that indicate sensitive data leakage.
const SENSITIVE_PATTERNS = [
    /\.env$/,
    /api-token/i,
    /\.siyuan-dev-target\.json$/,
];

let errors = 0;

function fail(msg) {
    console.error(`  [FAIL] ${msg}`);
    errors++;
}

function ok(msg) {
    console.log(`  [OK]   ${msg}`);
}

function globToRegex(pattern) {
    return new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
    );
}

function walkFiles(dir, base = dir) {
    const result = [];
    if (!fs.existsSync(dir)) return result;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...walkFiles(fullPath, base));
        } else {
            result.push(path.relative(base, fullPath).replace(/\\/g, "/"));
        }
    }
    return result;
}

function checkForbidden(name) {
    if (FORBIDDEN_FILES.includes(name)) {
        return true;
    }
    if (FORBIDDEN_PATTERNS.some((pat) => pat.test(name))) {
        return true;
    }
    if (SENSITIVE_PATTERNS.some((pat) => pat.test(name))) {
        return true;
    }
    return false;
}

/**
 * Check for path-traversal attempts in ZIP entries (e.g. `../foo` or
 * absolute paths like `/etc/passwd` or `C:\...`).
 */
function isPathTraversal(entry) {
    // Normalise separators.
    const normalised = entry.replace(/\\/g, "/");
    // Absolute Unix path.
    if (normalised.startsWith("/")) return true;
    // Drive letter (Windows).
    if (/^[a-zA-Z]:/.test(normalised)) return true;
    // Parent-directory reference.
    if (normalised.includes("../") || normalised === "..") return true;
    // UNC path.
    if (normalised.startsWith("//")) return true;
    return false;
}

// --------------------------------------------------------------- dist

function verifyDist() {
    console.log("\n--- Verifying dist/ ---");
    if (!fs.existsSync(DIST_DIR) || !fs.statSync(DIST_DIR).isDirectory()) {
        fail("dist/ directory does not exist");
        return;
    }

    const allFiles = walkFiles(DIST_DIR);
    console.log(`  dist contains ${allFiles.length} files`);

    // Required files
    for (const req of REQUIRED_FILES) {
        if (allFiles.includes(req)) {
            ok(`dist/${req}`);
        } else {
            fail(`dist/${req} is missing`);
        }
    }

    // Required globs
    for (const glob of REQUIRED_GLOBS) {
        const regex = globToRegex(glob);
        if (allFiles.some((f) => regex.test(f))) {
            ok(`dist/${glob}`);
        } else {
            fail(`dist/${glob} — no matching file found`);
        }
    }

    // Forbidden files
    for (const file of allFiles) {
        if (checkForbidden(file)) {
            fail(`dist/${file} — forbidden or sensitive file present`);
        }
    }

    ok("dist forbidden-file scan complete");
}

// --------------------------------------------------------------- zip

function verifyZip() {
    console.log("\n--- Verifying package.zip ---");
    if (!fs.existsSync(ZIP_PATH)) {
        fail("package.zip does not exist");
        return;
    }

    let entries;
    try {
        const zip = new AdmZip(ZIP_PATH);
        entries = zip.getEntries().map((e) => e.entryName);
    } catch (e) {
        fail(`Failed to read package.zip: ${e.message}`);
        return;
    }

    console.log(`  package.zip contains ${entries.length} entries`);

    // Normalise entries (strip leading ./ if present).
    const normalized = entries.map((e) => e.replace(/^\.\//, ""));

    // Path-traversal check.
    for (const entry of normalized) {
        if (isPathTraversal(entry)) {
            fail(`package.zip/${entry} — path-traversal entry detected`);
        }
    }

    // Required files
    for (const req of REQUIRED_FILES) {
        if (normalized.includes(req)) {
            ok(`package.zip/${req}`);
        } else {
            fail(`package.zip/${req} is missing`);
        }
    }

    // Required globs
    for (const glob of REQUIRED_GLOBS) {
        const regex = globToRegex(glob);
        if (normalized.some((e) => regex.test(e))) {
            ok(`package.zip/${glob}`);
        } else {
            fail(`package.zip/${glob} — no matching file found`);
        }
    }

    // Forbidden files
    for (const entry of normalized) {
        if (checkForbidden(entry)) {
            fail(`package.zip/${entry} — forbidden or sensitive file present`);
        }
    }

    ok("package.zip forbidden-file scan complete");
}

// --------------------------------------------------------------- main

console.log("=== Build Artifact Verification ===");
verifyDist();
verifyZip();

console.log("");
if (errors === 0) {
    console.log("All checks passed.");
    process.exit(0);
} else {
    console.error(`${errors} check(s) failed.`);
    process.exit(1);
}
