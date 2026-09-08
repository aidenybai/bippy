import { expect, test } from "@playwright/test";
import { diagramMetrics } from "../src/diagram/geometry";

test("uses the million-ui sidebar and fixed-size specimen board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("main section")).toHaveCount(16);
  await expect(page.getByRole("navigation", { name: "Components" })).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search components", exact: true }),
  ).toBeVisible();
  const first = page.locator("main section").first();
  await expect(first).toHaveCSS("width", "325px");
  await expect(first).toHaveCSS("height", "325px");
  await expect(first).toHaveCSS("background-color", "oklch(1 0 0)");
  await expect(first).toHaveCSS("border-radius", "0px");
  const firstBounds = await first.boundingBox();
  const secondBounds = await page.locator("main section").nth(1).boundingBox();
  if (!firstBounds || !secondBounds) throw new Error("Missing specimen");
  expect(secondBounds.x - firstBounds.x - firstBounds.width).toBe(16);
  await page.screenshot({ path: "test-results/diagram-board.png" });
  expect(errors).toEqual([]);
});

test("keeps SVG typography and geometry at native size", async ({ page }) => {
  await page.goto("/");
  const sizes = await page.locator('svg[role="group"]').evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        expectedWidth: Number(element.getAttribute("width")),
        expectedHeight: Number(element.getAttribute("height")),
      };
    }),
  );
  for (const size of sizes) {
    expect(size.width).toBe(size.expectedWidth);
    expect(size.height).toBe(size.expectedHeight);
  }
  const fontSizes = await page
    .locator(
      "[data-node-id] text, [data-node-id] tspan, [data-edge-from] text, [data-edge-label-for], [data-scope-kind] text",
    )
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontSize));
  expect(new Set(fontSizes)).toEqual(new Set([`${diagramMetrics.fontSize}px`]));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.screenshot({ path: "test-results/diagram-mobile.png" });
});

test("hover and keyboard focus preserve contrast without selection boxes", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator('#parent-tree [data-tree-relationship="parent"]');
  const node = diagram.locator('[data-node-id="main"]');
  const other = diagram.locator('[data-node-id="frame"]');
  await node.hover();
  await expect(node).toHaveCSS("opacity", "1");
  await expect(other).toHaveCSS("opacity", "1");
  await expect(other).toHaveAttribute("data-emphasis", "dimmed");
  for (const hitbox of await node.locator("rect").all()) {
    await expect(hitbox).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
    await expect(hitbox).toHaveCSS("stroke", "none");
  }
  await expect(diagram.locator('[data-edge-from="div"][data-edge-to="main"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(diagram.locator('[data-edge-from="strict"][data-edge-to="app"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await node.click();
  await page.mouse.move(0, 0);
  await expect(other).toHaveCSS("opacity", "1");
  await other.focus();
  await page.keyboard.press("ArrowDown");
  await expect(diagram.locator("[data-node-id]:focus")).toHaveCount(1);
  await expect(diagram.locator('[data-emphasis="dimmed"]')).toHaveCount(
    (await diagram.locator("[data-node-id]").count()) - 1,
  );
  await page.screenshot({ path: "test-results/hover-static.png" });
});

test("normal trees window large models and emphasize only the hovered item", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree", exact: true });
  const viewport = page.locator("#deep-tree [data-tree-viewport]");
  await expect(tree.locator('[aria-selected="true"]')).toHaveCount(0);
  await expect(viewport).toHaveAttribute("data-visible-count", "10");
  await expect(viewport).toHaveAttribute("data-mounted-count", "15");
  const node = tree.locator('[data-node-id="deep-3"]');
  const other = tree.locator('[data-node-id="deep-2"]');
  await node.hover();
  await expect(other).toHaveAttribute("data-emphasis", "dimmed");
  await expect(node.locator("[data-tree-toggle] path")).toHaveCSS("opacity", "1");
  await expect(node.locator("[data-component-symbol] circle")).toHaveAttribute(
    "r",
    String(diagramMetrics.nodeRadius),
  );
  await expect(node.locator(":scope > rect")).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  await node.locator("[data-tree-toggle]").click();
  await expect(node).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(node).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(0, 0);
  await expect(other).toHaveCSS("opacity", "1");
  await expect(node.locator(":scope > rect")).toHaveCSS("stroke", "none");
  await page.keyboard.press("End");
  await expect(tree.locator('[data-node-id="deep-9999"]')).toBeFocused();
  await expect(tree.locator('[data-node-id="deep-9998"]')).toHaveAttribute(
    "data-emphasis",
    "dimmed",
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await expect(viewport).toHaveAttribute("data-visible-count", "1");
  await expect(viewport).toHaveAttribute("data-mounted-count", "1");
  await page.locator("#deep-tree").screenshot({ path: "test-results/virtual-after.png" });
});

test("shared row hitboxes fill the viewport and keep the disclosure reachable", async ({
  page,
}) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree", exact: true });
  const viewport = page.locator("#deep-tree [data-tree-viewport]");
  await viewport.scrollIntoViewIfNeeded();
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Missing viewport");
  const row = tree.locator('[data-node-id="deep-3"]');
  const toggle = row.locator("[data-tree-toggle]");
  await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + 3 * diagramMetrics.rowHeight + 1);
  await expect(row).toHaveAttribute("data-emphasis", "normal");
  await expect(tree.locator('[data-node-id="deep-2"]')).toHaveAttribute("data-emphasis", "dimmed");
  await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + 4 * diagramMetrics.rowHeight - 1);
  await expect(toggle.locator("path")).toHaveCSS("opacity", "1");
  await page.mouse.move(bounds.x + 8, bounds.y + 3.5 * diagramMetrics.rowHeight, { steps: 20 });
  await expect(toggle.locator("path")).toHaveCSS("opacity", "1");
  await toggle.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const boxes = await tree.locator("[data-tree-item] > rect").evaluateAll((elements) =>
    elements.map((element) => {
      const rectangle = element.getBoundingClientRect();
      return { y: rectangle.y, height: rectangle.height, width: rectangle.width };
    }),
  );
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index].y).toBe(boxes[index - 1].y + boxes[index - 1].height);
    expect(boxes[index].width).toBe(bounds.width);
  }
});

test("shares compact node, text, connector, and arc rules throughout the system", async ({
  page,
}) => {
  await page.goto("/");
  const labelStyles = await page.locator("[data-node-id] > text").evaluateAll((elements) =>
    elements.map((element) => ({
      paintOrder: getComputedStyle(element).paintOrder,
      strokeWidth: getComputedStyle(element).strokeWidth,
      fontSize: getComputedStyle(element).fontSize,
    })),
  );
  for (const style of labelStyles) {
    expect(style.paintOrder).toBe("stroke");
    expect(style.strokeWidth).toBe("2px");
    expect(style.fontSize).toBe(`${diagramMetrics.fontSize}px`);
  }
  for (const connector of [
    page.locator("#edge-parent [data-edge-path]"),
    page.locator("#deep-tree [data-edge-path]").first(),
  ]) {
    await expect(connector).toHaveCSS("stroke-width", "1px");
    await expect(connector).toHaveCSS("stroke-opacity", "1");
  }
  await expect(page.locator("#edge-reference [data-edge-path]")).toHaveAttribute("d", / A /);
  await expect(page.locator("#edge-owner [data-edge-path]")).toHaveAttribute("d", / A /);
});

test("rebases a deep window without mounting the whole tree", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree", exact: true });
  const viewport = page.locator("#deep-tree [data-tree-viewport]");
  await viewport.scrollIntoViewIfNeeded();
  await viewport.evaluate((element, rowHeight) => {
    element.scrollTop = 6000 * rowHeight;
  }, diagramMetrics.rowHeight);
  await expect(viewport).toHaveAttribute("data-first-visible-index", "6000");
  expect(await tree.getByRole("treeitem").count()).toBeLessThanOrEqual(21);
  expect(await tree.locator("[data-edge-path]").count()).toBeLessThan(30);
  const dimensions = await viewport.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.width);
  await tree.locator('[data-node-id="deep-6000"]').focus();
  await page.keyboard.press("End");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-level", "10000");
  await expect(tree.locator('[data-focused="true"]')).toBeInViewport();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await expect(tree.getByRole("treeitem")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(tree.locator('[data-focused="true"]')).toHaveAttribute("aria-level", "2");
});

test("keeps sibling positions correct after collapsing a branch", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Branching tree", exact: true });
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("ArrowDown");
  const focused = tree.locator('[data-focused="true"]');
  await expect(focused).toHaveAttribute("aria-level", "2");
  await expect(focused).toHaveAttribute("aria-setsize", "3");
  await page.keyboard.press("ArrowLeft");
  await expect(focused).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(focused).toHaveAttribute("aria-level", "2");
  await expect(focused).toHaveAttribute("aria-posinset", "2");
  await page.keyboard.press("End");
  await expect(focused).toBeInViewport();
  expect(await tree.getByRole("treeitem").count()).toBeLessThanOrEqual(21);
});
