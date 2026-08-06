import { getActiveTab, getActiveEditor, Tab, Protyle, globalCommand } from "siyuan";

/**
 * The SiYuan `App` instance type as required by the plugin API's
 * `globalCommand(command, app)` second parameter — derived from the
 * exported function signature so it never depends on unexposed App
 * internals.  `undefined` when the type resolves to a non-callable
 * (treated as "no app available").
 */
export type GfApp = Parameters<typeof globalCommand>[1];

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
 * Result of a tab-level operation (close current tab, reload active
 * document).  `noop` is reserved for cases where the operation has no
 * work to do by design; exceptions are never reported as `executed`.
 */
export type TabOperationResult =
    | { status: "executed" }
    | { status: "unavailable"; reason: string }
    | { status: "noop"; reason: string }
    | { status: "failed"; reason: string; error?: string };

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
 * - `Wnd.removeTab(id, isBatchClose?, animate?, isSaveLayout?): void`
 *   (types/layout/Wnd.d.ts, line 27).  The official `removeDoc` /
 *   `closeBox` handlers and `closeTabByType` (app/src/index.ts,
 *   app/src/layout/tabUtil.ts) all close tabs via
 *   `tab.parent.removeTab(tab.id)`.
 * - `Protyle.reload(focus, updateReadonly?): void`
 *   (types/protyle.d.ts, line 302) — public wrapper around the official
 *   `reloadProtyle(protyle, focus, updateReadonly)`; the official code
 *   itself uses `this.reload(false)` after transactions.
 * - `globalCommand(command: string, app: App): void` — publicly exported
 *   by the plugin API (siyuan.d.ts, line 419).  The official
 *   implementation (app/src/boot/globalEvent/command/global.ts) handles
 *   `recentClosed` using SiYuan's own recently-closed-tab storage and
 *   restore flow (pop + `setStorageVal` + openFile by tab type).  This
 *   bridge **never reads or writes that storage itself**.
 *
 * The App instance is injected via the plugin constructor (the official
 * loader calls `new pluginClass({ app, name, displayName, i18n })`,
 * app/src/plugin/loader.ts) and forwarded to this bridge as a provider.
 * The provider may be absent (settings-catalog probe bridge, tests,
 * incomplete environments) — in that case app-dependent actions return
 * `unavailable`.
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
 * It does not guess tab/doc identity via constructor names, DOM class
 * names, private `model` fields, or unverified instanceof checks.
 */
export class SiyuanActionBridge {
    /** The injected App provider (may be null — see class docs). */
    private readonly app: GfApp | null;

    /**
     * @param app The SiYuan App instance (or a provider resolving to one)
     *   injected by the plugin.  Omit for probe bridges / tests.
     */
    constructor(app?: GfApp | null) {
        this.app = app ?? null;
    }

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

    /**
     * Close the currently active tab in the active window.
     *
     * Uses the same public object chain the official source uses for
     * `removeDoc` / `closeBox` / `closeTabByType`:
     *
     * ```ts
     * getActiveTab(true) → tab.parent (Wnd) → wnd.removeTab(tab.id)
     * ```
     *
     * `wndActive=true` restricts the lookup to the **active Wnd**, so the
     * target is whatever normal tab bar belongs to that window.  Dock
     * panels, block popovers and floating layers outside the active Wnd's
     * tab system are never handled.  **No claim is made about the tab's
     * model type** — it may or may not be an Editor; this method does not
     * guess.  No tab DOM is queried, no close-button click is simulated,
     * no private function is called.
     *
     * The official `Wnd.removeTab` handles the animation, layout save and
     * "last tab" behaviour itself; we never compensate for it.
     */
    closeActiveTab(): TabOperationResult {
        const tab = this.getActiveTabSafe();
        if (!tab) {
            return { status: "unavailable", reason: "no active tab" };
        }
        const wnd = tab.parent;
        if (!wnd || typeof wnd.removeTab !== "function") {
            return { status: "unavailable", reason: "tab has no removable parent" };
        }
        if (typeof tab.id !== "string" || tab.id.length === 0) {
            return { status: "unavailable", reason: "tab id unavailable" };
        }
        try {
            wnd.removeTab(tab.id);
            return { status: "executed" };
        } catch (err) {
            return this.toFailedResult(err, "closeActiveTab failed");
        }
    }

    /**
     * Reload the currently active document editor.
     *
     * Uses the public Protyle wrapper returned by `getActiveEditor(true)`:
     * `editor.reload(false)` → official `reloadProtyle(protyle, false)`.
     * `focus=false` avoids stealing editor focus back to the gesture
     * origin, matching how the official code reloads after transactions
     * (`this.reload(false)`).
     *
     * `getActiveEditor` resolves whatever Protyle the active interface
     * currently holds — primarily the current document editor, but in
     * embedded-Protyle contexts it may resolve to another editor.  No
     * model-type filtering is applied; when there is no active Protyle
     * the result is `unavailable`.  This method never imports
     * `app/src/protyle/util/reload.ts`, never copies its internals, never
     * calls HTTP APIs, never re-requests document data, and never reloads
     * the whole SiYuan window.
     */
    reloadActiveDocument(): TabOperationResult {
        const editor = this.getActiveEditorSafe();
        if (!editor) {
            return { status: "unavailable", reason: "no active editor" };
        }
        if (typeof editor.reload !== "function") {
            return { status: "unavailable", reason: "editor has no reload" };
        }
        try {
            editor.reload(false);
            return { status: "executed" };
        } catch (err) {
            return this.toFailedResult(err, "reloadActiveDocument failed");
        }
    }

    /**
     * Restore the most recently closed tab.
     *
     * Delegates entirely to SiYuan's own public plugin API
     * `globalCommand("recentClosed", app)` — the official implementation
     * (app/src/boot/globalEvent/command/global.ts) pops the last entry of
     * `window.siyuan.storage[Constants.LOCAL_CLOSED_TABS]`, persists the
     * updated list, and reopens the tab by its stored type.  This bridge
     * **never reads or writes the closed-tabs storage**, never copies the
     * restore logic, and never calls openFile/fetchPost/setStorageVal on
     * its own.
     *
     * `executed` only means the restore command was handed to SiYuan; the
     * actual tab content may load asynchronously.  We never wait for or
     * poll the DOM, never call the command twice, and never retry on
     * failure.  With an empty closed-tabs list SiYuan still accepts the
     * command (the UI simply shows no change) — we do not probe the
     * storage to detect emptiness.
     */
    restoreRecentlyClosedTab(): TabOperationResult {
        return this.runGlobalCommand("recentClosed", "restoreRecentlyClosedTab failed");
    }

    /**
     * Go back one step in SiYuan's navigation history.
     *
     * Delegates to the public plugin API `globalCommand("goBack", app)`
     * — the official implementation (app/src/boot/globalEvent/command/
     * global.ts) drives SiYuan's own back/forward stack.  This bridge
     * never copies that logic, never reads the internal history stack,
     * never touches `window.siyuan` history data, never simulates
     * browser history or button clicks.  With no history SiYuan may
     * accept the command with no visible change — we do not probe the
     * history to detect emptiness.
     */
    navigateBack(): TabOperationResult {
        return this.runGlobalCommand("goBack", "navigateBack failed");
    }

    /**
     * Go forward one step in SiYuan's navigation history.
     *
     * Same delegation model as {@link navigateBack} via the public
     * `globalCommand("goForward", app)`.
     */
    navigateForward(): TabOperationResult {
        return this.runGlobalCommand("goForward", "navigateForward failed");
    }

    // --------------------------------------------------------------- internals

    /**
     * Run a `globalCommand` action, mapping the outcome to a
     * {@link TabOperationResult}.  Shared by restore/navigate actions.
     */
    private runGlobalCommand(command: string, failureLabel: string): TabOperationResult {
        if (!this.app) {
            return { status: "unavailable", reason: "no app instance" };
        }
        if (typeof globalCommand !== "function") {
            return { status: "unavailable", reason: "globalCommand unavailable" };
        }
        try {
            // The public type declares `void`, but the official
            // implementation returns boolean — only an explicit `false`
            // (unhandled command) is treated as unavailable.
            const accepted: unknown = globalCommand(command, this.app);
            if (accepted === false) {
                return { status: "unavailable", reason: "command not handled" };
            }
            return { status: "executed" };
        } catch (err) {
            return this.toFailedResult(err, failureLabel);
        }
    }

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

    /** Build a `failed` result from a runtime exception (never throws). */
    private toFailedResult(err: unknown, fallback: string): TabOperationResult {
        const error = err instanceof Error ? err.message : String(err);
        return { status: "failed", reason: fallback, error };
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
