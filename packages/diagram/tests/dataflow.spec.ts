import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1200, height: 1200 } });

test("embeds hooks and props in both trees and traces the same flow across them", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#parent-tree").scrollIntoViewIfNeeded();
  await expect(page.locator("#dataflow")).toHaveCount(0);
  const parent = page.locator('[data-tree-relationship="parent"]');
  const owner = page.locator('[data-tree-relationship="owner"]');
  for (const tree of [parent, owner]) {
    await expect(tree.locator('[data-node-id="query-state"]')).toHaveCount(1);
    await expect(tree.locator('[data-node-id="feed-items"]')).toHaveCount(1);
    await expect(tree.locator("[data-edge-id]")).toHaveCount(0);
  }
  await parent.locator('[data-node-id="query-state"]').hover();
  for (const tree of [parent, owner]) {
    for (const nodeId of [
      "query-state",
      "set-query",
      "visible-todos",
      "feed-items",
      "post-item",
      "item-content",
      "query-clear",
    ])
      await expect(tree.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
        "data-emphasis",
        "normal",
      );
    for (const nodeId of ["todos-reducer", "cart-hook", "theme-hook"])
      await expect(tree.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
        "data-emphasis",
        "dimmed",
      );
    await expect(tree.locator('[data-edge-id="items-prop"] > [data-edge-path]')).toHaveAttribute(
      "d",
      / C /,
    );
    await expect(tree.locator('[data-edge-kind="owner"]')).toHaveCount(0);
  }
  await page.locator("#parent-tree").screenshot({ path: "test-results/tree-dataflow-query.png" });
  await page.mouse.move(0, 0);
  for (const tree of [parent, owner]) await expect(tree.locator("[data-edge-id]")).toHaveCount(0);
  await expect(parent.locator('[data-edge-kind="owner"]')).toHaveCount(0);
  await parent.locator('[data-node-id="app"]').hover();
  await expect(parent.locator('[data-edge-kind="owner"]').first()).toBeVisible();
  await page.keyboard.press("Tab");
  await owner.locator('[data-node-id="visible-todos"]').focus();
  for (const tree of [parent, owner]) {
    await expect(tree.locator('[data-node-id="query-state"]')).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
    await expect(tree.locator('[data-node-id="todos-reducer"]')).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
  }
});

test("shows store and context flows within their parent and owner projections", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#parent-tree").scrollIntoViewIfNeeded();
  const parent = page.locator('[data-tree-relationship="parent"]');
  const owner = page.locator('[data-tree-relationship="owner"]');
  await owner.locator('[data-node-id="cart-hook"]').hover();
  for (const tree of [parent, owner]) {
    for (const nodeId of [
      "cart-store",
      "get-snapshot",
      "subscribe",
      "cart-click",
      "stats-count",
      "strong-content",
    ])
      await expect(tree.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
        "data-emphasis",
        "normal",
      );
    await expect(tree.locator('[data-edge-id="store-subscribe"]')).toHaveCount(1);
    await expect(tree.locator('[data-edge-id="snapshot-changed"]')).toHaveCount(1);
  }
  await page.locator("#parent-tree").screenshot({ path: "test-results/tree-dataflow-store.png" });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await parent.locator('[data-node-id="theme-hook"]').hover();
  for (const tree of [parent, owner]) {
    await expect(tree.locator('[data-node-id="theme"]')).toHaveAttribute("data-emphasis", "normal");
    await expect(tree.locator('[data-node-id="strong-style"]')).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
    await expect(tree.locator('[data-node-id="cart-hook"]')).toHaveAttribute(
      "data-emphasis",
      "dimmed",
    );
  }
  await page
    .locator("#parent-tree")
    .screenshot({ path: "test-results/tree-dataflow-context-dark.png" });
});
