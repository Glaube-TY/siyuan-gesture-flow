// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Style isolation tests.
 *
 * The settings dialog styles must never leak out of the GestureFlow
 * dialog: no unscoped b3-dialog / b3-button / b3-text-field /
 * b3-switch / b3-select overrides, no body / html / :root / .layout
 * rules, no CSS variables written outside the plugin root, and no
 * bare `:global(...)` in Svelte components.  Every global rule in
 * src/index.scss must be nested under `.gf-settings-dialog`.
 *
 * These are negative assertions (forbidden forms must NOT exist),
 * not just "the text contains X" checks.
 */

const SRC = __dirname; // src/
const SCSS_PATH = resolve(SRC, "index.scss");
const SCSS = readFileSync(SCSS_PATH, "utf-8");

/** Strip comments, then split a SCSS source into its top-level rule blocks. */
function topLevelBlocks(source: string): { selector: string; body: string }[] {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks: { selector: string; body: string }[] = [];
    let depth = 0;
    let current: { selector: string; lines: string[] } | null = null;
    for (const rawLine of clean.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const braces = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth === 0) {
            current = { selector: line.replace(/\s*\{\s*$/, ""), lines: [] };
        } else if (current) {
            current.lines.push(line);
        }
        depth += braces;
        if (depth === 0 && current) {
            blocks.push({ selector: current.selector, body: current.lines.join("\n") });
            current = null;
        }
    }
    return blocks;
}

/** Extract the <style> section of a Svelte component (comments stripped). */
function svelteStyle(file: string): string {
    const src = readFileSync(resolve(SRC, file), "utf-8");
    const start = src.indexOf("<style>");
    const end = src.indexOf("</style>");
    if (start === -1 || end === -1) return "";
    return src
        .slice(start + "<style>".length, end)
        .replace(/\/\*[\s\S]*?\*\//g, "");
}

const SVELTE_FILES = [
    "settings/SettingsPanel.svelte",
    "settings/components/SettingRow.svelte",
    "settings/components/SettingSection.svelte",
];

describe("样式隔离 — 全局 index.scss", () => {
    it("顶层规则全部以插件专属 gf- 根类为作用域", () => {
        const blocks = topLevelBlocks(SCSS);
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
            expect(block.selector.trim()).toMatch(/^\.gf-/);
        }
    });

    it("所有涉及 b3-dialog 的规则都限定在 gf-settings-dialog 内", () => {
        const blocks = topLevelBlocks(SCSS);
        for (const block of blocks) {
            if (block.body.includes("b3-dialog")) {
                expect(block.selector).toContain("gf-settings-dialog");
            }
        }
        // Every individual b3-dialog selector line must be nested inside
        // the gf-settings-dialog block (no unscoped sibling blocks).
        const scoped = blocks.filter((b) => b.selector.includes("gf-settings-dialog"));
        expect(scoped.length).toBe(1);
        for (const cls of [".b3-dialog__container", ".b3-dialog__header", ".b3-dialog__body"]) {
            expect(scoped[0].body).toContain(cls);
        }
    });

    it("不存在无作用域的 .b3-button / .b3-text-field / .b3-switch / .b3-select 覆盖", () => {
        for (const cls of [".b3-button", ".b3-text-field", ".b3-switch", ".b3-select"]) {
            expect(SCSS).not.toContain(cls);
        }
    });

    it("不存在 body / html / :root / .layout 覆盖", () => {
        expect(SCSS).not.toMatch(/(^|\})\s*(body|html|:root|\.layout)\s*(\{|,)/m);
    });

    it("不存在 !important 强行覆盖", () => {
        expect(SCSS).not.toContain("!important");
    });

    it("不存在 :global 与 CSS 变量越出插件作用域", () => {
        expect(SCSS).not.toContain(":global");
        // No plugin CSS variables (--gf-*) may be defined on body/:root.
        expect(SCSS).not.toMatch(/(body|:root)[^{]*\{[^}]*--gf-/);
    });

    it("自定义全局类均使用 gf- 前缀", () => {
        const blocks = topLevelBlocks(SCSS);
        for (const block of blocks) {
            const tokens = [...block.selector.matchAll(/\.([a-zA-Z][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
            for (const token of tokens) {
                // Only plugin classes (gf-) or SiYuan structural classes
                // (b3-) as scoped targets are allowed.
                expect(token).toMatch(/^(gf-|b3-)/);
            }
        }
    });
});

describe("样式隔离 — Svelte 组件 scoped 样式", () => {
    it("组件样式不使用 :global（scoped CSS 保持局部作用域）", () => {
        for (const file of SVELTE_FILES) {
            expect(svelteStyle(file), file).not.toContain(":global");
        }
    });

    it("组件样式不定义 b3-* 类选择器（仅复用思源类，不覆盖）", () => {
        for (const file of SVELTE_FILES) {
            expect(svelteStyle(file), file).not.toMatch(/\.b3-[A-Za-z0-9_-]+\s*\{/);
        }
    });

    it("组件样式不覆盖原生元素选择器（input/select/button/textarea/html/body）", () => {
        for (const file of SVELTE_FILES) {
            expect(svelteStyle(file), file).not.toMatch(
                /(^|\})\s*(input|select|button|textarea|html|body)\s*(\{|,)/,
            );
        }
    });

    it("自定义类均使用 gf- 前缀（或与 gf- 类组合的 b3-/状态类）", () => {
        for (const file of SVELTE_FILES) {
            const style = svelteStyle(file);
            for (const m of style.matchAll(/\.([a-zA-Z][A-Za-z0-9_-]*)/g)) {
                const token = m[1];
                // svelte-xxx scoping suffixes and media queries are fine.
                if (token.startsWith("svelte-")) continue;
                if (token.startsWith("gf-") || token.startsWith("b3-")) continue;
                // Any other class (e.g. the `active` state class) must be
                // combined with a gf- class in the same selector line.
                const lineStart = style.lastIndexOf("\n", m.index!) + 1;
                const lineEnd = style.indexOf("\n", m.index!);
                const line = style.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
                expect(line, `${file}: .${token}`).toMatch(/\.gf-/);
            }
        }
    });
});

describe("样式隔离 — 构建产物 dist/index.css", () => {
    const cssPath = resolve(SRC, "../dist/index.css");
    const exists = existsSync(cssPath);

    it.skipIf(!exists)("产物中不存在无作用域的 b3-* / body / :root / .layout 规则", () => {
        const css = readFileSync(cssPath, "utf-8");
        const rules = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
        for (const selector of rules) {
            if (selector.startsWith("@")) continue; // @charset / @media
            if (selector.includes("b3-")) {
                expect(selector).toContain("gf-settings-dialog");
            }
            expect(selector).not.toMatch(/^(body|html|:root|\.layout)\b/);
        }
    });

    it.skipIf(!exists)("产物中所有自定义类均有明确作用域（gf-settings-dialog 或 svelte hash）", () => {
        const css = readFileSync(cssPath, "utf-8");
        const rules = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
        for (const selector of rules) {
            if (selector.startsWith("@")) continue;
            // Any gf- class appearing in the built CSS must be reachable
            // only through an explicit scope: the gf-settings-dialog
            // root (global rules) or a Svelte scoping hash.
            if (/\.gf-[a-zA-Z0-9_-]+/.test(selector)) {
                expect(selector, selector).toMatch(/gf-settings-dialog|\.svelte-/);
            }
        }
    });
});
