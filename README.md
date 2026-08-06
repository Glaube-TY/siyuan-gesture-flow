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
- **Smoke tests (small, permanent)** — pure-logic suites only: recognition
  pipeline, config migration, shortcut utilities, binding operations.
  Production correctness is enforced by `pnpm check` → `pnpm build` →
  `pnpm verify`; UI / pointer / lifecycle behaviour is verified in a real
  SiYuan instance.
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
- **Action dispatcher** — `GestureActionExecutor` (replacing the old
  `GestureCommandDispatcher`) validates session state, recognition result,
  and binding existence, then dispatches by `action.type`: builtin commands
  via `CommandExecutor`, keyboard shortcuts via `ShortcutExecutor` — each
  executed exactly once per session.
- **Versioned configuration** — a strictly-typed config model with version
  field (currently **version 2**), deep-cloned defaults, unified
  validation/normalisation, and a migration framework (v1 → v2 wraps legacy
  `commandId`/`commandParams` into `builtin` actions; migrations are
  persisted back and reported as `migrated`).  `ConfigManager` owns the
  in-memory snapshot, serialises all persistence via `Plugin.loadData` /
  `Plugin.saveData`, and notifies subscribers with independent deep copies.
  Imports go through the same migration + validation pipeline as the initial
  load; invalid payloads fall back to defaults.
- **Settings page** — a Svelte-based settings dialog hosted in a
  full-width standalone SiYuan `Dialog` (not `Setting.addItem`).  Tabs for General
  (enable, suppression key, activation distance, timeout), Recognition
  (direction mode, sampling, simplification, segment limits), Display
  (trail/hint toggles, line width), Bindings (full gesture recording +
  add/edit/delete/toggle; each binding runs a **builtin** command or a
  **keyboard shortcut**; JavaScript is a disabled "in development"
  placeholder), and Data (export, import, reset).  All user-facing strings
  come from i18n; rapid edits are debounced and merged so the runtime is not
  restarted on every keystroke.
- **Runtime manager** — `GestureFlowRuntime` encapsulates the full lifecycle
  of Adapter, Engine, Overlay, commands, and bindings.  `restart` fully stops
  the old runtime (detach adapter, destroy overlay, clear timers and replay
  tokens) before starting with the new config.  `enabled = false` skips
  mounting any input listener or overlay.

- **Keyboard shortcuts** — `ShortcutSpec` (strict serialisable key/code/
  keyCode + modifiers) captured by `ShortcutRecorder`, validated by one
  shared `validateShortcutSpec`, displayed cross-platform via
  `detectShortcutPlatform` (Windows/Linux `Ctrl+Shift+P`, macOS `⌃⇧P`), and
  dispatched by `ShortcutExecutor` as a synthetic `keydown` to the current
  focus.  Synthetic events are never `isTrusted`, so plugins that reject
  non-trusted keyboard events cannot be activated this way.
- **Binding labels** — `CommandLabelResolver` renders localised command
  titles for builtin actions and `快捷键：Ctrl+Shift+P`-style labels for
  shortcut actions in the overlay.

The following is **not yet implemented**:

- JavaScript actions (settings placeholder only)
- Destructive actions (close tab, delete doc, new doc, locate in doc tree)
- Touchpad / touch input support
- Scroll-wheel gestures, Rocker gestures, super drag
- Cross-plugin shortcut activation protocol (plugins that reject synthetic
  `isTrusted: false` events, e.g. siyuan-homepage custom shortcuts, cannot
  be triggered by GestureFlow shortcuts)

## Architecture

```
src/
  commands/
    CommandRegistry.ts          Atomic command registration
    CommandExecutor.ts          Uniform execution + de-duplication + error containment
    SiyuanActionBridge.ts       All SiYuan API/DOM access (tabs, scroll)
    registerBuiltinCommands.ts  Default tab/scroll commands
    types.ts                    Command / context / result types
  actions/
    GestureActionExecutor.ts    Session → binding → action dispatch (builtin/shortcut)
  shortcuts/
    types.ts                    Strict serialisable ShortcutSpec
    shortcutUtils.ts            Capture / normalise / validate / display / platform detection
    ShortcutExecutor.ts         Synthetic keydown dispatch
  config/
    types.ts                    Versioned config schema (version 2, strict types)
    defaults.ts                 Default config + deep-clone utilities
    validate.ts                 Validation + normalisation (range clamping, type checks)
    migrations.ts               Version detection + migration framework (v1 → v2)
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
    overlay/
      GestureOverlay.ts         Canvas trail + hint element (config-driven)
      types.ts                  Overlay-specific types
    bindings/
      GestureBindingRegistry.ts Direction → binding lookup (action-agnostic, immutable)
      defaultBindings.ts        Default L/R/U/D builtin bindings
      CommandLabelResolver.ts   Resolve action labels for overlay display
    GestureEngine.ts            Orchestrates the full pipeline
    GestureSession.ts           Per-gesture state + point accumulation
    GestureFeedbackController.ts  RAF coalescing + live recognition + async callback
    types.ts                    Shared types and enums
  runtime/
    GestureFlowRuntime.ts       Lifecycle manager — start/stop/restart all components
  settings/
    SettingsDialog.ts           Full-width standalone settings dialog wrapper
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
| `pnpm check` | Type-check production code only (tests excluded via tsconfig) |
| `pnpm build` | Production build → `dist/` + `package.zip` |
| `pnpm verify` | Verify `dist/` / `package.zip` (required + forbidden files, credential scan, style isolation of `index.css`) |
| `pnpm test:smoke` | Run the small permanent smoke suite (`tests/smoke/`) |
| `pnpm test` | Alias for `pnpm test:smoke` |
| `pnpm release:check` | Production-first gate: `check` → `build` → `verify` → `test:smoke` |
| `pnpm make-install` | Build + copy to SiYuan plugin directory |

### Development flow (production-first)

Always run in this order — never put tests before type-check and build:

1. `pnpm check` — production type-check (tests are excluded; test errors never
   block production checks).
2. `pnpm build` — production build.
3. `pnpm verify` — artifact verification incl. style-isolation of `dist/index.css`.
4. `pnpm test:smoke` — the small pure-logic smoke suite.

Real SiYuan interaction (right-button menu, gesture recording, settings dialog,
theme, tab switching, scrolling, shortcut capture/test, import/export, restart
persistence) is validated manually against the built plugin — not through
browser mocks.

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
