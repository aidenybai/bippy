import { expect, test } from "@playwright/test";

test("uses the function symbol for callable details in both projections", async ({ page }) => {
  await page.goto("/");
  for (const nodeId of [
    "query-state",
    "set-query",
    "dispatch",
    "feed-toggle",
    "post-toggle",
    "item-click",
    "get-snapshot",
    "subscribe",
    "store-add",
  ]) {
    const symbols = page.locator(
      `[data-tree-relationship] [data-node-id="${nodeId}"] [data-function-symbol]`,
    );
    await expect(symbols).toHaveCount(2);
    for (const symbol of await symbols.all()) {
      await expect(symbol).toHaveText("ƒ");
      await expect(symbol).toHaveAttribute("aria-hidden", "true");
      await expect(symbol).toHaveCSS("font-size", "10px");
    }
  }
  for (const nodeId of ["visible-todos", "stats-count", "feed-items", "cart-store", "app"]) {
    await expect(
      page.locator(`[data-tree-relationship] [data-node-id="${nodeId}"] [data-function-symbol]`),
    ).toHaveCount(0);
  }
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  const callback = parent.locator('[data-node-id="feed-toggle"]');
  await expect(callback).toHaveAccessibleName("props.onToggle");
  await expect(callback).toHaveAccessibleDescription(/value, function/);
  await parent.locator('[data-node-id="app"]').focus();
  await page.keyboard.press("s");
  await expect(parent.locator('[data-node-id="set-query"]')).toBeFocused();
});
