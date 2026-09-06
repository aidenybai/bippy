import { expect, test } from "@playwright/test";

test("traces hooks through props and callbacks using shared SVG primitives", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator("#dataflow");
  await diagram.scrollIntoViewIfNeeded();
  await diagram.screenshot({ path: "test-results/dataflow-rest.png" });
  await diagram.locator('[data-node-id="query-state"]').hover();
  for (const nodeId of [
    "query",
    "input-value",
    "input-change",
    "set-query",
    "visible-todos",
    "list-items",
  ])
    await expect(diagram.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
  for (const nodeId of ["todos-reducer", "cart-hook", "theme-hook"])
    await expect(diagram.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
      "data-emphasis",
      "dimmed",
    );
  await expect(diagram.locator('[data-edge-id="state-update"]')).toHaveCSS("opacity", "1");
  await expect(diagram.locator('[data-edge-id="reducer-result"]')).toHaveCSS("opacity", "0.2");
  await expect(diagram.locator('[data-edge-id="query-prop"] > path')).toHaveAttribute(
    "marker-end",
    /^url\(#.+\)$/,
  );
  await diagram.screenshot({ path: "test-results/dataflow-state.png" });
  await page.mouse.move(0, 0);
  await expect(diagram.locator('[data-emphasis="dimmed"]')).toHaveCount(0);
  await diagram.locator('[data-node-id="visible-todos"]').focus();
  await expect(diagram.locator('[data-node-id="query-state"]')).toHaveAttribute(
    "data-emphasis",
    "normal",
  );
  await expect(diagram.locator('[data-node-id="todos-reducer"]')).toHaveAttribute(
    "data-emphasis",
    "normal",
  );
});

test("traces external-store and context flows in both themes", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator("#dataflow");
  await diagram.locator('[data-node-id="cart-hook"]').hover();
  for (const nodeId of ["cart-store", "get-snapshot", "subscribe", "cart-click", "span-content"])
    await expect(diagram.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
  await diagram.screenshot({ path: "test-results/dataflow-store.png" });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await diagram.locator('[data-node-id="theme-provider"]').hover();
  for (const nodeId of ["theme-hook", "theme-value", "button-style"])
    await expect(diagram.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
      "data-emphasis",
      "normal",
    );
  await expect(diagram.locator('[data-node-id="cart-hook"]')).toHaveAttribute(
    "data-emphasis",
    "dimmed",
  );
  await diagram.screenshot({ path: "test-results/dataflow-context-dark.png" });
});
