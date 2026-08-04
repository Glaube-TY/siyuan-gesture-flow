/**
 * Build artifact verification.
 *
 * Checks both the `dist` directory and `package.zip` for required and
 * forbidden files.  Exits with code 1 on any violation.
 *
 * Usage:  node scripts/verify_build.js
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const ZIP_PATH = path.join(ROOT, "package.zip");

const REQUIRED_FILES = [
    "index.js",
    "plugin.json",
    "icon.png",
    "preview.png",
    "README.md",
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

let errors = 0;

function fail(msg) {
    console.error(`  [FAIL] ${msg}`);
    errors++;
}

function ok(msg) {
    console.log(`  [OK]   ${msg}`);
}

function globMatches(dir, pattern) {
    // Simple glob: convert to regex
    const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return walkFiles(dir).some((f) => regex.test(f));
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
    return FORBIDDEN_PATTERNS.some((pat) => pat.test(name));
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
        if (globMatches(DIST_DIR, glob)) {
            ok(`dist/${glob}`);
        } else {
            fail(`dist/${glob} — no matching file found`);
        }
    }

    // Forbidden files
    for (const file of allFiles) {
        if (checkForbidden(file)) {
            fail(`dist/${file} — forbidden file present`);
        }
    }

    // Check for index.css (may or may not exist if no styles, but if it exists it's fine)
    // Check no .siyuan-dev-target.json or dev tokens
    for (const file of allFiles) {
        if (file.endsWith(".siyuan-dev-target.json") || file.includes("api-token")) {
            fail(`dist/${file} — sensitive file present`);
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

    // Use `tar -tf` to list ZIP contents (available on Windows 10+ and Linux).
    let zipEntries;
    try {
        const output = execSync(
            `tar -tf "${ZIP_PATH}"`,
            { encoding: "utf8", maxBuffer: 1024 * 1024 },
        );
        zipEntries = output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch (e) {
        fail(`Failed to read package.zip: ${e.message}`);
        return;
    }

    console.log(`  package.zip contains ${zipEntries.length} entries`);

    // Normalize entries (strip leading ./ if present)
    const normalized = zipEntries.map((e) => e.replace(/^\.\//, ""));

    // Required files
    for (const req of REQUIRED_FILES) {
        if (normalized.includes(req)) {
            ok(`package.zip/${req}`);
        } else {
            fail(`package.zip/${req} is missing`);
        }
    }

    // Required globs
    const i18nGlob = "i18n/*.json";
    const i18nRegex = new RegExp("^" + i18nGlob.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    if (normalized.some((e) => i18nRegex.test(e))) {
        ok("package.zip/i18n/*.json");
    } else {
        fail("package.zip/i18n/*.json — no matching file found");
    }

    // Forbidden files
    for (const entry of normalized) {
        if (checkForbidden(entry)) {
            fail(`package.zip/${entry} — forbidden file present`);
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
