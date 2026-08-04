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
 * API verification basis (node_modules/siyuan types + official source):
 *
 * - `getActiveTab(wndActive?: boolean): Tab` — returns the active tab
 *   (siyuan.d.ts, line 315).  Default `wndActive=true`.
 * - `getActiveEditor(wndActive?: boolean): Protyle` — returns the
 *   **Protyle wrapper** instance (siyuan.d.ts, line 320).  Default
 *   `wndActive=true`.
 * - `Protyle.protyle: IProtyle` — the actual IProtyle instance
 *   (types/protyle.d.ts, line 284).  **Not** the wrapper itself.
 * - `IProtyle.scroll?: Scroll` — scroll manager
 *   (types/protyle.d.ts, line 976).
 * - `Scroll.element: HTMLElement` — the scrolling HTMLElement
 *   (types/protyle.d.ts, line 45).
 * - `IProtyle.contentElement?: HTMLElement` — fallback scroll container
 *   (types/protyle.d.ts, line 982).
 * - `Tab.headElement: HTMLElement` — the tab header element
 *   (types/layout/Tab.d.ts, line 15).
 * - `Tab.parent: Wnd` — the owning window/split
 *   (types/layout/Tab.d.ts, line 13).
 * - `Wnd.switchTab(target: HTMLElement, pushBack?: boolean, ...): void`
 *   (types/layout/Wnd.d.ts, line 18).  Official source confirms that
 *   user-initiated tab clicks pass `pushBack=true` (Wnd.ts click handler).
 * - `Wnd.children: Tab[]` — all tabs in the same split
 *   (types/layout/Wnd.d.ts, line 11).
 *
 * The bridge never throws — it returns `unavailable` or `noop` when the
 * required elements are missing.  It never dispatches synthetic mouse
 * events, simulates keyboard shortcuts, or modifies SiYuan DOM.
 */
export class SiyuanActionBridge {
    /**
     * Scroll the active document to the top or bottom.
     *
     * Calls `getActiveEditor(true)` to obtain the **Protyle wrapper**,
     * then accesses `editor.protyle.scroll.element` (falling back to
     * `editor.protyle.contentElement`).  Uses native `element.scrollTo`
     * / `scrollTop` assignment — no SiYuan HTTP API involved.
     */
    scrollActiveDocument(target: "top" | "bottom"): ScrollResult {
        const editor = this.getActiveEditorSafe();
        if (!editor) {
            return { status: "unavailable", reason: "no active editor" };
        }
        const protyle = editor.protyle;
        if (!protyle) {
            return { status: "unavailable", reason: "editor has no protyle" };
        }
        const scrollEl = this.getScrollElement(protyle);
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
     * Uses `getActiveTab(true)` → `tab.parent` (Wnd) → `wnd.children` to
     * find the current tab's index, then switches to the previous/next
     * tab via `wnd.switchTab(targetTab.headElement, true)`.
     *
     * The `pushBack=true` argument matches the official SiYuan click
     * handler behaviour, allowing the user to navigate back to the
     * previous tab.
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
        // pushBack=true matches official user-click behaviour.
        wnd.switchTab(targetTab.headElement, true);
        return { status: "executed" };
    }

    // --------------------------------------------------------------- internals

    /**
     * Get the active editor wrapper, or null if unavailable.
     *
     * Passes `wndActive=true` explicitly for clarity — this ensures we
     * get the editor from the currently active window.
     *
     * Wrapped in try/catch because `getActiveEditor` may throw in
     * non-standard environments (e.g. during testing or if the layout
     * is not yet ready).
     */
    private getActiveEditorSafe(): Protyle | null {
        try {
            const editor = getActiveEditor(true);
            return editor ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Get the active tab, or null if unavailable.
     *
     * Passes `wndActive=true` explicitly for clarity.
     */
    private getActiveTabSafe(): Tab | null {
        try {
            const tab = getActiveTab(true);
            return tab ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve the scroll container from an IProtyle instance.
     *
     * Priority: `protyle.scroll.element` → `protyle.contentElement`.
     *
     * @param protyle The IProtyle instance (obtained via `editor.protyle`).
     */
    private getScrollElement(protyle: { scroll?: { element?: HTMLElement }; contentElement?: HTMLElement }): HTMLElement | null {
        const scroll = protyle.scroll;
        if (scroll?.element) {
            return scroll.element;
        }
        const content = protyle.contentElement;
        return content ?? null;
    }
}
