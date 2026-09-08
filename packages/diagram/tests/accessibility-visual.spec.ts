import { expect, test } from "@playwright/test";

interface VisualTheme {
  theme: "light" | "dark";
}
const themes: VisualTheme[] = [{ theme: "light" }, { theme: "dark" }];

for (const { theme } of themes) {
  test(`maintains readable SVG contrast and 24px targets in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      }),
    ).toBeVisible();
    const getContrast = () =>
      page
        .locator(
          "main svg text, main svg tspan, main svg circle, main svg [data-component-symbol] rect, main svg [data-component-symbol] path, main svg [data-edge-from] > [data-edge-path], main svg [data-connector], main svg [data-scope-kind] > rect, main svg [data-focus-ring]",
        )
        .evaluateAll((elements) => {
          const context = document
            .createElement("canvas")
            .getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Missing canvas context");
          const getLuminance = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const channels = [...context.getImageData(0, 0, 1, 1).data]
              .slice(0, 3)
              .map((channel) => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
              });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          return elements
            .filter(
              (element) =>
                !["text", "tspan"].includes(element.tagName) || element.textContent?.trim(),
            )
            .map((element) => {
              const style = getComputedStyle(element);
              const isText = ["text", "tspan"].includes(element.tagName);
              const paint = isText ? style.fill : style.stroke;
              const foreground = getLuminance(paint === "currentcolor" ? style.color : paint);
              const background = getLuminance(
                getComputedStyle(element.closest("section") ?? document.body).backgroundColor,
              );
              return {
                text: element.textContent,
                minimum: isText ? 4.5 : 3,
                ratio:
                  (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05),
              };
            })
            .filter((result) => result.ratio < result.minimum);
        });
    expect(await getContrast()).toEqual([]);
    await page.locator('[data-tree-relationship="parent"] [data-node-id="theme"]').hover();
    expect(await getContrast()).toEqual([]);
    const targets = await page
      .locator("[data-tree-item] > rect, [data-row-hitbox], [data-tree-toggle] > rect")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      );
    expect(targets.length).toBeGreaterThan(30);
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(24 - 0.001);
      expect(target.height).toBeGreaterThanOrEqual(24 - 0.001);
    }
  });
}

test("keeps keyboard focus visible in forced colors and at 200% zoom", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Forced-colors emulation is checked in Chromium.");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/");
  const parent = page.getByRole("tree", { name: "Parent tree", exact: true });
  await parent.locator('[data-node-id="strict"]').focus();
  await page.keyboard.press("ArrowDown");
  const focused = parent.locator('[data-node-id="app"]');
  await expect(focused).toBeFocused();
  await expect(focused.locator("[data-focus-ring]")).toHaveCSS("stroke-width", "2px");
  await expect(focused.locator("[data-focus-ring]")).not.toHaveCSS("stroke", "none");
  await page
    .locator("#parent-tree")
    .screenshot({ path: "test-results/accessible-forced-colors.png" });
  await page.emulateMedia({ forcedColors: "none" });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.keyboard.press("ArrowDown");
  await expect(parent.locator('[data-node-id="query-state"]')).toBeFocused();
  await expect(parent.locator('[data-node-id="query-state"]')).toBeInViewport();
  await page.locator("#parent-tree").screenshot({ path: "test-results/accessible-zoom.png" });
});
