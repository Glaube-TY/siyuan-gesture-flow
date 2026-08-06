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
import { createHash } from "node:crypto";

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
    "asset/action.png",
];

const FORBIDDEN_PATTERNS = [
    /Hello/i,
    /^plugin-sample/i,
    // Whole source/dev directories must never ship.
    /^(tests|src|node_modules|\.git|\.github)(\/|$)/,
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

// --------------------------------------------------------------- version & assets

/**
 * Known placeholder-image SHA-256 hashes (the grey "160 × 160" /
 * "1024 × 768" placeholder PNGs).  Their presence blocks release.
 */
const PLACEHOLDER_ICON_SHA256 = "84225444cb7edd973efd33f9797e53c946ba91c071fb9380ceabc2394bb604f2";
const PLACEHOLDER_PREVIEW_SHA256 = "7fcd2462574ff7a6ed3952d8b3477a6a8e59f0ff5a839d545da3140e083cb852";

const ICON_DIMENSIONS = { w: 160, h: 160, maxBytes: 20 * 1024 };
const PREVIEW_DIMENSIONS = { w: 1024, h: 768, maxBytes: 200 * 1024 };

/** Read PNG width/height from the IHDR chunk (bytes 16–23). */
function readPngDimensions(buf) {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function sha256(buf) {
    return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify one image file: PNG signature, exact dimensions, size cap and
 * rejection of the known placeholder hashes.
 */
function verifyImage(label, buffer, dims) {
    const dim = readPngDimensions(buffer);
    if (!dim) {
        fail(`${label} — not a valid PNG`);
        return false;
    }
    if (dim.w !== dims.w || dim.h !== dims.h) {
        fail(`${label} — expected ${dims.w}x${dims.h}, got ${dim.w}x${dim.h}`);
        return false;
    }
    if (buffer.length > dims.maxBytes) {
        fail(`${label} — ${buffer.length} bytes exceeds ${dims.maxBytes}`);
        return false;
    }
    const hash = sha256(buffer);
    const placeholder = dims.w === 160 ? PLACEHOLDER_ICON_SHA256 : PLACEHOLDER_PREVIEW_SHA256;
    if (hash === placeholder) {
        fail(`${label} — still the known placeholder image (${hash})`);
        return false;
    }
    ok(`${label} — ${dim.w}x${dim.h}, ${buffer.length} bytes`);
    return true;
}

/** Verify icon/preview in a directory (dist) or a zip (package.zip). */
function verifyAssets(source) {
    const read = (name) => {
        if (source === "dist") {
            const p = path.join(DIST_DIR, name);
            return fs.existsSync(p) ? fs.readFileSync(p) : null;
        }
        const zip = new AdmZip(ZIP_PATH);
        const entry = zip.getEntries().find((e) => e.entryName.replace(/^\.\//, "") === name);
        return entry ? entry.getData() : null;
    };
    const icon = read("icon.png");
    const preview = read("preview.png");
    if (!icon) {
        fail(`${source}/icon.png missing`);
    } else {
        verifyImage(`${source}/icon.png`, icon, ICON_DIMENSIONS);
    }
    if (!preview) {
        fail(`${source}/preview.png missing`);
    } else {
        verifyImage(`${source}/preview.png`, preview, PREVIEW_DIMENSIONS);
    }
}

/** package.json.version === plugin.json.version, and valid SemVer. */
function verifyVersions() {    let pkg, plugin;
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
        plugin = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.json"), "utf-8"));
    } catch (e) {
        fail(`cannot read package.json/plugin.json: ${e.message}`);
        return;
    }
    if (pkg.version !== plugin.version) {
        fail(`version mismatch: package.json=${pkg.version} plugin.json=${plugin.version}`);
        return;
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
        fail(`invalid SemVer: ${pkg.version}`);
        return;
    }
    ok(`version consistency: v${pkg.version} (package.json === plugin.json, valid SemVer)`);

    // package.zip's plugin.json must carry the same version.
    if (fs.existsSync(ZIP_PATH)) {
        try {
            const zip = new AdmZip(ZIP_PATH);
            const entry = zip.getEntries().find((e) => e.entryName.replace(/^\.\//, "") === "plugin.json");
            if (!entry) {
                fail("package.zip/plugin.json missing");
                return;
            }
            const zipPlugin = JSON.parse(entry.getData().toString("utf-8"));
            if (zipPlugin.version !== pkg.version) {
                fail(`package.zip/plugin.json version ${zipPlugin.version} != package.json ${pkg.version}`);
            } else {
                ok(`package.zip/plugin.json version ${zipPlugin.version}`);
            }
        } catch (e) {
            fail(`cannot inspect package.zip plugin.json: ${e.message}`);
        }
    }
}

/**
 * Quiet-runtime check: the shipped plugin must not log normal-operation
 * chatter.  Scans src/ production code (and dist/index.js when present)
 * for console.log / console.info / console.debug, and verifies that any
 * console.warn / console.error only appear inside the allowed files.
 *
 * Allowed (genuine failures only, [GestureFlow] prefix):
 * - src/index.ts                — restart rollback warn
 * - src/gesture/GestureFeedbackController.ts — async callback error
 */
function verifyQuietRuntime() {
    const BANNED = [
        ["console.log(", "console.log"],
        ["console.info(", "console.info"],
        ["console.debug(", "console.debug"],
    ];
    const ALLOWED_WARN_ERROR = new Set([
        "src/index.ts",
        "src/gesture/GestureFeedbackController.ts",
    ]);
    const srcDir = path.join(ROOT, "src");

    const files = [];
    (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            if (fs.statSync(p).isDirectory()) {
                walk(p);
            } else if (p.endsWith(".ts") || p.endsWith(".svelte")) {
                files.push(p);
            }
        }
    })(srcDir);

    let problems = 0;
    for (const file of files) {
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        const content = fs.readFileSync(file, "utf-8");
        for (const [needle, label] of BANNED) {
            if (content.includes(needle)) {
                fail(`src/${rel} — banned ${label} in runtime code`);
                problems++;
            }
        }
        // warn/error must be inside the whitelisted files only.
        if (!ALLOWED_WARN_ERROR.has(rel)) {
            for (const needle of ["console.warn(", "console.error("]) {
                if (content.includes(needle)) {
                    fail(`src/${rel} — console.${needle.slice(8, -1)} outside whitelist`);
                    problems++;
                }
            }
        }
    }

    // Final bundle sanity: no leftover normal-log fragments.
    const bundle = path.join(DIST_DIR, "index.js");
    if (fs.existsSync(bundle)) {
        const js = fs.readFileSync(bundle, "utf-8");
        const fragments = [
            "loading (frontend:",
            "config loaded (source:",
            "unloading",
            "state ->",
            "gesture cancelled",
        ];
        for (const frag of fragments) {
            if (js.includes(frag)) {
                fail(`dist/index.js contains normal-log fragment: ${frag}`);
                problems++;
            }
        }
    }

    if (problems === 0) {
        ok(`quiet runtime: no console.log/info/debug in src; warn/error whitelisted (${files.length} files)`);
    }
}

// --------------------------------------------------------------- main

console.log("=== Build Artifact Verification ===");
verifyVersions();
verifyDist();
verifyZip();
verifyAssets("dist");
verifyAssets("zip");
verifyStyles(path.join(DIST_DIR, "index.css"));
verifyQuietRuntime();

console.log("");
if (errors === 0) {
    console.log("All checks passed.");
    process.exit(0);
} else {
    console.error(`${errors} check(s) failed.`);
    process.exit(1);
}
