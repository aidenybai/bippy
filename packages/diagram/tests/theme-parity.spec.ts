import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`board uses million-ui's ${theme} palette without navigation chrome`, async ({ page }) => {
    await page.goto("/diagram");
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const isDark = theme === "dark";
    const paints = [
      {
        selector: "main",
        property: "background-color",
        value: isDark ? "oklch(0.123 0 0)" : "color(display-p3 0.973 0.973 0.973)",
      },
      {
        selector: "#node-component",
        property: "background-color",
        value: isDark ? "oklch(0.145 0 0)" : "oklch(1 0 0)",
      },
      {
        selector: "#parent-tree-title",
        property: "color",
        value: isDark ? "oklch(0.708 0 0)" : "oklch(0.556 0 0)",
      },
    ];
    const differences = await page.evaluate((entries) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const results = entries.flatMap(({ selector, property, value }) => {
        const element = document.querySelector(selector);
        if (!element) return [`Missing ${selector}`];
        probe.style.setProperty(property, value);
        const expected = getComputedStyle(probe).getPropertyValue(property);
        const actual = getComputedStyle(element).getPropertyValue(property);
        return actual === expected ? [] : [`${selector} ${property}: ${actual} !== ${expected}`];
      });
      probe.remove();
      return results;
    }, paints);
    expect(differences).toEqual([]);
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
}
