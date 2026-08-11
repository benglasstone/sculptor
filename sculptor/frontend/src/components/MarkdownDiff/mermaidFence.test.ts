import type { ReactElement } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { getMermaidFenceSource } from "./mermaidFence.ts";

// `getMermaidFenceSource` inspects the children react-markdown hands a `<pre>`
// override: a single `<code>` element whose className carries the fence's
// language. Everything that isn't exactly a mermaid fence must fall through to
// the default source rendering, so these tests pin the negative cases as
// tightly as the positive one.

const codeElement = (className: string | undefined, children: unknown): ReactElement =>
  createElement("code", { className }, children as never);

describe("getMermaidFenceSource", () => {
  it("returns the source of a mermaid fence", () => {
    expect(getMermaidFenceSource(codeElement("language-mermaid", "graph TD;\nA-->B;\n"))).toBe("graph TD;\nA-->B;");
  });

  it("matches when the language class sits alongside others", () => {
    expect(getMermaidFenceSource(codeElement("hljs language-mermaid", "graph TD;"))).toBe("graph TD;");
  });

  it("joins a source split across text fragments", () => {
    expect(getMermaidFenceSource(codeElement("language-mermaid", ["graph ", "TD;"]))).toBe("graph TD;");
  });

  it("returns null for a fence in another language", () => {
    expect(getMermaidFenceSource(codeElement("language-python", "print()"))).toBeNull();
  });

  it("returns null for a language whose name merely contains 'mermaid'", () => {
    expect(getMermaidFenceSource(codeElement("language-mermaid-ish", "graph TD;"))).toBeNull();
  });

  it("returns null for an unlabelled fence", () => {
    expect(getMermaidFenceSource(codeElement(undefined, "plain text"))).toBeNull();
  });

  it("returns null when the code content is not plain text", () => {
    // A plugin (e.g. a syntax highlighter) may replace the text with elements;
    // there is no reliable source string to hand mermaid in that case.
    expect(getMermaidFenceSource(codeElement("language-mermaid", createElement("span", null, "graph")))).toBeNull();
  });

  it("returns null when the <pre> holds text rather than a <code> element", () => {
    expect(getMermaidFenceSource("graph TD;")).toBeNull();
  });
});
