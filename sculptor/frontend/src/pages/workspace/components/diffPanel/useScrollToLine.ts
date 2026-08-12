import type { RefObject } from "react";
import { useEffect } from "react";

// Give up looking for the line after this long. Pierre renders asynchronously
// (worker-pool highlighting), so the row does not exist on the first frame --
// but a line past the end of the file never appears at all, and a retry loop
// with no deadline would spin for the life of the tab.
const LOOKUP_TIMEOUT_MS = 5_000;

// Leave the target line this far below the top of the viewport rather than
// flush against it, so the lines above it stay readable as context.
const SCROLL_PADDING_PX = 120;

/**
 * The rendered row for a 1-based line number, or null when it is not (yet) in
 * the DOM.
 *
 * Pierre renders each content row with `data-line` set to the line number
 * (see its `processLine`), inside the shadow root of its file element -- so
 * the search descends through shadow roots the same way the in-file search
 * does. Note `data-line` is the LINE NUMBER; the sibling `data-line-index`
 * attribute is 0-based and belongs to Pierre's own bookkeeping.
 */
export const findLineElement = (host: HTMLElement | null, lineNumber: number): HTMLElement | null => {
  if (host === null) return null;
  const selector = `[data-line="${lineNumber}"]`;

  const search = (root: ParentNode): HTMLElement | null => {
    const direct = root.querySelector(selector);
    if (direct instanceof HTMLElement) return direct;
    for (const element of root.querySelectorAll("*")) {
      if (element instanceof HTMLElement && element.shadowRoot) {
        const nested = search(element.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  };

  return search(host);
};

/** Scroll `line` into view within `scrollable`, leaving context above it. */
export const scrollLineIntoView = (line: HTMLElement, scrollable: HTMLElement): void => {
  const lineRect = line.getBoundingClientRect();
  const scrollableRect = scrollable.getBoundingClientRect();

  const isComfortablyVisible =
    lineRect.top >= scrollableRect.top + SCROLL_PADDING_PX && lineRect.bottom <= scrollableRect.bottom;

  // Already well placed: scrolling anyway would yank the view for a line the
  // reader can see, which is the common case when a file opens near its top.
  if (isComfortablyVisible) return;

  scrollable.scrollBy({ top: lineRect.top - scrollableRect.top - SCROLL_PADDING_PX, behavior: "smooth" });
};

type UseScrollToLineParams = {
  /** Element containing Pierre's file view; the row is found beneath it. */
  contentRef: RefObject<HTMLElement | null>;
  /** The vertically scrolling element to move. Passed explicitly rather than
   *  discovered: Pierre renders its own (horizontal) scroller inside the
   *  content, and picking that one would scroll nothing. */
  scrollRef: RefObject<HTMLElement | null>;
  /** 1-based line to scroll to, or undefined to leave the view alone. */
  lineNumber: number | undefined;
  /** Timestamp of the open that asked for this line. Re-clicking the same
   *  `file.ts:42` link produces the same line with a newer timestamp, and must
   *  scroll again after the reader has scrolled away. */
  requestedAt: number | undefined;
};

/**
 * Scroll the file view to a requested line once Pierre has rendered it.
 *
 * The row is polled for by animation frame rather than waited on with a
 * MutationObserver: the row lives in a shadow root that does not exist until
 * Pierre's first render, and an observer cannot be attached to a root that
 * isn't there yet. The loop stops the moment the line is found.
 */
export const useScrollToLine = ({ contentRef, scrollRef, lineNumber, requestedAt }: UseScrollToLineParams): void => {
  useEffect(() => {
    if (lineNumber === undefined) return;

    let frame = 0;
    const deadline = performance.now() + LOOKUP_TIMEOUT_MS;

    const attempt = (): void => {
      const line = findLineElement(contentRef.current, lineNumber);
      const container = scrollRef.current;
      if (line !== null && container !== null) {
        scrollLineIntoView(line, container);
        return;
      }

      if (performance.now() < deadline) {
        frame = requestAnimationFrame(attempt);
      }
    };

    frame = requestAnimationFrame(attempt);
    return (): void => cancelAnimationFrame(frame);
  }, [contentRef, scrollRef, lineNumber, requestedAt]);
};
