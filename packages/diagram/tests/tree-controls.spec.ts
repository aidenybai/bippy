import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("chevrons appear only on the hovered row in static and virtual trees", async ({ page }) => {
  await page.goto("/");
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  const owner = page.getByRole("tree", { name: "Owner tree", exact: true });
  const item = parent.locator('[data-node-id="app"]');
  const chevron = item.locator("[data-tree-toggle] path");
  await page.mouse.move(0, 0);
  await item.focus();
  await expect(chevron).toHaveCSS("opacity", "0");
  await item.hover();
  await expect(chevron).toHaveCSS("opacity", "1");
  await expect(owner.locator('[data-disclosure-for="app"] path')).toHaveCSS("opacity", "0");
  await page.mouse.move(0, 0);
  await expect(chevron).toHaveCSS("opacity", "0");
  const row = page
    .getByRole("tree", { name: "Deep tree", exact: true })
    .getByRole("treeitem")
    .first();
  const virtualChevron = row.locator("[data-tree-toggle] path");
  await expect(virtualChevron).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(virtualChevron).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(virtualChevron).toHaveCSS("opacity", "0");
});

test("static disclosure, search, reveal, and bulk expansion preserve per-view state", async ({
  page,
}) => {
  await page.goto("/fixtures/tree-controls");
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  const owner = page.getByRole("tree", { name: "Owner tree", exact: true });
  const disclosure = parent.locator('[data-disclosure-for="app"]');
  await expect(disclosure).toHaveAttribute("data-expanded", "true");
  await disclosure.click();
  await expect(parent.locator('[data-node-id="app"]')).toHaveAttribute("aria-expanded", "false");
  await expect(parent.locator('[data-node-id="query-state"]')).toHaveCount(0);
  await expect(owner.locator('[data-node-id="query-state"]')).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search Parent tree", exact: true });
  await search.fill("query-state");
  await search.press("Enter");
  await expect(parent.locator('[data-node-id="query-state"]')).toBeFocused();
  await expect(disclosure).toHaveAttribute("data-expanded", "true");
  await page.getByRole("button", { name: "Collapse all in Owner tree", exact: true }).click();
  await expect(owner.locator('[data-node-id="query-state"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal active node in Owner tree", exact: true }).click();
  await expect(owner.locator('[data-node-id="query-state"]')).toBeFocused();
  await page.getByRole("button", { name: "Expand all in Owner tree", exact: true }).click();
  await expect(owner.locator('[data-node-id="post-2"]')).toHaveCount(1);
  await search.fill("does-not-exist");
  await expect(
    page.getByRole("group", { name: "Parent tree controls", exact: true }).getByRole("status"),
  ).toHaveText("No matches.");
  await search.press("Escape");
  await expect(search).toHaveValue("");
});

test("virtual search reveals hidden descendants without mounting the full tree", async ({
  page,
}) => {
  await page.goto("/fixtures/tree-controls");
  const tree = page.getByRole("tree", { name: "Deep tree", exact: true });
  await page.getByRole("button", { name: "Collapse all in Deep tree", exact: true }).click();
  await expect(tree.getByRole("treeitem")).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search Deep tree", exact: true });
  await search.fill("deep-9999");
  await search.press("Enter");
  await expect(tree.locator('[data-focused="true"]')).toBeFocused();
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("data-node-id", "deep-9999");
  expect(await tree.getByRole("treeitem").count()).toBeLessThan(30);
  await page.locator("#deep-tree [data-tree-viewport]").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Reveal active node in Deep tree", exact: true }).click();
  await expect(tree.locator('[data-node-id="deep-9999"]')).toBeInViewport();
  await search.fill("Application");
  await search.press("ArrowDown");
  await expect(search).toBeFocused();
  await expect(tree.locator('[data-node-id="deep-0"]')).toBeInViewport();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("disclosure stays inside the native item and respects capture cancellation and visibility", async ({
  page,
}) => {
  await page.goto("/fixtures/compound");
  const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
  const item = tree.locator('[data-node-id="app"]');
  const disclosure = item.locator("[data-tree-toggle]");
  await item.evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
  });
  await disclosure.click();
  await expect(item).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("activation-count")).toHaveText("0");
  await item.evaluate((element) => {
    element.style.display = "none";
  });
  await expect(disclosure).not.toBeVisible();
});

test.describe("disclosure touch", () => {
  test.use({ hasTouch: true });
  test("toggles without selecting and retains shared activation", async ({ page }) => {
    await page.goto("/fixtures/compound");
    const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
    const item = tree.locator('[data-node-id="app"]');
    await item.locator("[data-tree-toggle]").tap();
    await expect(item).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("activation-count")).toHaveText("0");
    await expect(page.getByTestId("active")).toHaveText("app");
    await expect(
      page
        .getByRole("tree", { name: "Compound owner", exact: true })
        .locator('[data-node-id="app"]'),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

test("component symbols, crossing gaps, and unnumbered labels retain semantic distinctions", async ({
  page,
}) => {
  await page.goto("/");
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  await expect(parent.locator('[data-node-id="app"] [data-function-symbol]')).toHaveCount(1);
  await expect(
    parent.locator('[data-node-id="error"] [data-component-symbol="class"] rect'),
  ).toHaveCount(1);
  await expect(parent.locator('[data-node-id="frame"]')).toHaveAccessibleDescription(
    /forward-ref wrapper/,
  );
  await expect(
    parent.locator('[data-node-id="post-2"] [data-component-symbol="memo"] path'),
  ).toHaveCount(1);
  expect(await parent.locator("[data-node-id] text").allTextContents()).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/\(\d+\)/)]),
  );
  await expect(parent.locator('[data-node-id="activity"]')).toContainText("visible");
  await parent.locator('[data-node-id="app"]').focus();
  await page.keyboard.press("ArrowRight");
  const paths = parent.locator("[data-edge-id] [data-edge-path]");
  await expect(paths.first()).toBeVisible();
  expect(await paths.count()).toBeGreaterThan(2);
  await expect(parent.locator("[data-edge-id] [data-edge-halo]")).toHaveCount(await paths.count());
  const colors = await paths.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).stroke),
  );
  expect(new Set(colors).size).toBe(2);
});
