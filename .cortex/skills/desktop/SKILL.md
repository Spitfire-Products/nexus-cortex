---
name: desktop
description: How to drive the computer with the `desktop` tool (nexus-desktop) — keyboard first, perceive before you click, the failsafe and stop file, coordinates, typing into fields, scripts/macros, and what to do when it refuses. Load before any desktop task (native apps, dialogs, installers, anything a browser tool cannot reach).
triggers:
  - desktop
  - screen
  - native app
  - dialog
  - mouse
  - keyboard shortcut
---

# The `desktop` tool

`desktop` controls a whole screen: a private virtual display (`NEXUS_DESKTOP=virtual`) or the user's own screen (`real`, enabled only by the
user with `cortex desktop enable --real`). It is off unless enabled. Use the browser tools for web pages; use `desktop` for what they cannot
reach — native applications, system dialogs, file pickers, installers, apps inside a virtual machine.

## 1. Start every task the same way
1. `desktop {action:"info"}` — screen size, screenshot scale, permissions, the failsafe spot, the launch allow-list. If permissions show
   false (macOS Screen Recording / Accessibility), stop and tell the user what to grant; mutating actions refuse without them.
2. `desktop {action:"context"}` — the front app, its windows, the focused element and recent events, in one cheap call.
3. Perceive before acting: `scan` (accessibility elements with refs) and `grab` read text and find controls WITHOUT a screenshot. Take a
   `screenshot` or `zoom` only when there is no accessible element to read.

## 2. Fastest path first (in this order)
1. A native keyboard shortcut (`hotkey` catalog: app switcher, go-to-folder in any open/save dialog, menu search, save-as …).
2. A menu item by name (`menu`) — one call instead of several clicks.
3. Keyboard navigation (Tab, arrows, Enter, accelerators) with `key` / `type`.
4. A `run` script: several actions in ONE call; save repeated sequences as `macro`s.
5. Clicks last — on a `ref` from `scan` (`press`) before raw coordinates.

## 3. Coordinates and typing
- Coordinates are pixels in the SCREENSHOT the tool returned (scaled to fit), never your own estimate and never from an older screenshot
  after the window moved. Re-`scan` or re-screenshot after anything that changes the layout.
- Fill a field with `fill_field` (click, select-all, type, commit, then a zoom of the field to verify) or `set_value` on a scanned ref — not
  a click followed by free typing.
- Dates and times: type the value into the field; never page through a calendar widget.
- If typed characters drop or garble (some apps and virtual machines), retry with `type_via:"paste"` or a `char_delay_ms` of 40–80.

## 4. Safety (the user's rules, enforced by the tool)
- FAILSAFE: if the user parks the cursor at the failsafe spot (`info` names it), the tool writes a stop file and REFUSES every further action.
  Do not try to work around it: tell the user the desktop is stopped and that deleting the stop file resumes it.
- `launch` opens only allow-listed apps; ask the user instead of hunting for another way to start a program.
- Every action is written to an audit log (typed text by length only). Never type secrets the user did not give you for that field.
- On the user's real screen, say what you are about to do before a multi-step action, keep focus on the target window, and never close or
  quit apps you did not open.

## 5. When something goes wrong
- A click "did nothing": re-`context` (a dialog may have opened, focus may have moved), then re-`scan`.
- A ref no longer exists: the window closed or retitled — `scan` again.
- An app shows no accessible elements (custom-drawn UI): drive it by screenshot + keyboard; `zoom` to read small text.
- `stats` summarizes recent actions and timings — use it to report what happened.
