import { expect, test } from "@playwright/test";

test("sidebar search, preview navigation, and history share the same specimens", async ({
  page,
}) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search components", exact: true });
  const navigation = page.getByRole("navigation", { name: "Components" });
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
  await search.fill("tree");
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await search.fill("missing");
  await expect(navigation.getByRole("status")).toHaveText("No components found.");
  await search.press("Escape");
  await expect(navigation.getByRole("link")).toHaveCount(16);
  await navigation.getByRole("link", { name: "Parent / owner", exact: true }).click();
  await page.getByRole("button", { name: "Show preview", exact: true }).click();
  await expect(page).toHaveURL(/component=parent-tree/);
  await expect(page.locator("main section")).toHaveCount(1);
  await expect(page.locator("#parent-tree")).toBeVisible();
  await navigation.getByRole("link", { name: "Tree / Deep", exact: true }).click();
  await expect(page.locator("#deep-tree")).toBeVisible();
  expect(
    await page.getByRole("tree", { name: "Deep tree", exact: true }).getByRole("treeitem").count(),
  ).toBeLessThan(30);
  await page.goBack();
  await expect(page.locator("#parent-tree")).toBeVisible();
  await page.getByRole("button", { name: "Show board", exact: true }).click();
  await expect(page.locator("main section")).toHaveCount(16);
});

test("tree actions use shared controls and accessible tooltips", async ({ page }) => {
  await page.goto("/?component=parent-tree");
  await expect(page.locator("main section")).toHaveCount(1);
  const controls = page.getByRole("group", { name: "Parent tree controls", exact: true });
  const search = controls.getByRole("searchbox");
  await expect(search).toHaveAttribute("data-slot", "input");
  await search.focus();
  const clearance = await search.evaluate((element) => {
    const frame = element.closest('[data-slot="scroll-area"]')?.getBoundingClientRect();
    if (!frame) throw new Error("Missing tree frame");
    const bounds = element.getBoundingClientRect();
    return Math.min(bounds.x - frame.x, bounds.y - frame.y);
  });
  expect(clearance).toBeGreaterThanOrEqual(4);
  const expand = controls.getByRole("button", { name: "Expand all in Parent tree", exact: true });
  await expand.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Expand all");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
