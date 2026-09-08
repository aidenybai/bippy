import { expect, test } from "@playwright/test";
import { treeDataflowEdges } from "../src/board/tree-dataflow-fixture";
import { openBoard } from "./open-board";

for (const theme of ["light", "dark"]) {
  test(`Shift reveals subdued dataflow while preserving the hovered trace in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light" });
    await openBoard(page);
    const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
    const owner = page.getByRole("tree", { name: "Owner tree", exact: true });
    await parent.locator('[data-node-id="query-state"]').hover();
    const edges = parent.locator("[data-edge-id]");
    await expect.poll(() => edges.count()).toBeGreaterThan(0);
    const initial = await edges.count();
    expect(initial).toBeLessThan(treeDataflowEdges.length);
    await page.keyboard.down("Shift");
    await expect(parent).toHaveAttribute("data-show-all-dataflow", "true");
    await expect(owner).toHaveAttribute("data-show-all-dataflow", "false");
    await expect(edges).toHaveCount(treeDataflowEdges.length);
    const background = parent.locator('[data-flow-background="true"]');
    const foreground = parent.locator('[data-edge-id][data-flow-background="false"]');
    expect(await background.count()).toBeGreaterThan(0);
    await expect(background.first()).toHaveCSS("opacity", "0.16");
    await expect(parent.locator('[data-edge-id="filter-query"]')).toHaveCSS("opacity", "1");
    expect(await foreground.count()).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/shift-dataflow-${theme}.png` });
    await page.keyboard.up("Shift");
    await expect(parent).toHaveAttribute("data-show-all-dataflow", "false");
    await expect(edges).toHaveCount(initial);
    await page.keyboard.down("Shift");
    await page.mouse.move(0, 0);
    await expect(parent).toHaveAttribute("data-show-all-dataflow", "false");
    await owner.locator('[data-node-id="query-state"]').hover();
    await expect(owner).toHaveAttribute("data-show-all-dataflow", "true");
    await expect(owner.locator("[data-edge-id]")).toHaveCount(treeDataflowEdges.length);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(owner).toHaveAttribute("data-show-all-dataflow", "false");
    await page.keyboard.up("Shift");
    await parent.locator('[data-node-id="app"]').hover();
    await expect(edges).toHaveCount(0);
    await page.keyboard.down("Shift");
    await expect(edges).toHaveCount(treeDataflowEdges.length);
    expect(await foreground.count()).toBeGreaterThan(0);
    expect(await background.count()).toBeGreaterThan(0);
    await page.keyboard.up("Shift");
    await expect(edges).toHaveCount(0);
  });
}
