import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface AccessibilityTheme {
  theme: "light" | "dark";
}
const themes: AccessibilityTheme[] = [{ theme: "light" }, { theme: "dark" }];

for (const { theme } of themes) {
  test(`has no automated WCAG violations in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    const parent = page.locator('[data-tree-relationship="parent"]');
    await parent.locator('[data-node-id="error"]').focus();
    await page.keyboard.press("ArrowDown");
    for (const nodeId of ["theme", "error", "query-state"]) {
      await parent.locator(`[data-node-id="${nodeId}"]`).focus();
      const focusedResult = await new AxeBuilder({ page })
        .include("#parent-tree")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(focusedResult.violations).toEqual([]);
    }
    await expect(parent.locator('[data-node-id="query-state"] [data-focus-ring]')).toHaveCount(1);
    await page
      .locator("#parent-tree")
      .screenshot({ path: `test-results/accessible-keyboard-${theme}.png` });
  });
}

test("uses one tab stop per tree with arrow navigation, typeahead, collapse, and metadata descriptions", async ({
  page,
}) => {
  await page.goto("/");
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  await expect(parent.locator('[data-tree-item][tabindex="0"]')).toHaveCount(1);
  await parent.locator('[data-node-id="strict"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(parent.locator('[data-node-id="app"]')).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(parent.locator('[data-node-id="query-state"]')).toBeFocused();
  await expect(parent.locator('[data-node-id="query-state"]')).toHaveAccessibleDescription(
    /Details of DemoApp.*Outgoing/,
  );
  await expect(parent.locator('[data-node-id="query-state"] [data-focus-ring]')).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await expect(parent.locator('[data-node-id="app"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(parent.locator('[data-node-id="app"]')).toHaveAttribute("aria-expanded", "false");
  await expect(parent.locator('[data-node-id="query-state"]')).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(parent.locator('[data-node-id="app"]')).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("s");
  await expect(parent.locator('[data-node-id="set-query"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(parent.locator('[data-tree-item][tabindex="0"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("searchbox", { name: "Search Owner tree", exact: true }),
  ).toBeFocused();
});

test("keeps native row focus mounted during automatic windowing and recovers on keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree", exact: true });
  await page.getByRole("button", { name: "Collapse all in Deep tree", exact: true }).focus();
  await page.keyboard.press("Tab");
  const first = tree.locator('[data-node-id="deep-0"]');
  await expect(first).toBeFocused();
  const viewport = page.locator("#deep-tree [data-tree-viewport]");
  await viewport.evaluate((element) => {
    element.scrollTop = 30000;
  });
  await expect(viewport).toHaveAttribute("data-first-visible-index", "1250");
  await expect(first).toBeFocused();
  expect(await tree.getByRole("treeitem").count()).toBeLessThan(30);
  await page.keyboard.press("End");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-level", "10000");
  await expect(tree.locator('[data-focused="true"]')).toBeInViewport();
  await expect(tree.locator('[data-focused="true"] [data-focus-ring]')).toHaveCount(1);
  await page.keyboard.press("Home");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-level", "1");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.up("Space");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-expanded", "true");
});

test.describe("touch access", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("activates once and retains detail traces after touch ends", async ({ page }) => {
    await page.goto("/fixtures/compound");
    const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
    await tree.locator('[data-node-id="count"]').tap();
    await expect(page.getByTestId("activation-count")).toHaveText("1");
    await expect(page.getByTestId("selected")).toHaveText("count");
    await expect(page.getByTestId("active")).toHaveText("count");
    await expect(tree.locator('[data-edge-id="count-child"]')).toHaveCount(1);
    await expect(tree.locator("[data-focus-ring]")).toHaveCount(0);
    const virtual = page.getByRole("tree", { name: "Compound virtual", exact: true });
    await virtual.getByRole("treeitem", { name: "Child", exact: true }).tap();
    await expect(page.getByTestId("virtual-selected")).toHaveText("child");
    await expect(virtual.locator('[data-node-id="child"]')).toHaveAttribute("data-active", "true");
  });
});
