import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

import { getMetaKey, isModifierPressed } from "~/electron/utils.ts";
import { splitFilePathSegments } from "~/pages/workspace/components/chat-alpha/filePathLinkify.ts";

import styles from "./terminalFileLinks.module.scss";

/** A file path found on one terminal line, in xterm's 1-based column space. */
export type TerminalFilePathMatch = {
  /** Workspace-relative path to open (line-number suffix already stripped). */
  navPath: string;
  /** First column of the path text, 1-based and inclusive. */
  startColumn: number;
  /** Last column of the path text, 1-based and inclusive. */
  endColumn: number;
};

/**
 * Locate workspace file paths in a single line of terminal text.
 *
 * Detection is delegated to `splitFilePathSegments` — the same matcher the chat
 * renderer uses — so a path that is clickable in chat is clickable in the
 * terminal and vice versa. Segments come back in source order, so accumulating
 * their lengths recovers each path's column range without re-running the regex.
 */
export const findFilePathMatches = (
  line: string,
  workspaceCodePath: string | null,
): ReadonlyArray<TerminalFilePathMatch> => {
  const matches: Array<TerminalFilePathMatch> = [];
  let offset = 0;
  for (const segment of splitFilePathSegments(line, workspaceCodePath)) {
    if (segment.kind === "path") {
      matches.push({
        navPath: segment.navPath,
        startColumn: offset + 1,
        endColumn: offset + segment.value.length,
      });
    }
    offset += segment.value.length;
  }
  return matches;
};

type LinkProviderOptions = {
  terminal: Terminal;
  /** Absolute path of the workspace clone, used to reject paths outside it. */
  workspaceCodePath: string | null;
  /** Called with the workspace-relative path when a link is activated. */
  onActivate: (navPath: string) => void;
  /** Host for the hover hint. Omit to skip the hint (e.g. in unit tests, where
   *  there is no laid-out terminal to position it against). */
  hintContainer?: HTMLElement | null;
};

/** Shows/hides the "<mod>-click to open" hint that follows the pointer.
 *
 * xterm underlines a hovered link itself, but nothing in that says the link
 * needs a modifier -- without the hint, a plain click looks broken rather than
 * deliberate. Kept as one element per provider, created on first hover. */
type HoverHint = { show: (event: MouseEvent) => void; hide: () => void };

const createHoverHint = (container: HTMLElement): HoverHint => {
  let element: HTMLDivElement | null = null;

  return {
    show(event: MouseEvent): void {
      if (element === null) {
        element = document.createElement("div");
        element.className = styles.tooltip;
        element.textContent = `${getMetaKey()}-click to open`;
        container.appendChild(element);
      }
      // Offset from the pointer so the hint never lands under the cursor,
      // which would otherwise sit between the pointer and the link.
      element.style.left = `${event.clientX + 12}px`;
      element.style.top = `${event.clientY + 16}px`;
    },
    hide(): void {
      element?.remove();
      element = null;
    },
  };
};

/**
 * An xterm link provider that turns workspace file paths into ctrl/cmd-clickable
 * links (Cmd on macOS), matching the modifier an editor's terminal uses.
 *
 * A plain click is deliberately left alone: in a terminal, click-and-drag is
 * selection, and stealing plain clicks would break selecting a path to copy it.
 *
 * Known gap: xterm hands the provider one row at a time, so a path the TUI
 * wrapped across a row boundary is not detected. Claude wraps long paths often,
 * so this finds the short ones and misses the long ones rather than pretending
 * to be complete.
 */
export const createFilePathLinkProvider = ({
  terminal,
  workspaceCodePath,
  onActivate,
  hintContainer,
}: LinkProviderOptions): ILinkProvider => {
  const hint = hintContainer ? createHoverHint(hintContainer) : null;

  return {
    provideLinks(bufferLineNumber: number, callback: (links: Array<ILink> | undefined) => void): void {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const matches = findFilePathMatches(text, workspaceCodePath);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      callback(
        matches.map(
          (match): ILink => ({
            range: {
              start: { x: match.startColumn, y: bufferLineNumber },
              end: { x: match.endColumn, y: bufferLineNumber },
            },
            text: match.navPath,
            activate: (event: MouseEvent): void => {
              if (!isModifierPressed(event)) return;
              hint?.hide();
              onActivate(match.navPath);
            },
            hover: (event: MouseEvent): void => hint?.show(event),
            leave: (): void => hint?.hide(),
          }),
        ),
      );
    },
  };
};
