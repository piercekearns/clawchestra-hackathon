# System Notifications for Unread Chat

> Deliver OS‑level notifications + dock/taskbar badges when new chat messages arrive while the app is unfocused.

## Summary

Clawchestra should surface unread chat activity when the app isn’t actively focused. That means native OS notifications (macOS Notification Center, Windows toast, Linux desktop notifications) and a dock/taskbar badge when a new assistant reply lands and the user hasn’t opened the drawer to read it yet. The goal is to make “new response” visible even when the app is minimized or the user is working in another window.

---

**Roadmap Item:** `system-notifications`
**Status:** Draft
**Created:** 2026-02-24

---

## Goals

- Provide **native OS notifications** when new assistant replies arrive and the app is not focused.
- Show **dock/taskbar badge** (red dot / unread count) while a reply is unread.
- Clear notifications/badge when the user returns to the app or opens the chat drawer.
- Keep behavior consistent across platforms, with graceful fallback where OS support differs.

## Non‑Goals

- No “persistent message queue” or offline delivery.
- No complex notification threading or history UI.
- No foreground notification spam when the app is already focused.

## UX Behavior

### When to Notify
- A new **assistant reply** arrives **while the app is not focused** (window not active / user is in another app).
- The chat drawer is closed and a response preview toast appears.

### When to Clear
- User opens the chat drawer.
- App regains focus and the user interacts (click/keypress).
- Optional: dismissing the preview toast clears the badge.

### In‑App Signals (existing)
- Continue to show the preview toast bubble; OS notifications complement it.

## Platform Behavior (planned)

### macOS
- Show a Notification Center alert (banner or alert).
- Set Dock badge (red dot or count).
- Ensure the standard macOS permission prompt is respected (first‑run ask or Settings page toggle).

### Windows
- Send a native toast notification.
- Taskbar badge/overlay if supported (investigate Tauri support).

### Linux
- Send a desktop notification (freedesktop standard). Badge support may not be available.

## Technical Approach (Tauri v2)

### Notifications
Use the official Tauri Notification plugin:
- JS guest binding: `@tauri-apps/plugin-notification`
- Rust plugin: `tauri-plugin-notification`
- Capabilities: add `notification:default` to `src-tauri/capabilities/default.json`

Per plugin docs (v2): register `tauri_plugin_notification::init()` in `src-tauri/src/lib.rs` and call `sendNotification()` from the frontend when needed.

### App Focus / Unread Tracking
- Track “unread reply” state in the chat store (derived from response toast + drawer state).
- Detect focus/blur via `document.hasFocus()` + `visibilitychange` and/or Tauri window events.
- Notification should **only fire once per new unread message** (coalesce multiple deltas into one).

## Open Questions / Research Needed

1. **Dock/Taskbar badge API:** What is the Tauri‑supported way to set badge count on macOS + Windows? (If not available, fallback to notifications only.)
2. **Permission UX:** Should we prompt on first unread notification or add a Settings toggle?
3. **Cross‑platform parity:** How best to represent “unread count” on Windows/Linux if badges aren’t supported?
4. **Coalescing rules:** If multiple replies arrive while unfocused, show a single notification with count?

## Acceptance Criteria (Draft)

- Unfocused app + new assistant reply → OS notification fires.
- Dock/taskbar badge shows unread state until user opens chat drawer.
- No notifications while the app is focused and drawer is open.
- Feature degrades gracefully where badges aren’t supported.
