# Worktree relocation: put worktrees beside the repo, out of `~/.sculptor`

Status: **planned** (design note). No code written yet.

## Goal

Move a workspace's on-disk directory from `~/.sculptor/workspaces/<uuid>/…` to a
hidden per-project directory **beside the repo** — for repo `~/repos/sculptor`,
workspaces live under `~/repos/.sculptor/<uuid>/…`. Two motivations:

- Keep a repo's worktrees next to it (discoverable, and they travel with the
  repo's parent directory) instead of pooled in one global hidden folder.
- A first step toward getting Sculptor's data out of `~/.sculptor` entirely (see
  "Scope boundary" — the rest of `~/.sculptor` is a much bigger effort).

## Current layout (measured)

A workspace's directory is minted in
`services/workspace_service/environment_manager/default_implementation.py`:

```python
LOCAL_WORKSPACE_DIR = get_workspaces_folder()          # <sculptor_folder>/workspaces
def _create_workspace_path(uuid): return (LOCAL_WORKSPACE_DIR / uuid)  # + mkdir
# create_environment():
workspace_path = _create_workspace_path(uuid4().hex)
environment_id = LocalEnvironmentID(str(workspace_path))   # the id IS the path
```

So today: `~/.sculptor/workspaces/<uuid>/` containing

- `code/` — the **git worktree** checkout (a `git worktree add` off the user's
  repo; its `.git` is a gitfile pointing back into `<repo>/.git/worktrees/<name>`),
- `state/tasks/<task_id>/…` and `artifacts/tasks/<task_id>/…` — Sculptor's own
  per-task state and artifacts.

Crucially, **`environment_id` is the absolute path string**, persisted on the
`workspace` row and read back as a path all over the codebase (diagnostics reads
`Path(workspace.environment_id)/state/…`, deletion does `Path(environment_id)`,
the branch/diff code resolves `<env>/code`, etc.). The id is self-describing, so
old and new layouts can coexist — a relocation changes only where *new* ids
point, and a migration rewrites *existing* ids.

## Target layout

```
~/repos/sculptor/            # the user's repo (project_path)
~/repos/.sculptor/           # NEW: hidden, sibling of the repo
  <uuid>/
    code/                    # the git worktree
    state/ … artifacts/ …
```

i.e. `project_path.parent / f".{project_path.name}" / <uuid>`.

## Part A — relocate NEW workspaces (small, self-contained)

`create_environment(project_path, …)` already has the repo path, so:

1. Make `_create_workspace_path` take `project_path` and build the per-project
   hidden base: `project_path.parent / ("." + project_path.name) / uuid`, `mkdir`.
   Drop the module-level `LOCAL_WORKSPACE_DIR` constant (it can't be per-project).
2. **Stale-environment cleanup** (`_cleanup_stale_environments`) currently scans
   `LOCAL_WORKSPACE_DIR.iterdir()` and `rmtree`s any dir not matching an active
   `environment_id`. Once ids point at per-project hidden dirs this scanner both
   (a) never cleans the new locations and (b) must not be pointed at a single
   base. Rework it to derive the set of base dirs from the active workspaces'
   `environment_id` parents (and/or the projects' repo paths) and scan those.
   **This is the highest-risk edit — a wrong base makes it delete live worktrees.**
3. `get_workspaces_folder()` / the `SCULPTOR_WORKSPACES_FOLDER` override (in
   `utils/build.py`): decide precedence. Simplest: the env override, when set,
   still forces the old flat layout (keeps the nested-dev-instance use case); the
   per-project layout is the default when it is unset.

New workspaces then live beside their repo; existing workspaces keep working
(their ids still point at `~/.sculptor/workspaces/…`). This alone satisfies "new
worktrees go to the better location" without touching any existing data.

## Part B — migrate EXISTING workspaces (the hard part)

Existing `environment_id`s point into `~/.sculptor/workspaces`. To move them we
must move a **git worktree**, not just a directory — the worktree's `.git`
gitfile and the main repo's `.git/worktrees/<name>/gitdir` both hold absolute
paths. A plain `mv` corrupts the worktree. Per workspace, with its agent and
terminals **stopped** (a live process cwd'd in `code/` blocks the move):

1. Compute the new dir `~/repos/.<repo>/<uuid>/` and `mkdir -p` it.
2. `git -C <repo> worktree move <old>/code <new>/code` — git rewrites both
   gitfile pointers. (Falls back to `git worktree repair` if a plain move was
   already done.)
3. `mv <old>/state <new>/state`, `<old>/artifacts <new>/artifacts`, and any
   loose files (`session_id`, `setup_log.txt`, `terminal_shell_pid`, …).
4. Update the DB: `workspace.environment_id = str(<new>)` (one field; nothing
   else references the old path once this is set).
5. Remove the now-empty `<old>` dir.

Ship this as a one-time, idempotent migration (a `sculpt` debug command or a
startup migration that runs once), operating only on workspaces whose
`environment_id` is still under the old base, and skipping any with a running
agent until it can stop them cleanly. Back up the DB first (the backend already
copies `database.db` → `database.backup` on startup).

The current user has **9 live workspaces** across several repos, so the migration
must group by project and resolve each repo's `project_path`.

## Risks / gotchas

- **Cleanup scanner deleting live worktrees** — the single biggest risk (Part A
  step 2). Add a guard: never `rmtree` a dir that is (or contains) a registered
  git worktree unless it is provably orphaned.
- **git worktree pointers** — never `mv` a worktree; always `git worktree move`
  / `repair`. A half-migrated worktree (dir moved, pointers stale) makes `git`
  fail inside the workspace.
- **`environment_id` = path coupling** — every consumer treats the id as an
  absolute path; the migration's DB rewrite must be atomic with the on-disk move
  (or ordered so a crash leaves a repairable, not lost, state).
- **Repo parent not writable / repo at filesystem root** — `project_path.parent`
  may be unwritable or odd (e.g. a repo directly under `/`). Fall back to the old
  `~/.sculptor/workspaces` base in that case rather than failing creation.
- **Name collisions** — two repos with the same basename in different parents get
  distinct hidden dirs (each beside its own repo), so no collision. But a repo
  named `sculptor` yields `~/repos/.sculptor`, distinct from the data dir
  `~/.sculptor` — similar name, different location; worth a comment.
- **Hidden dir inside a git repo** — the hidden base is a *sibling* of the repo,
  not inside it, so it never shows in the repo's `git status`. Confirm the parent
  (`~/repos`) is not itself a repo that would then see `.sculptor/` as untracked.
- **Path length** — the new path (`~/repos/.sculptor/<uuid>/code`) is shorter
  than deeply nested `.dev_sculptor/workspaces/<id>/code` chains, so the
  path-length limit that motivated `SCULPTOR_WORKSPACES_FOLDER` is not a concern.

## Scope boundary — the rest of the `~/.sculptor` exodus

This doc covers **worktrees only**. `~/.sculptor` also holds, and this does NOT
move: `internal/database.db` (+ backup), `internal/logs/`,
`internal/dependencies/` (managed claude/pi binaries), `internal/electron/`
(Electron userData), `terminal_agents/`, and `extensions/`. Fully eliminating
`~/.sculptor` means relocating those too and is a separate, larger design — much
of it is a single global store, not per-project, so it does not follow the
beside-the-repo model. Recommend landing worktree relocation first (highest
day-to-day value, self-contained) and treating the data/logs/deps move as a
follow-up.

## Files to touch

- `services/workspace_service/environment_manager/default_implementation.py` —
  `_create_workspace_path` (per-project base) and `_cleanup_stale_environments`
  (scan the right bases). The bulk of Part A.
- `utils/build.py` — `get_workspaces_folder` / `SCULPTOR_WORKSPACES_FOLDER`
  precedence.
- A one-time migration entrypoint for Part B (new file, e.g. a `sculpt debug`
  subcommand or a startup migration), plus tests that build a real worktree,
  move it, and assert git still resolves inside it and `environment_id` updated.
- Tests: env creation lands under `<repo>/../.<repo>/`; cleanup never removes a
  live worktree; migration is idempotent and repairs git pointers.
