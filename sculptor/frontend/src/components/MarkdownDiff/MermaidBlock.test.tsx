import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ElementIds } from "~/api";

import { MermaidBlock } from "./MermaidBlock.tsx";

// The real library is ~megabytes of diagram parsers and needs a full browser
// layout to produce an SVG, so it is stubbed here: these tests pin this
// component's contract around it (async swap-in, sanitized-SVG injection, and
// the fallback that keeps the source readable when a diagram won't parse),
// not mermaid's own rendering.
const mermaidMock = { initialize: vi.fn(), render: vi.fn() };
vi.mock("mermaid", () => ({ default: mermaidMock }));

afterEach(cleanup);
beforeEach(() => {
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
});

describe("MermaidBlock", () => {
  it("renders the SVG mermaid returns", async () => {
    mermaidMock.render.mockResolvedValue({ svg: "<svg data-testid='diagram-svg'></svg>" });

    render(<MermaidBlock source="graph TD;" />);

    const diagram = await screen.findByTestId(ElementIds.MERMAID_DIAGRAM);
    expect(diagram.querySelector("svg")).not.toBeNull();
  });

  it("pins the sanitizing config every render, since mermaid's config is global", async () => {
    mermaidMock.render.mockResolvedValue({ svg: "<svg></svg>" });

    render(<MermaidBlock source="graph TD;" />);
    await screen.findByTestId(ElementIds.MERMAID_DIAGRAM);

    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", htmlLabels: false }),
    );
  });

  it("falls back to the source text and the parse error when a diagram will not render", async () => {
    mermaidMock.render.mockRejectedValue(new Error("Parse error on line 1"));

    render(<MermaidBlock source="not a diagram" />);

    const fallback = await screen.findByTestId(ElementIds.MERMAID_DIAGRAM_ERROR);
    expect(fallback.textContent).toContain("Parse error on line 1");
    // The source itself must survive a failed render — a broken diagram should
    // never cost the reader the content of the file.
    expect(fallback.textContent).toContain("not a diagram");
    expect(screen.queryByTestId(ElementIds.MERMAID_DIAGRAM)).toBeNull();
  });

  it("gives each diagram its own render id so concurrent renders cannot collide", async () => {
    mermaidMock.render.mockResolvedValue({ svg: "<svg></svg>" });

    render(
      <>
        <MermaidBlock source="graph TD;" />
        <MermaidBlock source="graph LR;" />
      </>,
    );
    await screen.findAllByTestId(ElementIds.MERMAID_DIAGRAM);

    const [firstId, secondId] = mermaidMock.render.mock.calls.map((call) => call[0] as string);
    expect(firstId).not.toBe(secondId);
  });
});
