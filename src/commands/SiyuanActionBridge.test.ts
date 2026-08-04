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

/**
 * Build the official SiYuan scroll DOM structure:
 *
 * ```html
 * <div class="protyle-scroll">              ← scroll.element.parentElement
 *   <div class="protyle-scroll__up"></div>  ← top button
 *   <div class="protyle-scroll__bar"></div> ← scroll.element (block-index slider)
 *   <div class="protyle-scroll__down"></div>← bottom button
 * </div>
 * ```
 *
 * `scroll.element` is the **bar** (not a scroll container).  The real
 * document scroll container is `contentElement`.
 */
function makeOfficialScrollDom(opts: {
    withUp?: boolean;
    withDown?: boolean;
    withBar?: boolean;
} = {}): {
    container: HTMLElement;
    bar: HTMLElement;
    up: HTMLElement | null;
    down: HTMLElement | null;
} {
    const { withUp = true, withDown = true, withBar = true } = opts;
    const container = document.createElement("div");
    container.className = "protyle-scroll";

    const up = withUp ? document.createElement("div") : null;
    if (up) {
        up.className = "protyle-scroll__up";
        up.click = vi.fn();
        container.appendChild(up);
    }

    const bar = document.createElement("div");
    bar.className = "protyle-scroll__bar";
    if (!withBar) {
        // If no bar, still need a placeholder for structure tests
    }
    container.appendChild(bar);

    const down = withDown ? document.createElement("div") : null;
    if (down) {
        down.className = "protyle-scroll__down";
        down.click = vi.fn();
        container.appendChild(down);
    }

    return { container, bar, up, down };
}

/**
 * Build a contentElement (the real document scroll container) with
 * scrollTop / scrollHeight / scrollTo stubs.
 */
function makeContentElement(scrollHeight = 1000): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    el.scrollTo = vi.fn();
    el.scrollTop = 0;
    return el;
}

/**
 * Build a Protyle **wrapper** matching the official SiYuan structure:
 *   getActiveEditor() returns { protyle: IProtyle }
 *
 * Options:
 * - `scrollBar`: the `protyle-scroll__bar` element (scroll.element).
 *   Pass `null` to omit `protyle.scroll` entirely.
 * - `contentEl`: the real document scroll container.
 *   Pass `null` to omit `protyle.contentElement`.
 */
function makeProtyleWrapper(opts: {
    scrollBar?: HTMLElement | null;
    contentEl?: HTMLElement | null;
} = {}): unknown {
    const protyle: Record<string, unknown> = {};
    if (opts.scrollBar !== undefined) {
        protyle.scroll = opts.scrollBar ? { element: opts.scrollBar } : undefined;
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
    // -------------------------------------------------- official control
    it("top：调用当前编辑器的 protyle-scroll__up 控件", () => {
        const { bar, up } = makeOfficialScrollDom();
        // Bar is attached to container so bar.parentElement === protyle-scroll
        expect(up).not.toBeNull();
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("executed");
        if (result.status === "executed") {
            expect(result.method).toBe("official-control");
        }
        expect(up!.click).toHaveBeenCalledTimes(1);
    });

    it("bottom：调用当前编辑器的 protyle-scroll__down 控件", () => {
        const { bar, down } = makeOfficialScrollDom();
        expect(down).not.toBeNull();
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        if (result.status === "executed") {
            expect(result.method).toBe("official-control");
        }
        expect(down!.click).toHaveBeenCalledTimes(1);
    });

    it("不查找其他分屏的按钮（只查 scroll.element.parentElement）", () => {
        // Current editor's bar has NO parentElement (detached) — should
        // NOT fall back to a global querySelector.
        const bar = document.createElement("div");
        bar.className = "protyle-scroll__bar";
        // Deliberately do NOT attach bar to any container.
        // Create a decoy button in the document that must NOT be used.
        const decoyUp = document.createElement("div");
        decoyUp.className = "protyle-scroll__up";
        decoyUp.click = vi.fn();
        document.body.appendChild(decoyUp);

        const contentEl = makeContentElement(500);
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        // No parentElement → official control unavailable → fallback
        expect(result.status).toBe("executed");
        if (result.status === "executed") {
            expect(result.method).toBe("content-fallback");
        }
        expect(decoyUp.click).not.toHaveBeenCalled();
        decoyUp.remove();
    });

    it("官方控件缺失时回退到 contentElement", () => {
        // Bar exists but parentElement has no __up / __down
        const bar = document.createElement("div");
        const container = document.createElement("div");
        container.className = "protyle-scroll";
        container.appendChild(bar);
        const contentEl = makeContentElement(800);
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("executed");
        if (result.status === "executed") {
            expect(result.method).toBe("content-fallback");
        }
        expect(contentEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });

    it("回退顶部将 contentElement 滚动到 0", () => {
        const bar = document.createElement("div");
        // No parentElement → no official control
        const contentEl = makeContentElement(1000);
        contentEl.scrollTop = 200; // currently scrolled down
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("executed");
        expect(contentEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });

    it("回退底部使用 contentElement.scrollHeight", () => {
        const bar = document.createElement("div");
        const contentEl = makeContentElement(1234);
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(contentEl.scrollTo).toHaveBeenCalledWith({ top: 1234, behavior: "auto" });
    });

    it("绝不调用 scroll.element.scrollTo", () => {
        const { bar, up } = makeOfficialScrollDom();
        expect(up).not.toBeNull();
        // Add a scrollTo spy on the bar — it must NEVER be called.
        const barScrollTo = vi.fn();
        bar.scrollTo = barScrollTo;
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar }) as never,
        );
        const bridge = new SiyuanActionBridge();
        bridge.scrollActiveDocument("top");
        bridge.scrollActiveDocument("bottom");
        expect(barScrollTo).not.toHaveBeenCalled();
    });

    it("绝不写入 scroll.element.scrollTop", () => {
        const { bar } = makeOfficialScrollDom();
        // Use a getter/setter spy to detect any writes to bar.scrollTop.
        let barScrollTopValue = 0;
        const scrollTopSpy = vi.fn((v: number) => { barScrollTopValue = v; });
        Object.defineProperty(bar, "scrollTop", {
            get: () => barScrollTopValue,
            set: scrollTopSpy,
            configurable: true,
        });
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar }) as never,
        );
        const bridge = new SiyuanActionBridge();
        bridge.scrollActiveDocument("top");
        bridge.scrollActiveDocument("bottom");
        expect(scrollTopSpy).not.toHaveBeenCalled();
    });

    it("scrollTo 不可用时回退到 scrollTop 赋值（contentElement）", () => {
        const bar = document.createElement("div");
        const contentEl = document.createElement("div");
        Object.defineProperty(contentEl, "scrollHeight", { value: 1500, configurable: true });
        // No scrollTo function — only scrollTop
        delete (contentEl as unknown as { scrollTo?: unknown }).scrollTo;
        contentEl.scrollTop = 0;
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("bottom");
        expect(result.status).toBe("executed");
        expect(contentEl.scrollTop).toBe(1500);
    });

    it("官方控件 click 抛错时安全回退到 contentElement", () => {
        const { bar, up } = makeOfficialScrollDom();
        expect(up).not.toBeNull();
        // Make click throw
        up!.click = vi.fn(() => { throw new Error("click failed"); });
        const contentEl = makeContentElement(600);
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl }) as never,
        );
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        // Should fall back to contentElement, not throw
        expect(result.status).toBe("executed");
        if (result.status === "executed") {
            expect(result.method).toBe("content-fallback");
        }
        expect(contentEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });

    // -------------------------------------------------- unavailable cases
    it("没有活动编辑器时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue(null as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("没有 protyle 时返回 unavailable", () => {
        vi.mocked(getActiveEditor).mockReturnValue({} as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
    });

    it("没有官方控件且没有 contentElement 时返回 unavailable", () => {
        const bar = document.createElement("div");
        // Bar with no parentElement → no official control
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar, contentEl: null }) as never,
        );
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
        const { bar } = makeOfficialScrollDom();
        vi.mocked(getActiveEditor).mockReturnValue(
            makeProtyleWrapper({ scrollBar: bar }) as never,
        );
        const bridge = new SiyuanActionBridge();
        bridge.scrollActiveDocument("top");
        expect(getActiveEditor).toHaveBeenCalledWith(true);
    });

    // ---------------------------------------------- backwards-compat guard
    it("只有旧的错误 editor.scroll 结构时不得被误认为正式 API", () => {
        // Simulate the old wrong structure: scroll directly on editor
        // (no .protyle wrapper).  The bridge must reject this.
        const scrollEl = document.createElement("div");
        scrollEl.scrollTo = vi.fn();
        const wrongEditor = { scroll: { element: scrollEl } };
        vi.mocked(getActiveEditor).mockReturnValue(wrongEditor as never);
        const bridge = new SiyuanActionBridge();
        const result = bridge.scrollActiveDocument("top");
        expect(result.status).toBe("unavailable");
        expect(scrollEl.scrollTo).not.toHaveBeenCalled();
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
