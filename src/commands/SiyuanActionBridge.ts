import { getActiveTab, getActiveEditor, Tab, Protyle } from "siyuan";

/** Result of a scroll action. */
export type ScrollResult =
    | { status: "executed" }
    | { status: "unavailable"; reason: string };

/** Result of a tab-switch action. */
export type SwitchTabResult =
    | { status: "executed" }
    | { status: "unavailable"; reason: string }
    | { status: "noop"; reason: string };

/**
 * Bridge between GestureFlow commands and the SiYuan API/DOM.
 *
 * **All** SiYuan DOM selectors and API calls are centralised here.  No
 * other module in the codebase may query SiYuan-specific selectors.
 *
 * API verification basis (node_modules/siyuan types):
 *
 * - `getActiveTab(wndActive?: boolean): Tab` — returns the active tab
 *   (siyuan.d.ts).
 * - `getActiveEditor(wndActive?: boolean): Protyle` — returns the active
 *   editor instance (siyuan.d.ts).
 * - `Tab.headElement: HTMLElement` — the tab header element passed to
 *   `Wnd.switchTab` (types/layout/Tab.d.ts).
 * - `Tab.parent: Wnd` — the owning window/split (types/layout/Tab.d.ts).
 * - `Wnd.switchTab(target: HTMLElement, ...): void` — switches to the
 *   tab whose head element is `target` (types/layout/Wnd.d.ts).
 * - `Wnd.children: Tab[]` — all tabs in the same split
 *   (types/layout/Wnd.d.ts).
 * - `Protyle.scroll?: Scroll` — scroll manager; `Scroll.element` is the
 *   scrolling HTMLElement (types/protyle.d.ts, line 44-58).
 * - `Protyle.contentElement?: HTMLElement` — fallback scroll container
 *   (types/protyle.d.ts).
 *
 * The bridge never throws — it returns `unavailable` or `noop` when the
 * required elements are missing.  It never dispatches synthetic mouse
 * events, simulates keyboard shortcuts, or modifies SiYuan DOM.
 */
export class SiyuanActionBridge {
    /**
     * Scroll the active document to the top or bottom.
     *
     * Uses `getActiveEditor()` to obtain the Protyle instance, then
     * scrolls `protyle.scroll.element` (falling back to
     * `protyle.contentElement`).  Uses native `element.scrollTo` /
     * `scrollTop` assignment — no SiYuan HTTP API involved.
     */
    scrollActiveDocument(target: "top" | "bottom"): ScrollResult {
        const editor = this.getActiveEditorSafe();
        if (!editor) {
            return { status: "unavailable", reason: "no active editor" };
        }
        const scrollEl = this.getScrollElement(editor);
        if (!scrollEl) {
            return { status: "unavailable", reason: "no scroll container" };
        }
        const destination = target === "top" ? 0 : scrollEl.scrollHeight;
        if (typeof scrollEl.scrollTo === "function") {
            scrollEl.scrollTo({ top: destination, behavior: "auto" });
        } else {
            scrollEl.scrollTop = destination;
        }
        return { status: "executed" };
    }

    /**
     * Switch to the adjacent tab in the same window split.
     *
     * Uses `getActiveTab()` → `tab.parent` (Wnd) → `wnd.children` to
     * find the current tab's index, then switches to the previous/next
     * tab via `wnd.switchTab(targetTab.headElement)`.
     *
     * - Does **not** wrap around: at the leftmost/rightmost tab returns
     *   `noop`.
     * - Only operates within the same Wnd (split), never crosses into
     *   other tab bars or windows.
     */
    switchAdjacentTab(direction: "previous" | "next"): SwitchTabResult {
        const tab = this.getActiveTabSafe();
        if (!tab) {
            return { status: "unavailable", reason: "no active tab" };
        }
        const wnd = tab.parent;
        if (!wnd || !wnd.children || !wnd.switchTab) {
            return { status: "unavailable", reason: "no parent wnd" };
        }
        const siblings = wnd.children;
        const currentIndex = siblings.findIndex((t) => t.id === tab.id);
        if (currentIndex < 0) {
            return { status: "unavailable", reason: "active tab not in wnd.children" };
        }
        const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
        // No wrap-around — return noop at edges.
        if (targetIndex < 0) {
            return { status: "noop", reason: "already at leftmost tab" };
        }
        if (targetIndex >= siblings.length) {
            return { status: "noop", reason: "already at rightmost tab" };
        }
        const targetTab = siblings[targetIndex];
        if (!targetTab || !targetTab.headElement) {
            return { status: "unavailable", reason: "target tab has no head element" };
        }
        wnd.switchTab(targetTab.headElement);
        return { status: "executed" };
    }

    // --------------------------------------------------------------- internals

    /**
     * Get the active editor, or null if unavailable.
     *
     * Wrapped in try/catch because `getActiveEditor` may throw in
     * non-standard environments (e.g. during testing or if the layout
     * is not yet ready).
     */
    private getActiveEditorSafe(): Protyle | null {
        try {
            const editor = getActiveEditor();
            return editor ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Get the active tab, or null if unavailable.
     */
    private getActiveTabSafe(): Tab | null {
        try {
            const tab = getActiveTab();
            return tab ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve the scroll container for a Protyle editor.
     *
     * Priority: `protyle.scroll.element` → `protyle.contentElement`.
     */
    private getScrollElement(editor: Protyle): HTMLElement | null {
        const scroll = (editor as unknown as { scroll?: { element?: HTMLElement } }).scroll;
        if (scroll?.element) {
            return scroll.element;
        }
        const content = (editor as unknown as { contentElement?: HTMLElement }).contentElement;
        return content ?? null;
    }
}
