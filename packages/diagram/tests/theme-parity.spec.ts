import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`board chrome uses million-ui's ${theme} palette`, async ({ page }) => {
    await page.goto("/?component=node-component");
    await expect(page.locator("main section")).toHaveCount(1);
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.getByRole("button", { name: "Show preview", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const isDark = theme === "dark";
    const paints = [
      {
        selector: '[aria-label="Show preview"]',
        property: "color",
        value: isDark ? "oklch(0.985 0 0)" : "oklch(0.145 0 0)",
      },
      {
        selector: '[aria-label="Show preview"]',
        property: "background-color",
        value: isDark
          ? "color-mix(in oklab, oklch(0.269 0 0) 50%, transparent)"
          : "oklch(0.97 0 0)",
      },
      {
        selector: '[data-slot="tooltip-content"][data-open]',
        property: "background-color",
        value: "color(display-p3 0.057 0.057 0.057)",
      },
      {
        selector: '[data-slot="tooltip-content"][data-open]',
        property: "color",
        value: "color(display-p3 0.949 0.949 0.949)",
      },
      {
        selector: 'main > [data-slot="scroll-area"]',
        property: "background-color",
        value: isDark ? "oklch(0.123 0 0)" : "color(display-p3 0.973 0.973 0.973)",
      },
      {
        selector: "#node-component",
        property: "background-color",
        value: isDark ? "oklch(0.145 0 0)" : "oklch(1 0 0)",
      },
      {
        selector: "aside",
        property: "color",
        value: isDark ? "oklch(0.985 0 0)" : "oklch(0.145 0 0)",
      },
      {
        selector: "aside",
        property: "border-right-color",
        value: isDark ? "oklch(1 0 0 / 8%)" : "oklch(0.922 0 0)",
      },
      {
        selector: "aside nav a:last-of-type",
        property: "color",
        value: isDark ? "oklch(0.708 0 0)" : "oklch(0.556 0 0)",
      },
      {
        selector: "aside input",
        property: "background-color",
        value: isDark ? "color-mix(in oklab, oklch(1 0 0 / 15%) 30%, transparent)" : "oklch(1 0 0)",
      },
      {
        selector: "aside input",
        property: "box-shadow",
        value: `0 0 0 1px ${isDark ? "oklch(1 0 0 / 12%)" : "oklch(0.922 0 0)"}`,
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
  });
}
