import { expect, test } from "@playwright/test";

test("shows catch regions for the hovered boundary and synchronizes the owner view", async ({
  page,
}) => {
  await page.goto("/");
  const parent = page.locator('[data-tree-relationship="parent"]');
  const owner = page.locator('[data-tree-relationship="owner"]');
  await expect(parent.locator("[data-scope-kind]")).toHaveCount(0);
  await parent.locator('[data-node-id="error"]').hover();
  await expect(parent.locator('[data-scope-kind="boundary"]')).toHaveCount(2);
  await expect(parent.getByLabel("catches: ErrorBoundary (5) boundary scope")).toBeVisible();
  await expect(owner.locator('[data-node-id="error"] > circle')).not.toHaveCSS(
    "fill",
    "rgb(255, 255, 255)",
  );
  await parent.screenshot({ path: "test-results/outer-boundary.png" });
  await owner.locator('[data-node-id="feed-error"]').hover();
  await expect(parent.locator('[data-scope-kind="boundary"]')).toHaveCount(1);
  await expect(parent.getByLabel("catches: ErrorBoundary (16) boundary scope")).toBeVisible();
  await parent.screenshot({ path: "test-results/inner-boundary.png" });
  await page.mouse.move(0, 0);
  await expect(parent.locator("[data-scope-kind]")).toHaveCount(0);
});

test("only shows the context overlay while its provider is active", async ({ page }) => {
  await page.goto("/");
  const parent = page.locator('[data-tree-relationship="parent"]');
  await parent.locator('[data-node-id="theme"]').hover();
  await expect(parent.locator('[data-scope-kind="context"]')).toHaveCount(1);
  await expect(parent.locator('[data-scope-kind="context"]')).toHaveCSS("opacity", "1");
  await expect(parent.locator('[data-edge-from="theme"][data-edge-to="stats"]')).toBeVisible();
  await parent.locator('[data-node-id="frame"]').hover();
  await expect(parent.locator('[data-scope-kind="context"]')).toHaveCount(0);
});

test("shows direct creations in the parent tree and the subtree in the owner tree", async ({
  page,
}) => {
  await page.goto("/");
  const parent = page.locator('[data-tree-relationship="parent"]');
  const owner = page.locator('[data-tree-relationship="owner"]');
  await parent.locator('[data-node-id="app"]').hover();
  await expect(parent.locator('[data-node-id="frame"]')).toHaveCSS("opacity", "1");
  await expect(parent.locator('[data-node-id="div"]')).toHaveCSS("opacity", "1");
  await expect(parent.locator('[data-node-id="div"]')).toHaveAttribute("data-emphasis", "dimmed");
  await expect(owner.locator('[data-node-id="div"]')).toHaveCSS("opacity", "1");
  await expect(owner.locator('[data-node-id="strict"]')).toHaveCSS("opacity", "1");
  await expect(owner.locator('[data-node-id="strict"]')).toHaveAttribute("data-emphasis", "dimmed");
  await page.locator("#parent-tree").screenshot({ path: "test-results/linked-owner.png" });
});

test("has minimal metadata and an icon-only persistent theme switch", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("diagram");
  await expect(
    page.locator('meta[name="description"], meta[property="og:description"]'),
  ).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(toggle).toHaveText("");
  await expect(toggle.locator("svg")).toHaveCount(1);
  await expect(toggle).toHaveCSS("appearance", "none");
  await expect(toggle).toHaveCSS("border-top-width", "0px");
  await expect(toggle).toHaveCSS("border-bottom-width", "0px");
  await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(toggle).toHaveCSS("width", "32px");
  await toggle.click();
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toHaveCSS(
    "outline-style",
    "none",
  );
  await page.reload();
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "dark");
  await page.locator("#parent-tree").screenshot({ path: "test-results/trees-dark.png" });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "light");
});
