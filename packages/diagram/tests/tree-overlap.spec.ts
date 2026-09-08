import { expect, test } from "@playwright/test";
import { treeDataflowEdges } from "../src/board/tree-dataflow-fixture";

for (const theme of ["light", "dark"]) {
  test(`flow labels clear rows, glyphs, and each other in ${theme} mode`, async ({ page }) => {
    await page.goto("/?component=parent-tree");
    await expect(page.locator("main section")).toHaveCount(1);
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    for (const projection of ["Parent tree", "Owner tree"]) {
      const tree = page.getByRole("tree", { name: projection, exact: true });
      for (const nodeId of [
        "query-state",
        "cart-hook",
        "stats-count",
        "get-snapshot",
        "subscribe",
        "cart-store",
        "dispatch",
        "feed-toggle",
      ]) {
        await tree.locator(`[data-node-id="${nodeId}"]`).focus();
        const expectedLabels = treeDataflowEdges.filter(
          (edge) => edge.label && (edge.from === nodeId || edge.to === nodeId),
        );
        await expect(tree.locator("[data-edge-label-for]")).toHaveCount(expectedLabels.length);
        const overlaps = await tree.evaluate((element) => {
          const labels = [...element.querySelectorAll("[data-edge-label-for]")];
          const obstacles = [
            ...element.querySelectorAll(
              '[data-node-id] [data-slot="diagram-label"], [data-node-id] circle, [data-component-symbol], [data-focus-ring]',
            ),
          ];
          const getGlyphBounds = (target: Element) => {
            if (!(target instanceof SVGGraphicsElement)) throw new Error("Expected SVG content");
            const bounds = target.getBBox();
            const matrix = target.getScreenCTM();
            if (!matrix) throw new Error("Missing SVG transform");
            const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
            const end = new DOMPoint(
              bounds.x + bounds.width,
              bounds.y + bounds.height,
            ).matrixTransform(matrix);
            return { left: start.x, top: start.y, right: end.x, bottom: end.y };
          };
          const failures: string[] = [];
          for (const [index, label] of labels.entries()) {
            const bounds = getGlyphBounds(label);
            for (const obstacle of [...obstacles, ...labels.slice(index + 1)]) {
              const other = getGlyphBounds(obstacle);
              const stroke = obstacle.hasAttribute("data-focus-ring") ? 1 : 0;
              if (
                bounds.left < other.right + stroke &&
                bounds.right > other.left - stroke &&
                bounds.top < other.bottom + stroke &&
                bounds.bottom > other.top - stroke
              )
                failures.push(
                  `${label.textContent} / ${obstacle.textContent || obstacle.closest("[data-node-id]")?.getAttribute("data-node-id")}`,
                );
            }
          }
          return failures;
        });
        expect(overlaps, `${projection}: ${nodeId}`).toEqual([]);
      }
    }
    const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
    await parent.locator('[data-node-id="cart-hook"]').focus();
    await page.locator("#parent-tree [data-tree-viewport]").evaluateAll((elements) =>
      elements.forEach((element) => {
        element.scrollTop = 0;
      }),
    );
    await page
      .locator("#parent-tree")
      .screenshot({ path: `test-results/flow-labels-${theme}.png` });
  });
}
