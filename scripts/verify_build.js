/**
 * Build artifact verification.
 *
 * Checks both the `dist` directory and `package.zip` for required and
 * forbidden files, plus content-level scanning for hardcoded credentials.
 * Exits with code 1 on any violation.
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

/**
 * File extensions whose contents are scanned for hardcoded credentials.
 * Binary formats (images, fonts, zips) are skipped.
 */
const TEXT_EXTENSIONS = new Set([
    ".js", ".json", ".md", ".css", ".html", ".txt", ".xml", ".svg", ".yaml", ".yml",
]);

/**
 * Maximum file size (in bytes) for content scanning.  Larger files are
 * skipped to avoid reading huge minified bundles byte-by-byte; the limit
 * is generous enough for any reasonable plugin bundle.
 */
const MAX_SCAN_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * Credential patterns for content scanning.
 *
 * Each entry has:
 * - `regex`: the pattern to match
 * - `label`: human-readable description (printed on violation, never the
 *   matched value itself)
 * - `allow`: optional list of strings that, if the match equals one of
 *   them, suppresses the violation (for placeholders like `<TOKEN>`)
 */
/** @type {Array<{regex: RegExp, label: string, allow?: string[]}>} */
const CREDENTIAL_PATTERNS = [
    // Authorization: token <something>
    {
        regex: /Authorization\s*[:=]\s*["']?(?:token|Bearer)\s+([A-Za-z0-9_\-]{8,})["']?/i,
        label: "Authorization header with credential",
    },
    // SIYUAN_API_TOKEN=<value> (but not empty or placeholder)
    {
        regex: /SIYUAN_API_TOKEN\s*=\s*["']?([A-Za-z0-9_\-]{8,})["']?/i,
        label: "SIYUAN_API_TOKEN assignment",
        allow: ["YOUR_TOKEN", "<TOKEN>", "your_token_here", "PLACEHOLDER"],
    },
    // Generic API key patterns
    {
        regex: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-]{16,})["']/i,
        label: "Hardcoded API key or secret",
        allow: ["YOUR_TOKEN", "<TOKEN>", "your_token_here", "PLACEHOLDER"],
    },
    // SiYuan-specific token in URL
    {
        regex: /(?:127\.0\.0\.1|localhost)(?::\d+)?/i,
        label: "localhost URL reference (informational, not a violation by itself)",
    },
];

/**
 * Explicit placeholder strings that are always safe and should never be
 * flagged as credentials.
 */
const SAFE_PLACEHOLDERS = new Set([
    "<token>", "<TOKEN>", "your_token", "YOUR_TOKEN",
    "your_token_here", "YOUR_TOKEN_HERE",
    "placeholder", "PLACEHOLDER",
    "", // empty string
]);

let errors = 0;

function fail(msg) {
    console.error(`  [FAIL] ${msg}`);
    errors++;
}

function warn(msg) {
    console.log(`  [WARN] ${msg}`);
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
    // Check both the full path and the basename so that nested forbidden
    // files (e.g. `subdir/kernel.js`) are also detected.
    const base = path.basename(name);
    if (FORBIDDEN_FILES.includes(name) || FORBIDDEN_FILES.includes(base)) {
        return true;
    }
    if (FORBIDDEN_PATTERNS.some((pat) => pat.test(name) || pat.test(base))) {
        return true;
    }
    if (SENSITIVE_PATTERNS.some((pat) => pat.test(name) || pat.test(base))) {
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

/**
 * Whether a file's extension qualifies it for text content scanning.
 */
function isTextFile(name) {
    const ext = path.extname(name).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
}

/**
 * Scan text content for hardcoded credentials.
 *
 * Reports the file path and credential type but **never** prints the
 * matched value itself.
 */
function scanContent(filePath, content) {
    for (const pattern of CREDENTIAL_PATTERNS) {
        const match = pattern.regex.exec(content);
        if (!match) continue;

        // If the matched group is a known placeholder, skip.
        if (match[1]) {
            const value = match[1].trim();
            if (SAFE_PLACEHOLDERS.has(value)) continue;
            if (pattern.allow && pattern.allow.includes(value)) continue;
        }

        // The "localhost URL" pattern is informational only.
        if (pattern.label.includes("informational")) {
            warn(`${filePath} — ${pattern.label}`);
            continue;
        }

        fail(`${filePath} — ${pattern.label} detected (value redacted)`);
    }
}

/**
 * Read a file from dist and scan its content if it's a text file.
 */
function scanDistFile(distPath, relPath) {
    if (!isTextFile(relPath)) return;
    const fullPath = path.join(distPath, relPath);
    let stat;
    try {
        stat = fs.statSync(fullPath);
    } catch {
        return;
    }
    if (stat.size > MAX_SCAN_SIZE) {
        warn(`${relPath} — skipped content scan (file too large: ${stat.size} bytes)`);
        return;
    }
    let content;
    try {
        content = fs.readFileSync(fullPath, "utf-8");
    } catch {
        return;
    }
    scanContent(relPath, content);
}

/**
 * Read a ZIP entry and scan its content if it's a text file.
 */
function scanZipEntry(zip, entryName) {
    if (!isTextFile(entryName)) return;
    let entry;
    try {
        entry = zip.getEntry(entryName);
    } catch {
        return;
    }
    if (!entry || entry.header.size > MAX_SCAN_SIZE) {
        if (entry) {
            warn(`${entryName} — skipped content scan (entry too large: ${entry.header.size} bytes)`);
        }
        return;
    }
    let content;
    try {
        content = entry.getData().toString("utf-8");
    } catch {
        return;
    }
    scanContent(`package.zip/${entryName}`, content);
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

    // Content scanning
    console.log("  Scanning dist text file contents for credentials...");
    for (const file of allFiles) {
        scanDistFile(DIST_DIR, file);
    }
    ok("dist content scan complete");
}

// --------------------------------------------------------------- zip

function verifyZip() {
    console.log("\n--- Verifying package.zip ---");
    if (!fs.existsSync(ZIP_PATH)) {
        fail("package.zip does not exist");
        return;
    }

    let zip;
    let entries;
    try {
        zip = new AdmZip(ZIP_PATH);
        entries = zip.getEntries().map((e) => e.entryName);
    } catch (e) {
        fail(`Failed to read package.zip: ${e.message}`);
        return;
    }

    console.log(`  package.zip contains ${entries.length} entries`);

    // Build a mapping from original entryName to normalised name (strip
    // leading ./ if present).  Path/forbidden checks use the normalised
    // name, but content scanning must use the original entryName because
    // `zip.getEntry(normalised)` fails to find entries stored as
    // `./index.js`.
    /** @type {Array<{original: string, normalized: string}>} */
    const entryMap = entries.map((e) => ({
        original: e,
        normalized: e.replace(/^\.\//, ""),
    }));

    // Path-traversal check (uses normalised name).
    for (const { normalized } of entryMap) {
        if (isPathTraversal(normalized)) {
            fail(`package.zip/${normalized} — path-traversal entry detected`);
        }
    }

    // Required files
    for (const req of REQUIRED_FILES) {
        if (entryMap.some((e) => e.normalized === req)) {
            ok(`package.zip/${req}`);
        } else {
            fail(`package.zip/${req} is missing`);
        }
    }

    // Required globs
    for (const glob of REQUIRED_GLOBS) {
        const regex = globToRegex(glob);
        if (entryMap.some((e) => regex.test(e.normalized))) {
            ok(`package.zip/${glob}`);
        } else {
            fail(`package.zip/${glob} — no matching file found`);
        }
    }

    // Forbidden files (uses normalised name so basename check works).
    for (const { normalized } of entryMap) {
        if (checkForbidden(normalized)) {
            fail(`package.zip/${normalized} — forbidden or sensitive file present`);
        }
    }

    ok("package.zip forbidden-file scan complete");

    // Content scanning — MUST use the original entryName so that
    // `zip.getEntry(entryName)` resolves correctly even when the entry
    // is stored as `./index.js`.
    console.log("  Scanning package.zip text entries for credentials...");
    for (const { original } of entryMap) {
        scanZipEntry(zip, original);
    }
    ok("package.zip content scan complete");
}

// --------------------------------------------------------------- style checks

/**
 * Style-isolation checks on the built `dist/index.css` (stage 6A policy).
 *
 * The plugin must never override SiYuan's global styles:
 * - every rule touching a `.b3-*` class must be scoped under a `gf-`
 *   plugin class (Svelte scoped styles and the global index.scss both
 *   satisfy this by construction);
 * - global selectors (`body`, `html`, `:root`, `.layout`) are forbidden;
 * - `!important` is forbidden;
 * - `:global` must not appear in the built output.
 */
function verifyStyles(cssPath) {
    if (!fs.existsSync(cssPath)) {
        warn("dist/index.css not found — skipping style checks");
        return;
    }
    const css = fs.readFileSync(cssPath, "utf-8");

    // Split the CSS into top-level rules with a character-level brace
    // scanner (string- and comment-aware) so minified single-line output
    // is split correctly.
    const rules = [];
    let start = 0;
    let depth = 0;
    let inString = null;
    let inComment = false;
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (inComment) {
            if (ch === "*" && css[i + 1] === "/") { inComment = false; i++; }
            continue;
        }
        if (inString) {
            if (ch === "\\") { i++; continue; }
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === "/" && css[i + 1] === "*") { inComment = true; i++; continue; }
        if (ch === '"' || ch === "'") { inString = ch; continue; }
        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0) {
                rules.push(css.slice(start, i + 1));
                start = i + 1;
            }
        }
    }

    let checked = 0;
    for (const rule of rules) {
        const braceIdx = rule.indexOf("{");
        const selector = braceIdx >= 0 ? rule.slice(0, braceIdx) : rule;
        const body = braceIdx >= 0 ? rule.slice(braceIdx + 1) : "";
        const sel = selector.trim();
        if (!sel) continue;
        checked++;

        if (/!important\b/i.test(body)) {
            fail(`dist/index.css — !important in rule: ${sel}`);
        }
        if (
            /(^|[,\s])(body|html)(?=[\s,{.#:[]|$)/.test(sel) ||
            /(^|[,\s]):root(?=[\s,{.#:[]|$)/.test(sel) ||
            /(^|[,\s])\.layout(?=[\s,{.#:[]|$)/.test(sel)
        ) {
            fail(`dist/index.css — global selector in rule: ${sel}`);
        }
        if (/:global/.test(sel)) {
            fail(`dist/index.css — :global in rule: ${sel}`);
        }
        // Any rule touching a b3-* class must live under a gf- scope.
        if (/\.b3-/.test(sel) && !/gf-/.test(sel)) {
            fail(`dist/index.css — unscoped b3-* selector: ${sel}`);
        }
    }
    ok(`dist/index.css style isolation checks complete (${checked} rules)`);
}

// --------------------------------------------------------------- main

console.log("=== Build Artifact Verification ===");
verifyDist();
verifyZip();
verifyStyles(path.join(DIST_DIR, "index.css"));

console.log("");
if (errors === 0) {
    console.log("All checks passed.");
    process.exit(0);
} else {
    console.error(`${errors} check(s) failed.`);
    process.exit(1);
}
