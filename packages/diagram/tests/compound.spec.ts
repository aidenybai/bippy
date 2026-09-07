import { expect, test } from "@playwright/test";

test("supports controlled state, shared views, and isolated nested roots", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/fixtures/compound");
  const parent = page.getByRole("tree", { name: "Compound parent" });
  const owner = page.getByRole("tree", { name: "Compound owner" });
  const isolated = page.getByRole("group", { name: "Isolated diagram" });
  await expect(page.getByTestId("active")).toHaveText("none");
  await expect(isolated.locator('[data-node-id="isolated-first"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByRole("button", { name: "Activate count", exact: true }).click();
  for (const view of [parent, owner]) {
    await expect(view.locator('[data-node-id="count"]')).toHaveAttribute("data-active", "true");
    await expect(view.locator('[data-edge-id="count-child"]')).toHaveCount(1);
  }
  await isolated.locator('[data-node-id="isolated-second"]').hover();
  await expect(isolated.locator('[data-node-id="isolated-second"]')).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("active")).toHaveText("count");
  await parent.locator('[data-node-id="child"]').hover();
  await expect(page.getByTestId("active")).toHaveText("child");
  await expect(owner.locator('[data-node-id="child"]')).toHaveAttribute("data-active", "true");
  await page.getByRole("button", { name: "Clear active", exact: true }).click();
  await expect(page.getByTestId("active")).toHaveText("none");
  expect(errors).toEqual([]);
});

test("forwards refs and DOM props while composing consumer handlers with selection", async ({
  page,
}) => {
  await page.goto("/fixtures/compound");
  const parent = page.getByRole("tree", { name: "Compound parent" });
  const item = parent.locator('[data-node-id="child"]');
  await expect(parent).toHaveClass(/consumer-view/);
  await expect(item).toHaveClass(/consumer-item/);
  await expect(item).toHaveAttribute("data-slot", "tree-item");
  await expect(item).toHaveAttribute("data-custom", "item");
  await expect(parent.locator('[data-node-id="count"]')).toHaveAttribute(
    "data-slot",
    "tree-detail",
  );
  await expect(parent.locator('[data-node-id="count"] circle')).toHaveCount(0);
  await expect(parent.getByTestId("custom-label")).toHaveText("state");
  await item.click();
  await expect(page.getByTestId("selected")).toHaveText("child");
  await expect(page.getByTestId("clicked")).toHaveText("child");
  await page.getByRole("button", { name: "Inspect refs", exact: true }).click();
  await expect(page.getByTestId("refs")).toHaveText("true");
  const blocked = page.locator('[data-node-id="blocked"]');
  await blocked.hover();
  await expect(blocked).not.toHaveAttribute("data-active", "true");
  await blocked.click();
  await expect(page.getByTestId("blocked")).toHaveText("false");
});
