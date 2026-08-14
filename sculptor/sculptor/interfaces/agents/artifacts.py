from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import AnyUrl
from pydantic import Field

from sculptor.foundation.pydantic_serialization import SerializableModel


class AgentTaskStatus(StrEnum):
    """Status of a single agent task in a TaskListArtifact.

    Named to disambiguate from sculptor.web.derived.TaskStatus (the
    runner-level status with BUILDING/RUNNING/etc.).
    """

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class Task(SerializableModel):
    id: str
    subject: str
    description: str = ""
    active_form: str | None = None
    status: AgentTaskStatus
    blocks: list[str] = Field(default_factory=list)
    blocked_by: list[str] = Field(default_factory=list)
    owner: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskListArtifact(SerializableModel):
    """Task list artifact backed by Claude Code's per-task JSON files."""

    object_type: str = "TaskListArtifact"
    version: int = 2
    tasks: list[Task]


class DiffArtifact(SerializableModel):
    """Unified diff artifact containing all diff types."""

    object_type: str = "DiffArtifact"
    uncommitted_diff: str = ""
    # The "All changes" diff: from merge-base(base_ref, HEAD) to the working tree,
    # where base_ref is the worktree's parent (the branch/commit it was created
    # from) — so this shows what the workspace changed since branching, not the
    # divergence from a distant mainline.
    target_branch_diff: str = ""
    # Commit SHA of merge-base(base_ref, HEAD) — the ref the target_branch_diff's
    # old-side line numbers reference. The frontend fetches the "old" file
    # content for hunk expansion at this commit so the line arrays stay in sync
    # with the diff. Empty when there is no base ref or no merge-base.
    target_branch_merge_base: str = ""
    # True when target_branch_diff was dropped for exceeding the size cap: the
    # frontend shows a "diff too large" notice rather than an empty ("no changes")
    # view. See _MAX_DIFF_BYTES in the workspace service.
    target_branch_diff_truncated: bool = False
    file_errors: dict[str, str] = Field(
        default_factory=dict,
        description="Per-file diff generation errors. Maps relative file path to error message.",
    )


class AgentArtifact(SerializableModel):
    """
    An artifact produced by the agent during its work. Represents the "output" of the agent's work.

    The URL should point to a location where the artifact can be accessed.
    """

    # used to dispatch and discover the type of message
    object_type: str
    # the name of the artifact,
    # can be used to provide some structure to the outputs of an agent.
    # for a file, this is something like "output.txt" or "branch/main" or "whatever/thing.png"
    # for a branch, this is the branch name.
    name: str
    # where the artifact can be found
    url: AnyUrl


class FileAgentArtifact(AgentArtifact):
    object_type: str = "FileAgentArtifact"


ArtifactUnion = DiffArtifact | TaskListArtifact


class ArtifactType(StrEnum):
    """Types of artifacts that agents can produce."""

    DIFF = "DIFF"  # Unified diff artifact with all three diff types
    PLAN = "PLAN"
