// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Svelte component — we only care about the Dialog lifecycle,
// not the rendered DOM (that is covered by SettingsPanel.test.ts).
const mockPanelInstances: { destroyed: boolean; props: unknown }[] = [];
vi.mock("./SettingsPanel.svelte", () => {
    return {
        default: class MockSettingsPanel {
            constructor(opts: { target: unknown; props: unknown }) {
                mockPanelInstances.push({ destroyed: false, props: opts.props });
            }
            $destroy() {
                const inst = mockPanelInstances[mockPanelInstances.length - 1];
                if (inst) inst.destroyed = true;
            }
        },
    };
});

// Mock the siyuan Dialog — record every constructor call so we can
// assert on title / content / width / height and the destroyCallback.
interface MockDialogOpts {
    title?: string;
    content?: string;
    width?: string;
    height?: string;
    destroyCallback?: () => void;
}
interface MockDialogInstance {
    opts: MockDialogOpts;
    element: { querySelector: (sel: string) => HTMLElement | null };
    destroyed: boolean;
    destroy: () => void;
}
const mockDialogs: MockDialogInstance[] = [];

vi.mock("siyuan", () => {
    return {
        Dialog: class MockDialog {
            opts: MockDialogOpts;
            element: { querySelector: (sel: string) => HTMLElement | null };
            destroyed = false;

            constructor(opts: MockDialogOpts) {
                this.opts = opts;
                // Simulate the host div that the real Dialog would
                // render from the `content` string.
                const host = document.createElement("div");
                host.className = "gf-dialog-host";
                this.element = {
                    querySelector: (sel: string) => {
                        if (sel === ".gf-dialog-host") return host;
                        return host.querySelector(sel);
                    },
                };
                mockDialogs.push(this as unknown as MockDialogInstance);
            }
            destroy() {
                this.destroyed = true;
            }
        },
    };
});

import { SettingsDialog } from "./SettingsDialog";
import type { ConfigManager } from "@/config/ConfigManager";

function makeOpts() {
    return {
        configManager: {
            getConfig: () => ({}),
            subscribe: () => () => {},
            updateConfig: async () => ({ status: "saved" as const, message: "" }),
        } as unknown as ConfigManager,
        i18n: { settingsTitle: "手势流设置" },
        onStatus: vi.fn(),
    };
}

describe("SettingsDialog — 生命周期", () => {
    beforeEach(() => {
        mockPanelInstances.length = 0;
        mockDialogs.length = 0;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("open 创建一个 Dialog 实例并挂载 Svelte 组件", () => {
        const dlg = new SettingsDialog();
        expect(dlg.isOpen).toBe(false);

        dlg.open(makeOpts());

        expect(dlg.isOpen).toBe(true);
        expect(mockDialogs).toHaveLength(1);
        expect(mockPanelInstances).toHaveLength(1);
    });

    it("Dialog 标题使用 i18n.settingsTitle", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        expect(mockDialogs[0].opts.title).toBe("手势流设置");
    });

    it("未提供 settingsTitle 时回退到英文默认值", () => {
        const dlg = new SettingsDialog();
        dlg.open({
            configManager: makeOpts().configManager,
            i18n: {},
            onStatus: vi.fn(),
        });
        expect(mockDialogs[0].opts.title).toBe("GestureFlow Settings");
    });

    it("Dialog 宽度受视口约束（不写死 200px）", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const width = mockDialogs[0].opts.width ?? "";
        expect(width).toContain("min(");
        expect(width).not.toContain("200px");
        // Should reference viewport units
        expect(width).toMatch(/100vw/);
    });

    it("Dialog 高度受视口约束", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const height = mockDialogs[0].opts.height ?? "";
        expect(height).toContain("min(");
        expect(height).toMatch(/100vh/);
    });

    it("Dialog 内容包含 gf-dialog-host 宿主节点", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        expect(mockDialogs[0].opts.content).toContain("gf-dialog-host");
    });

    it("Dialog 不使用 Setting.addItem 或 actionElement 结构", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const content = mockDialogs[0].opts.content ?? "";
        // The content should NOT contain Setting's structural classes
        expect(content).not.toContain("fn__size200");
        expect(content).not.toContain("config-item");
        expect(content).not.toContain("b3-label");
    });

    it("重复调用 open 不会创建第二个 Dialog", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        dlg.open(makeOpts());
        dlg.open(makeOpts());
        expect(mockDialogs).toHaveLength(1);
        expect(mockPanelInstances).toHaveLength(1);
    });

    it("close 销毁 Svelte 组件和 Dialog", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const dialogRef = mockDialogs[0];

        dlg.close();

        expect(dlg.isOpen).toBe(false);
        expect(mockPanelInstances[0].destroyed).toBe(true);
        expect(dialogRef.destroyed).toBe(true);
    });

    it("close 是幂等的，重复调用不会报错", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        dlg.close();
        dlg.close();
        dlg.close();
        expect(mockDialogs).toHaveLength(1);
    });

    it("destroyCallback 触发时也会正确清理", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const callback = mockDialogs[0].opts.destroyCallback;
        expect(typeof callback).toBe("function");

        callback?.();
        expect(dlg.isOpen).toBe(false);
        expect(mockPanelInstances[0].destroyed).toBe(true);
    });

    it("destroy 后再调用 open 不会创建新 Dialog", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        dlg.destroy();

        mockDialogs.length = 0;
        mockPanelInstances.length = 0;

        dlg.open(makeOpts());
        expect(mockDialogs).toHaveLength(0);
        expect(mockPanelInstances).toHaveLength(0);
    });

    it("destroy 后 isOpen 为 false", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        dlg.destroy();
        expect(dlg.isOpen).toBe(false);
    });

    it("Svelte 组件接收正确的 props", () => {
        const opts = makeOpts();
        const dlg = new SettingsDialog();
        dlg.open(opts);

        const panel = mockPanelInstances[0];
        expect(panel.props).toMatchObject({
            configManager: opts.configManager,
            i18n: opts.i18n,
            onStatus: opts.onStatus,
        });
    });
});

describe("SettingsDialog — 不使用 Setting 承载整页", () => {
    beforeEach(() => {
        mockPanelInstances.length = 0;
        mockDialogs.length = 0;
    });

    it("Dialog 标题不是插件技术名称 siyuan-gesture-flow", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const title = mockDialogs[0].opts.title ?? "";
        expect(title).not.toBe("siyuan-gesture-flow");
        expect(title).not.toContain("siyuan-gesture-flow");
    });

    it("使用完整自定义 Dialog 而非 Setting.addItem", () => {
        // The SettingsDialog class creates exactly one Dialog instance
        // and never touches Setting.  We verify by checking that the
        // content is a host div, not an actionElement wrapper.
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        expect(mockDialogs).toHaveLength(1);
        // Content should be our host div, not a Setting control column
        expect(mockDialogs[0].opts.content).toBe('<div class="gf-dialog-host"></div>');
    });
});
