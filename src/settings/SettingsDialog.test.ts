// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Svelte component — we only care about the Dialog lifecycle,
// not the rendered DOM (that is covered by SettingsPanel.test.ts).
const mockPanelInstances: { destroyed: boolean; destroyCount: number; props: unknown }[] = [];
vi.mock("./SettingsPanel.svelte", () => {
    return {
        default: class MockSettingsPanel {
            constructor(opts: { target: unknown; props: unknown }) {
                mockPanelInstances.push({ destroyed: false, destroyCount: 0, props: opts.props });
            }
            $destroy() {
                const inst = mockPanelInstances[mockPanelInstances.length - 1];
                if (inst) {
                    inst.destroyed = true;
                    inst.destroyCount++;
                }
            }
        },
    };
});

// Mock the siyuan Dialog — record every constructor call so we can
// assert on title / content / width / height and the destroyCallback.
// The mock mimics real SiYuan behaviour: `destroy()` removes the DOM
// and then fires `destroyCallback` (synchronously here, which is the
// strictest version of the real async callback).
interface MockDialogOpts {
    title?: string;
    content?: string;
    width?: string;
    height?: string;
    destroyCallback?: () => void;
}
interface MockDialogInstance {
    opts: MockDialogOpts;
    element: HTMLElement;
    destroyed: boolean;
    /** How many times `destroy()` was invoked (must be ≤ 1 per dialog). */
    destroyCalls: number;
    destroy: () => void;
}
const mockDialogs: MockDialogInstance[] = [];

vi.mock("siyuan", () => {
    return {
        Dialog: class MockDialog {
            opts: MockDialogOpts;
            element: HTMLElement;
            destroyed = false;
            destroyCalls = 0;

            constructor(opts: MockDialogOpts) {
                this.opts = opts;
                // Mimic the real SiYuan Dialog DOM shape that the
                // global styles in src/index.scss target:
                //   element
                //   └─ .b3-dialog
                //      └─ .b3-dialog__container
                //         ├─ .b3-dialog__header
                //         └─ .b3-dialog__body
                //            └─ .gf-dialog-host (from `content`)
                this.element = document.createElement("div");
                const dialog = document.createElement("div");
                dialog.className = "b3-dialog";
                const container = document.createElement("div");
                container.className = "b3-dialog__container";
                const header = document.createElement("div");
                header.className = "b3-dialog__header";
                const body = document.createElement("div");
                body.className = "b3-dialog__body";
                const host = document.createElement("div");
                host.className = "gf-dialog-host";
                container.appendChild(header);
                container.appendChild(body);
                dialog.appendChild(container);
                this.element.appendChild(dialog);
                body.appendChild(host);
                document.body.appendChild(this.element);
                mockDialogs.push(this as unknown as MockDialogInstance);
            }
            destroy() {
                this.destroyCalls++;
                this.destroyed = true;
                this.element.remove();
                // Real SiYuan fires destroyCallback after the dialog DOM
                // is removed.
                this.opts.destroyCallback?.();
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
        commandCatalog: [],
        onStatus: vi.fn(),
    };
}

describe("SettingsDialog — 生命周期", () => {
    beforeEach(() => {
        mockPanelInstances.length = 0;
        mockDialogs.length = 0;
        document.body.innerHTML = "";
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
            commandCatalog: [],
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

    it("Dialog 外层拥有 gf-settings-dialog 专属作用域类", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        // The class is added to the Dialog's outermost element so the
        // global styles in src/index.scss can scope b3-dialog rules to
        // this dialog only.
        expect(mockDialogs[0].element.classList.contains("gf-settings-dialog")).toBe(true);
    });

    it("关闭 Dialog 后专属元素从文档中全部销毁", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        expect(document.querySelector(".gf-settings-dialog")).toBeTruthy();

        dlg.close();

        expect(document.querySelector(".gf-settings-dialog")).toBeNull();
        expect(document.querySelector(".gf-dialog-host")).toBeNull();
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

    it("用户关闭路径（Dialog 已销毁后 destroyCallback）不会再次调用 Dialog.destroy", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const dialogRef = mockDialogs[0];

        // Simulate SiYuan closing the dialog on its own (X / Esc /
        // scrim): it calls Dialog.destroy(), which fires destroyCallback.
        dialogRef.destroy();

        // The plugin must not call destroy() a second time from the
        // destroyCallback path, and the panel must be destroyed exactly once.
        expect(dialogRef.destroyCalls).toBe(1);
        expect(mockPanelInstances[0].destroyCount).toBe(1);
        expect(dlg.isOpen).toBe(false);
    });

    it("主动 close 只调用一次 Dialog.destroy 和一次 Panel.$destroy", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const dialogRef = mockDialogs[0];

        dlg.close();

        expect(dialogRef.destroyCalls).toBe(1);
        expect(mockPanelInstances[0].destroyCount).toBe(1);
        expect(dlg.isOpen).toBe(false);
    });

    it("旧 Dialog 延迟到来的 destroyCallback 不会清理新打开的 Dialog", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        const first = mockDialogs[0];

        // User closes the first dialog (SiYuan destroys it).
        first.destroy();
        expect(dlg.isOpen).toBe(false);

        // A new dialog is opened afterwards.
        dlg.open(makeOpts());
        expect(mockDialogs).toHaveLength(2);
        const second = mockDialogs[1];
        expect(dlg.isOpen).toBe(true);

        // The old dialog's destroyCallback arrives late (delayed async
        // path in real SiYuan).  It must not touch the new dialog.
        first.opts.destroyCallback?.();
        expect(dlg.isOpen).toBe(true);
        expect(second.destroyCalls).toBe(0);
        expect(mockPanelInstances[1].destroyCount).toBe(0);
    });

    it("旧 Dialog 关闭后重新打开是全新实例，且可再次正常关闭", () => {
        const dlg = new SettingsDialog();
        dlg.open(makeOpts());
        mockDialogs[0].destroy();
        expect(dlg.isOpen).toBe(false);

        dlg.open(makeOpts());
        expect(mockDialogs).toHaveLength(2);
        expect(dlg.isOpen).toBe(true);

        dlg.close();
        expect(mockDialogs[1].destroyCalls).toBe(1);
        expect(dlg.isOpen).toBe(false);
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
        document.body.innerHTML = "";
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
