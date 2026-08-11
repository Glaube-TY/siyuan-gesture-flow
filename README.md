# GestureFlow

GestureFlow is a **gesture automation plugin** for SiYuan. Draw with the right mouse button or a Windows laptop touchpad, then release to run the bound action.

## What you can do

- Switch tabs, close them, or restore a recently closed one.
- Create documents, open the daily note or recent documents, and more.
- Run a global search or search for the selected text.
- Show or hide panels (file tree, outline, backlinks, …) and graph views.
- Split or unsplit the editor layout.
- Open settings, sync now, toggle read-only mode, or lock the screen.
- Scroll to the top or bottom of a document.
- Go back / forward through your navigation history.
- Bind a gesture to a keyboard shortcut, with a custom action name.
- Record single or multi-direction gestures of your own.
- Record multi-finger taps, swipes, independent paths, anchor-and-draw gestures, pinches and rotations on a Windows touchpad.
- Export, import and reset the configuration.

## Quick start

1. Install and enable the plugin in SiYuan.
2. Open **GestureFlow settings** from the plugin menu.
3. To use touchpad input, turn on **Enable touchpad** in **General**.
4. Open **Bindings** and click **New binding**.
5. Select the input source: mouse or touchpad.
6. Mouse: hold the right button and draw. Touchpad: click the square recording panel, perform the gesture on the physical touchpad, then release every finger.
7. Choose an implementation type (built-in action or keyboard shortcut).
8. Choose the built-in action, or enter an action name and record a keyboard shortcut.
9. Save, close the settings window, and try the gesture for real.

## Right-button mouse gestures

- Hold the right mouse button, move the mouse, then release.
- Supported directions: **U**, **D**, **L**, **R** and combinations such as `R → D`.
- With **8-direction mode** enabled, diagonal directions (e.g. `↖ ↗ ↘ ↙`) are also recognized.
- Right-clicking without moving still shows SiYuan's normal context menu.
- Holding the temporary disable key lets you use the ordinary right-click menu while gestures stay active.

## Windows touchpad gestures

### Recording and use

- Add or edit a binding in **Bindings**, then switch its input source to **Touchpad**.
- Click the square recording panel itself to start; there is no separate external start button.
- You do not select a finger count beforehand. GestureFlow records the physical finger count and each contact path directly from device frames.
- Recognition begins when fingers touch the pad. The recording finishes and freezes when **every finger has been released**.
- Supported kinds include tap, hold, same-direction swipe, shared multi-segment shape, independent per-finger paths, anchor finger + drawing finger, pinch and rotate.
- Recording and runtime feedback render one trail per finger and show the action that the recognised gesture will execute.

### Relationship with Windows system gestures

GestureFlow blocks only common, unavoidable interactions so Windows and the plugin do not execute the same input together:

- **One finger:** pointer movement and clicks always remain with the system.
- **Two fingers:** secondary click/press, same-direction scrolling or panning, and pinch zoom are blocked.
- **Three fingers:** three-finger tap is blocked.
- **Allowed:** different independent two-finger paths, anchor-and-draw and rotation, plus three-or-more-finger swipes, multi-segment or independent paths, holds, pinches and rotations other than the three-finger tap.

An action being configurable in Windows Settings does not mean it is enabled on the current PC. GestureFlow never changes the system touchpad configuration and does not pre-emptively block a three/four/five-finger action merely because Windows can map it. See [Microsoft's touch gesture guide](https://support.microsoft.com/windows/hardware/input-devices/touch-gestures-for-windows).

### Compatibility and installation requirements

- Full per-contact and multi-finger trail support currently targets **SiYuan Desktop on Windows x64** and requires a compatible touchpad and driver recognised by Windows.
- Release packages include a prebuilt `native/gesture_flow_touchpad.node`. Normal users only install and enable the plugin; they **do not need Node.js, Python, pnpm, Visual Studio, or the Windows SDK**.
- If the native module cannot load, GestureFlow falls back to Electron event observation when possible. This exposes only some OS-level gestures and cannot fully record independent contact paths.
- Windows ARM64, macOS, Linux, mobile and browser builds do not currently provide the full advanced touchpad path. Mouse gestures remain available.

## Implementation types

| Type | Description |
| --- | --- |
| Built-in action | Pick one of the built-in features (see the list below). |
| Keyboard shortcut | Enter an **action name** (e.g. "Open Global Search"), click the capture box, and press the key combination. Save, close the settings window, and verify with a real gesture. |
| JavaScript | Shown as **in development** — currently not selectable. |

## Built-in actions

GestureFlow reuses SiYuan's own action capabilities, so each built-in action behaves exactly like its native SiYuan equivalent.

### Tabs

| Name | Effect |
| --- | --- |
| Previous tab | Switch to the previous tab in the current window. |
| Next tab | Switch to the next tab in the current window. |
| Close current tab | Close the currently active tab. |
| Restore recently closed tab | Restore the most recently closed tab. |
| Close tabs to the left | Close every tab to the left of the active tab. |
| Close tabs to the right | Close every tab to the right of the active tab. |
| Close other tabs | Close all tabs except the active one. |
| Close all tabs | Close all tabs in the current window. |

### Documents

| Name | Effect |
| --- | --- |
| Reload current document | Reload the currently active document. |
| New document | Create a new document. |
| Open daily note | Open today's daily note. |
| Recent documents | Open the recent-documents list. |
| Data history | Open the data history panel. |
| Flashcards | Open the spaced-repetition card view. |

### Search

| Name | Effect |
| --- | --- |
| Global search | Open SiYuan's global search. |
| Search selected text | Search for the currently selected text. |

### Navigation

| Name | Effect |
| --- | --- |
| Back | Go back one step in navigation history. |
| Forward | Go forward one step in navigation history. |

### Panels & Views

| Name | Effect |
| --- | --- |
| File tree | Show / hide the file-tree panel. |
| Outline | Show / hide the outline panel. |
| Backlinks | Show / hide the backlinks panel. |
| Bookmarks | Show / hide the bookmarks panel. |
| Tags | Show / hide the tags panel. |
| Inbox | Show / hide the inbox panel. |
| Document graph | Show / hide the document graph. |
| Global graph | Show / hide the global graph. |
| Toggle dock bar | Show / hide the dock bar. |

### Layout

| Name | Effect |
| --- | --- |
| Split left / right | Split the current tab into a left/right layout. |
| Split top / bottom | Split the current tab into a top/bottom layout. |
| Unsplit current layout | Remove the current split. |
| Unsplit all | Remove all splits. |

### Application & System

| Name | Effect |
| --- | --- |
| Open SiYuan settings | Open the SiYuan settings dialog. |
| Sync now | Trigger an immediate synchronisation. |
| Toggle read-only mode | Toggle the editor read-only mode. |
| Lock screen | Lock the SiYuan screen. |

### Scrolling

| Name | Effect |
| --- | --- |
| Scroll to top | Scroll the current document to the top. |
| Scroll to bottom | Scroll the current document to the bottom. |

> The default mouse gestures are unchanged: **L → previous tab**, **R → next tab**, **U → scroll to top**, **D → scroll to bottom**. Every other action has **no default gesture** — bind it to a trajectory of your choice in the Bindings tab.

## Shortcut compatibility

- Shortcuts are sent as **synthetic keyboard events**, never forged `isTrusted` events.
- SiYuan's built-in shortcuts usually respond.
- Whether a shortcut takes effect may depend on the current focus area.
- A few plugins that actively reject non-trusted keyboard events may not respond.
- Always close the settings window and verify with a **real gesture** in the context where the shortcut normally works.

## Settings

| Tab | Purpose |
| --- | --- |
| General | Enable/disable the plugin, enable touchpad input, temporary disable key, activation distance and timeout. |
| Recognition | Direction mode (4/8), sampling and simplification sensitivity. |
| Display | Trail and hint toggles, line width. |
| Bindings | Select mouse or touchpad input, record gestures, and manage bindings (add / edit / delete / toggle). |
| Data | Export, import and reset the configuration. |

## FAQ

**Is the normal right-click menu still available?**
Yes — right-clicking without moving still shows SiYuan's context menu. Hold the temporary disable key to use the ordinary right-click whenever needed.

**Why is a shortcut not working?**
The shortcut is dispatched to the current focus. Some shortcuts are context-sensitive (e.g. only work inside an editor), and plugins that reject synthetic events will ignore it. Close the settings window and verify with a real gesture in the context where the shortcut normally works.

**Why is my gesture not recognized?**
The trajectory may be too short, too long, or drawn too slowly. Check the activation distance and timeout settings, and make sure the input source, finger count and direction sequence match the saved binding (with 8-direction mode off, diagonals are not recognized). Touchpad recording needs native per-contact frames; if the UI reports observer mode, confirm that you are using SiYuan Desktop on Windows x64.

**How do I record a touchpad gesture?**
Create a binding, select **Touchpad**, click the square recording panel, then perform the gesture on the laptop touchpad. Finger count and individual paths are detected automatically; releasing every finger completes the recording.

**Why can't I save some touchpad gestures?**
They overlap Windows one-finger pointer input, two-finger secondary-click/scroll/zoom, or the three-finger tap. Use different per-finger paths, a multi-segment turn, anchor-and-draw, or another gesture with three or more fingers.

**Do users need Node.js or a compiler toolchain?**
No. The Windows x64 release package already contains the compiled native addon. Node.js, Python, Visual Studio and related tools are development and release-build requirements only.

**How do I temporarily disable gestures?**
Turn off the plugin in the General tab, or hold the configured temporary disable key while clicking.

**How do I back up my configuration?**
Use the **Export** button in the Data tab — it downloads a JSON file. **Import** restores it, and **Reset** returns to defaults.

**Why can't I select JavaScript?**
JavaScript actions are still in development and are disabled for safety.

## Roadmap

These are plans, **not** current-version features:

- Bind gestures to JavaScript code snippets;
- Support mouse side buttons and other configurable input buttons.

## Contributing

Welcome to report issues, suggest features, or submit Pull Requests via [GitHub Issues](https://github.com/Glaube-TY/siyuan-gesture-flow/issues).

Development environment: Node.js 20 and pnpm 10. Run `pnpm release:check` before committing.

## Support the Project

Support the project if GestureFlow helps you — your contribution keeps it maintained and improved. Scan one of the QR codes below, or visit the [donation page](https://glaube-ty.top/da-shang/).

<a href="https://glaube-ty.top/da-shang/" target="_blank" rel="noopener noreferrer">
  <img src="https://glaube-ty.top/uploads/attachments/halo/8b772b15-f542-4157-a251-e3985f37f84a.png" alt="WeChat Pay QR code" width="160" loading="lazy" />
</a>
<a href="https://glaube-ty.top/da-shang/" target="_blank" rel="noopener noreferrer">
  <img src="https://glaube-ty.top/uploads/attachments/halo/f3d25e23-333e-4356-99d0-d0fda69d11ad.jpg" alt="Alipay QR code" width="160" loading="lazy" />
</a>

## License

MIT — see [LICENSE](LICENSE).
