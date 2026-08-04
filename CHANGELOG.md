# Changelog

## Stage 3 — Gesture trail and live feedback

### Canvas trajectory overlay

- Added `GestureOverlay` — a fixed full-viewport Canvas (`position: fixed`,
  `inset: 0`, `pointer-events: none`, `aria-hidden="true"`) that renders the
  live mouse trail as a rounded polyline.
- DPR-aware: internal pixel dimensions scale with `devicePixelRatio`; CSS
  dimensions track `window.innerWidth`/`innerHeight`.  Resize listener keeps
  the Canvas in sync across display changes.
- Trail colour reads SiYuan CSS theme variables (`--b3-theme-primary`,
  `--b3-theme-on-primary`, `--b3-theme-background`) with stable fallbacks, so
  both light and dark themes are readable.
- Canvas creation and destruction are idempotent; repeated mount/unmount cycles
  leave no duplicate elements.

### Live hint element

- A long-lived `position: fixed` hint `<div>` follows the last trail point,
  showing the current direction sequence (e.g. `R → D`).
- Hint flips/clamps near window edges so it never overflows the viewport.
- Uses `textContent` only (no `innerHTML`); styles use SiYuan CSS variables.
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

### Testing

- Added overlay + integration tests covering element creation/idempotency,
  DPR scaling, resize, RAF coalescing, hint positioning, status display,
  complete/cancel hiding, and unload cleanup.

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
