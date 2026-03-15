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

import { NewScoutingWorkspaceView } from "./new-scouting-workspace";

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

describe("new scouting workspace", () => {
  it("renders the live run name and prompt fields with disabled scaffolded controls", () => {
    const html = renderToStaticMarkup(
      createElement(NewScoutingWorkspaceView, {
        draft: {
          name: "Gaming run",
          prompt: "gaming creators",
        },
        onNameChange: () => undefined,
        onPromptChange: () => undefined,
        onSubmit: () => undefined,
        requestState: {
          status: "idle",
          message:
            "Run name and prompt are live today. Campaign, week, brief, and targeting controls stay scaffolded until the backend stores those fields.",
        },
        showLegacyNotice: true,
      }),
    );

    expect(html).toContain("Run name");
    expect(html).toContain("Prompt");
    expect(html).toContain("Campaign");
    expect(html).toContain("Source mode");
    expect(html).toContain("Legacy route");
    expect(html).toContain('href="/database?tab=runs"');
    expect(html).toContain("Start scouting");
    expect(html).not.toContain("Current backend mode");
    expect(html).not.toContain("auto-generated client-side");
  });

  it("keeps run name and prompt live while scaffolded fields stay disabled", () => {
    const tree = createElement(NewScoutingWorkspaceView, {
      draft: {
        name: "Gaming run",
        prompt: "gaming creators",
      },
      onNameChange: () => undefined,
      onPromptChange: () => undefined,
      onSubmit: () => undefined,
      requestState: {
        status: "idle",
        message:
          "Run name and prompt are live today. Campaign, week, brief, and targeting controls stay scaffolded until the backend stores those fields.",
      },
    });
    const rendered = (tree.type as typeof NewScoutingWorkspaceView)(tree.props);
    const selects = findElementsByType(rendered, "select") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const inputs = findElementsByType(rendered, "input") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const textareas = findElementsByType(rendered, "textarea") as Array<
      ReactElement<{ disabled?: boolean }>
    >;

    expect(selects.every((element) => element.props.disabled)).toBe(true);
    expect(inputs[0]?.props.disabled).toBe(false);
    expect(inputs.slice(1).every((element) => element.props.disabled)).toBe(true);
    expect(textareas[0]?.props.disabled).toBe(false);
  });
});
