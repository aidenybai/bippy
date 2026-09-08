import { expect, test } from "@playwright/test";

test("parent and owner are full-width and content-height without tree toolbars", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/diagram");
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
        chartHeight: svg.getBoundingClientRect().height,
      };
    });
    expect(geometry.width).toBe(1440 - 48);
    expect(geometry.viewportWidth).toBeCloseTo(geometry.width - 32, 0);
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
