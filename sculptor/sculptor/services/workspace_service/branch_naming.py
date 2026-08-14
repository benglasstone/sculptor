"""Pure-function helpers for generating workspace branch names.

No git operations and no I/O. The caller is responsible for fetching
`git config user.name` and for choosing between a per-project override
and the user-global default pattern.
"""

from coolname import generate_slug
from slugify import slugify

_MAX_SLUG_LENGTH = 20
_RANDOM_SLUG_WORD_COUNT = 2


def slugify_workspace_name(name: str) -> str:
    """Slugify a user-supplied workspace name into a kebab-case slug.

    Empty or pure-whitespace/punctuation input returns the empty string.
    Output is capped on a word boundary to avoid a trailing partial token.
    """
    if not name or not name.strip():
        return ""
    return slugify(name, max_length=_MAX_SLUG_LENGTH, word_boundary=True, separator="-", lowercase=True)


def generate_random_slug() -> str:
    """Return a random `<adjective>-<noun>` slug (UX-quality randomness)."""
    return generate_slug(_RANDOM_SLUG_WORD_COUNT)


def next_indexed_branch_name(base: str, existing_branches: set[str]) -> str:
    """Return `<base>-<n>` for the lowest positive `n` not already in
    `existing_branches`.

    The convention for a new worktree branch: every workspace opened off a
    branch gets its own well-named branch, e.g. `main-1`, `main-2`. Pure; the
    caller supplies the existing branch names (from git)."""
    n = 1
    while f"{base}-{n}" in existing_branches:
        n += 1
    return f"{base}-{n}"


def resolve_pattern(pattern: str, user_slug: str, name_slug: str) -> str:
    """Substitute `<user>` and `<slug>` placeholders in `pattern`.

    Unknown placeholders (e.g. `<foo>`) are left literal. Empty
    substitutions collapse: a leading `/` is stripped and consecutive
    `/` characters are reduced to one.
    """
    resolved = pattern.replace("<user>", user_slug).replace("<slug>", name_slug)
    while "//" in resolved:
        resolved = resolved.replace("//", "/")
    if resolved.startswith("/"):
        resolved = resolved[1:]
    return resolved
