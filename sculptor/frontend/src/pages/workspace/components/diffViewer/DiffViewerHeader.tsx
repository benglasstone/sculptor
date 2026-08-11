import { Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { BookOpen, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useMemo } from "react";

import { ElementIds } from "~/api";
import type { FileContextMenuContext, FileStatus } from "~/pages/workspace/panels/fileBrowser/types.ts";
import { isBinaryFile } from "~/pages/workspace/panels/fileBrowser/utils.ts";

import styles from "./DiffViewerHeader.module.scss";
import { DiffViewerMenu } from "./DiffViewerMenu.tsx";
import type { RecentFilesScope } from "./FilePathSelect.tsx";
import { FilePathSelect } from "./FilePathSelect.tsx";
import type { DiffViewOptions, TreeViewOptions } from "./types.ts";

type DiffViewerHeaderProps = {
  workspaceId: string;
  filePath: string;
  /** Which panel's recents the path dropdown feeds and re-opens into. */
  recentFilesScope: RecentFilesScope;
  addedLines: number;
  removedLines: number;
  fileStatus: FileStatus | null;
  isBinary: boolean;
  /** The diff view controls in the triple-dot menu. Absent for
   *  file-view / commit-diff selections that have no diff toggles. */
  viewOptions?: DiffViewOptions;
  /** The tree view controls merged into the triple-dot menu. */
  treeOptions?: TreeViewOptions;
  /** Rendered before the breadcrumb — the sidebar-visibility toggle. */
  leadingControl?: ReactNode;
  /** The manual data refresh, surfaced as a triple-dot menu item. */
  onRefresh?: () => void;
  /** Quick-open icon that opens the file's rendered markdown / diagram view in
   *  the Files panel (offered on diff/commit headers). Omit to hide the icon.
   *  The label carries the tooltip and aria-label, whose wording differs
   *  between markdown and diagram files. */
  openRendered?: { label: string; handleOpen: () => void };
  /** Closes the open file, returning the viewer to its empty state. Omit to
   *  hide the close icon (the empty header has no file to close). */
  onClose?: () => void;
};

/**
 * The 41px viewer header: an optional leading control (sidebar toggle), the
 * file breadcrumb, line stats, and the single triple-dot options menu.
 */
export const DiffViewerHeader = ({
  workspaceId,
  filePath,
  recentFilesScope,
  addedLines,
  removedLines,
  fileStatus,
  isBinary: isBinaryProp,
  viewOptions,
  treeOptions,
  leadingControl,
  onRefresh,
  openRendered,
  onClose,
}: DiffViewerHeaderProps): ReactElement => {
  const isBinary = isBinaryProp || isBinaryFile(filePath.split("/").pop() ?? "");

  const fileContext: FileContextMenuContext = useMemo(
    () => ({
      filePath,
      isFolder: false,
      fileStatus: fileStatus ?? undefined,
      isBinary,
      source: "diff-header" as const,
    }),
    [filePath, fileStatus, isBinary],
  );

  return (
    <Flex
      align="center"
      gap="2"
      px="3"
      flexShrink="0"
      className={styles.header}
      data-testid={ElementIds.DIFF_FILE_HEADER}
    >
      {leadingControl}
      <FilePathSelect workspaceId={workspaceId} filePath={filePath} recentFilesScope={recentFilesScope} />

      <span className={styles.spacer} />

      {(addedLines > 0 || removedLines > 0) && (
        <span className={styles.lineStats}>
          <span className={styles.lineStatsAdded}>+{addedLines}</span>
          <span className={styles.lineStatsRemoved}>-{removedLines}</span>
        </span>
      )}

      {openRendered && (
        <Tooltip content={openRendered.label}>
          <IconButton
            variant="ghost"
            size="1"
            color="gray"
            onClick={openRendered.handleOpen}
            aria-label={openRendered.label}
            data-testid={ElementIds.DIFF_OPEN_RENDERED_MARKDOWN}
          >
            <BookOpen size={14} />
          </IconButton>
        </Tooltip>
      )}

      <DiffViewerMenu
        workspaceId={workspaceId}
        fileContext={fileContext}
        viewOptions={viewOptions}
        treeOptions={treeOptions}
        isBinary={isBinary}
        onRefresh={onRefresh}
      />

      {onClose && (
        <Tooltip content="Close file">
          <IconButton
            variant="ghost"
            size="1"
            color="gray"
            onClick={onClose}
            aria-label="Close file"
            data-testid={ElementIds.DIFF_CLOSE_FILE}
          >
            <X size={14} />
          </IconButton>
        </Tooltip>
      )}
    </Flex>
  );
};
