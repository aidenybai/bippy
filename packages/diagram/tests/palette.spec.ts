import { expect, test } from "@playwright/test";
import { openBoard } from "./open-board";

interface PaletteCase {
  theme: "light" | "dark";
}
const cases: PaletteCase[] = [{ theme: "light" }, { theme: "dark" }];

for (const { theme } of cases) {
  test(`distinguishes semantic colors without replacing shapes in ${theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await openBoard(page);
    await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", theme);
    await page.mouse.move(0, 0);
    const parent = page.locator('[data-tree-relationship="parent"]');
    const accents = new Set<string>();
    for (const kind of ["provider", "boundary", "suspense"]) {
      const node = parent.locator(`[data-node-kind="${kind}"]`).first();
      await node.hover();
      await expect(node).toHaveAttribute("data-active", "true");
      const color = await node.evaluate((element) => getComputedStyle(element).color);
      accents.add(color);
      const strokes = await parent
        .locator("[data-scope-kind] > rect")
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
      for (const stroke of strokes) expect(stroke).toBe(color);
    }
    const portal = page.locator("#node-portal [data-node-id]");
    await portal.hover();
    const portalColor = await portal.evaluate((element) => getComputedStyle(element).color);
    accents.add(portalColor);
    expect(accents.size).toBe(4);
    const rings = await portal
      .locator("circle")
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
    expect(rings).toEqual([portalColor, portalColor]);
    await page.locator("#parent-tree").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.locator("#parent-tree [data-tree-viewport]").evaluateAll((elements) => {
      for (const element of elements) element.scrollTop = 0;
    });
    await expect(parent.locator('[data-component-symbol="class"] rect').first()).toHaveCount(1);
    await expect(parent.locator('[data-component-symbol="memo"] path')).toHaveCount(1);
    await page.locator("#parent-tree").screenshot({ path: `test-results/palette-${theme}.png` });
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/board-${theme}.png`, fullPage: true });
  });
}
