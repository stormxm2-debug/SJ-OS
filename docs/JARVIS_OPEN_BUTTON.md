# Jarvis Open Button

The CEO can open Jarvis at any time through visible controls, not only the
hidden `Ctrl + Space` shortcut.

## Entry points

| Control | Location | File |
| --- | --- | --- |
| Floating button | Bottom-right of every screen | `src/renderer/src/components/jarvis/JarvisLauncher.tsx` |
| Sidebar button | Bottom of the left navigation | `src/renderer/src/components/layout/Sidebar.tsx` |
| Topbar button | Header, right side | `src/renderer/src/components/layout/Topbar.tsx` |
| Shortcut | `Ctrl + Space` (still active) | `src/renderer/src/components/jarvis/JarvisPanel.tsx` |

All three buttons are labelled **자비스** with the tooltip **자비스 열기** and use
the existing `Bot` / `Sparkles` assistant icons.

## Behaviour

- Clicking any button calls `jarvisService.open()`, which opens the panel and
  auto-focuses the command input (`#jarvis-command-input`).
- `open()` is idempotent, so if Jarvis is already open the panel simply stays in
  front.
- The buttons remain clickable after commands run — the panel only exists in the
  DOM while open (`if (!state.isOpen) return null`), so it never leaves a
  full-screen click blocker behind.

## Click-lock safety

- The closed Jarvis panel renders nothing (`null`), so there is no invisible
  full-screen overlay trapping clicks.
- The floating launcher is a small fixed element at `z-40`, below the panel's
  `z-50` modal, and hides itself while Jarvis is open — it can never block the
  rest of the app.
