import { expect, test } from "@playwright/test";
import { openBoard } from "./open-board";

test("parent and owner sit side by side at content height without tree toolbars", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBoard(page);
  const parentBounds = await page.locator("#parent-tree").boundingBox();
  const ownerBounds = await page.locator("#owner-tree").boundingBox();
  if (!parentBounds || !ownerBounds) throw new Error("Missing specimens");
  expect(ownerBounds.y).toBe(parentBounds.y);
  expect(ownerBounds.x - parentBounds.x - parentBounds.width).toBe(16);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /tree controls/i })).toHaveCount(0);
  for (const id of ["parent-tree", "owner-tree"]) {
    const geometry = await page.locator(`#${id}`).evaluate((element) => {
      const viewport = element.querySelector("[data-tree-viewport]");
      const svg = element.querySelector('svg[role="tree"]');
      if (!(viewport instanceof HTMLElement) || !(svg instanceof SVGElement))
        throw new Error("Missing tree");
      return {
        width: element.getBoundingClientRect().width,
        viewportWidth: viewport.clientWidth,
        height: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollWidth: viewport.scrollWidth,
        chartHeight: svg.getBoundingClientRect().height,
      };
    });
    expect(geometry.width).toBe((1007 - 16) / 2);
    expect(Math.abs(geometry.viewportWidth - (geometry.width - 32))).toBeLessThanOrEqual(0.5);
    expect(geometry.scrollWidth).toBe(geometry.viewportWidth);
    expect(geometry.height).toBeGreaterThan(396);
    expect(geometry.scrollHeight).toBe(geometry.height);
    expect(geometry.chartHeight).toBe(geometry.height);
  }
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  const owner = page.getByRole("tree", { name: "Owner tree", exact: true });
  const before = await parent.boundingBox();
  const ownerBefore = await owner.boundingBox();
  await parent.locator('[data-disclosure-for="app"]').click();
  expect((await parent.boundingBox())?.height).toBeLessThan(before?.height ?? 0);
  expect((await owner.boundingBox())?.height).toBe(ownerBefore?.height);
  await expect(owner.locator('[data-node-id="query-state"]')).toHaveCount(1);
  await page.goto("/diagram?component=owner-tree");
  await expect(page.locator("main section")).toHaveCount(17);
});

for (const width of [760, 390]) {
  test(`trees stay inside their columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openBoard(page);
    const bounds = await page.locator("#parent-tree, #owner-tree").evaluateAll((elements) =>
      elements.map((element) => {
        const frame = element.querySelector("[data-tree-relationship]");
        const viewport = element.querySelector("[data-tree-viewport]");
        if (!(frame instanceof HTMLElement) || !(viewport instanceof HTMLElement))
          throw new Error("Missing tree");
        const sectionBounds = element.getBoundingClientRect();
        const frameBounds = frame.getBoundingClientRect();
        return {
          x: sectionBounds.x,
          y: sectionBounds.y,
          right: sectionBounds.right,
          bottom: sectionBounds.bottom,
          frameLeft: frameBounds.x,
          frameRight: frameBounds.right,
          clip: getComputedStyle(frame).overflow,
          viewportWidth: viewport.clientWidth,
          scrollWidth: viewport.scrollWidth,
          viewportHeight: viewport.clientHeight,
          scrollHeight: viewport.scrollHeight,
        };
      }),
    );
    for (const geometry of bounds) {
      expect(geometry.frameLeft).toBeGreaterThanOrEqual(geometry.x + 16);
      expect(geometry.frameRight).toBeLessThanOrEqual(geometry.right - 16);
      expect(geometry.clip).toBe("clip");
      expect(geometry.scrollWidth).toBe(geometry.viewportWidth);
      expect(geometry.scrollHeight).toBe(geometry.viewportHeight);
    }
    if (width > 713) {
      expect(bounds[1].y).toBe(bounds[0].y);
      expect(bounds[1].x - bounds[0].right).toBe(16);
    } else {
      expect(bounds[1].y - bounds[0].bottom).toBe(16);
      expect(bounds[1].x).toBe(bounds[0].x);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
