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

function makeEditor(scrollEl: HTMLElement | null) {
    return { scroll: scrollEl ? { element: scrollEl } : null } as unknown as Parameters<typeof SiyuanActionBridge.prototype.scrollActiveDocument>[0] extends never ? never : Parameters<typeof getActiveEditor>[0] extends never ? never : ReturnType<typeof getActiveEditor>;
}

function makeTab(opts: {
    id?: string;
    headElement?: HTMLElement;
    parent?: { children: unknown[]; switchTab: (el: HTMLElement) => void } | null;
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
    it("滚动到顶部调用 scrollTo(0)", () => {
        const scrollEl = makeScrollElement(1000);
        vi.mocked(getActiveEditor).mockReturnValue(makeEditor(scrollEl) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("executed");
        expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });

    it("滚动到底部调用 scrollTo(scrollHeight)", () => {
        const scrollEl = makeScrollElement(2000);
        vi.mocked(getActiveEditor).mockReturnValue(makeEditor(scrollEl) as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });
    });

    it("没有活动编辑器时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue(null as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("编辑器没有 scroll 元素时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue(makeEditor(null) as never);
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
});

// ============================================================ tab tests
describe("SiyuanActionBridge — switchAdjacentTab", () => {
    it("切换到上一个标签页", () => {
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
        expect(switchTab).toHaveBeenCalledWith(head0);
    });

    it("切换到下一个标签页", () => {
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
        expect(switchTab).toHaveBeenCalledWith(head1);
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
        // Only 2 tabs in this wnd
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
});
