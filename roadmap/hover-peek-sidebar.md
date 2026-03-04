# Hover-Peek Sidebar

> Notion-style progressive disclosure: hover to peek, click to pin.

## Summary

The sidebar toggle button currently has two states: open (pinned) and closed. This adds a third intermediate state — **hover-peek** — where hovering over the toggle causes the sidebar to appear as a floating overlay that the user can interact with. Moving the cursor away dismisses it. Clicking the toggle pins the sidebar in place as it does today.

## Behaviour

### Hover-Peek (floating overlay)

1. User hovers over the sidebar toggle button in the title bar.
2. After a short delay (~150ms debounce to avoid flicker), the sidebar renders as a **floating overlay** — positioned absolutely over the board content, not pushing it aside.
3. The overlay has a subtle drop shadow to distinguish it from the pinned sidebar.
4. User can move their cursor into the overlay and interact with it (navigate threads, click chats, use quick actions).
5. When the cursor leaves both the toggle button and the overlay, the overlay dismisses after a short grace period (~200ms — prevents accidental dismissal when moving between toggle and sidebar).

### Click-to-Pin (existing behaviour)

6. Clicking the toggle button pins the sidebar in place — same as current behaviour (sidebar occupies layout space, pushes board content).
7. When the sidebar is pinned, hovering has no additional effect.

### Dismissal rules

- Hover-peek dismisses when cursor leaves the overlay + toggle region.
- Pressing Escape while hover-peeking dismisses it.
- Clicking anywhere on the board while hover-peeking dismisses it.
- If the user clicks a chat in the hover-peek sidebar that opens the secondary drawer, the sidebar should auto-dismiss (the drawer is the intended destination).

## Visual differences: peek vs pinned

| Aspect | Hover-peek | Pinned |
|--------|-----------|--------|
| Position | `position: absolute`, overlays board | In-flow, pushes board |
| Shadow | `shadow-xl` to float above content | No shadow (border only) |
| Width | Same as pinned sidebar width | Same |
| z-index | Above board content, below modals | Normal flow |
| Transition | Fade + slide in from left | Width transition (existing) |

## Implementation sketch

- Track a `sidebarPeekOpen` transient state (not persisted).
- `onMouseEnter` on toggle button → start debounce timer → set `sidebarPeekOpen = true`.
- `onMouseLeave` on toggle button + sidebar overlay → start grace timer → set `sidebarPeekOpen = false`.
- `onMouseEnter` on sidebar overlay → cancel grace timer (keep open).
- Render the sidebar component in two modes: `mode="pinned"` (current) or `mode="peek"` (absolute positioned overlay).
- The `Sidebar` component already handles width/resize — peek mode just changes positioning.

## Edge cases

- **Settings mode**: If sidebar is in settings mode and pinned, hover-peek should not activate (settings requires pinned sidebar).
- **Thin sidebar**: The thin sidebar strip is always visible when sidebar is closed. Hover-peek activates from the toggle button in the title bar, not from the thin sidebar itself.
- **Keyboard**: No keyboard trigger for hover-peek (it's a mouse affordance). ⌘+B or similar could be a future pinned toggle shortcut.
- **Touch**: No hover on touch devices — not relevant for Tauri desktop app, but worth noting.

## Relation to other items

- Complements **flexible-layout-orientation** — hover-peek works in both horizontal and vertical layouts since it overlays rather than taking layout space.
- Could interact with **responsive-layout-constraints** — on very narrow windows, hover-peek might be preferred over pinned sidebar.
