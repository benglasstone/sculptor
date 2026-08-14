# Warm terminals: keep-alive pool for instant workspace revisits

Status: **planned** (design note). A cheap mitigation shipped first — see
"Shipped mitigation" below.

## Problem (measured)

Switching to a workspace makes its Claude-CLI terminal take ~1–2s to appear.
Measured cause (backend `logs.jsonl`, `_connect_terminal_websocket`): on every
terminal connect the backend replays its buffered PTY output — typically
**750 KB–1 MB** — and xterm re-parses that whole ANSI stream **synchronously on
the main thread**. A TUI agent constantly redraws, so its buffer sits pegged at
the cap. The connect itself is instant ("Found terminal manager" <1ms); the cost
is the reparse.

This fires on essentially every switch because the section grid renders only the
**active** workspace (`activeWorkspaceIdAtom`), so switching unmounts the old
workspace's panels and mounts the target's. `useTerminal` disposes the xterm
instance and closes the WebSocket on unmount
(`useTerminal.ts`, the `[]` xterm-init effect's cleanup and the WS effect's
cleanup), so a revisit is always a cold connect → full replay → full reparse.

## Shipped mitigation

`MAX_OUTPUT_BUFFER_SIZE` in
`sculptor/services/workspace_service/environment_manager/environments/local_terminal_manager.py`
was reduced **1 MB → 256 KB**. Every cold connect reparses ~4× less. Cost: less
reconnect scrollback (still ample for the visible screen + recent history). This
does not eliminate the reparse on revisit — the warm-terminal work below does.

## Warm-terminals design (the real fix)

Goal: revisiting a recently-viewed workspace shows its terminal **instantly** and
**already current** — no reconnect, no replay, no reparse.

Approach: a module-level **keep-alive LRU pool** of live terminals, keyed by
`terminalPath` (`/api/v1/workspaces/{id}/terminal/{index}/ws`). Nothing is torn
down on unmount for the last ~N (e.g. 4) terminals; the hidden WebSocket keeps
streaming so the offscreen xterm stays up to date.

### Mechanics

1. **Pool entry** owns: the `XTerm` instance, its addons (Fit/WebLinks/WebGL/link
   provider), the `WebSocket`, the CPR/query-filter refs
   (`hasReceivedReplayRef`, `lastLiveQueryAtRef`), and — critically — **the DOM
   element that `xterm.open()` was called on**.

2. **On mount** for a `terminalPath`:
   - Pool hit → **adopt**: `appendChild` the pool entry's xterm-owned element into
     the panel's container ref, `fitAddon.fit()` + resize, rebind the
     connection-status callback. No new xterm, no new WS, no replay.
   - Pool miss → create as today, register the entry in the pool.

3. **On unmount**:
   - Move the xterm-owned element back to a detached holder (keep it alive).
   - **Keep the WebSocket open** so live output continues into the hidden xterm.
   - Touch LRU. If over cap, **evict** the oldest: close its WS, `dispose()` its
     xterm, drop its element.

4. **xterm binds to one element** — you cannot cleanly re-`open()` on a new
   container. So the element the pool holds is the unit that moves between the
   hidden holder and the visible panel; the panel's `terminalContainerRef` becomes
   a mount point you `appendChild` into, not the element xterm renders into.

### What has to change in `useTerminal.ts`

The two `[]` mount effects (xterm-init, WS-connect) currently run per-mount and
tear down on unmount. Restructure so creation/teardown are **per-pool-entry**
(lifetime = pool residency), while **per-mount** work is only: adopt the element,
fit, and wire the status/file-path callbacks (which must read through refs so a
re-adopted entry picks up the new mount's handlers). Keyboard handler and
`onData→ws.send` already read `wsRef` at call time, so they survive reuse; verify
they aren't double-registered on adopt.

### Risks / gotchas (why this needs a dev instance to verify)

- **Double-connect / input leak**: ensure adopt doesn't re-run the WS effect or
  re-register `onData`; a duplicate `onData` would double-send keystrokes.
- **Replay-frame filtering**: `hasReceivedReplayRef` must stay per-entry so an
  adopted (already-past-replay) terminal doesn't re-arm the spurious-CPR filter.
- **Resize on adopt**: the element may have been fit to a different panel size;
  `fitAddon.fit()` + a PTY resize send on every adopt.
- **WebGL context**: moving the canvas in the DOM can drop the WebGL context
  (`onContextLoss` already disposes the addon → falls back to canvas); confirm it
  recovers or re-fits cleanly.
- **Memory**: N live xterms + WSs. Cap N small (≈4) and evict LRU.
- **Theme toggle**: the existing theme-update effect must still target the pooled
  xterm.

### Files

- `sculptor/frontend/src/pages/workspace/panels/useTerminal.ts` — the pool + the
  lifecycle restructure (the bulk of the work).
- `sculptor/frontend/src/pages/workspace/panels/TerminalPanelView.tsx` — container
  becomes a mount point; forward the panel/workspace identity so the hook can key
  the pool.
- Tests: `useTerminal.test.tsx`, `TerminalPanel.test.ts` — add adopt/evict cases
  (no double-connect, replay-filter state preserved, LRU eviction disposes).

Cannot be hot-reloaded into a packaged AppImage; iterate on a `just` dev instance
(vite) before baking into a release build.
