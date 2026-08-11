import type { ILink, Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";

import { createFilePathLinkProvider, findFilePathMatches } from "./terminalFileLinks.ts";

const WORKSPACE = "/repo/workspace";

// A terminal whose buffer is the given lines, exposing only what the provider
// reads (`buffer.active.getLine(...).translateToString(true)`).
const fakeTerminal = (lines: ReadonlyArray<string>): Terminal =>
  ({
    buffer: {
      active: {
        getLine: (index: number) =>
          index < lines.length ? { translateToString: (): string => lines[index] } : undefined,
      },
    },
  }) as unknown as Terminal;

describe("findFilePathMatches", () => {
  it("returns the 1-based inclusive column range of a path", () => {
    // "see " is 4 characters, so the path starts at column 5.
    const [match] = findFilePathMatches("see src/main.ts here", WORKSPACE);
    expect(match).toEqual({ navPath: "src/main.ts", lineNumber: null, startColumn: 5, endColumn: 15 });
  });

  it("finds a path at the very start of a line", () => {
    const [match] = findFilePathMatches("src/main.ts changed", WORKSPACE);
    expect(match.startColumn).toBe(1);
    expect(match.endColumn).toBe(11);
  });

  it("finds several paths on one line, in order", () => {
    const matches = findFilePathMatches("a/one.ts and b/two.py", WORKSPACE);
    expect(matches.map((m) => m.navPath)).toEqual(["a/one.ts", "b/two.py"]);
    expect(matches[1].startColumn).toBeGreaterThan(matches[0].endColumn);
  });

  it("strips a line-number suffix from the opened path but keeps it in the range", () => {
    const [match] = findFilePathMatches("src/main.ts:42", WORKSPACE);
    expect(match.navPath).toBe("src/main.ts");
    // The clickable region still covers the ":42" the user sees.
    expect(match.endColumn).toBe(14);
  });

  it("reports the line a path named, so the viewer can highlight it", () => {
    expect(findFilePathMatches("src/main.ts:42", WORKSPACE)[0].lineNumber).toBe(42);
    expect(findFilePathMatches("src/main.ts", WORKSPACE)[0].lineNumber).toBeNull();
    // Files are 1-based, so :0 names no line the viewer could highlight.
    expect(findFilePathMatches("src/main.ts:0", WORKSPACE)[0].lineNumber).toBeNull();
  });

  it("makes an absolute in-workspace path workspace-relative", () => {
    const [match] = findFilePathMatches(`${WORKSPACE}/src/main.ts`, WORKSPACE);
    expect(match.navPath).toBe("src/main.ts");
  });

  it("ignores a path outside the workspace", () => {
    expect(findFilePathMatches("/etc/hosts.yaml is elsewhere", WORKSPACE)).toEqual([]);
  });

  it("ignores a URL that contains a path-shaped tail", () => {
    expect(findFilePathMatches("https://example.com/src/main.ts", WORKSPACE)).toEqual([]);
  });

  it("returns nothing for a line with no path", () => {
    expect(findFilePathMatches("$ npm run build", WORKSPACE)).toEqual([]);
  });
});

describe("createFilePathLinkProvider", () => {
  const provideLinksFor = (
    line: string,
    onActivate = vi.fn(),
  ): { links: Array<ILink>; onActivate: ReturnType<typeof vi.fn> } => {
    const provider = createFilePathLinkProvider({
      terminal: fakeTerminal([line]),
      workspaceCodePath: WORKSPACE,
      onActivate,
    });
    const callback = vi.fn();
    // xterm addresses rows 1-based.
    provider.provideLinks(1, callback);
    return { links: callback.mock.calls[0][0], onActivate };
  };

  it("provides a link covering the path", () => {
    const { links } = provideLinksFor("see src/main.ts here");
    expect(links).toHaveLength(1);
    expect(links[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 15, y: 1 } });
    expect(links[0].text).toBe("src/main.ts");
  });

  it("provides nothing for a line without a path", () => {
    const { links } = provideLinksFor("$ npm run build");
    expect(links).toBeUndefined();
  });

  it("provides nothing for a row past the end of the buffer", () => {
    const provider = createFilePathLinkProvider({
      terminal: fakeTerminal(["src/main.ts"]),
      workspaceCodePath: WORKSPACE,
      onActivate: vi.fn(),
    });
    const callback = vi.fn();
    provider.provideLinks(99, callback);
    expect(callback).toHaveBeenCalledWith(undefined);
  });

  it("opens the file on a modifier-click", () => {
    const { links, onActivate } = provideLinksFor("see src/main.ts here");
    // jsdom reports a non-Mac platform, so Ctrl is the modifier here.
    links[0].activate(new MouseEvent("click", { ctrlKey: true }), "src/main.ts");
    expect(onActivate).toHaveBeenCalledWith("src/main.ts", null);
  });

  it("passes the named line to the opener", () => {
    const { links, onActivate } = provideLinksFor("see src/main.ts:42 here");
    links[0].activate(new MouseEvent("click", { ctrlKey: true }), "src/main.ts");
    expect(onActivate).toHaveBeenCalledWith("src/main.ts", 42);
  });

  it("shows a hover hint naming the modifier, and removes it on leave", () => {
    const container = document.createElement("div");
    const provider = createFilePathLinkProvider({
      terminal: fakeTerminal(["see src/main.ts here"]),
      workspaceCodePath: WORKSPACE,
      onActivate: vi.fn(),
      hintContainer: container,
    });
    const callback = vi.fn();
    provider.provideLinks(1, callback);
    const links: Array<ILink> = callback.mock.calls[0][0];

    expect(container.textContent).toBe("");

    links[0].hover?.(new MouseEvent("mousemove", { clientX: 40, clientY: 80 }), "src/main.ts");
    // jsdom reports a non-Mac platform, so the hint names Ctrl here.
    expect(container.textContent).toBe("Ctrl-click to open");

    links[0].leave?.(new MouseEvent("mouseout"), "src/main.ts");
    expect(container.textContent).toBe("");
  });

  it("clears the hover hint when the link is activated", () => {
    const container = document.createElement("div");
    const provider = createFilePathLinkProvider({
      terminal: fakeTerminal(["see src/main.ts here"]),
      workspaceCodePath: WORKSPACE,
      onActivate: vi.fn(),
      hintContainer: container,
    });
    const callback = vi.fn();
    provider.provideLinks(1, callback);
    const links: Array<ILink> = callback.mock.calls[0][0];

    links[0].hover?.(new MouseEvent("mousemove"), "src/main.ts");
    links[0].activate(new MouseEvent("click", { ctrlKey: true }), "src/main.ts");

    // The file view takes over the screen; a stranded hint would hang around
    // over whatever is under the pointer afterwards.
    expect(container.textContent).toBe("");
  });

  it("ignores a plain click, leaving click-drag selection alone", () => {
    const { links, onActivate } = provideLinksFor("see src/main.ts here");
    links[0].activate(new MouseEvent("click"), "src/main.ts");
    expect(onActivate).not.toHaveBeenCalled();
  });
});
