import type { Mermaid } from "mermaid";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { ElementIds } from "~/api";
import { useResolvedTheme } from "~/common/Utils.ts";

import styles from "./MermaidBlock.module.scss";

// mermaid bundles a parser per diagram type and is one of the largest
// dependencies in the app, so it is imported only once a diagram is actually on
// screen. The promise is cached module-side: the second diagram in a file (and
// every later file) reuses the module already loaded.
let mermaidModulePromise: Promise<Mermaid> | null = null;

const loadMermaid = (): Promise<Mermaid> => {
  if (mermaidModulePromise === null) {
    mermaidModulePromise = import("mermaid").then((module) => module.default);
  }
  return mermaidModulePromise;
};

// `mermaid.render` needs an id it can also use as a CSS selector, and it must
// be unique across concurrently-rendering diagrams (a theme flip can leave a
// superseded render in flight). A monotonic counter gives both.
let nextRenderId = 0;

// mermaid config is global, so it is re-applied before every render rather than
// once at startup — the theme can change while diagrams are mounted.
const initializeMermaid = (mermaid: Mermaid, isDarkTheme: boolean): void => {
  mermaid.initialize({
    startOnLoad: false,
    // File content is untrusted — see the policy note in `markdownPlugins.ts`.
    // "strict" runs mermaid's own DOMPurify pass over the emitted SVG and
    // disables the `click` directive (which can bind handlers and open URLs),
    // and `htmlLabels: false` keeps label text out of `<foreignObject>` HTML so
    // labels render as SVG `<text>`.
    securityLevel: "strict",
    htmlLabels: false,
    // Without this, a diagram that fails to parse leaves mermaid's own error
    // graphic behind in the DOM; the error state below is rendered instead.
    suppressErrorRendering: true,
    theme: isDarkTheme ? "dark" : "default",
  });
};

type RenderOutcome = { status: "ready"; svg: string } | { status: "error"; message: string };

// Results carry the input they came from, so a diagram whose source or theme
// just changed falls back to the placeholder without the effect having to reset
// state on the way in (which would cost an extra render pass).
type RenderResult = RenderOutcome & { renderKey: string };

const toRenderKey = (source: string, isDarkTheme: boolean): string => `${isDarkTheme ? "dark" : "light"}:${source}`;

type MermaidBlockProps = {
  /** The diagram source: a ```mermaid fence's body, or a whole .mmd file. */
  source: string;
};

/**
 * One rendered Mermaid diagram. Rendering is asynchronous (the library is
 * loaded on demand and its own render step is async), so this always starts in
 * a placeholder state. A diagram that fails to parse falls back to its source
 * text plus the parse error — a broken diagram must never cost the reader the
 * content of the file.
 */
export const MermaidBlock = ({ source }: MermaidBlockProps): ReactElement => {
  const isDarkTheme = useResolvedTheme() === "dark";
  const renderKey = toRenderKey(source, isDarkTheme);
  const [result, setResult] = useState<RenderResult | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const renderDiagram = async (): Promise<void> => {
      try {
        const mermaid = await loadMermaid();
        if (isCancelled) return;
        initializeMermaid(mermaid, isDarkTheme);
        const { svg } = await mermaid.render(`mermaid-diagram-${(nextRenderId += 1)}`, source);
        if (isCancelled) return;
        setResult({ status: "ready", svg, renderKey });
      } catch (error) {
        if (isCancelled) return;
        setResult({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
          renderKey,
        });
      }
    };

    void renderDiagram();

    return (): void => {
      isCancelled = true;
    };
  }, [source, isDarkTheme, renderKey]);

  // A result from a previous source/theme is stale; show the placeholder until
  // the render for the current input lands.
  const state: RenderOutcome | null = result !== null && result.renderKey === renderKey ? result : null;

  if (state === null) {
    return <div className={styles.placeholder}>Rendering diagram…</div>;
  }

  if (state.status === "error") {
    return (
      <div className={styles.error} data-testid={ElementIds.MERMAID_DIAGRAM_ERROR}>
        <div className={styles.errorMessage}>Could not render diagram: {state.message}</div>
        <pre>{source}</pre>
      </div>
    );
  }

  // The only place in the file-rendering path that injects markup rather than
  // React elements: mermaid's output is an SVG string. It is sanitized by
  // mermaid's own DOMPurify pass under `securityLevel: "strict"` above, which
  // is the whole reason that level is pinned here.
  return (
    <div
      className={styles.diagram}
      data-testid={ElementIds.MERMAID_DIAGRAM}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
};
