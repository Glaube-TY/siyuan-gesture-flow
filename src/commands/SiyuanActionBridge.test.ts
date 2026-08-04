// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the siyuan module before importing the bridge.
vi.mock("siyuan", () => ({
    getActiveTab: vi.fn(),
    getActiveEditor: vi.fn(),
}));

import { SiyuanActionBridge } from "./SiyuanActionBridge";
import { getActiveTab, getActiveEditor } from "siyuan";

// --------------------------------------------------------------- helpers

function makeScrollElement(scrollHeight = 1000): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    el.scrollTo = vi.fn();
    el.scrollTop = 0;
    return el;
}

/**
 * Build a Protyle **wrapper** that matches the official SiYuan return
 * structure: `getActiveEditor()` returns a `Protyle` whose `.protyle`
 * field is the real `IProtyle` instance.
 *
 *   editor.protyle.scroll.element   → scroll container
 *   editor.protyle.contentElement   → fallback content element
 */
function makeProtyleWrapper(opts: {
    scrollEl?: HTMLElement | null;
    contentEl?: HTMLElement | null;
} = {}): unknown {
    const protyle: Record<string, unknown> = {};
    if (opts.scrollEl !== undefined) {
        protyle.scroll = opts.scrollEl ? { element: opts.scrollEl } : undefined;
    }
    if (opts.contentEl !== undefined) {
        protyle.contentElement = opts.contentEl;
    }
    return { protyle };
}

function makeTab(opts: {
    id?: string;
    headElement?: HTMLElement;
    parent?: { children: unknown[]; switchTab: (el: HTMLElement, pushBack?: boolean) => void } | null;
} = {}): unknown {
    return {
        id: opts.id ?? "tab-1",
        headElement: opts.headElement ?? document.createElement("div"),
        parent: opts.parent ?? null,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================ scroll tests
describe("SiyuanActionBridge — scrollActiveDocument", () => {
    it("真实 Protyle 包装结构：滚动到顶部调用 scrollTo(0)", () => {
        const scrollEl = makeScrollElement(1000);
        vi.mocked(getActiveEditor).mockReturnValue(makeProtyleWrapper({ scrollEl }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("executed");
        expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });

    it("真实 Protyle 包装结构：滚动到底部调用 scrollTo(scrollHeight)", () => {
        const scrollEl = makeScrollElement(2000);
        vi.mocked(getActiveEditor).mockReturnValue(makeProtyleWrapper({ scrollEl }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });
    });

    it("editor.protyle.scroll.element 优先于 contentElement", () => {
        const scrollEl = makeScrollElement(1000);
        const contentEl = document.createElement("div");
        contentEl.scrollTo = vi.fn();
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollEl, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        bridge.scrollActiveDocument("top");
        expect(scrollEl.scrollTo).toHaveBeenCalled();
        expect(contentEl.scrollTo).not.toHaveBeenCalled();
    });

    it("没有 scroll.element 时使用 editor.protyle.contentElement", () => {
        const contentEl = makeScrollElement(500);
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollEl: null, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(contentEl.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "auto" });
    });

    it("只有旧的错误 editor.scroll 结构时不得被误认为正式 API", () => {
        // Simulate the old wrong structure: scroll directly on editor
        const scrollEl = makeScrollElement(1000);
        const wrongEditor = { scroll: { element: scrollEl } };
        vi.mocked(getActiveEditor).mockReturnValue(wrongEditor as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        // Should NOT execute — the bridge now requires editor.protyle
        expect(result.status).toBe("unavailable");
        expect(scrollEl.scrollTo).not.toHaveBeenCalled();
    });

    it("没有 protyle 时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue({} as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("没有滚动元素时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollEl: null, contentEl: null }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("scrollTo 不存在时正确写入 scrollTop", () => {
        const scrollEl = document.createElement("div");
        Object.defineProperty(scrollEl, "scrollHeight", { value: 1500, configurable: true });
        // No scrollTo function — only scrollTop
        delete (scrollEl as unknown as { scrollTo?: unknown }).scrollTo;
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(scrollEl.scrollTop).toBe(1500);
    });

    it("没有活动编辑器时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue(null as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("getActiveEditor 抛出异常时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockImplementation(() => { throw new Error("no layout"); });
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("调用 getActiveEditor 时明确使用当前活动窗口参数", () => {
        const scrollEl = makeScrollElement(1000);
        vi.mocked(getActiveEditor).mockReturnValue(makeProtyleWrapper({ scrollEl }) as never);
        const bridge = new SiyuanActionBridge();
        bridge.scrollActiveDocument("top");
        expect(getActiveEditor).toHaveBeenCalledWith(true);
    });
});

// ============================================================ tab tests
describe("SiyuanActionBridge — switchAdjacentTab", () => {
    it("切换到上一个标签页（pushBack=true）", () => {
        const switchTab = vi.fn();
        const head1 = document.createElement("div");
        const head0 = document.createElement("div");
        const wnd = {
            children: [
                { id: "tab-0", headElement: head0 },
                { id: "tab-1", headElement: head1 },
            ],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-1",
            headElement: head1,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("previous");
        expect(result.status).toBe("executed");
        expect(switchTab).toHaveBeenCalledWith(head0, true);
    });

    it("切换到下一个标签页（pushBack=true）", () => {
        const switchTab = vi.fn();
        const head0 = document.createElement("div");
        const head1 = document.createElement("div");
        const wnd = {
            children: [
                { id: "tab-0", headElement: head0 },
                { id: "tab-1", headElement: head1 },
            ],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-0",
            headElement: head0,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("executed");
        expect(switchTab).toHaveBeenCalledWith(head1, true);
    });

    it("到达最左标签页返回 noop", () => {
        const switchTab = vi.fn();
        const head0 = document.createElement("div");
        const wnd = {
            children: [{ id: "tab-0", headElement: head0 }],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-0",
            headElement: head0,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("previous");
        expect(result.status).toBe("noop");
        expect(switchTab).not.toHaveBeenCalled();
    });

    it("到达最右标签页返回 noop", () => {
        const switchTab = vi.fn();
        const head0 = document.createElement("div");
        const wnd = {
            children: [{ id: "tab-0", headElement: head0 }],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-0",
            headElement: head0,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("noop");
        expect(switchTab).not.toHaveBeenCalled();
    });

    it("没有活动标签页返回 unavailable", () => {
        vi.mocked(getActiveTab).mockReturnValue(null as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("unavailable");
    });

    it("标签页没有 parent 返回 unavailable", () => {
        vi.mocked(getActiveTab).mockReturnValue(makeTab({ parent: null }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("unavailable");
    });

    it("活动标签页不在 children 中返回 unavailable", () => {
        const switchTab = vi.fn();
        const wnd = {
            children: [{ id: "tab-other", headElement: document.createElement("div") }],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-missing",
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("unavailable");
    });

    it("不跨越其他标签栏（只操作同一 wnd.children）", () => {
        const switchTab = vi.fn();
        const head0 = document.createElement("div");
        const head1 = document.createElement("div");
        const wnd = {
            children: [
                { id: "tab-0", headElement: head0 },
                { id: "tab-1", headElement: head1 },
            ],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-1",
            headElement: head1,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        // At the rightmost tab — should noop, not cross to another wnd
        const result = bridge.switchAdjacentTab("next");
        expect(result.status).toBe("noop");
    });

    it("调用 getActiveTab 时明确使用当前活动窗口参数", () => {
        const switchTab = vi.fn();
        const head0 = document.createElement("div");
        const wnd = {
            children: [{ id: "tab-0", headElement: head0 }],
            switchTab,
        };
        vi.mocked(getActiveTab).mockReturnValue(makeTab({
            id: "tab-0",
            headElement: head0,
            parent: wnd,
        }) as never);
        const bridge = new SiyuanActionBridge();
        bridge.switchAdjacentTab("next");
        expect(getActiveTab).toHaveBeenCalledWith(true);
    });
});
