// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import SettingsPanel from "./SettingsPanel.svelte";
import { createDefaultConfig } from "@/config/defaults";
import type { GestureFlowConfig } from "@/config/types";
import type { ConfigManager, ConfigUpdatePatch } from "@/config/ConfigManager";

/**
 * SettingsPanel DOM structure tests.
 *
 * Happy DOM cannot compute real layouts, so these tests assert on the
 * DOM hierarchy, class names, and the structural responsibilities
 * (flex containers, scroll region, hidden file input, b3-switch usage,
 * nav item count).  Final visual layout must still be verified in a
 * real SiYuan instance.
 */

function makeConfig(): GestureFlowConfig {
    return createDefaultConfig();
}

function makeConfigManager(config: GestureFlowConfig): ConfigManager {
    let current = config;
    const subscribers = new Set<(c: GestureFlowConfig) => void>();
    return {
        getConfig: () => current,
        subscribe: (fn: (c: GestureFlowConfig) => void) => {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
        updateConfig: async (patch: ConfigUpdatePatch) => {
            current = { ...current, ...patch } as GestureFlowConfig;
            subscribers.forEach((fn) => fn(current));
            return { status: "saved" as const, message: "Saved" };
        },
        exportJson: () => current,
        importJson: async () => ({ status: "imported" as const, message: "Imported" }),
        reset: async () => {
            current = createDefaultConfig();
            subscribers.forEach((fn) => fn(current));
            return { status: "saved" as const, message: "Reset" };
        },
    } as unknown as ConfigManager;
}

const i18n: Record<string, string> = {
    settingsTitle: "手势流设置",
    settingsTabGeneral: "常规",
    settingsTabRecognition: "识别",
    settingsTabDisplay: "显示",
    settingsTabBindings: "绑定",
    settingsTabData: "数据",
    settingsSectionBasic: "基础",
    settingsSectionTrigger: "触发方式",
    settingsSectionDirection: "方向识别",
    settingsSectionPath: "轨迹处理",
    settingsEnabled: "启用手势",
    settingsEnabledDesc: "关闭后将停用所有手势识别与可视化效果。",
    settingsSuppressionKey: "临时禁用键",
    settingsSuppressionKeyDesc: "按住此键再右键，可暂时跳过手势，直接弹出右键菜单。",
    settingsSuppressionKeyNone: "无",
    settingsActivationDistance: "激活距离 (px)",
    settingsActivationDistanceDesc: "按住右键移动超过该距离后，才会开始识别手势。",
    settingsTimeoutMs: "手势超时 (ms)",
    settingsTimeoutMsDesc: "按住右键超过该时长未完成手势将自动取消，填 0 表示不限制。",
    settingsDirectionMode: "方向模式",
    settingsDirectionModeDesc: "4 方向仅识别上下左右，8 方向额外识别四个斜向。",
    settingsDirectionMode4: "4 方向",
    settingsDirectionMode8: "8 方向",
    settingsSampleDistance: "采样距离 (px)",
    settingsSampleDistanceDesc: "采样间距。",
    settingsSimplifyTolerance: "简化容差 (px)",
    settingsSimplifyToleranceDesc: "控制轨迹简化程度。",
    settingsMinimumSegmentLength: "最小方向段长度 (px)",
    settingsMinimumSegmentLengthDesc: "短于该长度的移动会被忽略。",
    settingsTurnAngleThreshold: "转向角阈值 (度)",
    settingsTurnAngleThresholdDesc: "方向改变超过该角度才会被视为新的方向段。",
    settingsMaximumSegments: "最大方向段数",
    settingsMaximumSegmentsDesc: "手势包含的方向段数超过该值时将被忽略。",
    settingsShowTrail: "显示轨迹",
    settingsShowTrailDesc: "在屏幕上绘制鼠标移动的轨迹。",
    settingsShowHint: "显示提示",
    settingsShowHintDesc: "实时显示已识别的方向和将要执行的命令。",
    settingsLineWidth: "轨迹线宽 (px)",
    settingsLineWidthDesc: "轨迹线条的粗细。",
    settingsBindingsDesc: "启用或禁用四个默认绑定。",
    settingsExport: "导出配置",
    settingsExportDesc: "将当前配置下载为 JSON 文件。",
    settingsImport: "导入配置",
    settingsImportDesc: "从 JSON 文件替换当前配置。",
    settingsReset: "恢复默认",
    settingsResetDesc: "将所有字段与绑定重置为默认值。",
    cmdTabsPrevious: "上一个标签页",
    cmdTabsNext: "下一个标签页",
    cmdScrollTop: "滚动到顶部",
    cmdScrollBottom: "滚动到底部",
};

interface MountedPanel {
    host: HTMLElement;
    component: SettingsPanel;
    configManager: ConfigManager;
}

function mountPanel(): MountedPanel {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const configManager = makeConfigManager(makeConfig());
    const component = new SettingsPanel({
        target: host,
        props: { configManager, i18n, onStatus: vi.fn() },
    });
    return { host, component, configManager };
}

function cleanup(component: SettingsPanel): void {
    component.$destroy();
    document.body.innerHTML = "";
}

describe("SettingsPanel — 根结构", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        if (mounted) cleanup(mounted.component);
    });

    it("根节点为 gf-root，使用 flex 布局占满容器", () => {
        const root = mounted.host.querySelector(".gf-root");
        expect(root).toBeTruthy();
        // Root should be a flex container (display:flex set via <style>)
        expect(root).toBeInstanceOf(HTMLElement);
    });

    it("根节点不包含 fn__size200 类", () => {
        const root = mounted.host.querySelector(".gf-root");
        expect(root?.classList.contains("fn__size200")).toBe(false);
        expect(mounted.host.querySelector(".fn__size200")).toBeNull();
    });

    it("根节点不包含 config-item 或 b3-label 类", () => {
        expect(mounted.host.querySelector(".config-item")).toBeNull();
        expect(mounted.host.querySelector(".b3-label")).toBeNull();
    });

    it("不包含 h2 标题（避免与 Dialog 标题重复）", () => {
        const h2 = mounted.host.querySelector("h2");
        expect(h2).toBeNull();
    });

    it("不显示插件技术名称 siyuan-gesture-flow", () => {
        const text = mounted.host.textContent ?? "";
        expect(text).not.toContain("siyuan-gesture-flow");
    });
});

describe("SettingsPanel — 左侧导航", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("左侧导航包含五个分类按钮", () => {
        const nav = mounted.host.querySelector(".gf-nav");
        expect(nav).toBeTruthy();
        const buttons = nav?.querySelectorAll(".gf-nav-btn");
        expect(buttons?.length).toBe(5);
    });

    it("导航按钮文本不是空字符串", () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        buttons.forEach((btn) => {
            expect((btn.textContent ?? "").trim().length).toBeGreaterThan(0);
        });
    });

    it("导航按钮文本不出现单字竖排（每个按钮都有非空文本）", () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        const labels = Array.from(buttons).map((b) => (b.textContent ?? "").trim());
        // Each label should be a proper word, not a single character
        labels.forEach((label) => {
            expect(label.length).toBeGreaterThan(1);
        });
    });

    it("默认选中常规分类", () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        expect(buttons[0].classList.contains("active")).toBe(true);
    });

    it("点击导航按钮可以切换分类", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        // Click "识别" (index 1)
        (buttons[1] as HTMLElement).click();
        // Wait for Svelte reactivity
        await Promise.resolve();
        expect(buttons[1].classList.contains("active")).toBe(true);
        expect(buttons[0].classList.contains("active")).toBe(false);

        // Click "数据" (index 4)
        (buttons[4] as HTMLElement).click();
        await Promise.resolve();
        expect(buttons[4].classList.contains("active")).toBe(true);
        expect(buttons[1].classList.contains("active")).toBe(false);
    });
});

describe("SettingsPanel — 常规分类", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("启用手势使用 b3-switch 滑块", () => {
        const section = mounted.host.querySelector(".gf-section");
        expect(section).toBeTruthy();

        const switches = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch');
        expect(switches.length).toBeGreaterThanOrEqual(1);

        // The first b3-switch should be the "enable gestures" toggle
        const enableSwitch = switches[0] as HTMLInputElement;
        expect(enableSwitch.checked).toBe(true);
    });

    it("不使用浏览器原生方形复选框（无 b3-switch 的 checkbox）", () => {
        const allCheckboxes = mounted.host.querySelectorAll('input[type="checkbox"]');
        allCheckboxes.forEach((cb) => {
            expect(cb.classList.contains("b3-switch")).toBe(true);
        });
    });

    it("临时禁用键使用 b3-select 下拉框", () => {
        const selects = mounted.host.querySelectorAll("select.b3-select");
        expect(selects.length).toBeGreaterThanOrEqual(1);
    });

    it("数字输入使用 b3-text-field 类", () => {
        const numberInputs = mounted.host.querySelectorAll('input[type="number"].b3-text-field');
        expect(numberInputs.length).toBeGreaterThanOrEqual(2); // activation distance + timeout
    });

    it("常规分类分为基础和触发方式两个卡片", () => {
        const sections = mounted.host.querySelectorAll(".gf-section");
        expect(sections.length).toBeGreaterThanOrEqual(2);
    });
});

describe("SettingsPanel — 显示分类", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("显示轨迹和显示提示均为 b3-switch 滑块", async () => {
        // Switch to "显示" tab
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[2] as HTMLElement).click(); // index 2 = display
        await Promise.resolve();

        const switches = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch');
        // Should have at least 2 switches (showTrail + showHint)
        expect(switches.length).toBeGreaterThanOrEqual(2);
    });
});

describe("SettingsPanel — 绑定分类", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("绑定列表使用 SettingRow 而非原生 table", async () => {
        // Switch to "绑定" tab
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const table = mounted.host.querySelector("table");
        expect(table).toBeNull();

        const rows = mounted.host.querySelectorAll(".gf-row");
        expect(rows.length).toBe(4); // four default bindings
    });

    it("每个绑定项有方向徽标", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const badges = mounted.host.querySelectorAll(".gf-badge");
        expect(badges.length).toBe(4); // L, R, U, D
        const badgeTexts = Array.from(badges).map((b) => b.textContent?.trim());
        expect(badgeTexts).toContain("L");
        expect(badgeTexts).toContain("R");
        expect(badgeTexts).toContain("U");
        expect(badgeTexts).toContain("D");
    });

    it("绑定列表所有开关为 b3-switch 滑块", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const switches = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch');
        expect(switches.length).toBe(4);
        switches.forEach((s) => {
            expect(s.classList.contains("b3-switch")).toBe(true);
        });
    });
});

describe("SettingsPanel — 数据分类", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("导入文件 input 默认隐藏", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[4] as HTMLElement).click(); // data tab
        await Promise.resolve();

        const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeTruthy();
        expect(fileInput.classList.contains("gf-file-hidden")).toBe(true);
    });

    it("不直接显示原生文件选择框（input 带有 hidden 类）", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[4] as HTMLElement).click();
        await Promise.resolve();

        const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
        // The hidden class should make it invisible
        expect(fileInput.classList.contains("gf-file-hidden")).toBe(true);
    });

    it("导出、导入、恢复默认使用 b3-button 类按钮", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[4] as HTMLElement).click();
        await Promise.resolve();

        const btns = mounted.host.querySelectorAll("button.b3-button");
        expect(btns.length).toBeGreaterThanOrEqual(3);
    });

    it("点击导入按钮触发文件 input 的 click", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[4] as HTMLElement).click();
        await Promise.resolve();

        const fileInput = mounted.host.querySelector('input[type="file"]') as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => {});

        // Find the import button (second b3-button in the data tab)
        const btns = mounted.host.querySelectorAll("button.b3-button");
        // Import is the second button
        (btns[1] as HTMLElement).click();

        expect(clickSpy).toHaveBeenCalledTimes(1);
        clickSpy.mockRestore();
    });
});

describe("SettingsPanel — 主题与样式变量", () => {
    it("源文件不包含硬编码的白色背景", () => {
        const source = readFileSync(
            resolve(__dirname, "SettingsPanel.svelte"),
            "utf-8",
        );
        // Should not have hardcoded white background without CSS variable fallback
        // The pattern #fff or #ffffff as background without var() is not allowed
        const styleSection = source.slice(source.indexOf("<style>"), source.indexOf("</style>") + 8);
        // Every color should use var(--b3-...) as the primary value
        // Check that there are no raw background: #fff without var fallback
        const hardcodedBgMatches = styleSection.match(/background\s*:\s*(#[0-9a-fA-F]{3,6}|white)\s*[;}\n]/g);
        expect(hardcodedBgMatches).toBeNull();
    });

    it("源文件不包含硬编码的黑色文字", () => {
        const source = readFileSync(
            resolve(__dirname, "SettingsPanel.svelte"),
            "utf-8",
        );
        const styleSection = source.slice(source.indexOf("<style>"), source.indexOf("</style>") + 8);
        // Check no hardcoded black color without var fallback
        const hardcodedColorMatches = styleSection.match(/color\s*:\s*(#[0-9a-fA-F]{3,6}|black)\s*[;}\n]/g);
        expect(hardcodedColorMatches).toBeNull();
    });

    it("SettingRow 源文件使用 CSS 变量", () => {
        const source = readFileSync(
            resolve(__dirname, "components/SettingRow.svelte"),
            "utf-8",
        );
        const styleSection = source.slice(source.indexOf("<style>"), source.indexOf("</style>") + 8);
        // Should reference b3 CSS variables
        expect(styleSection).toContain("var(--b3-");
    });

    it("SettingSection 源文件使用 CSS 变量", () => {
        const source = readFileSync(
            resolve(__dirname, "components/SettingSection.svelte"),
            "utf-8",
        );
        const styleSection = source.slice(source.indexOf("<style>"), source.indexOf("</style>") + 8);
        expect(styleSection).toContain("var(--b3-");
    });
});

describe("SettingsPanel — 内容滚动区域", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("内容区域具有 gf-content 类（独立滚动容器）", () => {
        const content = mounted.host.querySelector(".gf-content");
        expect(content).toBeTruthy();
    });

    it("根节点具有 overflow hidden（防止整页滚动）", () => {
        // The gf-root class should have overflow:hidden in its style
        const source = readFileSync(
            resolve(__dirname, "SettingsPanel.svelte"),
            "utf-8",
        );
        const rootStyle = source.match(/\.gf-root\s*\{[^}]+\}/);
        expect(rootStyle).toBeTruthy();
        expect(rootStyle![0]).toContain("overflow: hidden");
        expect(rootStyle![0]).toContain("display: flex");
    });
});

describe("SettingsPanel — 组件销毁与订阅清理", () => {
    it("销毁后调用 $destroy 不报错", () => {
        const mounted = mountPanel();
        expect(() => mounted.component.$destroy()).not.toThrow();
    });

    it("销毁后可以再次挂载新实例", () => {
        const mounted = mountPanel();
        mounted.component.$destroy();
        document.body.innerHTML = "";

        const host2 = document.createElement("div");
        document.body.appendChild(host2);
        const cm2 = makeConfigManager(makeConfig());
        expect(() => {
            new SettingsPanel({
                target: host2,
                props: { configManager: cm2, i18n, onStatus: vi.fn() },
            });
        }).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Dialog height chain + unified background.
//
// The dialog-wide rules live in the global src/index.scss (the Svelte
// scoped style cannot reach SiYuan's b3-dialog DOM).  Happy DOM cannot
// compute real flex heights, so these tests assert the structural and
// styling responsibilities: every b3-dialog rule is scoped under
// .gf-settings-dialog, the height chain (container → body → host →
// root) is a flex chain, backgrounds are unified on gf-root, and the
// nav/content own their scroll regions.
// ---------------------------------------------------------------------------

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

/** Extract the body of a single-level nested block like `.foo { ... }`. */
function nestedBlock(body: string, selector: string): string | null {
    const idx = body.indexOf(`${selector} {`);
    if (idx === -1) return null;
    const open = body.indexOf("{", idx);
    const close = body.indexOf("}", open);
    if (open === -1 || close === -1) return null;
    return body.slice(open + 1, close);
}

/** Extract the body of a top-level Svelte scoped style rule. */
function scopedRule(source: string, selector: string): string | null {
    const match = source.match(new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{[^}]+\\}`));
    return match ? match[0] : null;
}

describe("SettingsPanel — Dialog 高度链路（全局 index.scss）", () => {
    let scss: string;

    beforeEach(() => {
        scss = readFileSync(resolve(__dirname, "../index.scss"), "utf-8");
    });

    it("index.scss 中所有 b3-dialog 规则都限定在 gf-settings-dialog 作用域内", () => {
        expect(scss).toContain("gf-settings-dialog");
        const blocks = topLevelBlocks(scss);
        for (const block of blocks) {
            if (block.body.includes("b3-dialog")) {
                expect(block.selector).toContain("gf-settings-dialog");
            }
        }
    });

    it("b3-dialog__container 被设计为纵向 Flex 容器且不随内容伸缩", () => {
        const blocks = topLevelBlocks(scss);
        const scoped = blocks.find((b) => b.selector.includes("gf-settings-dialog"));
        expect(scoped).toBeTruthy();
        const container = nestedBlock(scoped!.body, ".b3-dialog__container");
        expect(container).toContain("display: flex");
        expect(container).toContain("flex-direction: column");
        expect(container).toMatch(/flex:\s*0 0 auto/);
    });

    it("b3-dialog__header 不参与内容区伸缩", () => {
        const blocks = topLevelBlocks(scss);
        const scoped = blocks.find((b) => b.selector.includes("gf-settings-dialog"));
        const header = nestedBlock(scoped!.body, ".b3-dialog__header");
        expect(header).toMatch(/flex:\s*0 0 auto/);
    });

    it("b3-dialog__body 被设计为 flex 1、min-height 0 且隐藏溢出", () => {
        const blocks = topLevelBlocks(scss);
        const scoped = blocks.find((b) => b.selector.includes("gf-settings-dialog"));
        const body = nestedBlock(scoped!.body, ".b3-dialog__body");
        expect(body).toMatch(/flex:\s*1 1 auto/);
        expect(body).toContain("min-height: 0");
        expect(body).toContain("min-width: 0");
        expect(body).toContain("overflow: hidden");
    });

    it("gf-dialog-host 被设计为 flex 1、height 100% 和 min-height 0", () => {
        const blocks = topLevelBlocks(scss);
        const scoped = blocks.find((b) => b.selector.includes("gf-settings-dialog"));
        const host = nestedBlock(scoped!.body, ".gf-dialog-host");
        expect(host).toMatch(/flex:\s*1 1 auto/);
        expect(host).toContain("height: 100%");
        expect(host).toContain("width: 100%");
        expect(host).toContain("min-height: 0");
        expect(host).toContain("min-width: 0");
        expect(host).toContain("display: flex");
        expect(host).toContain("overflow: hidden");
    });

    it("gf-root 在全局样式中被设计为 flex 1 填满宿主", () => {
        const blocks = topLevelBlocks(scss);
        const scoped = blocks.find((b) => b.selector.includes("gf-settings-dialog"));
        const root = nestedBlock(scoped!.body, ".gf-root");
        expect(root).toMatch(/flex:\s*1 1 auto/);
        expect(root).toContain("min-height: 0");
    });
});

describe("SettingsPanel — 统一背景与滚动职责", () => {
    let source: string;

    beforeEach(() => {
        source = readFileSync(resolve(__dirname, "SettingsPanel.svelte"), "utf-8");
    });

    it("gf-root 具有统一页面背景职责（var(--b3-theme-background)）", () => {
        const root = scopedRule(source, ".gf-root");
        expect(root).toBeTruthy();
        expect(root).toMatch(/background:\s*var\(--b3-theme-background/);
    });

    it("gf-nav 不再使用与整体不同的独立实色背景（transparent）", () => {
        const nav = scopedRule(source, ".gf-nav");
        expect(nav).toBeTruthy();
        expect(nav).toMatch(/background:\s*transparent/);
        // The nav must not paint its own opaque background variable.
        expect(nav).not.toMatch(/background:\s*var\(--b3-theme-background/);
    });

    it("gf-content 不再使用另一套独立背景（transparent）", () => {
        const content = scopedRule(source, ".gf-content");
        expect(content).toBeTruthy();
        expect(content).toMatch(/background:\s*transparent/);
    });

    it("gf-nav 具有纵向滚动能力", () => {
        const nav = scopedRule(source, ".gf-nav");
        expect(nav).toContain("overflow-y: auto");
        expect(nav).toContain("min-height: 0");
    });

    it("gf-content 具有独立纵向滚动能力", () => {
        const content = scopedRule(source, ".gf-content");
        expect(content).toContain("overflow-y: auto");
        expect(content).toContain("min-height: 0");
    });

    it("窄屏媒体规则仍然存在（导航转顶部横向）", () => {
        expect(source).toMatch(/@media\s*\(max-width:\s*560px\)/);
        const mediaSection = source.slice(source.indexOf("@media"));
        expect(mediaSection).toContain("flex-direction: column");
        expect(mediaSection).toContain("flex: 0 0 auto");
        expect(mediaSection).toContain("overflow-x: auto");
    });
});

describe("SettingsPanel — 标签切换不重建外壳", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        cleanup(mounted.component);
    });

    it("切换五个标签后 gf-root / gf-nav / gf-content 外壳不被重新创建", async () => {
        const root = mounted.host.querySelector(".gf-root");
        const nav = mounted.host.querySelector(".gf-nav");
        const content = mounted.host.querySelector(".gf-content");
        expect(root).toBeTruthy();
        expect(nav).toBeTruthy();
        expect(content).toBeTruthy();

        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        expect(buttons.length).toBe(5);
        const firstNavChild = nav?.firstElementChild;

        for (let i = 0; i < buttons.length; i++) {
            (buttons[i] as HTMLElement).click();
            await Promise.resolve();
            expect(mounted.host.querySelector(".gf-root")).toBe(root);
            expect(mounted.host.querySelector(".gf-nav")).toBe(nav);
            expect(mounted.host.querySelector(".gf-content")).toBe(content);
            // Nav structure is untouched — same button order, same first child.
            expect(nav?.firstElementChild).toBe(firstNavChild);
            expect(nav?.querySelectorAll(".gf-nav-btn").length).toBe(5);
        }
    });

    it("切换标签只替换右侧内容，左侧导航结构不变", async () => {
        const nav = mounted.host.querySelector(".gf-nav");
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        const labelsBefore = Array.from(buttons).map((b) => (b.textContent ?? "").trim());

        (buttons[4] as HTMLElement).click(); // data tab
        await Promise.resolve();

        const navAfter = mounted.host.querySelector(".gf-nav");
        expect(navAfter).toBe(nav);
        const labelsAfter = Array.from(navAfter!.querySelectorAll(".gf-nav-btn")).map(
            (b) => (b.textContent ?? "").trim(),
        );
        expect(labelsAfter).toEqual(labelsBefore);
    });

    it("gf-root 仍然包含 gf-nav 和 gf-content 两个区域", () => {
        const root = mounted.host.querySelector(".gf-root");
        expect(root?.querySelector(":scope > .gf-nav")).toBeTruthy();
        expect(root?.querySelector(":scope > .gf-content")).toBeTruthy();
    });
});
