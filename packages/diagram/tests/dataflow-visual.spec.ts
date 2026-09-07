import { expect, test } from "@playwright/test";
import { diagramMetrics } from "../src/diagram/geometry";

test.use({ deviceScaleFactor: 2, viewport: { width: 1200, height: 1200 } });

test("keeps inline data neutral, uses one active accent, and preserves arrow clearance", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#parent-tree").scrollIntoViewIfNeeded();
  const parent = page.locator('[data-tree-relationship="parent"]');
  await expect(parent.locator('[data-node-id="feed-toggle"]')).toHaveAttribute(
    "data-node-kind",
    "value",
  );
  await expect(parent.locator('[data-node-id="set-query"]')).toHaveAttribute(
    "data-node-kind",
    "callback",
  );
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.mouse.move(0, 0);
    const colors = await parent
      .locator('[data-node-variant="detail"]')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
    expect(new Set(colors).size).toBe(1);
    await expect(parent.locator('[data-node-variant="detail"] circle')).toHaveCount(0);
    await expect(
      parent.locator('[data-edge-kind="parent"][data-edge-to="stats-count"]'),
    ).toHaveCount(0);
    await expect(
      parent.locator('[data-edge-kind="parent"][data-edge-to="theme-hook"]'),
    ).toHaveCount(0);
    await expect(parent.locator('[data-edge-kind="parent"][data-edge-to="section"]')).toHaveCount(
      1,
    );
    await parent.locator('[data-node-id="cart-hook"]').hover();
    await expect(
      parent.locator('[data-edge-kind="parent"][data-edge-to="stats-count"]'),
    ).toHaveCount(0);
    const strokes = await parent
      .locator("[data-edge-id] > path")
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
    expect(new Set(strokes).size).toBe(1);
    const marker = parent.locator('[data-edge-id="snapshot-prop"] marker');
    await expect(marker).toHaveAttribute("refX", "4");
    const endpoint = await parent.evaluate((element) => {
      const path = element.querySelector('[data-edge-id="snapshot-prop"] > path');
      const node = element.querySelector('[data-node-id="stats-count"]');
      if (!(path instanceof SVGPathElement) || !(node instanceof SVGGElement))
        throw new Error("Missing connection");
      const transform = node.transform.baseVal.consolidate()?.matrix;
      if (!transform) throw new Error("Missing transform");
      const point = path.getPointAtLength(path.getTotalLength());
      return { gap: transform.e - point.x, verticalOffset: transform.f - point.y };
    });
    expect(endpoint.gap).toBeCloseTo(diagramMetrics.detailPortGap);
    expect(endpoint.verticalOffset).toBeCloseTo(0);
    const positions = await parent
      .locator('[data-edge-id="store-subscribe"] > text, [data-edge-id="snapshot-changed"] > text')
      .evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("y"))));
    expect(Math.abs(positions[0] - positions[1])).toBeGreaterThan(
      diagramMetrics.annotationFontSize,
    );
    await page
      .locator("#parent-tree")
      .screenshot({ path: `test-results/tree-dataflow-${theme}.png` });
  }
});
