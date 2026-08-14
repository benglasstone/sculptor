import { useCallback, useEffect, useMemo, useState } from "react";

import { workspaceOpenInOs } from "~/api";
import { useForceRefreshWorkspaceDiff, useWorkspaceDiff } from "~/common/state/hooks/useWorkspaceDiff.ts";
import { useWorkspaceFiles } from "~/common/state/hooks/useWorkspaceFiles.ts";
import { parseDiff } from "~/components/DiffUtils.ts";
import type { DiffScope } from "~/pages/workspace/components/diffPanel/types.ts";

import type { FileStatus, FlatFileEntry, PerFileDiff, TreeNode } from "./types.ts";
import { buildFileTree, computeFolderChangeCounts, determineFileStatus, filterFilesBySubstring } from "./utils.ts";

/** Selects the appropriate diff string for the given scope. */
const selectDiffString = (
  diff: { uncommittedDiff?: string | null; targetBranchDiff?: string | null } | null,
  scope: DiffScope,
): string | null | undefined => {
  if (!diff) return null;
  return scope === "vs-target-branch" ? diff.targetBranchDiff : diff.uncommittedDiff;
};

/** Parses the workspace diff string once and returns both a status map and a per-file diff map.
 *  Shared between useFileStatusMap and usePerFileDiffMap to avoid parsing the same diff twice. */
const useParsedDiffMaps = (
  workspaceId: string,
  scope: DiffScope,
): { statusMap: Map<string, FileStatus>; perFileDiffMap: Map<string, PerFileDiff> } => {
  const { data: diff } = useWorkspaceDiff(workspaceId);
  const diffString = selectDiffString(diff ?? null, scope);

  return useMemo(() => {
    const statusMap = new Map<string, FileStatus>();
    const perFileDiffMap = new Map<string, PerFileDiff>();
    if (!diffString) {
      return { statusMap, perFileDiffMap };
    }

    const parsed = parseDiff(diffString);
    for (const fileChange of parsed.fileChanges) {
      const { referenceFileName, previousFileName } = fileChange.fileNames;
      const status = determineFileStatus(fileChange);
      statusMap.set(referenceFileName, status);
      perFileDiffMap.set(referenceFileName, {
        filePath: referenceFileName,
        previousFilePath: previousFileName !== referenceFileName ? previousFileName : null,
        status,
        diffString: fileChange.diffString,
        addedLines: fileChange.changes.added,
        removedLines: fileChange.changes.removed,
      });
    }

    return { statusMap, perFileDiffMap };
  }, [diffString]);
};

/** Builds a map from file path to FileStatus by parsing the workspace diff.
 *  When scope is "uncommitted" (default), uses uncommittedDiff (changes since HEAD),
 *  matching the behavior of `git status`.
 *  When scope is "vs-target-branch", uses targetBranchDiff (all changes vs target branch). */
export const useFileStatusMap = (workspaceId: string, scope: DiffScope = "uncommitted"): Map<string, FileStatus> => {
  return useParsedDiffMaps(workspaceId, scope).statusMap;
};

/** Builds a map from file path to per-file diff data (status, line counts, previous path).
 *  Uses the same scope as useFileStatusMap for consistency. */
export const usePerFileDiffMap = (workspaceId: string, scope: DiffScope = "uncommitted"): Map<string, PerFileDiff> => {
  return useParsedDiffMaps(workspaceId, scope).perFileDiffMap;
};

/** The two derived products of a file list + diff: the tree and its per-folder change counts. */
type DerivedFileTree = { tree: Array<TreeNode>; folderChangeCounts: Map<string, number> };

// Stable empty products so an uncached first paint doesn't allocate (and doesn't
// churn referential identity across renders).
const EMPTY_FOLDER_COUNTS: Map<string, number> = new Map();
const EMPTY_DERIVED_TREE: DerivedFileTree = { tree: [], folderChangeCounts: EMPTY_FOLDER_COUNTS };

// The file tree is rebuilt OFF the urgent render path (see useFileTree) and cached
// per workspace+scope, so revisiting an already-open workspace shows its tree
// instantly instead of rebuilding on the switch's critical path. The cache is
// bounded; the oldest entry is evicted once it is full (Map preserves insertion
// order). Sized to comfortably cover the workspaces a session cycles through.
const MAX_CACHED_FILE_TREES = 24;
const fileTreeCache = new Map<string, DerivedFileTree>();

const fileTreeCacheKey = (workspaceId: string, scope: DiffScope): string => `${workspaceId}::${scope}`;

/** Builds the tree and folder counts from a file list + diff. Pure; the caller
 *  decides when to run it (useFileTree runs it after paint, never during the
 *  blocking switch render). */
const buildDerivedFileTree = (
  files: ReadonlyArray<{ path: string; type: "file" | "directory" }>,
  statusMap: Map<string, FileStatus>,
  fileErrors: Record<string, string>,
): DerivedFileTree => {
  const tree = buildFileTree({ files, fileStatusMap: statusMap, fileErrors });

  // Add deleted files from the diff that don't appear in the file list.
  const existingPaths = new Set(files.map((f) => f.path));
  for (const [filePath, status] of statusMap) {
    if (status === "D" && !existingPaths.has(filePath)) {
      addDeletedFileToTree({ tree, filePath, fileErrors });
    }
  }

  return { tree, folderChangeCounts: computeFolderChangeCounts(tree) };
};

type UseFileTreeResult = {
  tree: Array<TreeNode>;
  folderChangeCounts: Map<string, number>;
  /** True while we don't have file list data to show yet. */
  isPending: boolean;
  /** True while a diff fetch is in flight (initial or background refresh). */
  isFetching: boolean;
  /** True while the backend is recomputing the diff (`diff_status` is GENERATING). */
  isGenerating: boolean;
  refetch: () => void;
};

/** Builds the file tree and folder change counts from the workspace file list and diff. */
export const useFileTree = (workspaceId: string, scope: DiffScope = "uncommitted"): UseFileTreeResult => {
  const { data: files, isPending, isFetching: isFilesFetching, refetch: refetchFiles } = useWorkspaceFiles(workspaceId);
  const statusMap = useFileStatusMap(workspaceId, scope);
  const { data: diff, isFetching: isDiffFetching, isGenerating } = useWorkspaceDiff(workspaceId);
  const refreshDiff = useForceRefreshWorkspaceDiff(workspaceId);
  const fileErrors = useMemo(() => diff?.fileErrors ?? {}, [diff?.fileErrors]);
  const isFetching = isFilesFetching || isDiffFetching;

  // The tree is derived OFF the urgent render path so a workspace switch paints
  // the chat/terminal first and the tree fills in a frame later — on a large repo
  // the build is tens of ms of synchronous work that otherwise blocked the switch's
  // first paint. Two pieces make that work without flashing the wrong workspace:
  //
  //  - `derived` holds what to render NOW: the cached tree for THIS workspace+scope
  //    (instant on revisit) or the empty tree on a first, uncached visit.
  //  - a passive effect (runs AFTER paint) builds/refreshes the tree and caches it.
  const cacheKey = fileTreeCacheKey(workspaceId, scope);
  const [derived, setDerived] = useState<DerivedFileTree>(() => fileTreeCache.get(cacheKey) ?? EMPTY_DERIVED_TREE);

  // On a workspace/scope switch the key changes; swap synchronously to that key's
  // cached tree (or empty) so we never show the previous workspace's tree for a
  // frame. This is React's "adjust state when a prop changes during render" pattern:
  // the setState reschedules this render before it commits, so nothing stale paints.
  const [shownKey, setShownKey] = useState(cacheKey);
  if (shownKey !== cacheKey) {
    setShownKey(cacheKey);
    setDerived(fileTreeCache.get(cacheKey) ?? EMPTY_DERIVED_TREE);
  }

  // Build/refresh after paint. Re-runs whenever the inputs change (a file or diff
  // update), always off the blocking path. The build is cheap enough to run inline
  // in the effect; caching makes repeat switches free.
  useEffect(() => {
    if (!files) {
      return;
    }
    const result = buildDerivedFileTree(files, statusMap, fileErrors);
    if (!fileTreeCache.has(cacheKey) && fileTreeCache.size >= MAX_CACHED_FILE_TREES) {
      const oldest = fileTreeCache.keys().next().value;
      if (oldest !== undefined) {
        fileTreeCache.delete(oldest);
      }
    }
    fileTreeCache.set(cacheKey, result);
    // Deliberate: the whole point is to build AFTER paint and then re-render with
    // the result. The follow-up render this rule warns about is the intended
    // behavior (paint the chat/terminal first, fill the tree in a frame later);
    // reflecting post-paint computed data inherently needs a state update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDerived(result);
  }, [cacheKey, files, statusMap, fileErrors]);

  const { tree, folderChangeCounts } = derived;

  // Combined refetch: refresh both the file list and the diff so the
  // Uncommitted tab reflects external changes (e.g. files created via terminal).
  const refetch = useCallback(() => {
    refetchFiles();
    void refreshDiff();
  }, [refetchFiles, refreshDiff]);

  return { tree, folderChangeCounts, isPending, isFetching, isGenerating, refetch };
};

const addDeletedFileToTree = ({
  tree,
  filePath,
  fileErrors,
}: {
  tree: Array<TreeNode>;
  filePath: string;
  fileErrors: Record<string, string>;
}): void => {
  const segments = filePath.split("/");
  const fileName = segments[segments.length - 1];

  if (segments.length === 1) {
    if (tree.some((n) => n.path === filePath)) {
      return;
    }
    tree.push({
      name: fileName,
      path: filePath,
      type: "file",
      children: [],
      status: "D",
      errorMessage: fileErrors[filePath],
    });
    return;
  }

  let currentLevel = tree;
  for (let i = 0; i < segments.length - 1; i++) {
    const folderName = segments[i];
    const baseFolderPath = segments.slice(0, i + 1).join("/");
    // If a non-directory node (e.g. a symlink that replaced the directory)
    // already occupies the path we'd use for the synthesized folder, fall
    // back to a disambiguated path with a trailing slash so the React key
    // doesn't collide with the file at the same path.
    const hasConflict = currentLevel.some((n) => n.path === baseFolderPath && n.type !== "directory");
    const folderPath = hasConflict ? `${baseFolderPath}/` : baseFolderPath;
    const displayName = hasConflict ? `${folderName}/` : folderName;
    let folder = currentLevel.find((n) => n.path === folderPath && n.type === "directory");
    if (!folder) {
      folder = {
        name: displayName,
        path: folderPath,
        type: "directory",
        children: [],
      };
      currentLevel.push(folder);
    }
    currentLevel = folder.children;
  }

  if (currentLevel.some((n) => n.path === filePath)) {
    return;
  }
  currentLevel.push({
    name: fileName,
    path: filePath,
    type: "file",
    children: [],
    status: "D",
    errorMessage: fileErrors[filePath],
  });
};

const EMPTY_MATCHING_PATHS = new Set<string>();

type UseFileSearchResult = {
  results: Array<FlatFileEntry>;
  resultCount: number;
  matchingPaths: Set<string>;
};

/** Searches workspace files by case-insensitive substring match on file path. */
export const useFileSearch = (workspaceId: string, query: string): UseFileSearchResult => {
  const { data: files } = useWorkspaceFiles(workspaceId);

  return useMemo(() => {
    if (!files || query === "") {
      return { results: [], resultCount: 0, matchingPaths: EMPTY_MATCHING_PATHS };
    }
    return filterFilesBySubstring(files, query);
  }, [files, query]);
};

export const openInOs = async ({
  workspaceId,
  path,
  action,
}: {
  workspaceId: string;
  path: string;
  action: "open_file" | "open_containing_folder";
}): Promise<void> => {
  try {
    await workspaceOpenInOs({
      path: { workspace_id: workspaceId },
      body: { path, action },
    });
  } catch (error) {
    console.error("Error opening in OS:", error);
  }
};
