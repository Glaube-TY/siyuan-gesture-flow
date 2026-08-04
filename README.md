# GestureFlow / 手势流

[中文版](./README.zh-CN.md)

A mouse gesture plugin for [SiYuan Note](https://b3log.org/siyuan).

## Current Status

GestureFlow is under active development. The following is **done**:

- **Mouse input layer** — a PointerEvent-based adapter with a full state machine
  (IDLE → PENDING → TRACKING → COMPLETED/CANCELLED), pointer capture, capture-phase
  listeners, Alt-key suppression, Escape/blur/visibility/cancel handling, and button
  release detection.
- **Direction recognition pipeline** — uniform distance sampling → Ramer–Douglas–Peucker
  simplification → heading-based segmentation → 4/8-direction quantisation → adjacent
  duplicate merging. Supports smooth rounded corners without collapsing them into
  diagonals.
- **Recognition result validation** — gestures that exceed the maximum segment count are
  marked invalid (not truncated), preventing accidental action matches.
- **Automated tests** — covers the recognition pipeline and input adapter.
- **Canvas trajectory overlay** — a fixed full-viewport Canvas renders the live
  mouse trail with DPR-aware scaling, plus a hint element showing the current
  direction sequence (e.g. `R → D`).  Updates are coalesced via
  `requestAnimationFrame`.

The following is **not yet implemented**:

- Action registry and SiYuan-specific actions (tab switching, scrolling, commands, etc.)
- Settings page
- Touchpad / touch input support

## Architecture

```
src/gesture/
  input/
    InputAdapter.ts         Abstract base adapter
    MouseGestureAdapter.ts  Mouse-specific PointerEvent adapter
  recognition/
    PathSampler.ts          Uniform arc-length resampling
    PathSimplifier.ts       RDP simplification + jitter/short-segment removal
    DirectionVectorizer.ts  Heading segmentation + direction quantisation
    DirectionMatcher.ts     Adjacent-duplicate merging
    recognition.test.ts     Pipeline tests
  overlay/
    GestureOverlay.ts       Canvas trail + hint element
    overlay.test.ts         Overlay tests
    types.ts                Overlay-specific types
  GestureEngine.ts         Orchestrates the full pipeline
  GestureSession.ts        Per-gesture state + point accumulation
  GestureFeedbackController.ts  RAF coalescing + live recognition
  types.ts                 Shared types and enums
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### Setup

```bash
pnpm install
```

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Watch-mode build with inline sourcemaps (dev deployment mirror) |
| `pnpm build` | Production build → `dist/` + `package.zip` |
| `pnpm check` | TypeScript / Svelte type-check |
| `pnpm test` | Run all vitest tests |
| `pnpm verify` | Verify `dist/` and `package.zip` contain required files and no forbidden files |
| `pnpm make-install` | Build + copy to SiYuan plugin directory |

### Dev Deployment

This plugin uses a **real directory mirror** deployment model (not symbolic links).
Run `pnpm dev:setup` once to configure the target SiYuan `data/plugins` directory,
then `pnpm dev` will sync changes on every rebuild.

## Packaging

`pnpm build` produces `package.zip` containing:

- `index.js` — bundled plugin entry
- `index.css` — styles (if any)
- `plugin.json` — plugin metadata
- `icon.png`, `preview.png`
- `i18n/*.json`
- `README*.md`

This plugin is a **Frontend Plugin only** — it does not include `kernel.js`.

## License

MIT
