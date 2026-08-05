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
- **Versioned configuration** — a strictly-typed config model with version
  field, deep-cloned defaults, unified validation/normalisation, and a
  migration framework (currently version 1).  `ConfigManager` owns the
  in-memory snapshot, serialises all persistence via `Plugin.loadData` /
  `Plugin.saveData`, and notifies subscribers with independent deep copies.
  Imports go through the same migration + validation pipeline as the initial
  load; invalid payloads fall back to defaults.
- **Settings page** — a Svelte-based settings dialog mounted via the official
  SiYuan `Setting` class.  Tabs for General (enable, suppression key,
  activation distance, timeout), Recognition (direction mode, sampling,
  simplification, segment limits), Display (trail/hint toggles, line width),
  Bindings (enable/disable the four default bindings), and Data (export,
  import, reset).  All user-facing strings come from i18n; rapid edits are
  debounced and merged so the runtime is not restarted on every keystroke.
- **Runtime manager** — `GestureFlowRuntime` encapsulates the full lifecycle
  of Adapter, Engine, Overlay, commands, and bindings.  `restart` fully stops
  the old runtime (detach adapter, destroy overlay, clear timers and replay
  tokens) before starting with the new config.  `enabled = false` skips
  mounting any input listener or overlay.

The following is **not yet implemented**:

- Custom gesture recorder and full binding editor (editing directions, adding
  new bindings, drag-and-drop reordering, custom command params)
- Destructive actions (close tab, delete doc, new doc, locate in doc tree)
- Touchpad / touch input support
- Scroll-wheel gestures, Rocker gestures, super drag

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
  config/
    types.ts                    Versioned config schema (strict types)
    defaults.ts                 Default config + deep-clone utilities
    validate.ts                 Validation + normalisation (range clamping, type checks)
    migrations.ts               Version detection + migration framework
    ConfigManager.ts            Persistence owner (load/save/import/export/reset/subscribe)
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
      GestureOverlay.ts         Canvas trail + hint element (config-driven)
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
  runtime/
    GestureFlowRuntime.ts       Lifecycle manager — start/stop/restart all components
  settings/
    SettingsPanel.svelte        Svelte settings dialog (tabs: general/recognition/display/bindings/data)
    settingsHelpers.ts          Pure helpers (parseNumber, DebouncedPatchScheduler)
  index.ts                      Plugin entry — config manager, runtime, settings, unload
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
