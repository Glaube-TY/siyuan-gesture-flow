# GestureFlow

GestureFlow is a **gesture automation plugin** for SiYuan. Draw a gesture with your mouse and release — the bound action runs immediately.

## What you can do

- Switch between tabs.
- Close a tab, or restore the most recently closed one.
- Reload the current document.
- Scroll to the top or bottom of a document.
- Go back / forward through your navigation history.
- Bind a gesture to a keyboard shortcut, with a custom action name.
- Record single or multi-direction gestures of your own.
- Export, import and reset the configuration.

## Quick start

1. Install and enable the plugin in SiYuan.
2. Open **GestureFlow settings** from the plugin menu.
3. Go to the **Bindings** tab.
4. Click **New binding**.
5. Hold the right mouse button and draw the trajectory.
6. Choose an implementation type (built-in action or keyboard shortcut).
7. Choose the built-in action, or enter an action name and record a keyboard shortcut.
8. Save.
9. Close the settings window and try the gesture for real.

## Drawing gestures

- The first release supports **right-button gesture input on desktop**.
- Hold the right mouse button, move the mouse, then release.
- Supported directions: **U**, **D**, **L**, **R** and combinations such as `R → D`.
- With **8-direction mode** enabled, diagonal directions (e.g. `↖ ↗ ↘ ↙`) are also recognized.
- Right-clicking without moving still shows SiYuan's normal context menu.
- Holding the temporary disable key lets you use the ordinary right-click menu while gestures stay active.

## Implementation types

| Type | Description |
| --- | --- |
| Built-in action | Pick one of the built-in features (see the list below). |
| Keyboard shortcut | Enter an **action name** (e.g. "Open Global Search"), click the capture box, and press the key combination. Save, close the settings window, and verify with a real gesture. |
| JavaScript | Shown as **in development** — currently not selectable. |

## Built-in actions

| Name | Effect |
| --- | --- |
| Previous tab | Switch to the previous tab in the current window. |
| Next tab | Switch to the next tab in the current window. |
| Close current tab | Close the currently active tab. |
| Restore recently closed tab | Restore the most recently closed tab (uses SiYuan's own restore flow). |
| Reload current document | Reload the currently active document. |
| Scroll to top | Scroll the current document to the top. |
| Scroll to bottom | Scroll the current document to the bottom. |
| Back | Go back one step in navigation history. |
| Forward | Go forward one step in navigation history. |

> The newer actions (close tab, restore, reload, back, forward) have **no default gesture** — bind them to a trajectory of your choice in the Bindings tab.

## Shortcut compatibility

- Shortcuts are sent as **synthetic keyboard events**, never forged `isTrusted` events.
- SiYuan's built-in shortcuts usually respond.
- Whether a shortcut takes effect may depend on the current focus area.
- A few plugins that actively reject non-trusted keyboard events may not respond.
- Always close the settings window and verify with a **real gesture** in the context where the shortcut normally works.

## Settings

| Tab | Purpose |
| --- | --- |
| General | Enable/disable the plugin, temporary disable key, activation distance and timeout. |
| Recognition | Direction mode (4/8), sampling and simplification sensitivity. |
| Display | Trail and hint toggles, line width. |
| Bindings | Record gestures and manage bindings (add / edit / delete / toggle). |
| Data | Export, import and reset the configuration. |

## FAQ

**Is the normal right-click menu still available?**
Yes — right-clicking without moving still shows SiYuan's context menu. Hold the temporary disable key to use the ordinary right-click whenever needed.

**Why is a shortcut not working?**
The shortcut is dispatched to the current focus. Some shortcuts are context-sensitive (e.g. only work inside an editor), and plugins that reject synthetic events will ignore it. Close the settings window and verify with a real gesture in the context where the shortcut normally works.

**Why is my gesture not recognized?**
The trajectory may be too short, too long, or drawn too slowly. Check the activation distance and timeout settings, and make sure the direction sequence matches a saved binding (with 8-direction mode off, diagonals are not recognized).

**How do I temporarily disable gestures?**
Turn off the plugin in the General tab, or hold the configured temporary disable key while clicking.

**How do I back up my configuration?**
Use the **Export** button in the Data tab — it downloads a JSON file. **Import** restores it, and **Reset** returns to defaults.

**Why can't I select JavaScript?**
JavaScript actions are still in development and are disabled for safety.

## Roadmap

These are plans, **not** current-version features:

- Bind gestures to JavaScript code snippets;
- Add laptop touchpad gesture input;
- Support mouse side buttons and other configurable input buttons.

## Contributing

Welcome to report issues, suggest features, or submit Pull Requests via [GitHub Issues](https://github.com/Glaube-TY/siyuan-gesture-flow/issues).

Development environment: Node.js 20 and pnpm 10. Run `pnpm release:check` before committing.

## License

MIT — see [LICENSE](LICENSE).
