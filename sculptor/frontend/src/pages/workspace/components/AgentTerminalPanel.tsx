import { useSetAtom } from "jotai";
import type { ReactElement } from "react";
import { useCallback } from "react";

import { ElementIds } from "~/api";
import { useTaskWorkspaceId } from "~/common/state/hooks/useTaskHelpers.ts";
import { openFileViewTabAtom } from "~/pages/workspace/components/diffPanel/atoms.ts";
import { useWorkspaceCodePath } from "~/pages/workspace/hooks/useWorkspaceCodePath.ts";

import { useIsKnownWorkspaceFile } from "../panels/useIsKnownWorkspaceFile.ts";
import { useTerminal } from "../panels/useTerminal";
import styles from "./AgentTerminalPanel.module.scss";
import { useTerminalChatActions } from "./useTerminalChatActions.ts";

type AgentTerminalPanelProps = {
  taskId: string;
};

/**
 * Full-pane terminal for a terminal agent — occupies the space the chat
 * interface occupies for chat agents.
 *
 * Only mounted for the active agent tab: hidden-tab persistence comes from
 * the backend-owned PTY (the WebSocket reconnects with the replay buffer),
 * not from keeping xterm mounted. useTerminal's 4404 retry covers the
 * agent-still-BUILDING window before the backend handler registers the PTY.
 */
export const AgentTerminalPanel = ({ taskId }: AgentTerminalPanelProps): ReactElement => {
  useTerminalChatActions(taskId);
  // For a terminal agent this pane IS the conversation, so a file path the
  // agent prints here is the only place it can be clicked. Ctrl/cmd-click
  // opens it in the file viewer, matching the chat surface's path links.
  const workspaceId = useTaskWorkspaceId(taskId);
  const workspaceCodePath = useWorkspaceCodePath(workspaceId ?? "");
  const isKnownFile = useIsKnownWorkspaceFile(workspaceId ?? null);
  const openFileViewTab = useSetAtom(openFileViewTabAtom);
  const handleFilePathActivate = useCallback(
    (navPath: string, lineNumber: number | null): void => {
      if (workspaceId === undefined) return;
      openFileViewTab({ workspaceId, filePath: navPath, lineNumber: lineNumber ?? undefined });
    },
    [openFileViewTab, workspaceId],
  );

  const { terminalContainerRef } = useTerminal({
    terminalPath: `/api/v1/agents/${taskId}/terminal/ws`,
    isVisible: true,
    fontSize: 13,
    lineHeight: 1.1,
    onFilePathActivate: handleFilePathActivate,
    workspaceCodePath,
    isKnownFile,
    // The terminal is this agent's only input surface and the pane remounts
    // on every tab switch, so it must take keyboard focus immediately (SCU-1578).
    focusOnVisible: true,
  });

  return (
    <div className={styles.agentTerminalPanel} data-testid={ElementIds.AGENT_TERMINAL_PANEL}>
      <div ref={terminalContainerRef} className={styles.xtermWrapper} />
    </div>
  );
};
