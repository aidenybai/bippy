import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("wires label and description slots, custom IDs, refs, and conditional slot removal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/fixtures/compound");
  const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
  const detail = tree.locator('[data-node-id="count"]');
  await expect(detail).toHaveAccessibleName("state");
  await expect(detail).toHaveAccessibleDescription(/Details of App.*Custom count explanation/);
  await expect(detail.locator('[data-slot="tree-label"]')).toHaveAttribute(
    "id",
    "custom-count-label",
  );
  await page.getByRole("button", { name: "Inspect refs", exact: true }).click();
  await expect(page.getByTestId("refs")).toHaveText("true");
  await page.getByRole("button", { name: "Toggle description slot", exact: true }).click();
  await expect(detail).not.toHaveAccessibleDescription(/Custom count explanation/);
  await expect(detail).toHaveAccessibleDescription(/Details of App/);
  await page.getByRole("button", { name: "Toggle label slot", exact: true }).click();
  await expect(detail).toHaveAccessibleName("useState, count");
  await page.getByRole("button", { name: "Toggle label slot", exact: true }).click();
  await expect(detail).toHaveAccessibleName("state");
  const unresolved = await page
    .locator("[aria-labelledby], [aria-describedby]")
    .evaluateAll((elements) =>
      elements.flatMap((element) =>
        ["aria-labelledby", "aria-describedby"].flatMap((attribute) =>
          (element.getAttribute(attribute)?.split(/\s+/) ?? []).filter(
            (id) => id && !element.ownerDocument.getElementById(id),
          ),
        ),
      ),
    );
  expect(unresolved).toEqual([]);
  expect(errors).toEqual([]);
});

test("recovers focus after item removal and skips disabled items without activating them", async ({
  page,
}) => {
  await page.goto("/fixtures/compound");
  const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
  const child = tree.locator('[data-node-id="child"]');
  await child.focus();
  await page.keyboard.press("Delete");
  await expect(child).toHaveCount(0);
  await expect(tree.locator('[data-node-id="app"]')).toBeFocused();
  await page.getByRole("button", { name: "Toggle child", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toggle child", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Toggle disabled child", exact: true }).click();
  await tree.locator('[data-node-id="app"]').focus();
  await page.keyboard.press("End");
  await expect(tree.locator('[data-node-id="count"]')).toBeFocused();
  await expect(child).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("selected")).toHaveText("");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected")).toHaveText("count");
});

test("reactivates controlled focus and repairs disabled or hidden DOM items", async ({ page }) => {
  await page.goto("/fixtures/compound");
  const tree = page.getByRole("tree", { name: "Compound parent", exact: true });
  const child = tree.locator('[data-node-id="child"]');
  await child.focus();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("active")).toHaveText("count");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("active")).toHaveText("child");
  await expect(page.getByTestId("activation-count")).toHaveText("1");
  await child.evaluate((element) => element.setAttribute("aria-disabled", "true"));
  await expect(tree.locator('[data-node-id="app"]')).toBeFocused();
  await child.evaluate((element) => element.removeAttribute("aria-disabled"));
  await child.focus();
  await child.evaluate((element) => element.setAttribute("style", "display: none"));
  await expect(tree.locator('[data-node-id="app"]')).toBeFocused();
});

test("virtual focus is independent from activation and empty views remain named and focusable", async ({
  page,
}) => {
  await page.goto("/fixtures/compound");
  const virtual = page.getByRole("tree", { name: "Compound virtual", exact: true });
  await virtual.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("virtual-selected")).toHaveText("");
  await expect(virtual.locator('[data-node-id="count"] circle')).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("virtual-selected")).toHaveText("count");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("virtual-selected")).toHaveText("count");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("virtual-selected")).toHaveText("child");
  await page.getByRole("button", { name: "Toggle empty", exact: true }).click();
  const empty = page.getByRole("group", { name: "Compound parent", exact: true });
  await empty.focus();
  await expect(empty).toBeFocused();
  await expect(empty).toHaveAccessibleDescription(/No nodes to display/);
  await expect(page.getByRole("group", { name: "Compound virtual", exact: true })).toContainText(
    "No nodes to display.",
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
