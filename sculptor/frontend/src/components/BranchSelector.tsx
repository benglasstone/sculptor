import { Flex, Text } from "@radix-ui/themes";
import { GitBranchIcon } from "lucide-react";
import type { ReactElement } from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import type { RepoInfo } from "~/api";
import { ElementIds, fetchProjectOrigin } from "~/api";
import { BranchSelectorCore, type BranchWithBadges } from "~/components/BranchSelectorCore.tsx";

import styles from "./BranchSelector.module.scss";

type BranchSelectorProps = {
  repoInfo: RepoInfo | null;
  fetchRepoInfo: () => Promise<RepoInfo | undefined>;
  sourceBranch: string | undefined;
  setUserSelectedBranch: (branch: string) => void;
  disabled?: boolean;
  triggerVariant?: "soft" | "ghost";
  /** Extra class merged onto the trigger (e.g. the modal's breadcrumb-chip style). */
  className?: string;
};

const BranchSelectorComponent = ({
  repoInfo,
  fetchRepoInfo,
  sourceBranch,
  setUserSelectedBranch,
  disabled = false,
  triggerVariant = "soft",
  className,
}: BranchSelectorProps): ReactElement => {
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  // Drop refresh requests that arrive while one is already in flight, so they
  // don't stack into concurrent fetches.
  const isFetchingRef = useRef(false);

  const selectedBranchName = sourceBranch || "";
  const areBranchesLoaded = (repoInfo?.recentBranches?.length ?? 0) > 0;

  const branches: Array<BranchWithBadges> = useMemo(() => {
    const localBranches = repoInfo?.recentBranches || [];
    const localSet = new Set(localBranches);
    const local: Array<BranchWithBadges> = localBranches.map((branch) => ({
      branch,
      badges: branch === repoInfo?.currentBranch ? ["current"] : [],
    }));
    // Remote-tracking branches (e.g. `origin/foo` fetched via "fetch from
    // origin") are selectable too, badged so they read as remote; a new worktree
    // branch is created off the selected one. Skip remotes shadowed by a local.
    const remote: Array<BranchWithBadges> = (repoInfo?.remoteBranches || [])
      .filter((branch) => !localSet.has(branch))
      .map((branch) => ({ branch, badges: ["remote"] }));
    return [...local, ...remote];
  }, [repoInfo]);

  // "Fetch from origin" pulls newly-pushed branches (e.g. ones with open PRs)
  // into the remote-tracking set, then refreshes so they appear in the list.
  const [isFetchingFromOrigin, setIsFetchingFromOrigin] = useState(false);
  const handleFetchFromOrigin = useCallback((): void => {
    const projectId = repoInfo?.projectId;
    if (projectId == null || isFetchingFromOrigin) return;
    setIsFetchingFromOrigin(true);
    void fetchProjectOrigin({ path: { project_id: projectId } })
      .then(() => fetchRepoInfo())
      .catch((error: unknown) => {
        console.error("Failed to fetch from origin:", error);
      })
      .finally(() => setIsFetchingFromOrigin(false));
  }, [repoInfo?.projectId, fetchRepoInfo, isFetchingFromOrigin]);

  const displayBranchName = selectedBranchName;

  // Refresh the branch list in response to a user interaction (selecting a
  // branch or opening the dropdown), straight from the handler. A request that
  // arrives while a refresh is in flight is dropped.
  const triggerFetch = useCallback((): void => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsFetchingBranches(true);
    void fetchRepoInfo().finally(() => {
      isFetchingRef.current = false;
      setIsFetchingBranches(false);
    });
  }, [fetchRepoInfo]);

  return (
    <BranchSelectorCore
      selectedBranch={selectedBranchName}
      onBranchSelected={(branch) => {
        setUserSelectedBranch(branch);
        triggerFetch();
      }}
      branches={branches}
      specialBranchFilter={(b) =>
        b.badges.some((badge) => (typeof badge === "string" ? badge : badge.text) === "current")
      }
      onFetchFromOrigin={handleFetchFromOrigin}
      isFetchingFromOrigin={isFetchingFromOrigin}
      isLoadingBranches={!areBranchesLoaded && isFetchingBranches}
      disabled={disabled}
      triggerContent={
        <Flex align="center" gap="1" className={styles.dropdownButton}>
          <GitBranchIcon size={12} />
          <Text className={styles.selectorLabel}>source</Text>
          <Text className={styles.branchName} truncate={true}>
            {displayBranchName}
          </Text>
        </Flex>
      }
      triggerVariant={triggerVariant}
      testId={ElementIds.BRANCH_SELECTOR}
      className={className ? `${styles.dropdownButton} ${className}` : styles.dropdownButton}
      onOpenChange={(open) => {
        if (open) triggerFetch();
      }}
    />
  );
};

export const BranchSelector = memo(BranchSelectorComponent);
