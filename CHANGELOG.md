# Changelog

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
- **Scroll fix**: `scrollActiveDocument` now calls `getActiveEditor(true)` to obtain
  the **Protyle wrapper**, then accesses `editor.protyle.scroll.element` (falling
  back to `editor.protyle.contentElement`).  The previous implementation incorrectly
  read `editor.scroll` / `editor.contentElement` directly from the wrapper, which
  do not exist on the official `Protyle` type — scrolling was silently unavailable.
  Scroll target for "top" is `0`; for "bottom" it is `scrollEl.scrollHeight`.
  Falls back to `scrollTop` assignment when `scrollTo` is missing.
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
