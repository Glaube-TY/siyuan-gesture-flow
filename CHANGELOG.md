# Changelog

## Stage 6B-3 — Simplified shortcut UI, user-facing README, navigation actions

- **Shortcut UI**: the two long tutorial paragraphs (compatibility +
  context hints) were removed from the settings screen; the bindings
  description was trimmed to one line; the capture field now takes a
  full row (100 % width, ~52 px, centered, 16 px, slightly heavier
  weight) with a theme-primary capturing state (`gf-shortcut-input--
  capturing`), and Clear / Test buttons moved to a right-aligned second
  row so they never squeeze the input.  Empty state shows "Click, then
  press a key combination" instead of "No shortcut set".  All styles are
  component-scoped with `gf-` classes — no global overrides.  A stale
  test-result message is cleared on re-capture, clear, and
  implementation-type switch.  The compatibility explanation moved to
  README "Shortcut compatibility".
- **README**: both README.md and README.zh-CN.md were rewritten as
  user-oriented documentation (intro, capabilities, quick start, how to
  draw, implementation types, built-in actions table, shortcut
  compatibility, settings, FAQ, roadmap, contributing, license).  All
  developer-oriented content (state machines, class wiring, architecture
  tree, migration internals, stage numbering) was removed from the README
  body.
- **`navigation.back` / `navigation.forward`** (group **Navigation**):
  delegate to the public `globalCommand("goBack" | "goForward", app)`;
  no default gestures, no reading of SiYuan's internal history, no
  browser-history simulation.
- No config version change (stays **2**); default bindings unchanged
  (L/R/U/D); plugin.json / package.json descriptions updated to
  user-facing text.
- New i18n keys: `cmdNavigationBack`, `cmdNavigationForward`,
  `cmdGroupNavigation` (zh + en); removed `shortcutEmpty`,
  `shortcutCompatibilityHint`, `shortcutContextHint`.

## Stage 6B-2 — Restore recently closed tab

- **`tabs.restoreRecent` — Restore Recently Closed Tab** (group **Tabs**):
  delegates to SiYuan's public plugin API `globalCommand("recentClosed",
  app)` — the official implementation pops the last entry of
  `window.siyuan.storage[Constants.LOCAL_CLOSED_TABS]`, persists the
  updated list and reopens the tab by its stored type.  GestureFlow never
  reads or writes the closed-tabs storage, never copies the restore logic,
  never polls the DOM, and never retries.  `executed` only means the
  restore command was handed to SiYuan; with an empty history SiYuan
  accepts the command with no visible change.
- **App injection**: `GestureFlowPlugin` captures `options.app` in an
  explicit constructor (`ConstructorParameters<typeof Plugin>[0]`, verified
  against the official loader `new pluginClass({ app, name, displayName,
  i18n })`), forwards it to `GestureFlowRuntime`, which passes it to
  `SiyuanActionBridge` as a nullable provider.  Probe/test bridges simply
  omit it and restore returns `unavailable`.  No private field access, no
  `window.siyuan` storage probing.
- No default gesture (users bind their own trajectory); config version
  stays **2**; the six existing command ids are unchanged.
- New i18n key: `cmdTabsRestoreRecent` (zh + en).
- Documentation accuracy pass: the 6B-1 claims that `tabs.close` only
  closes "normal document tabs" and that `document.reload` always returns
  `unavailable` for non-document tabs were removed — neither method applies
  model-type filtering.

## Stage 6B-1 — Close tab & reload document actions

- **ShortcutRecorder focus fix**: capture now ends immediately on input
  blur (previously a stale `pointerDownInside` flag could swallow the
  first blur after clicking another control).  Blur never modifies the
  shortcut, emits `change`, or clears the draft; `disabled` also exits
  capture and sets the real `disabled` attribute on the input.
- **`tabs.close` — Close Current Tab** (group **Tabs**): closes the tab
  `getActiveTab(true)` resolves to in the active window via the official
  public chain `getActiveTab(true)` → `tab.parent.removeTab(tab.id)`.
  Dock panels, block popovers and floating layers outside the active
  Wnd's tab system are never handled; **no model-type filtering is
  applied** (the tab may or may not be an Editor).  No tab DOM is
  touched, no close-button click or shortcut is simulated.
- **`document.reload` — Reload Current Document** (group **Document**):
  reloads the Protyle `getActiveEditor(true)` resolves to (mainly the
  current document editor; embedded-Protyle contexts may resolve
  elsewhere — no model-type filtering) via `editor.reload(false)` (the
  official Protyle wrapper; `focus=false` avoids stealing editor focus).
  Returns `unavailable` when there is no active Protyle; no HTTP API, no
  window reload.
- Both new commands have **no default gestures** — users bind them
  manually in the Bindings tab.  Config version stays **2** (no schema
  change); the four original commands and default bindings are
  unchanged.
- New i18n keys: `cmdTabsClose`, `cmdDocumentReload`, `cmdGroupDocument`
  (zh + en).

## Stage 6A — Shortcut binding actions, config v2, extensible action model

### Unified binding action model (config version 2)

- Bumped `CURRENT_CONFIG_VERSION` to 2.  `ConfigBinding` no longer carries
  top-level `commandId` / `commandParams`; it now holds a single `action`:
  - `BuiltinBindingAction { type: "builtin", commandId, commandParams }`
  - `ShortcutBindingAction { type: "shortcut", shortcut: ShortcutSpec }`
- JavaScript is deliberately NOT a persistent action type — it exists only
  as a disabled "in development" option in the settings UI and can never be
  saved, imported, or executed.
- Pure-function v1 → v2 migration: legacy top-level `commandId` /
  `commandParams` are wrapped into `builtin` actions; binding id / enabled /
  directions are preserved; empty bindings stay empty; missing `bindings`
  stays missing (defaults are filled by the validator).  Version-less early
  dev configs with legacy fields are migrated too; version-less v2-shaped
  configs are stamped with the current version.
- Migration is now explicitly recognised: `migrateAndValidate` reports
  `migrated: true`, `ConfigManager` persists the v2 payload and returns
  `source: "migrated"`, so the next load skips migration.

### Keyboard shortcuts

- `src/shortcuts/` — strict serialisable `ShortcutSpec` (key / code /
  keyCode + four modifier flags; no events, DOM nodes or functions).
- Single source of truth for shortcut keys: canonical forms (lowercase
  letters, exact spec names for `F6` / `ArrowLeft` / `Home` / `Enter` /
  `Tab` / …), with `isSupportedShortcutKey`, `normalizeShortcutSpec` and
  `validateShortcutSpec` shared by capture, config validation and
  binding-draft validation.  Conflicting key/code/keyCode triples and
  `keyCode: 0` are rejected; `keyCode` must match the key/code mapping.
- `ShortcutExecutor` dispatches a synthetic `keydown` to the current
  `activeElement` (falling back to `document`); `keyCode`/`which` are filled
  on the instance only (never the prototype); `isTrusted` is never forged.
  Results: `dispatched` / `unavailable` / `failed`.  Synthetic events cannot
  activate plugins that reject non-trusted events (documented limitation).
- `ShortcutRecorder` captures shortcuts (pure modifiers ignored, Escape
  cancels, Backspace/Delete clear), and a test button dispatches the draft
  through the same executor without saving.
- Cross-platform display via `detectShortcutPlatform()`: Windows/Linux
  `Ctrl+Shift+P` / `Alt+Left`; macOS `⌃⇧P` / `⌥Left`.

### Architecture

- `GestureBindingRegistry` is action-agnostic (direction matching only).
- `GestureCommandDispatcher` was replaced by `GestureActionExecutor` —
  dispatch by `action.type` (builtin → CommandExecutor, shortcut →
  ShortcutExecutor), with cross-type per-session de-duplication.
- `CommandLabelResolver` shows localised command titles / shortcut strings;
  the overlay renders the correct action label.
- Settings dialog destroy is now per-instance idempotent (wrapped instance
  `destroy`, stale-callback safe) — no double `Dialog.destroy()` /
  `SettingsPanel.$destroy()`.

### Testing & release process

- Test suite reduced from 26 files / ~10.8k lines to a small permanent
  smoke suite under `tests/smoke/` (pure logic only: recognition, config
  migration, shortcut utils, binding operations).
- `pnpm check` type-checks production code only (tsconfig excludes tests);
  `pnpm build` and `pnpm verify` (incl. `dist/index.css` style isolation)
  come before `pnpm test:smoke`.  Real SiYuan manual testing covers UI /
  pointer / lifecycle behaviour.

---

## Stage 5A — Versioned configuration, persistence, settings page, and runtime reload

> Historical stage record.  Superseded by Stage 6A: the config version is now
> **2**, the settings page runs in a custom Dialog (not `Setting.addItem`),
> bindings support add/edit/delete/toggle + recording with builtin **and**
> shortcut actions, and the test suite was reduced to the `tests/smoke/`
> suites.  The notes below describe the 5A-era shape.

### Versioned configuration model

- Added `src/config/types.ts` — strictly-typed config schema with `version`,
  `enabled`, `trigger` (button, activationDistance, suppressionKey, timeoutMs),
  `recognizer` (sampleDistance, simplifyTolerance, minimumSegmentLength,
  turnAngleThreshold, maximumSegments, directionMode), `overlay` (showTrail,
  showHint, lineWidth), and `bindings` array.  Uses explicit union types for
  `suppressionKey` (`Alt | Control | Shift | Meta | null`) and `directionMode`
  (`4 | 8`); no `any`, `as never`, or `ts-ignore`.
- Added `src/config/defaults.ts` — `createDefaultConfig()` returns a fresh
  independent deep copy on every call; `deepCloneConfig()` recursively clones
  bindings, directions, and commandParams so external mutation cannot pollute
  subsequent instances.  Default values match the pre-5A hard-coded behaviour:
  button 2, activationDistance 16, suppressionKey Alt, timeoutMs 2000,
  sampleDistance 4, simplifyTolerance 2.8, minimumSegmentLength 18,
  turnAngleThreshold 42, maximumSegments 6, directionMode 4, showTrail true,
  showHint true, lineWidth 3, bindings L/R/U/D.
- Added `src/config/validate.ts` — unified validation + normalisation entry.
  Validates version (supported integer), enabled (boolean), button (only 2
  in v1), activationDistance (4–100), suppressionKey (Alt/Control/Shift/Meta/null),
  timeoutMs (0–10000), sampleDistance (>0), simplifyTolerance (≥0),
  minimumSegmentLength (>0), turnAngleThreshold (1–89), maximumSegments
  (positive integer), directionMode (4 or 8), lineWidth (1–20), bindings
  (array, non-empty unique ids, non-empty legal non-repeating direction
  sequences, commandId present in the injected available-command set,
  commandParams plain object, enabled boolean).  Missing fields are filled
  from defaults; out-of-range numbers are clamped; type errors / duplicate
  bindings / unknown directions / unknown commands are rejected.  Result is
  `valid` | `normalized` | `invalid` with the default config as fallback.
  No new runtime validation dependency.
- Added `src/config/migrations.ts` — version detection (`detectVersion`),
  migration framework (`registerMigration`), and `migrateAndValidate` that
  runs detect → migrate → normalise → validate in sequence.  Unknown future
  versions are refused (no forced downgrade).  Migration functions are pure;
  they never call `saveData`.  *(Historical 5A note: version 1 had no real
  migrations — Stage 6A added the v1 → v2 migration.)*

### ConfigManager and persistence

- Added `src/config/ConfigManager.ts` — the single owner of the in-memory
  config snapshot.  Uses the verified SiYuan `Plugin.loadData` / `saveData` /
  `removeData` API (verified via `node_modules/siyuan/siyuan.d.ts`).
  `loadData` returns `null` when the storage file does not exist — this is
  treated as "first run" and falls back to defaults without error.
  - Storage name: stable constant `gesture-flow-config`.
  - `load()` is idempotent (returns the same promise on repeated calls).
  - `getConfig()` returns an independent deep copy — external code cannot
    mutate the internal state.
  - `replaceConfig()` / `updateConfig()` validate the candidate before
    persisting; on validation failure the previous config is preserved.
  - `reset()` restores defaults and persists.
  - `exportJson()` / `importJson()` — imports go through the same migration
    + validation pipeline as the initial load; invalid imports do not
    overwrite the current config.  Exports contain no tokens, workspace
    paths, DOM objects, events, or sessions.
  - `subscribe()` / `destroy()` — subscribers receive independent snapshots;
    `destroy()` tears down subscriptions and rejects pending saves.
  - Save serialisation: a single `saveChain` promise ensures last-write-wins
    with no concurrent `saveData` calls.  On persistence failure the
    in-memory state is rolled back to stay consistent with the last
    successfully saved data.

### Runtime manager

- Added `src/runtime/GestureFlowRuntime.ts` — encapsulates the full lifecycle
  of CommandRegistry, SiyuanActionBridge, built-in commands,
  GestureBindingRegistry, CommandExecutor, GestureCommandDispatcher,
  GestureEngine, GestureOverlay, GestureFeedbackController, and
  MouseGestureAdapter.
  - `start(config)` is idempotent; `stop()` is idempotent.
  - `restart(newConfig)` fully stops the old runtime first (adapter.detach,
    controller.destroy, overlay.destroy, clear timers and replay tokens),
    then starts with the new config.  At most one Adapter and one Overlay
    exist at any time.
  - `enabled = false` skips mounting input listeners and Overlay; the
    runtime enters a `disabled` state and can be re-enabled via `restart`.
  - Restart failure rolls back to the previous working config.
  - `index.ts` now only constructs ConfigManager, Runtime, and settings UI —
    no manual component wiring.

### Config-driven modules

- `MouseGestureAdapter` accepts `trigger` config (button,
  activationDistance, suppressionKey, timeoutMs).
- `GestureEngine` accepts `recognizer` config (sampleDistance,
  simplifyTolerance, minimumSegmentLength, turnAngleThreshold,
  maximumSegments, directionMode).
- `GestureOverlay` accepts `overlay` config (showTrail, showHint, lineWidth)
  via constructor and `updateConfig()`.  `showTrail = false` suppresses
  Canvas drawing but recognition continues.  `showHint = false` suppresses
  the hint element but recognition continues.  Both off — commands still
  execute.

### Settings page

- Added `src/settings/SettingsPanel.svelte` — Svelte settings dialog.  In 5A
  it was mounted via the official SiYuan `Setting` class with a custom
  HTMLElement; **Stage 6A runs it in a custom full-screen Dialog** instead.
  - Tabs: General (enable, suppression key, activation distance, timeout),
    Recognition (direction mode, sample distance, simplify tolerance,
    minimum segment length, turn angle threshold, maximum segments),
    Display (show trail, show hint, line width), Bindings (5A-era: only
    enable/disable the four default bindings; **Stage 6A adds full
    add/edit/delete/toggle + gesture recording + builtin/shortcut actions**),
    Data (export, import, reset).
  - All user-facing strings come from i18n (`en.json` / `zh-CN.json`); no
    hardcoded Chinese in TypeScript or Svelte logic.
  - Numeric inputs use string buffers with explicit min/max/step; values are
    parsed and clamped on blur or debounce flush.  Invalid values show an
    inline error and are not saved.
  - Rapid edits are debounced (400 ms) and merged via
    `DebouncedPatchScheduler` so the runtime is not restarted on every
    keystroke.  Component destroy flushes pending patches and clears the
    timer + subscription.
  - Import validates before applying; invalid import does not overwrite the
    current config.  Reset requires confirmation.
- Added `src/settings/settingsHelpers.ts` — pure helpers extracted from the
  Svelte component for unit testing: `parseNumber` (input validation +
  clamping) and `DebouncedPatchScheduler` (debounce + patch merging).

### Input layer preservation

- The existing right-click contextmenu state machine is unchanged.  Runtime
  `restart` calls `adapter.detach()` so old protection timers and replay
  microtasks fail safely via the detach generation mechanism.  No double
  listeners, no double Canvas, no residual contextmenu protection.

### Testing

- Config tests: defaults deep-clone (7), validation valid/missing/out-of-range/
  type-error/duplicate-bindings/unknown-command (28), migration framework (13),
  ConfigManager load/save/update/reset/import/export/subscribe/destroy/
  serial-save/deep-copy (29).
- Runtime tests: state machine, enabled toggle, restart (stop-then-start,
  rapid restart), config changes, binding enable/disable, stop-then-restart (19).
- Settings helper tests: parseNumber valid/invalid/clamp, DebouncedPatchScheduler
  basic/merge/destroy/flush (30).
- Overlay tests extended for config-driven behaviour (showTrail, showHint,
  lineWidth, updateConfig) (54).
- Total: 495 tests passing across 17 test files.  *(Historical count — the
  Stage 6A cleanup reduced the suite to the permanent `tests/smoke/`
  pure-logic suites; these per-stage counts no longer reflect the repo.)*

## Stage 4 stabilization — contextmenu coordination and document scrolling fix

### contextmenu coordination ("capture first, replay later")

- **Problem**: the previous `contextmenu` suppression only took effect once a session
  reached TRACKING.  In real SiYuan (Windows / Electron) the `contextmenu` event may
  fire *before* the pointer has moved past the activation threshold (e.g.
  `pointerdown → contextmenu → pointermove → pointerup`), so the menu appeared
  mid-gesture and could not be retroactively hidden.
- **New model**: `MouseGestureAdapter` now intercepts **every** `contextmenu` that
  arrives while a right-click session is active (PENDING or TRACKING).  The listener
  is registered on `window` in the **capture phase** so it runs before SiYuan's own
  document/element handlers.
  - Active session → `preventDefault` + `stopPropagation` + `stopImmediatePropagation`,
    save a minimal snapshot (clientX/Y, screenX/Y, modifier keys, target).
  - Session ends as plain right-click (PENDING, no gesture) → replay the snapshot
    **exactly once** via a microtask so the normal SiYuan menu appears.  Replay target
    resolution: original target → `document.elementFromPoint` → `document.body`.
  - Session reaches TRACKING and completes or is cancelled → discard the snapshot;
    no menu appears.
  - Alt-suppressed right-clicks never create a session, so their `contextmenu` passes
    through untouched.
- **Recursion guard**: replayed events are marked with a private `WeakSet<Event>` so
  the adapter does not re-intercept its own replay.  No double menu, no left-click
  synthesis, no DOM menu hiding, no text-selection clearing.

### Document scrolling fix

- **Problem**: `scrollActiveDocument` used `editor.protyle.scroll.element` as the
  scroll container.  That element is `protyle-scroll__bar` — the **block-index
  slider**, not the document scroll container.  Setting its `scrollTop` had no effect
  on the document, so U/D gestures showed a trail and command hint but never scrolled.
- **Fix**:
  - **Priority 1 — official control**: locate the current editor's
    `protyle-scroll__up` / `protyle-scroll__down` button via
    `editor.protyle.scroll.element.parentElement.querySelector(...)`, then call
    `click()`.  This reuses SiYuan's `goHome` / `goEnd` logic, which handles dynamic
    block loading for long documents.  The query is scoped to the current editor's
    scroll control only — never crosses into other splits or windows.
  - **Priority 2 — content fallback**: if the official buttons are unavailable (or
    their `click()` throws), fall back to `editor.protyle.contentElement` — the real
    document scroll container.  Top → `scrollTo({top: 0})`; bottom →
    `scrollTo({top: scrollHeight})`.  Falls back to `scrollTop` assignment when
    `scrollTo` is missing.
  - `scroll.element` is **never** used as a scroll container — no `scrollTo`, no
    `scrollTop` writes on it.  It is used only to locate the official scroll control
    via `parentElement`.
- **Result type**: `ScrollResult` now reports `method: "official-control" |
  "content-fallback"` so callers (and dev-mode logs) can distinguish the path taken.

### Testing

- Rewrote `MouseGestureAdapter.test.ts` contextmenu scenarios (A–G + edge cases):
  - A: contextmenu before move, gesture forms → intercepted, no replay, no menu.
  - B: contextmenu before pointerup, plain right-click → replayed exactly once,
    correct target / coords / modifiers, no recursive interception, no left-click.
  - C: contextmenu after pointerup (natural order) → no early replay, passes through,
    single menu.
  - D: sub-threshold move with intercepted contextmenu → single replay on pointerup.
  - E: Alt suppression → no session, contextmenu passes through.
  - F: TRACKING + Escape / pointercancel / window-blur → cancelled, no replay.
  - G: detach during PENDING with intercepted contextmenu → no residual snapshot /
    replay task / listener.
  - Edge: L-direction gesture fully suppresses menu; replay event not re-intercepted.
- Rewrote `SiyuanActionBridge.test.ts` scroll fixtures to match the official DOM
  structure: `scroll.element` is `protyle-scroll__bar` (no scrollTo/scrollTop),
  `scroll.element.parentElement` is `protyle-scroll` containing `__up` / `__bar` /
  `__down`; `contentElement` is the real scroll container.  Tests cover:
  official-control click (top/bottom), no cross-split lookup, content-fallback
  (top=0, bottom=scrollHeight), never call `scroll.element.scrollTo`,
  never write `scroll.element.scrollTop`, `scrollTo`-missing fallback, official
  click-throw safe fallback, unavailable cases (no editor / no protyle / no control
  and no contentElement / `getActiveEditor` throws), `getActiveEditor(true)` arg,
  old wrong `editor.scroll` structure rejected.

### Documentation

- `README.md` / `README.zh-CN.md`: corrected the bridge description — no longer
  claims `editor.protyle.scroll.element` is the document scroll container; explains
  it is the block-index slider, that `contentElement` is the direct scroll container,
  and that the official `__up` / `__down` buttons reuse SiYuan's `goHome` / `goEnd`.
- Added contextmenu coordination mechanism description to the mouse input layer
  section.

## Stage 4 — Command registry, gesture bindings, and safe actions

### Command system

- Added `CommandRegistry` with atomic `registerMany` (two-phase validate-then-commit
  so a duplicate id in the middle of a batch leaves nothing registered).
- Added `CommandExecutor` with per-session de-duplication (bounded LRU set), uniform
  `CommandExecutionResult` semantics, and try/catch that converts both sync throws
  and async rejections into `failed` results — no unhandled promise rejections.
- Added `GestureCommandDispatcher` — the single decision point between a completed
  `GestureSession` + `RecognitionResult` and `CommandExecutor`.  Validates session
  state (COMPLETED only), result validity (valid + non-empty directions + null
  invalidReason), binding existence and enabled state before dispatching.  Re-uses
  the same `RecognitionResult` produced by `GestureFeedbackController` — never
  re-invokes `engine.recognize`.

### SiYuan action bridge

- Added `SiyuanActionBridge` — centralises **all** SiYuan API/DOM access.  No HTTP,
  no token, no workspace paths.
- **Scroll fix (initial)**: `scrollActiveDocument` now calls `getActiveEditor(true)`
  to obtain the **Protyle wrapper**, then accesses `editor.protyle`.  The previous
  implementation incorrectly read `editor.scroll` / `editor.contentElement` directly
  from the wrapper, which do not exist on the official `Protyle` type — scrolling was
  silently unavailable.  *(Note: this initial version still treated
  `editor.protyle.scroll.element` as the scroll container, which turned out to be
  incorrect — see the "Stage 4 stabilization" section above for the corrected
  approach using the official `protyle-scroll__up` / `__down` buttons and
  `contentElement` fallback.)*
- **Tab switching**: `switchAdjacentTab` uses `getActiveTab(true)` → `tab.parent`
  (Wnd) → `wnd.children` to find the current index, then
  `wnd.switchTab(targetTab.headElement, true)`.  The `pushBack=true` argument
  matches the official SiYuan click handler, allowing history navigation back to
  the previous tab.  No wrap-around (returns `noop` at edges); never crosses split
  panes or windows.

### Gesture bindings

- Added `GestureBindingRegistry` — maps direction sequences to commands with:
  - ID uniqueness (empty / whitespace-only ids rejected; duplicate ids rejected).
  - Duplicate direction-sequence rejection.
  - Dual index (by direction key and by id) backed by a single authoritative record.
  - `setEnabled` / `setEnabledById` keep both indices consistent.
  - Deep-copy immutability: `list()`, `resolve()`, and `getById()` return defensive
    copies of `directions` and `commandParams`; external mutation cannot affect the
    internal state.
  - Atomic `registerMany` (validate-then-commit).
- Default bindings: `L → tabs.previous`, `R → tabs.next`, `U → scroll.top`,
  `D → scroll.bottom`.

### Command context snapshot

- `buildCommandContext` produces a fully isolated snapshot: `directions` array is
  copied, every point is copied, `start` / `end` are independent objects (not
  references into `session.points`).  `invalidReason` retains the precise
  `InvalidReason` union type.  No live `GestureSession` reference, no DOM objects,
  no event objects are retained.

### Async callback error handling

- `GestureFeedbackController.onGestureComplete` callback type now accepts
  `void | Promise<void>`.  Sync throws and async rejections are both caught via
  `try/catch` + `Promise.catch` and routed to an injectable `onCallbackError`
  handler.  The overlay's final-frame feedback is shown immediately and never
  blocks on command execution.  No unhandled promise rejections.

### index.ts cleanup

- Removed `as never` casts and hand-written pseudo-types from `handleGestureComplete`.
  The method now receives the real `GestureSession` and `RecognitionResult` types.
- Dev logging limited to `sessionId`, `commandId`, and `status` — no full i18n
  objects, no DOM, no point arrays, no credentials.

### Testing

- Added `GestureCommandDispatcher.test.ts` (21 tests): happy path, de-duplication,
  state guards (CANCELLED, TRACKING), result guards (invalid, empty, too-many-segments,
  cancelled), binding guards (no binding, disabled), command-not-found, sync/async
  commands, sync throw → failed, async reject → no unhandled rejection, context
  snapshot isolation, strict direction matching (D-R / R-D).
- Added `types.test.ts` (10 tests): CommandContext snapshot isolation for
  directions, points, start/end, invalidReason type constraint.
- Extended `GestureBindingRegistry.test.ts` (30 tests): ID management, immutability,
  atomic registerMany.
- Extended `SiyuanActionBridge.test.ts` (20 tests): real Protyle wrapper structure,
  `editor.protyle.scroll.element` priority, `contentElement` fallback, old
  `editor.scroll` structure not mistaken for the official API, no-protyle /
  no-scroll-element / `scrollTo`-missing / `getActiveEditor`-throws cases,
  `getActiveEditor(true)` / `getActiveTab(true)` called with current-window arg.
- Extended `feedback.test.ts` (21 tests): onComplete reuses the same
  RecognitionResult (no re-recognition), cancel does not trigger callback, duplicate
  onComplete does not re-callback, async callback failure safely caught, sync
  callback throw safely caught, overlay not blocked by command promise.

## Stage 3 — Gesture trail and live feedback

### Canvas trajectory overlay

- Added `GestureOverlay` — a fixed full-viewport Canvas (`position: fixed`,
  `inset: 0`, `pointer-events: none`, `aria-hidden="true"`) that renders the
  live mouse trail as a rounded polyline.
- DPR-aware: internal pixel dimensions scale with `devicePixelRatio`; CSS
  dimensions track `window.innerWidth`/`innerHeight`.  Resize listener keeps
  the Canvas in sync across display changes.
- Trail colour reads the SiYuan CSS theme variable `--b3-theme-primary` at
  draw time with a stable fallback, so both light and dark themes are
  readable.
- Canvas creation and destruction are idempotent; repeated mount/unmount cycles
  leave no duplicate elements.

### Live hint element

- A long-lived `position: fixed` hint `<div>` follows the last trail point,
  showing the current direction sequence (e.g. `R → D`).
- Hint flips/clamps near window edges so it never overflows the viewport.
- Uses `textContent` only (no `innerHTML`); hint colours use CSS `var()`
  with SiYuan theme variables (`--b3-theme-on-background`,
  `--b3-theme-surface`, `--b3-theme-primary-light`) and stable fallbacks,
  so the browser re-resolves colours automatically on theme switch.
- `white-space: pre-line` and `max-width` allow the future `commandLabel`
  to wrap onto a second line without using `innerHTML`.
- `commandLabel` field reserved for the future action system; currently `null`.

### RAF coalescing controller

- Added `GestureFeedbackController` — bridges `MouseGestureAdapter` events,
  `GestureEngine`, and `GestureOverlay`.
- `onUpdate` saves the latest session snapshot and schedules at most one
  `requestAnimationFrame` per frame; multiple moves within the same frame are
  coalesced into a single redraw + recognition pass.
- Pending RAF is cancelled on destroy; final-frame updates are flushed on
  complete/cancel so the end point is always drawn.

### Status display

- TRACKING: shows the live direction sequence.
- Too-many-segments: shows a localised "gesture too long" message.
- Cancel: hint hides immediately.
- Complete: final result shown for ~300ms then hidden.
- Empty/short: no hint shown (preserves normal right-click UX).
- All user-facing strings live in `i18n/zh-CN.json` and `i18n/en.json`;
  direction letters (`R/D/L/U`) are not translated.

### Lifecycle

- `index.ts` wires `MouseGestureAdapter` → `GestureFeedbackController` →
  `GestureOverlay` + `GestureEngine`.
- `onunload` detaches the adapter, destroys the controller/overlay, cancels
  RAF and timers, and removes all DOM elements.
- Production builds no longer log per-move session data; dev mode retains
  concise debug logging.

### Timer competition fix

- `GestureFeedbackController.onStateChange(PENDING)` now cancels stale hide
  timers and clears the previous gesture's trail, so a new gesture starting
  during the previous gesture's ~300 ms hide-delay window is never hidden
  by the old timer.
- `GestureOverlay.show()` defensively cancels any pending hide timer.
- At most one hide timer exists at any time; `showFinalThenHide` cancels
  the previous timer before setting a new one.

### Resize hint repositioning

- On window resize, the hint is repositioned using the latest `OverlayState`
  so it stays within the new viewport bounds.

### Build verification

- `verify_build.js` now scans text files (`.js`, `.json`, `.md`, `.css`,
  `.html`, `.txt`) in both `dist/` and `package.zip` for hardcoded
  credentials (`Authorization: token ...`, `SIYUAN_API_TOKEN=...`, generic
  API key patterns).  Placeholders like `<TOKEN>` and `YOUR_TOKEN` are
  excluded.  Matched values are never printed.

### Testing

- Overlay tests cover element creation/idempotency, Canvas property checks,
  DPR scaling, resize handling, Canvas drawing calls (via mock
  `CanvasRenderingContext2D`), hint positioning with realistic
  `getBoundingClientRect` mocks, edge clamping (right/bottom/left-top/tiny
  window), theme variable usage, commandLabel wrapping, timer competition
  (via Vitest fake timers), and unload cleanup.
- FeedbackController tests cover RAF coalescing, lifecycle, PENDING
  invisibility, and timer competition scenarios (consecutive gestures,
  immediate PENDING after complete, three-gesture sequence, cancel/destroy
  timer cleanup).

## v0.1.0 — Stage 1-2 stabilization

### Input layer

- Implemented `MouseGestureAdapter` with a full state machine
  (IDLE → PENDING → TRACKING → COMPLETED/CANCELLED).
- All pointer listeners use the **capture phase** so gestures are observed
  before SiYuan's own handlers.
- Added `lostpointercapture`, `window.blur`, `visibilitychange`, and Escape
  cancellation paths.
- Alt key temporarily disables gestures; non-mouse `pointerType` is ignored.
- Trigger-button release detection via `buttons` mask.
- Pointer Capture lifecycle managed correctly; idempotent `attach()`/`detach()`.
- Adapter and Session use **config copies** to isolate active sessions from
  external config mutations.

### Recognition pipeline

- Replaced per-point local-angle simplification with **Ramer–Douglas–Peucker**
  (RDP), preserving smooth arc shape instead of collapsing it into a diagonal.
- Fixed `removeJitter` to only skip the jitter point B, keeping C for
  re-evaluation — previous `i += 2` unconditionally discarded C.
- Added `simplifyTolerance` config (default 2.8 px).
- Pipeline: raw points → uniform sampling → RDP → jitter removal →
  short-segment merging → heading segmentation → direction quantisation →
  adjacent-duplicate merging.
- Smooth rounded turns (R→D, R→U, L→D, L→U) now correctly recognised across
  varying arc point counts (10–90), radii (30–100 px), speeds, and jitter.

### Recognition result validation

- `RecognitionResult` now carries `valid`, `invalidReason`, `rawDirections`,
  and `directions`.
- Gestures exceeding `maximumSegments` are **invalidated** (not truncated),
  with `rawDirections` preserved for debugging and `directions` emptied.
- `InvalidReason` is a strict union type: `too-short | too-many-segments |
  cancelled | empty`.
- Cancelled sessions produce `valid === false` with `invalidReason: "cancelled"`.

### Testing

- Recognition-pipeline tests (straight lines, sharp folds, reversals,
  short paths, smooth turns with varying density/radius/speed/jitter,
  maximum-segments invalidation, cancelled sessions, empty/single-point paths).
- `MouseGestureAdapter` tests using `happy-dom` (basic state machine,
  contextmenu suppression, all cancel paths, Alt suppression, pointerType
  filter, pointerId filter, button-release detection, idempotent attach/detach,
  timer cleanup, CANCELLED not executable).

### Build & engineering

- `emptyOutDir` set to `true` — stale `dist/` files removed on every build.
- Removed non-existent `docs/*.md` glob from static copy and watch patterns.
- Added `scripts/verify_build.js` — checks `dist/` and `package.zip` for
  required files (index.js, plugin.json, icon.png, preview.png, i18n/*.json,
  README*.md) and forbidden files (kernel.js, .env, .siyuan-dev-target.json,
  template leftovers).
- `.gitignore` no longer ignores `pnpm-lock.yaml`.
- Added `packageManager: pnpm@10.14.0` to `package.json`.
- TypeScript `strict: true` enabled.
- CI workflow updated: pnpm 10, `--frozen-lockfile`, runs
  `pnpm check → pnpm test → pnpm build → pnpm verify`.

### Documentation & metadata

- Rewrote `README.md` and `README.zh-CN.md` to reflect actual project state.
- Updated `plugin.json` and `package.json` metadata (author, repository, URL).
- No longer describes Kernel Plugin, symbolic-link deployment, or template
  boilerplate.
