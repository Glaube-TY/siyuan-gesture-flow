# Changelog

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

- 85 recognition-pipeline tests (straight lines, sharp folds, reversals,
  short paths, smooth turns with varying density/radius/speed/jitter,
  maximum-segments invalidation, cancelled sessions, empty/single-point paths).
- 20 `MouseGestureAdapter` tests using `happy-dom` (basic state machine,
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
