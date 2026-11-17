# Kanban Board

An OpenChamber extension that shows a project's tasks (local `.scratch/` files or GitHub Issues) as a Kanban board and starts agent sessions on them.

## Keyboard

**Shortcut**:
A key combination bound to one board action within one Shortcut context; the user can rebind it in Settings.
_Avoid_: Hotkey, keybinding

**Shortcut context**:
The place a Shortcut applies: the Board, an Open task, or Add task. The same key may mean different actions in different contexts.
_Avoid_: Scope, mode

**Selected card**:
The one card on the Board that keyboard actions act on; it stays selected when the board redraws.
_Avoid_: Focused card, active card, current task

**Open task**:
A task shown in the task modal.
_Avoid_: Task detail, task view
