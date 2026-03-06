import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CatalogChannelDetailPage from "./page";

describe("catalog channel detail page", () => {
  it("renders week 1 channel detail placeholder", () => {
    const html = renderToStaticMarkup(CatalogChannelDetailPage());

    expect(html).toContain("Channel Detail");
    expect(html).toContain("Channel detail shell lands in Week 1.");
  });
});
