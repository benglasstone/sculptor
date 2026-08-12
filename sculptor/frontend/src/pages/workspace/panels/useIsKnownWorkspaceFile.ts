import { useCallback, useMemo } from "react";

import { useWorkspaceFiles } from "~/common/state/hooks/useWorkspaceFiles.ts";

/**
 * A predicate for "is this workspace-relative path a real file?".
 *
 * Backed by the workspace file list the Files panel already fetches, so this
 * adds no request of its own — react-query hands both callers the same cached
 * list.
 *
 * Returns false while the list is loading. Callers use this to decide whether
 * path-shaped text becomes a clickable link, and a link that cannot open
 * anything is worse than no link, so the loading window offers nothing rather
 * than guessing.
 */
export const useIsKnownWorkspaceFile = (workspaceId: string | null): ((navPath: string) => boolean) => {
  const { data: files } = useWorkspaceFiles(workspaceId);

  const knownPaths = useMemo(() => new Set((files ?? []).map((file) => file.path)), [files]);

  return useCallback((navPath: string): boolean => knownPaths.has(navPath), [knownPaths]);
};
