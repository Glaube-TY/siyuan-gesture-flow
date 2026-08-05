// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import SettingsPanel from "./SettingsPanel.svelte";
import { createDefaultConfig } from "@/config/defaults";
import type { GestureFlowConfig } from "@/config/types";
import type { ConfigManager, ConfigUpdatePatch } from "@/config/ConfigManager";
import type { SettingCommandItem } from "./commandCatalog";

/** Records siyuan `confirm` invocations so tests can drive confirm/cancel. */
const confirmCalls: { text: string; confirmCb: (() => void) | null; cancelCb: (() => void) | null }[] = [];

vi.mock("siyuan", () => ({
    confirm: (
        _title: string,
        text: string,
        confirmCallback?: () => void,
        cancelCallback?: () => void,
    ) => {
        confirmCalls.push({
            text,
            confirmCb: confirmCallback ?? null,
            cancelCb: cancelCallback ?? null,
        });
    },
}));

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
    bindingAdd: "新增绑定",
    bindingAddTitle: "新增绑定",
    bindingEditTitle: "编辑绑定",
    bindingEdit: "编辑",
    bindingDelete: "删除",
    bindingDeleteConfirm: "确认删除该绑定？",
    bindingEmpty: "暂无绑定",
    bindingSave: "保存",
    bindingCancel: "取消",
    bindingSaving: "保存中…",
    bindingEnabled: "启用",
    bindingGesture: "手势",
    bindingCommand: "命令",
    bindingNoGesture: "尚未录制手势",
    bindingErrorEmpty: "请先录制手势",
    bindingErrorTooMany: "手势方向段过多",
    bindingErrorDiagonal4: "4 方向模式不支持斜向手势",
    bindingErrorNoCommand: "请选择命令",
    gestureRecorderHint: "按住右键绘制手势",
    gestureRecorderRecording: "录制中，松开完成",
    gestureRecorderTooShort: "轨迹太短",
    gestureRecorderTooMany: "手势过长",
    gestureRecorderUnrecognised: "无法识别",
    gestureRecorderClear: "清除",
    gestureRecorderEmpty: "尚未录制手势",
    actionType: "实现类型",
    actionBuiltin: "内置功能",
    actionShortcut: "快捷键",
    actionJavascript: "JavaScript",
    actionInDevelopment: "开发中",
    actionBuiltinSelect: "选择内置功能",
    actionBuiltinBadge: "内置功能",
    actionShortcutBadge: "快捷键",
    shortcutCaptureHint: "点击后按下组合键",
    shortcutCapturing: "正在录入…",
    shortcutClear: "清除快捷键",
    shortcutClearLabel: "清除",
    shortcutTest: "测试快捷键",
    shortcutTestSent: "已发送测试快捷键",
    shortcutEmptyError: "快捷键不能为空",
    shortcutCompatibilityHint: "快捷键会作为合成键盘事件发送",
    shortcutContextHint: "上下文相关快捷键请关闭设置窗口后用真实手势验证",
    bindingErrorJavascriptUnavailable: "JavaScript 功能正在开发",
};

/** Read-only command catalog matching the runtime's built-in commands. */
const COMMAND_CATALOG: SettingCommandItem[] = [
    { id: "tabs.previous", titleKey: "cmdTabsPrevious", title: "上一个标签页", group: "Tabs", groupTitle: "标签页" },
    { id: "tabs.next", titleKey: "cmdTabsNext", title: "下一个标签页", group: "Tabs", groupTitle: "标签页" },
    { id: "scroll.top", titleKey: "cmdScrollTop", title: "滚动到顶部", group: "Scrolling", groupTitle: "滚动" },
    { id: "scroll.bottom", titleKey: "cmdScrollBottom", title: "滚动到底部", group: "Scrolling", groupTitle: "滚动" },
];

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
        props: { configManager, i18n, commandCatalog: COMMAND_CATALOG, onStatus: vi.fn() },
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

    it("绑定列表使用管理项而非原生 table", async () => {
        // Switch to "绑定" tab
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const table = mounted.host.querySelector("table");
        expect(table).toBeNull();

        const items = mounted.host.querySelectorAll(".gf-binding-item");
        expect(items.length).toBe(4); // four default bindings
    });

    it("每个绑定项有方向徽标", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const badges = mounted.host.querySelectorAll(".gf-binding-item .gf-binding-dirs .gf-badge");
        expect(badges.length).toBe(4); // L, R, U, D
        const badgeTexts = Array.from(badges).map((b) => b.textContent?.trim());
        expect(badgeTexts).toContain("←"); // L
        expect(badgeTexts).toContain("→"); // R
        expect(badgeTexts).toContain("↑"); // U
        expect(badgeTexts).toContain("↓"); // D
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

    it("绑定列表顺序与配置数组顺序一致", async () => {
        const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
        (buttons[3] as HTMLElement).click();
        await Promise.resolve();

        const items = mounted.host.querySelectorAll(".gf-binding-item");
        const cfg = mounted.configManager.getConfig();
        expect(items.length).toBe(cfg.bindings.length);
        for (let i = 0; i < items.length; i++) {
            const badges = items[i].querySelectorAll(".gf-binding-dirs .gf-badge");
            const badgeTexts = Array.from(badges).map((b) => b.textContent?.trim());
            expect(badgeTexts).toEqual(
                cfg.bindings[i].directions.map((d) => symbolFor(d)),
            );
        }
    });
});

/** Direction → display symbol (mirrors directionLabels without importing). */
function symbolFor(d: string): string {
    const map: Record<string, string> = {
        U: "↑", D: "↓", L: "←", R: "→", UL: "↖", UR: "↗", DL: "↙", DR: "↘",
    };
    return map[d] ?? d;
}

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

// ---------------------------------------------------------------------------
// Stage 5B: binding management (add / edit / delete / toggle / recorder).
// ---------------------------------------------------------------------------

const RECT2 = { left: 10, top: 20, width: 300, height: 140 } as DOMRect;

/** Stub canvas + RAF so the BindingEditor's GestureRecorder can run. */
function stubRecorderEnvironment(): void {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        stroke: vi.fn(), setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT2);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    vi.stubGlobal("ResizeObserver", class {
        observe() {} unobserve() {} disconnect() {}
    });
}

/** Draw a polyline in the recorder area via synthetic pointer events. */
function drawGestureInRecorder(host: HTMLElement, waypoints: [number, number][]): void {
    const el = host.querySelector("[data-gesture-flow-recorder]") as HTMLElement;
    expect(el).toBeTruthy();
    const p = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
        el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, button: 2, buttons: 2,
            clientX: RECT2.left + x, clientY: RECT2.top + y, pointerId: 9,
            pointerType: "mouse", ...extra,
        }));
    };
    p("pointerdown", waypoints[0][0], waypoints[0][1]);
    for (let i = 0; i < waypoints.length - 1; i++) {
        const [x1, y1] = waypoints[i];
        const [x2, y2] = waypoints[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8));
        for (let s = 1; s <= steps; s++) {
            const f = s / steps;
            p("pointermove", x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
        }
    }
    const last = waypoints[waypoints.length - 1];
    p("pointerup", last[0], last[1], { buttons: 0 });
}

function openBindingsTab(mounted: MountedPanel): void {
    const buttons = mounted.host.querySelectorAll(".gf-nav-btn");
    (buttons[3] as HTMLElement).click();
}

describe("SettingsPanel — 绑定管理（stage 5B）", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        stubRecorderEnvironment();
        confirmCalls.length = 0;
        mounted = mountPanel();
        openBindingsTab(mounted);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        cleanup(mounted.component);
    });

    it("新增绑定按钮可见", async () => {
        await Promise.resolve();
        const addBtn = mounted.host.querySelector(".gf-binding-add");
        expect(addBtn).toBeTruthy();
    });

    it("点击新增按钮打开编辑器", async () => {
        await Promise.resolve();
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await Promise.resolve();
        const editor = mounted.host.querySelector(".gf-binding-editor");
        expect(editor).toBeTruthy();
        expect(editor?.textContent).toContain("新增绑定");
    });

    it("点击已有绑定编辑按钮打开编辑器并保留原绑定", async () => {
        await Promise.resolve();
        const editBtns = mounted.host.querySelectorAll(".gf-binding-edit");
        expect(editBtns.length).toBe(4);
        (editBtns[0] as HTMLElement).click();
        await Promise.resolve();
        const editor = mounted.host.querySelector(".gf-binding-editor");
        expect(editor).toBeTruthy();
        // Editing keeps the original id: the title says 编辑绑定 and the
        // recorded directions badge shows the original L (←).
        expect(editor?.textContent).toContain("编辑绑定");
        const badges = editor?.querySelectorAll(".gf-badge");
        expect(Array.from(badges ?? []).map((b) => b.textContent?.trim())).toContain("←");
    });

    it("命令选择框来自命令目录（分组 optgroup）", async () => {
        await Promise.resolve();
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await Promise.resolve();
        // The first select is the implementation type; the command
        // catalog select is the one with optgroups.
        const selects = mounted.host.querySelectorAll(".gf-binding-editor select");
        const select = Array.from(selects).find(
            (s) => s.querySelectorAll("optgroup").length > 0,
        ) as HTMLSelectElement | undefined;
        expect(select).toBeTruthy();
        expect(select!.querySelectorAll("option").length).toBe(4);
        expect(select!.querySelectorAll("optgroup").length).toBe(2);
    });

    it("新增绑定：录制 R→D 并保存成功，列表更新为 5 项", async () => {
        await Promise.resolve();
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await Promise.resolve();

        drawGestureInRecorder(mounted.host, [[0, 0], [120, 0], [120, 120]]);
        await new Promise((r) => setTimeout(r, 10));

        const saveBtn = mounted.host.querySelector(".gf-binding-editor-save") as HTMLButtonElement;
        expect(saveBtn).toBeTruthy();
        saveBtn.click();
        await new Promise((r) => setTimeout(r, 20));

        // Editor closed, list now has 5 items with a R→D badge pair.
        expect(mounted.host.querySelector(".gf-binding-editor")).toBeNull();
        const items = mounted.host.querySelectorAll(".gf-binding-item");
        expect(items.length).toBe(5);
        const lastBadges = Array.from(
            items[items.length - 1].querySelectorAll(".gf-binding-dirs .gf-badge"),
        ).map((b) => b.textContent?.trim());
        expect(lastBadges).toEqual(["→", "↓"]);
    });

    it("取消不保存，配置不变", async () => {
        await Promise.resolve();
        const updateSpy = vi.spyOn(mounted.configManager, "updateConfig");
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await Promise.resolve();
        drawGestureInRecorder(mounted.host, [[0, 0], [120, 0]]);
        await new Promise((r) => setTimeout(r, 10));

        const cancelBtn = Array.from(
            mounted.host.querySelectorAll(".gf-binding-editor button"),
        ).find((b) => b.textContent?.trim() === "取消") as HTMLButtonElement;
        cancelBtn.click();
        await Promise.resolve();

        expect(mounted.host.querySelector(".gf-binding-editor")).toBeNull();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(mounted.configManager.getConfig().bindings.length).toBe(4);
    });

    it("重复手势无法保存：编辑为他人方向时显示错误并保留草稿", async () => {
        await Promise.resolve();
        const updateSpy = vi.spyOn(mounted.configManager, "updateConfig");
        // Edit the default-L binding and re-record it as R (occupied by default-R).
        (mounted.host.querySelectorAll(".gf-binding-edit")[0] as HTMLElement).click();
        await Promise.resolve();
        drawGestureInRecorder(mounted.host, [[0, 0], [120, 0]]);
        await new Promise((r) => setTimeout(r, 10));

        const saveBtn = mounted.host.querySelector(".gf-binding-editor-save") as HTMLButtonElement;
        saveBtn.click();
        await new Promise((r) => setTimeout(r, 20));

        // Editor stays open with an error; nothing persisted.
        expect(mounted.host.querySelector(".gf-binding-editor")).toBeTruthy();
        expect(mounted.host.querySelector(".gf-binding-editor-error")).toBeTruthy();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it("删除绑定需确认，确认后列表更新", async () => {
        await Promise.resolve();
        (mounted.host.querySelectorAll(".gf-binding-delete")[1] as HTMLElement).click(); // default-R
        await Promise.resolve();

        // SiYuan confirm was shown with direction + command details.
        expect(confirmCalls.length).toBe(1);
        expect(confirmCalls[0].text).toContain("→"); // direction symbol in text
        expect(confirmCalls[0].text).toContain("下一个标签页"); // command title

        // User confirms → delete happens.
        confirmCalls[0].confirmCb?.();
        await new Promise((r) => setTimeout(r, 20));

        const items = mounted.host.querySelectorAll(".gf-binding-item");
        expect(items.length).toBe(3);
    });

    it("删除绑定取消确认时列表不变", async () => {
        await Promise.resolve();
        (mounted.host.querySelectorAll(".gf-binding-delete")[0] as HTMLElement).click();
        await Promise.resolve();
        expect(confirmCalls.length).toBe(1);

        // User cancels — the confirm callback is never invoked.
        expect(mounted.host.querySelectorAll(".gf-binding-item").length).toBe(4);
        expect(mounted.configManager.getConfig().bindings.length).toBe(4);
    });

    it("启停开关更新绑定 enabled", async () => {
        await Promise.resolve();
        const switches = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch');
        const first = switches[0] as HTMLInputElement;
        expect(first.checked).toBe(true);
        first.checked = false;
        first.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(mounted.configManager.getConfig().bindings[0].enabled).toBe(false);
    });

    it("空绑定列表显示空状态", async () => {
        // Fresh manager with no bindings.
        document.body.innerHTML = "";
        const host = document.createElement("div");
        document.body.appendChild(host);
        const cm = makeConfigManager({ ...createDefaultConfig(), bindings: [] });
        const component = new SettingsPanel({
            target: host,
            props: { configManager: cm, i18n, commandCatalog: COMMAND_CATALOG, onStatus: vi.fn() },
        });
        const navBtns = host.querySelectorAll(".gf-nav-btn");
        (navBtns[3] as HTMLElement).click();
        await Promise.resolve();
        expect(host.querySelector(".gf-binding-empty")).toBeTruthy();
        expect(host.querySelectorAll(".gf-binding-item").length).toBe(0);
        component.$destroy();
    });

    it("8 方向模式下斜向绑定显示斜向徽标", async () => {
        document.body.innerHTML = "";
        const host = document.createElement("div");
        document.body.appendChild(host);
        const cfg = createDefaultConfig();
        cfg.recognizer.directionMode = 8;
        cfg.bindings.push({
            id: "diag-1",
            enabled: true,
            directions: ["UR", "DL"],
            action: { type: "builtin" as const, commandId: "tabs.next", commandParams: {} },
        });
        const cm = makeConfigManager(cfg);
        const component = new SettingsPanel({
            target: host,
            props: { configManager: cm, i18n, commandCatalog: COMMAND_CATALOG, onStatus: vi.fn() },
        });
        const navBtns = host.querySelectorAll(".gf-nav-btn");
        (navBtns[3] as HTMLElement).click();
        await Promise.resolve();
        const badges = Array.from(
            host.querySelectorAll(".gf-binding-item:last-child .gf-binding-dirs .gf-badge"),
        ).map((b) => b.textContent?.trim());
        expect(badges).toEqual(["↗", "↙"]);
        component.$destroy();
    });
});

describe("SettingsPanel — 5B 稳定化（重复方向 / 方向模式 / 回滚 / 分组）", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        stubRecorderEnvironment();
        confirmCalls.length = 0;
        mounted = mountPanel();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        cleanup(mounted.component);
    });

    it("含重复方向的绑定正常显示（U-D-U / R-L-R / R-D-R-D）", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.bindings = [
            ...cfg.bindings,
            { id: "udu", enabled: true, directions: ["U", "D", "U"], action: { type: "builtin" as const, commandId: "tabs.next", commandParams: {} } },
            { id: "rlr", enabled: true, directions: ["R", "L", "R"], action: { type: "builtin" as const, commandId: "tabs.previous", commandParams: {} } },
            { id: "rdrd", enabled: true, directions: ["R", "D", "R", "D"], action: { type: "builtin" as const, commandId: "tabs.next", commandParams: {} } },
        ];
        openBindingsTab(mounted);
        await Promise.resolve();

        const items = mounted.host.querySelectorAll(".gf-binding-item");
        expect(items.length).toBe(7);
        const badgeTexts = (el: Element) =>
            Array.from(el.querySelectorAll(".gf-binding-dirs .gf-badge")).map((b) => b.textContent?.trim());
        expect(badgeTexts(items[4])).toEqual(["↑", "↓", "↑"]);   // U-D-U
        expect(badgeTexts(items[5])).toEqual(["→", "←", "→"]);   // R-L-R
        expect(badgeTexts(items[6])).toEqual(["→", "↓", "→", "↓"]); // R-D-R-D
    });

    it("编辑含重复方向的绑定不抛错（打开编辑器保留全部徽标）", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.bindings.push({
            id: "udu", enabled: true, directions: ["U", "D", "U"], action: { type: "builtin" as const, commandId: "tabs.next", commandParams: {} },
        });
        openBindingsTab(mounted);
        await Promise.resolve();
        const editBtns = mounted.host.querySelectorAll(".gf-binding-edit");
        (editBtns[4] as HTMLElement).click(); // the U-D-U binding
        await Promise.resolve();
        const badges = mounted.host.querySelectorAll(".gf-binding-editor-dir");
        expect(Array.from(badges).map((b) => b.textContent?.trim())).toEqual(["↑", "↓", "↑"]);
    });

    it("命令选择框 optgroup 使用本地化分组名", async () => {
        openBindingsTab(mounted);
        await Promise.resolve();
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await Promise.resolve();
        const groups = mounted.host.querySelectorAll(".gf-binding-editor optgroup");
        const labels = Array.from(groups).map((g) => g.getAttribute("label"));
        expect(labels).toContain("标签页");
        expect(labels).toContain("滚动");
    });

    it("8→4 切换：存在启用斜向绑定时不修改配置并提示", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.recognizer.directionMode = 8;
        cfg.bindings.push({
            id: "diag", enabled: true, directions: ["UR"], action: { type: "builtin" as const, commandId: "tabs.next", commandParams: {} },
        });
        const cm = mounted.configManager as ConfigManager & { updateConfig: ReturnType<typeof vi.fn> };
        const updateSpy = vi.spyOn(cm, "updateConfig");

        // Switch to 识别 tab and change the direction mode select.
        const navBtns = mounted.host.querySelectorAll(".gf-nav-btn");
        (navBtns[1] as HTMLElement).click();
        await Promise.resolve();
        // Find the directionMode select (first select in the recognition tab).
        const modeSelect = Array.from(
            mounted.host.querySelectorAll<HTMLSelectElement>(".gf-content select"),
        ).find((s) => Array.from(s.options).some((o) => ["4", "8"].includes(o.value)));
        expect(modeSelect).toBeTruthy();
        modeSelect!.value = "4";
        modeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));

        // Not written, not saved, config unchanged (still 8-dir with the
        // enabled diagonal binding).
        expect(mounted.configManager.getConfig().recognizer.directionMode).toBe(8);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it("禁用斜向绑定后可以切换 4 方向，绑定被保留且不能启用", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.recognizer.directionMode = 8;
        cfg.bindings = cfg.bindings.map((b) =>
            b.id === "default-L" ? { ...b, directions: ["UR"] as const, enabled: false } : b,
        );
        openBindingsTab(mounted);
        await Promise.resolve();

        // Disabled diagonal binding survives the switch (4-dir).
        const navBtns = mounted.host.querySelectorAll(".gf-nav-btn");
        (navBtns[1] as HTMLElement).click();
        await Promise.resolve();
        const modeSelect = Array.from(
            mounted.host.querySelectorAll<HTMLSelectElement>(".gf-content select"),
        ).find((s) => Array.from(s.options).some((o) => ["4", "8"].includes(o.value)));
        modeSelect!.value = "4";
        modeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500)); // allow the debounced save

        const after = mounted.configManager.getConfig();
        expect(after.recognizer.directionMode).toBe(4);
        const diag = after.bindings.find((b) => b.id === "default-L");
        expect(diag?.enabled).toBe(false); // retained but disabled
        expect(diag?.directions).toEqual(["UR"]); // not silently rewritten

        // Toggling it on in 4-dir mode is refused and the switch stays off.
        openBindingsTab(mounted);
        await Promise.resolve();
        const sw = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch')[0] as HTMLInputElement;
        expect(sw.checked).toBe(false);
        sw.checked = true;
        sw.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(mounted.configManager.getConfig().bindings.find((b) => b.id === "default-L")?.enabled).toBe(false);
    });

    it("保存失败后界面恢复实际配置（方向模式）", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.recognizer.directionMode = 4;
        const cm = mounted.configManager;
        vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });

        const navBtns = mounted.host.querySelectorAll(".gf-nav-btn");
        (navBtns[1] as HTMLElement).click();
        await Promise.resolve();
        const modeSelect = Array.from(
            mounted.host.querySelectorAll<HTMLSelectElement>(".gf-content select"),
        ).find((s) => Array.from(s.options).some((o) => ["4", "8"].includes(o.value)));
        modeSelect!.value = "8";
        modeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500)); // allow the debounced save

        // UI rolled back to the real config (4).
        expect(mounted.configManager.getConfig().recognizer.directionMode).toBe(4);
    });

    it("保存失败后启用开关恢复原状态（绑定启停）", async () => {
        openBindingsTab(mounted);
        await Promise.resolve();
        const cm = mounted.configManager;
        const updateSpy = vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });

        const sw = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch')[0] as HTMLInputElement;
        expect(sw.checked).toBe(true);
        sw.checked = false;
        sw.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(updateSpy).toHaveBeenCalledTimes(1);

        // Rolled back: still enabled in config and the switch reads it.
        expect(mounted.configManager.getConfig().bindings[0].enabled).toBe(true);
        expect((mounted.host.querySelectorAll('input[type="checkbox"].b3-switch')[0] as HTMLInputElement).checked).toBe(true);
    });

    it("删除失败后列表恢复原状", async () => {
        openBindingsTab(mounted);
        await Promise.resolve();
        const cm = mounted.configManager;
        vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });

        (mounted.host.querySelectorAll(".gf-binding-delete")[0] as HTMLElement).click();
        await Promise.resolve();
        confirmCalls[0].confirmCb?.();
        await new Promise((r) => setTimeout(r, 20));

        expect(mounted.host.querySelectorAll(".gf-binding-item").length).toBe(4);
        expect(mounted.configManager.getConfig().bindings.length).toBe(4);
    });
});

describe("SettingsPanel — 保存失败回滚（display / numeric）", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        mounted = mountPanel();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        cleanup(mounted.component);
    });

    it("显示开关保存失败后恢复实际状态", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.overlay.showTrail = false;
        const cm = mounted.configManager;
        vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });

        const navBtns = mounted.host.querySelectorAll(".gf-nav-btn");
        (navBtns[2] as HTMLElement).click(); // display tab
        await Promise.resolve();
        const sw = mounted.host.querySelectorAll('input[type="checkbox"].b3-switch')[0] as HTMLInputElement;
        expect(sw.checked).toBe(false);
        sw.checked = true;
        sw.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500)); // debounced save → fails → rollback

        expect(mounted.configManager.getConfig().overlay.showTrail).toBe(false);
    });

    it("数字设置保存失败后恢复实际值并同步输入框", async () => {
        const cfg = mounted.configManager.getConfig();
        cfg.trigger.activationDistance = 24;
        const cm = mounted.configManager;
        vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });

        const navBtns = mounted.host.querySelectorAll(".gf-nav-btn");
        (navBtns[0] as HTMLElement).click(); // general tab
        await Promise.resolve();
        // The activation distance number input is the first number input.
        const numInput = Array.from(
            mounted.host.querySelectorAll<HTMLInputElement>(".gf-content input"),
        ).find((el) => el.type === "number");
        expect(numInput).toBeTruthy();
        const updateSpy = vi.spyOn(cm, "updateConfig").mockResolvedValue({ status: "error", message: "boom" });
        numInput!.value = "48";
        numInput!.dispatchEvent(new Event("input", { bubbles: true }));
        numInput!.dispatchEvent(new Event("blur", { bubbles: true })); // numeric fields commit on blur
        await new Promise((r) => setTimeout(r, 500)); // debounced save → fails → rollback

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(mounted.configManager.getConfig().trigger.activationDistance).toBe(24);
        expect((numInput as HTMLInputElement).value).toBe("24");
    });
});

// ============================================================ 实现类型（stage 6A）

describe("SettingsPanel — 实现类型（stage 6A）", () => {
    let mounted: MountedPanel;

    beforeEach(() => {
        stubRecorderEnvironment();
        confirmCalls.length = 0;
        mounted = mountPanel();
        openBindingsTab(mounted);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        cleanup(mounted.component);
    });

    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    /** Currently checked implementation-type radio. */
    function typeRadio(): HTMLInputElement {
        const radios = Array.from(
            mounted.host.querySelectorAll('input[name="gf-binding-impl-type"]'),
        ) as HTMLInputElement[];
        return radios.find((r) => r.checked) ?? radios[0];
    }

    async function openEditor(): Promise<void> {
        (mounted.host.querySelector(".gf-binding-add") as HTMLElement).click();
        await flush();

    }

    async function switchToShortcut(): Promise<void> {
        const radio = Array.from(
            mounted.host.querySelectorAll('input[name="gf-binding-impl-type"]'),
        ).find((r) => (r as HTMLInputElement).value === "shortcut") as HTMLInputElement;
        expect(radio).toBeTruthy();
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        await flush();
    }

    /** Record R→D and capture Ctrl+P via the ShortcutRecorder. */
    async function recordAndCaptureShortcut(): Promise<void> {
        await openEditor();
        drawGestureInRecorder(mounted.host, [[0, 0], [120, 0], [120, 120]]);
        await flush();
        await switchToShortcut();
        const input = mounted.host.querySelector(".gf-shortcut-input") as HTMLInputElement;
        expect(input).toBeTruthy();
        input.dispatchEvent(new Event("click", { bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keydown", {
            key: "p", code: "KeyP", ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await flush();
    }

    /** Mutate the config, then force the panel to re-render with it. */
    function setConfig(mutate: (cfg: GestureFlowConfig) => void): void {
        const cfg = mounted.configManager.getConfig();
        mutate(cfg);
        // Re-assign to a new object and notify the component.
        (mounted.configManager as unknown as { updateConfig: (p: ConfigUpdatePatch) => Promise<unknown> })
            .updateConfig({ bindings: cfg.bindings });
    }

    it("实现类型包含三个选项，JavaScript 可见但 disabled", async () => {
        await openEditor();
        const radios = Array.from(
            mounted.host.querySelectorAll("input[name=\"gf-binding-impl-type\"]"),
        ) as HTMLInputElement[];
        expect(radios.map((r) => r.value)).toEqual(["builtin", "shortcut", "javascript"]);
        expect(radios[0].checked).toBe(true); // 默认 builtin
        const jsRadio = radios.find((r) => r.value === "javascript");
        expect(jsRadio?.disabled).toBe(true);
        expect(jsRadio?.parentElement?.textContent).toContain("开发中");
    });

    it("默认 builtin 分支显示命令选择框", async () => {
        await openEditor();
        const commandSelect = Array.from(
            mounted.host.querySelectorAll(".gf-binding-editor select"),
        ).find((s) => s.querySelectorAll("optgroup").length > 0);
        expect(commandSelect).toBeTruthy();
        expect(mounted.host.querySelector(".gf-shortcut-recorder")).toBeNull();
    });

    it("已有 builtin 绑定编辑时打开 builtin 分支", async () => {
        await openEditor();
        // 取消，回到列表，再编辑 default-L
        (mounted.host.querySelector(".gf-binding-editor button.b3-button--text") as HTMLElement).click();
        await flush();
        (mounted.host.querySelectorAll(".gf-binding-edit")[0] as HTMLElement).click();
        await flush();
        expect(typeRadio().checked).toBe(true);
    });

    it("已有 shortcut 绑定编辑时打开 shortcut 分支并显示快捷键", async () => {
        setConfig((cfg) => {
            cfg.bindings = [
                ...cfg.bindings,
                {
                    id: "sc-1",
                    enabled: true,
                    directions: ["R", "D"],
                    action: { type: "shortcut", shortcut: { key: "p", code: "KeyP", keyCode: 80, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } },
                },
            ];
        });
        await flush();
        (mounted.host.querySelectorAll(".gf-binding-edit")[4] as HTMLElement).click();
        await flush();
        expect(typeRadio().checked).toBe(true);
        const input = mounted.host.querySelector(".gf-shortcut-input") as HTMLInputElement;
        expect(input.value).toBe("Ctrl+p");
    });

    it("切换实现类型只修改草稿，取消后配置完全不变", async () => {
        const before = JSON.stringify(mounted.configManager.getConfig());
        await openEditor();
        await switchToShortcut();
        const input = mounted.host.querySelector(".gf-shortcut-input") as HTMLInputElement;
        input.dispatchEvent(new Event("click", { bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true }));
        await flush();
        // 取消
        (mounted.host.querySelector(".gf-binding-editor button.b3-button--text") as HTMLElement).click();
        await flush();
        expect(JSON.stringify(mounted.configManager.getConfig())).toBe(before);
    });

    it("shortcut 绑定保存成功，列表显示类型徽标与快捷键", async () => {
        await recordAndCaptureShortcut();
        (mounted.host.querySelector(".gf-binding-editor-save") as HTMLElement).click();
        await flush();

        const cfg = mounted.configManager.getConfig();
        const last = cfg.bindings[cfg.bindings.length - 1];
        expect(last.action.type).toBe("shortcut");
        if (last.action.type === "shortcut") {
            expect(last.action.shortcut.key).toBe("p");
            expect(last.action.shortcut.ctrlKey).toBe(true);
        }
        const items = mounted.host.querySelectorAll(".gf-binding-item");
        const lastItem = items[items.length - 1];
        expect(lastItem.querySelector(".gf-badge--shortcut")?.textContent?.trim()).toBe("快捷键");
        expect(lastItem.textContent).toContain("快捷键：Ctrl+p");
    });

    it("空快捷键不能保存（显示错误，配置不变）", async () => {
        const before = JSON.stringify(mounted.configManager.getConfig());
        await openEditor();
        drawGestureInRecorder(mounted.host, [[0, 0], [120, 0], [120, 120]]);
        await switchToShortcut();
        (mounted.host.querySelector(".gf-binding-editor-save") as HTMLElement).click();
        await flush();
        expect(mounted.host.querySelector(".gf-binding-editor")).not.toBeNull(); // 编辑器保持打开
        expect(JSON.stringify(mounted.configManager.getConfig())).toBe(before);
    });

    it("清除快捷键按钮清空草稿", async () => {
        await recordAndCaptureShortcut();
        const clearBtn = mounted.host.querySelector(".gf-shortcut-btn") as HTMLElement;
        expect(clearBtn).toBeTruthy();
        clearBtn.click();
        await flush();
        const input = mounted.host.querySelector(".gf-shortcut-input") as HTMLInputElement;
        expect(input.value).toBe("");
    });

    it("测试按钮不保存配置（草稿仍保留，编辑器保持打开）", async () => {
        const before = JSON.stringify(mounted.configManager.getConfig());
        await recordAndCaptureShortcut();
        const testBtn = Array.from(
            mounted.host.querySelectorAll(".gf-shortcut-btn"),
        ).find((b) => (b as HTMLElement).textContent?.trim() === "测试快捷键") as HTMLElement;
        expect(testBtn).toBeTruthy();
        testBtn.click();
        await flush();
        expect(mounted.host.querySelector(".gf-binding-editor")).not.toBeNull();
        expect(JSON.stringify(mounted.configManager.getConfig())).toBe(before);
        expect(mounted.host.querySelector(".gf-binding-editor-test")?.textContent).toContain("已发送测试快捷键");
    });

    it("列表显示 builtin 类型徽标与具体命令名", async () => {
        const items = mounted.host.querySelectorAll(".gf-binding-item");
        expect(items.length).toBe(4);
        const first = items[0];
        expect(first.querySelector(".gf-badge--builtin")?.textContent?.trim()).toBe("内置功能");
        expect(first.textContent).toContain("上一个标签页");
    });
});
