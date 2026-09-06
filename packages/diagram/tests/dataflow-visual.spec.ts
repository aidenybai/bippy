import { expect, test } from "@playwright/test";
import { diagramMetrics } from "../src/diagram/geometry";

test.use({ deviceScaleFactor: 2, viewport: { width: 1200, height: 900 } });

test("keeps prop glyphs and wire endpoints consistent without overlapping tree branches", async ({
  page,
}) => {
  await page.goto("/");
  const diagram = page.locator("#dataflow");
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram.locator('[data-edge-kind="parent"]')).toHaveCount(0);
  await expect(diagram.locator('[data-node-id="toolbar-change"]')).toHaveAttribute(
    "data-node-kind",
    "value",
  );
  await expect(diagram.locator('[data-node-id="set-query"]')).toHaveAttribute(
    "data-node-kind",
    "callback",
  );
  const marker = diagram.locator('[data-edge-id="query-prop"] marker');
  await expect(marker).toHaveAttribute("refX", "4");
  await expect(marker.locator("path")).toHaveAttribute(
    "stroke-width",
    String(diagramMetrics.strokeWidth),
  );
  const endpoints = await diagram.evaluate((element) => {
    const path = element.querySelector('[data-edge-id="query-prop"] > path');
    const node = element.querySelector('[data-node-id="toolbar-query"]');
    if (!(path instanceof SVGPathElement) || !(node instanceof SVGGElement))
      throw new Error("Missing connection");
    const transform = node.transform.baseVal.consolidate()?.matrix;
    if (!transform) throw new Error("Missing node transform");
    const point = path.getPointAtLength(path.getTotalLength());
    return { distance: transform.e - point.x, verticalOffset: transform.f - point.y };
  });
  expect(endpoints.distance).toBeCloseTo(
    diagramMetrics.nodeRadius + diagramMetrics.strokeWidth / 2,
  );
  expect(endpoints.verticalOffset).toBe(0);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const ports = await diagram.locator('[data-node-kind="value"]').evaluateAll((elements) =>
      elements.map((element) => {
        const circle = element.querySelector("circle");
        const label = element.querySelector("text");
        if (!circle || !label) throw new Error("Missing port");
        return {
          isHollow: getComputedStyle(circle).fill === getComputedStyle(label).stroke,
          radius: circle.getAttribute("r"),
          strokeWidth: getComputedStyle(circle).strokeWidth,
        };
      }),
    );
    for (const port of ports)
      expect(port).toEqual({
        isHollow: true,
        radius: String(diagramMetrics.nodeRadius),
        strokeWidth: `${diagramMetrics.strokeWidth}px`,
      });
    const bounds = await diagram.locator('[data-node-id="toolbar-query"]').boundingBox();
    if (!bounds) throw new Error("Missing query port");
    await page.screenshot({
      path: `test-results/dataflow-ports-${theme}.png`,
      clip: { x: bounds.x - 40, y: bounds.y - 10, width: 240, height: 100 },
    });
  }
});
