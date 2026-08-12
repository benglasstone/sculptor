import { afterEach, describe, expect, it, vi } from "vitest";

import { findLineElement, scrollLineIntoView } from "./useScrollToLine.ts";

/** A host holding a Pierre-shaped file element: rows carrying `data-line` live
 *  inside a shadow root, which is why the finder cannot use a plain query. */
const buildFileHost = (lineNumbers: ReadonlyArray<number>): HTMLElement => {
  const host = document.createElement("div");
  const fileElement = document.createElement("div");
  host.appendChild(fileElement);
  const shadow = fileElement.attachShadow({ mode: "open" });
  for (const lineNumber of lineNumbers) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(lineNumber));
    row.setAttribute("data-line-index", String(lineNumber - 1));
    row.textContent = `line ${lineNumber}`;
    shadow.appendChild(row);
  }
  return host;
};

/** An element with the given viewport rect and a spyable scrollBy. */
const buildRectElement = (rect: { top: number; bottom: number }): HTMLElement => {
  const element = document.createElement("div");
  element.getBoundingClientRect = (): DOMRect => ({ ...rect, height: rect.bottom - rect.top }) as DOMRect;
  element.scrollBy = vi.fn();
  return element;
};

afterEach(() => vi.restoreAllMocks());

describe("findLineElement", () => {
  it("finds a row by line number inside the shadow root", () => {
    const host = buildFileHost([1, 2, 3]);
    expect(findLineElement(host, 2)?.textContent).toBe("line 2");
  });

  it("matches on the line number, not the 0-based index beside it", () => {
    const host = buildFileHost([10, 11]);
    // data-line-index for line 11 is 10 — a finder keying off the wrong
    // attribute would return line 11 when asked for line 10.
    expect(findLineElement(host, 10)?.textContent).toBe("line 10");
  });

  it("returns null for a line that is not rendered", () => {
    expect(findLineElement(buildFileHost([1, 2]), 99)).toBeNull();
  });

  it("returns null for a missing host", () => {
    expect(findLineElement(null, 1)).toBeNull();
  });
});

describe("scrollLineIntoView", () => {
  const scrollable = (): HTMLElement => buildRectElement({ top: 0, bottom: 500 });

  it("scrolls a line below the viewport to near the top", () => {
    const container = scrollable();
    scrollLineIntoView(buildRectElement({ top: 900, bottom: 916 }), container);
    // 900 - 0 - 120 padding: the line lands 120px below the top edge.
    expect(container.scrollBy).toHaveBeenCalledWith({ top: 780, behavior: "smooth" });
  });

  it("scrolls back up for a line above the viewport", () => {
    const container = scrollable();
    scrollLineIntoView(buildRectElement({ top: -300, bottom: -284 }), container);
    expect(container.scrollBy).toHaveBeenCalledWith({ top: -420, behavior: "smooth" });
  });

  it("leaves a comfortably visible line alone", () => {
    const container = scrollable();
    scrollLineIntoView(buildRectElement({ top: 200, bottom: 216 }), container);
    // Yanking the view for a line the reader can already see would be worse
    // than doing nothing.
    expect(container.scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls a line hidden under the top padding", () => {
    const container = scrollable();
    // Visible, but only 30px down: too close to the edge to read its context.
    scrollLineIntoView(buildRectElement({ top: 30, bottom: 46 }), container);
    expect(container.scrollBy).toHaveBeenCalledWith({ top: -90, behavior: "smooth" });
  });
});
