import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => react.createElement("a", { href, className }, children),
  };
});

import { ApiRequestError } from "../../lib/runs-api";
import {
  CreateRunShellView,
  getCreateRunErrorMessage,
  normalizeRunDraft,
  normalizeRunTarget,
} from "./create-run-shell";

function findElementByType(node: ReactNode, type: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, type);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  if (element.type === type) {
    return element;
  }

  return findElementByType(element.props.children, type);
}

function findElementsByType(node: ReactNode, type: string): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementsByType(child, type));
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  return [
    ...(element.type === type ? [element] : []),
    ...findElementsByType(element.props.children, type),
  ];
}

function renderView(requestState: Parameters<typeof CreateRunShellView>[0]["requestState"]) {
  return renderToStaticMarkup(
    createElement(CreateRunShellView, {
      draft: {
        name: "Gaming Run",
        query: "gaming creators",
        target: "25",
      },
      onNameChange: () => undefined,
      onQueryChange: () => undefined,
      onTargetChange: () => undefined,
      onSubmit: () => undefined,
      requestState,
      showRunsIndexLink: true,
    }),
  );
}

describe("create run shell", () => {
  it("normalizes run draft whitespace", () => {
    expect(
      normalizeRunDraft({
        name: "  Gaming Run  ",
        query: "  gaming creators  ",
        target: " 25 ",
      }),
    ).toEqual({
      name: "Gaming Run",
      query: "gaming creators",
      target: "25",
    });
  });

  it("normalizes run target input", () => {
    expect(normalizeRunTarget(" 25 ")).toBe(25);
    expect(normalizeRunTarget("0")).toBeNull();
    expect(normalizeRunTarget("1.5")).toBeNull();
  });

  it("maps missing key errors to a clearer UI message", () => {
    expect(
      getCreateRunErrorMessage(
        new ApiRequestError("Assigned YouTube API key is required before creating a run", 400),
      ),
    ).toBe(
      "Your account does not have an assigned YouTube API key yet. Ask an admin to add one before starting a run.",
    );
  });

  it("renders the create form with idle copy and back link", () => {
    const html = renderView({
      status: "idle",
      message:
        "Runs blend matching catalog channels with new YouTube discovery using the API key assigned to your account.",
    });

    expect(html).toContain("Start a scouting run");
    expect(html).toContain("Run name");
    expect(html).toContain("Search query");
    expect(html).toContain("Target");
    expect(html).toContain("Create run");
    expect(html).toContain('href="/runs"');
  });

  it("renders error feedback when submission fails", () => {
    const html = renderView({
      status: "error",
      message: "Your account does not have an assigned YouTube API key yet.",
    });

    expect(html).toContain("Your account does not have an assigned YouTube API key yet.");
    expect(html).toContain('role="alert"');
  });

  it("suppresses hydration warnings on the run-create form controls targeted by extensions", () => {
    const tree = createElement(CreateRunShellView, {
      draft: {
        name: "Gaming Run",
        query: "gaming creators",
        target: "25",
      },
      onNameChange: () => undefined,
      onQueryChange: () => undefined,
      onTargetChange: () => undefined,
      onSubmit: () => undefined,
      requestState: {
        status: "idle",
        message:
          "Runs blend matching catalog channels with new YouTube discovery using the API key assigned to your account.",
      },
      showRunsIndexLink: true,
    });
    const rendered = (tree.type as typeof CreateRunShellView)(tree.props);
    const form = findElementByType(rendered, "form") as ReactElement<{
      suppressHydrationWarning?: boolean;
    }> | null;
    const input = findElementByType(rendered, "input") as ReactElement<{
      suppressHydrationWarning?: boolean;
    }> | null;
    const textarea = findElementByType(rendered, "textarea") as ReactElement<{
      suppressHydrationWarning?: boolean;
    }> | null;
    const targetInput = findElementsByType(rendered, "input")[1] as ReactElement<{
      suppressHydrationWarning?: boolean;
    }> | null;
    const button = findElementByType(rendered, "button") as ReactElement<{
      suppressHydrationWarning?: boolean;
    }> | null;

    expect(form?.props.suppressHydrationWarning).toBe(true);
    expect(input?.props.suppressHydrationWarning).toBe(true);
    expect(textarea?.props.suppressHydrationWarning).toBe(true);
    expect(targetInput?.props.suppressHydrationWarning).toBe(true);
    expect(button?.props.suppressHydrationWarning).toBe(true);
  });
});
