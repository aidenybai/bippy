import { expect, type Page } from "@playwright/test";

export const openBoard = async (page: Page) => {
  await page.goto("/diagram");
  const width = await page
    .locator("#parent-tree [data-tree-viewport]")
    .evaluate((element) =>
      Math.min(element.clientWidth, Math.floor(Number.parseFloat(getComputedStyle(element).width))),
    );
  await expect(page.getByRole("tree", { name: "Parent tree", exact: true })).toHaveAttribute(
    "width",
    String(width),
  );
};
