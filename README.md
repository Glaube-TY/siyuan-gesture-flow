# GestureFlow / 手势流

[中文版](./README.zh-CN.md)

A mouse gesture plugin for [SiYuan Note](https://b3log.org/siyuan).

## Current Status

GestureFlow is under active development. The following is **done**:

- **Mouse input layer** — a PointerEvent-based adapter with a full state machine
  (IDLE → PENDING → TRACKING → COMPLETED/CANCELLED), pointer capture, capture-phase
  listeners, Alt-key suppression, Escape/blur/visibility/cancel handling, and button
  release detection.  Uses a **"capture first, replay later"** `contextmenu`
  coordination model: every `contextmenu` that arrives while a right-click session is
  active is intercepted on `window` (capture phase); if the session ends as a plain
  click (PENDING), the event is replayed exactly once via a microtask so the normal
  SiYuan menu appears; if a gesture forms (TRACKING) or is cancelled, the snapshot is
  discarded and no menu appears.  Replayed events are marked with a `WeakSet` to
  prevent recursive interception.
- **Direction recognition pipeline** — uniform distance sampling → Ramer–Douglas–Peucker
  simplification → heading-based segmentation → 4/8-direction quantisation → adjacent
  duplicate merging. Supports smooth rounded corners without collapsing them into
  diagonals.
- **Recognition result validation** — gestures that exceed the maximum segment count are
  marked invalid (not truncated), preventing accidental action matches.
- **Automated tests** — covers the recognition pipeline, mouse input adapter,
  Canvas Overlay (element lifecycle, DPR scaling, drawing calls, hint edge
  clamping, theme variable usage, commandLabel wrapping), and
  FeedbackController (RAF coalescing, timer competition, PENDING
  invisibility, unload cleanup).
- **Canvas trajectory overlay** — a fixed full-viewport Canvas renders the live
  mouse trail with DPR-aware scaling, plus a hint element showing the current
  direction sequence (e.g. `R → D`).  Updates are coalesced via
  `requestAnimationFrame`.
- **Command registry** — a typed `CommandRegistry` with atomic batch
  registration, group metadata, and uniform `CommandExecutionResult` semantics.
- **In-memory gesture bindings** — a `GestureBindingRegistry` maps direction
  sequences to commands with ID uniqueness, deep-copy immutability, and
  per-direction / per-ID enable/disable.
- **SiYuan action bridge** — `SiyuanActionBridge` centralises all SiYuan API
  access (no HTTP, no token).  Implements adjacent tab switching
  (`getActiveTab` → `Wnd.switchTab`) and document scroll to top/bottom.
  Scrolling prefers reusing SiYuan's official `protyle-scroll__up` /
  `protyle-scroll__down` buttons (which internally call `goHome` / `goEnd`
  and handle dynamic block loading); if those are unavailable, it falls back
  to setting `editor.protyle.contentElement.scrollTop`.  Note:
  `editor.protyle.scroll.element` is the **block-index slider**
  (`protyle-scroll__bar`), not a scroll container — the bridge never calls
  `scrollTo` / `scrollTop` on it; it is used only to locate the official
  scroll control via `parentElement`.
- **Command dispatcher** — `GestureCommandDispatcher` validates session state,
  recognition result, and binding existence before executing the bound command
  exactly once per session.

The following is **not yet implemented**:

- Settings page
- Configuration persistence
- Destructive actions (close tab, delete doc, new doc, locate in doc tree)
- Touchpad / touch input support

## Architecture

```
src/
  commands/
    CommandRegistry.ts          Atomic command registration
    CommandExecutor.ts          Uniform execution + de-duplication + error containment
    GestureCommandDispatcher.ts Session → binding → command dispatch
    SiyuanActionBridge.ts       All SiYuan API/DOM access (tabs, scroll)
    registerBuiltinCommands.ts  Default tab/scroll commands
    types.ts                    Command / context / result types
  gesture/
    input/
      InputAdapter.ts           Abstract base adapter
      MouseGestureAdapter.ts    Mouse-specific PointerEvent adapter
    recognition/
      PathSampler.ts            Uniform arc-length resampling
      PathSimplifier.ts         RDP simplification + jitter/short-segment removal
      DirectionVectorizer.ts    Heading segmentation + direction quantisation
      DirectionMatcher.ts       Adjacent-duplicate merging
      recognition.test.ts       Pipeline tests
    overlay/
      GestureOverlay.ts         Canvas trail + hint element
      overlay.test.ts           Overlay tests
      types.ts                  Overlay-specific types
    bindings/
      GestureBindingRegistry.ts Direction → command bindings (immutable, ID-indexed)
      defaultBindings.ts        L/R/U/D → tabs.previous/next, scroll.top/bottom
      CommandLabelResolver.ts   Resolve command labels for overlay display
    GestureEngine.ts            Orchestrates the full pipeline
    GestureSession.ts           Per-gesture state + point accumulation
    GestureFeedbackController.ts  RAF coalescing + live recognition + async callback
    types.ts                    Shared types and enums
  index.ts                      Plugin entry — wiring, dev logging, unload cleanup
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
