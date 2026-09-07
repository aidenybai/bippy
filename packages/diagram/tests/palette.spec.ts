import { expect, test } from "@playwright/test";

interface PaletteCase {
  theme: "light" | "dark";
}

const cases: PaletteCase[] = [{ theme: "light" }, { theme: "dark" }];

for (const { theme } of cases) {
  test(`uses neutral resting diagrams and one interaction accent in ${theme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await page.mouse.move(0, 0);
    const coloredPaints = await page.locator("main svg *").evaluateAll((elements) => {
      const paints = new Set(
        elements.flatMap((element) => {
          const style = getComputedStyle(element);
          return [style.color, style.fill, style.stroke];
        }),
      );
      return [...paints].filter((paint) => {
        const channels = paint.match(/[\d.]+/g)?.map(Number);
        return (
          channels &&
          channels.length >= 3 &&
          (Math.abs(channels[0] - channels[1]) > 0.001 ||
            Math.abs(channels[1] - channels[2]) > 0.001)
        );
      });
    });
    expect(coloredPaints).toEqual([]);
    const parent = page.locator('[data-tree-relationship="parent"]');
    const restingColor = await parent
      .locator('[data-node-kind="provider"]')
      .evaluate((element) => getComputedStyle(element).color);
    let accent: string | undefined;
    for (const kind of ["provider", "boundary", "suspense"]) {
      const node = parent.locator(`[data-node-kind="${kind}"]`).first();
      await node.hover();
      await expect(node).toHaveAttribute("data-active", "true");
      const color = await node.evaluate((element) => getComputedStyle(element).color);
      accent ??= color;
      expect(color).toBe(accent);
      expect(color).not.toBe(restingColor);
      const strokes = await parent
        .locator("[data-scope-kind] > rect")
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
      for (const stroke of strokes) expect(stroke).toBe(accent);
    }
    const portal = page.locator("#node-portal [data-node-id]");
    await portal.hover();
    await expect(portal).toHaveCSS("color", accent ?? "");
    const rings = await portal
      .locator("circle")
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke));
    expect(rings).toEqual([accent, accent]);
    await page.locator("#parent-tree").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.locator("#parent-tree").screenshot({ path: `test-results/palette-${theme}.png` });
  });
}
