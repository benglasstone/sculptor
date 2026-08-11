import type { ReactNode } from "react";
import { isValidElement } from "react";

// react-markdown renders a fenced block as `<pre><code class="language-x">`.
// Detection happens on the `<pre>` (not the `<code>`) because the replacement
// is a `<div>`, which is invalid inside `<pre>`'s phrasing content — overriding
// `pre` swaps the whole block instead of nesting one inside it.
const MERMAID_LANGUAGE_CLASS = "language-mermaid";

type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

/** Text content of a `<code>` element as react-markdown supplies it: a single
 *  string for a plain fence, or a fragment array when a plugin has split it. */
const readTextContent = (children: ReactNode): string | null => {
  if (typeof children === "string") return children;
  if (Array.isArray(children) && children.every((child) => typeof child === "string")) {
    return children.join("");
  }
  return null;
};

/**
 * The diagram source when a `<pre>`'s content is exactly one ```mermaid fence,
 * else null (any other fenced block renders as ordinary source text).
 */
export const getMermaidFenceSource = (children: ReactNode): string | null => {
  if (!isValidElement(children)) return null;
  const { className, children: codeChildren } = children.props as CodeElementProps;
  if (className === undefined) return null;
  if (!className.split(/\s+/).includes(MERMAID_LANGUAGE_CLASS)) return null;
  const source = readTextContent(codeChildren);
  if (source === null) return null;
  // The fence body always ends in the newline before the closing ```; mermaid
  // tolerates it, but trimming keeps the source shown in the error fallback
  // free of a trailing blank line.
  return source.replace(/\n$/, "");
};
