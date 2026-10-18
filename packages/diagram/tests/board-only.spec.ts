import { expect, test } from "@playwright/test";

test("diagram is board-only, with trees first and mini specimens last", async ({ page }) => {
  await page.goto("/diagram");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show board|Show preview/ })).toHaveCount(0);
  await expect(page.locator("main section")).toHaveCount(17);
  const ids = await page
    .locator("main section")
    .evaluateAll((elements) => elements.map((element) => element.id));
  expect(ids.slice(0, 2)).toEqual(["parent-tree", "owner-tree"]);
  expect(ids.indexOf("node-component")).toBeGreaterThan(ids.indexOf("relationships"));
  await page.goto("/diagram?component=node-host");
  await expect(page.locator("main section")).toHaveCount(17);
});

test("opt-in tree actions retain shared controls and accessible tooltips", async ({ page }) => {
  await page.goto("/fixtures/tree-controls");
  const controls = page.getByRole("group", { name: "Parent tree controls", exact: true });
  const search = controls.getByRole("searchbox");
  await expect(search).toHaveAttribute("data-slot", "input");
  const clearance = await search.evaluate((element) => {
    const frame = element.closest('[role="group"]')?.getBoundingClientRect();
    if (!frame) throw new Error("Missing controls");
    const bounds = element.getBoundingClientRect();
    return Math.min(bounds.x - frame.x, bounds.y - frame.y);
  });
  expect(clearance).toBeGreaterThanOrEqual(4);
  await expect(page.locator('[data-slot="tooltip-content"]').first()).toBeAttached();
  await controls.getByRole("button", { name: "Expand all in Parent tree", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Expand all");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
