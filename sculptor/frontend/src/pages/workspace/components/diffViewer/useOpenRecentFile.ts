import { useSetAtom } from "jotai";
import { useCallback } from "react";

import type { RecentDiffFile } from "~/pages/workspace/components/diffPanel/atoms.ts";
import {
  openCommitDiffTabAtom,
  openDiffTabAtom,
  openFileViewTabAtom,
} from "~/pages/workspace/components/diffPanel/atoms.ts";
import { changesScopeAtomFamily } from "~/pages/workspace/panels/fileBrowser/atoms.ts";

import type { RecentFilesScope } from "./FilePathSelect.tsx";

/**
 * Re-open a recently-viewed file in the panel it was viewed in.
 *
 * Shared by the header's path dropdown (picking an entry) and the header's
 * close button (falling back to the next file), so both routes into a recent
 * file agree on what "open this entry" means per panel.
 */
export const useOpenRecentFile = (
  workspaceId: string,
  recentFilesScope: RecentFilesScope,
): ((entry: RecentDiffFile) => void) => {
  const { panel } = recentFilesScope;
  const openDiff = useSetAtom(openDiffTabAtom);
  const openFileView = useSetAtom(openFileViewTabAtom);
  const openCommitDiff = useSetAtom(openCommitDiffTabAtom);
  const setChangesScope = useSetAtom(changesScopeAtomFamily(workspaceId));

  return useCallback(
    (entry: RecentDiffFile): void => {
      if (panel === "files") {
        openFileView({ workspaceId, filePath: entry.path });
        return;
      }

      if (panel === "changes") {
        // A Changes recent carries the scope it was viewed under; re-point the
        // panel's scope picker at it so the picker, tree, and viewer all
        // reference the same base (an undefined scope means the uncommitted diff).
        setChangesScope(entry.scope ?? "uncommitted");
        openDiff({ workspaceId, filePath: entry.path, status: entry.status ?? "M", scope: entry.scope });
        return;
      }

      if (entry.commitHash !== undefined) {
        openCommitDiff({ workspaceId, commitHash: entry.commitHash, filePath: entry.path });
      }
    },
    [panel, workspaceId, openDiff, openFileView, openCommitDiff, setChangesScope],
  );
};
