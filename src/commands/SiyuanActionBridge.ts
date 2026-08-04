import { getActiveTab, getActiveEditor, Tab, Protyle } from "siyuan";

/** Result of a scroll action. */
export type ScrollResult =
    | { status: "executed"; method: "official-control" | "content-fallback" }
    | { status: "unavailable"; reason: string }
    | { status: "failed"; reason: string };

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
 * - `Scroll.element: HTMLElement` — the `protyle-scroll__bar` element
 *   (the block-index slider, **NOT** the document scroll container).
 *   Confirmed by official source: `app/src/protyle/scroll/index.ts`.
 * - `Scroll.parentElement` (private in type, but accessible at runtime) —
 *   the `protyle-scroll` container that holds `__up`, `__bar`, `__down`.
 * - `IProtyle.contentElement?: HTMLElement` — the **real** document scroll
 *   container (types/protyle.d.ts, line 982).  Confirmed by official
 *   source: `goHome` / `goEnd` set `protyle.contentElement.scrollTop`.
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
 * **Scroll strategy**: the bridge prefers reusing SiYuan's official
 * `protyle-scroll__up` / `protyle-scroll__down` buttons (which internally
 * call `goHome` / `goEnd` and handle dynamic block loading).  If those
 * buttons are unavailable, it falls back to directly setting
 * `contentElement.scrollTop`.
 *
 * The bridge never throws — it returns `unavailable`, `noop`, or `failed`
 * when the required elements are missing or operations error.  It never
 * dispatches synthetic mouse events (except `click()` on the official
 * scroll buttons), simulates keyboard shortcuts, or modifies SiYuan DOM.
 */
export class SiyuanActionBridge {
    /**
     * Scroll the active document to the top or bottom.
     *
     * Calls `getActiveEditor(true)` to obtain the **Protyle wrapper**,
     * then accesses `editor.protyle`.
     *
     * Priority:
     * 1. **Official control**: if `protyle.scroll.element.parentElement`
     *    contains `protyle-scroll__up` (for top) or `protyle-scroll__down`
     *    (for bottom), call `click()` on that button.  This reuses SiYuan's
     *    `goHome` / `goEnd` logic, which handles dynamic block loading.
     * 2. **Content fallback**: set `protyle.contentElement.scrollTop` to
     *    `0` (top) or `scrollHeight` (bottom) via `scrollTo` or direct
     *    assignment.
     *
     * **Never** calls `scrollTo` / `scrollTop` on `scroll.element` — that
     * element is the block-index slider (`protyle-scroll__bar`), not a
     * scroll container.
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

        // --- Priority 1: official scroll control ---
        const officialButton = this.findOfficialScrollButton(protyle, target);
        if (officialButton) {
            try {
                officialButton.click();
                return { status: "executed", method: "official-control" };
            } catch {
                // Button click failed — fall through to content fallback.
            }
        }

        // --- Priority 2: contentElement fallback ---
        const contentEl = protyle.contentElement;
        if (!contentEl) {
            return { status: "unavailable", reason: "no scroll container" };
        }
        const destination = target === "top" ? 0 : contentEl.scrollHeight;
        try {
            if (typeof contentEl.scrollTo === "function") {
                contentEl.scrollTo({ top: destination, behavior: "auto" });
            } else {
                contentEl.scrollTop = destination;
            }
            return { status: "executed", method: "content-fallback" };
        } catch {
            return { status: "failed", reason: "contentElement scroll failed" };
        }
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
     * Find the official SiYuan scroll button (`protyle-scroll__up` or
     * `protyle-scroll__down`) for the given protyle.
     *
     * The official DOM structure (from `app/src/protyle/scroll/index.ts`):
     *
     * ```html
     * <div class="protyle-scroll">
     *   <div class="protyle-scroll__up">...</div>
     *   <div class="protyle-scroll__bar">...</div>
     *   <div class="protyle-scroll__down">...</div>
     * </div>
     * ```
     *
     * `protyle.scroll.element` is the `protyle-scroll__bar` element.
     * Its `parentElement` is the `protyle-scroll` container, which also
     * contains the `__up` and `__down` buttons.
     *
     * We scope the query to `scroll.element.parentElement` so we only
     * find buttons in the **current** editor's scroll control — never
     * buttons from other splits or windows.
     *
     * @param protyle The IProtyle instance.
     * @param target "top" → find `__up`; "bottom" → find `__down`.
     * @returns The button element, or `null` if not found.
     */
    private findOfficialScrollButton(
        protyle: { scroll?: { element?: HTMLElement } },
        target: "top" | "bottom",
    ): HTMLElement | null {
        const scrollEl = protyle.scroll?.element;
        if (!scrollEl) {
            return null;
        }
        const container = scrollEl.parentElement;
        if (!container) {
            return null;
        }
        const className = target === "top" ? "protyle-scroll__up" : "protyle-scroll__down";
        // querySelector scoped to the container — never crosses into
        // other editors.
        return container.querySelector(`.${className}`);
    }
}
