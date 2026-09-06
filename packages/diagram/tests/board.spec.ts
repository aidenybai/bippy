import { expect, test } from "@playwright/test";
import { diagramMetrics } from "../src/diagram/geometry";

test("uses the minimal fixed-size million-ui board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1200, height: 815 });
  await page.goto("/");
  await expect(page.locator("main section")).toHaveCount(16);
  await expect(page.locator("header, footer, nav, h1")).toHaveCount(0);
  const first = page.locator("main section").first();
  await expect(first).toHaveCSS("width", "325px");
  await expect(first).toHaveCSS("height", "325px");
  await expect(first).toHaveCSS("background-color", "rgb(255, 255, 255)");
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
    .locator("[data-node-id] > text")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontSize));
  expect(new Set(fontSizes)).toEqual(new Set([`${diagramMetrics.fontSize}px`]));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.screenshot({ path: "test-results/diagram-mobile.png" });
});

test("hover and keyboard focus fade other nodes without selection boxes", async ({ page }) => {
  await page.goto("/");
  const diagram = page.locator('#parent-tree [data-tree-relationship="parent"]');
  const node = diagram.locator('[data-node-id="main"]');
  const other = diagram.locator('[data-node-id="frame"]');
  await node.hover();
  await expect(node).toHaveCSS("opacity", "1");
  await expect(other).toHaveCSS("opacity", "0.2");
  await expect(node.locator("rect")).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  await expect(node.locator("rect")).toHaveCSS("stroke", "none");
  await expect(diagram.locator('[data-edge-from="div"][data-edge-to="main"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(diagram.locator('[data-edge-from="strict"][data-edge-to="app"]')).toHaveCSS(
    "opacity",
    "0.2",
  );
  await node.click();
  await page.mouse.move(0, 0);
  await expect(other).toHaveCSS("opacity", "1");
  await page.keyboard.press("Tab");
  const focused = diagram.locator("[data-node-id]:focus");
  await expect(focused).toHaveCount(1);
  await expect(diagram.locator('[data-emphasis="dimmed"]')).toHaveCount(
    (await diagram.locator("[data-node-id]").count()) - 1,
  );
  await page.screenshot({ path: "test-results/hover-static.png" });
});

test("virtual rows reuse diagram nodes and emphasize only the hovered item", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree" });
  await expect(tree.locator('[aria-selected="true"]')).toHaveCount(0);
  await expect(tree).toHaveAttribute("data-visible-count", "11");
  await expect(tree).toHaveAttribute("data-mounted-count", "16");
  const node = tree.locator('[data-node-id="deep-3"]');
  const other = tree.locator('[data-node-id="deep-2"]');
  await node.hover();
  await expect(node).toHaveCSS("opacity", "1");
  await expect(other).toHaveCSS("opacity", "0.2");
  await expect(tree.getByRole("treeitem").nth(2).getByRole("button")).toHaveCSS("opacity", "0");
  await expect(node.locator("circle")).toHaveAttribute("r", String(diagramMetrics.nodeRadius));
  await expect(node.locator("rect")).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  await node.click();
  await page.mouse.move(0, 0);
  await expect(other).toHaveCSS("opacity", "1");
  await expect(node.locator("rect")).toHaveCSS("stroke", "none");
  await node.hover();
  await tree.press("End");
  await expect(tree.locator('[data-node-id="deep-9999"]')).toHaveAttribute(
    "data-emphasis",
    "normal",
  );
  await expect(tree.locator('[data-node-id="deep-9998"]')).toHaveAttribute(
    "data-emphasis",
    "dimmed",
  );
  await tree.press("Home");
  await tree.press("ArrowLeft");
  await expect(tree).toHaveAttribute("data-visible-count", "1");
  await expect(tree).toHaveAttribute("data-mounted-count", "1");
  await page.locator("#deep-tree").screenshot({ path: "test-results/virtual-after.png" });
});

test("virtual hitboxes fill the row and keep the expander reachable", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree" });
  await tree.scrollIntoViewIfNeeded();
  const bounds = await tree.boundingBox();
  if (!bounds) throw new Error("Missing tree viewport");
  const row = tree.getByRole("treeitem").nth(3);
  const node = row.locator("[data-node-id]");
  const toggle = row.getByRole("button");
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + 3 * diagramMetrics.rowHeight + 0.5);
  await expect(node).toHaveAttribute("data-emphasis", "normal");
  await expect(tree.locator('[data-node-id="deep-2"]')).toHaveAttribute("data-emphasis", "dimmed");
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + 4 * diagramMetrics.rowHeight - 0.5);
  await expect(toggle).toHaveCSS("opacity", "1");
  await page.mouse.move(bounds.x + 8, bounds.y + 3.5 * diagramMetrics.rowHeight, { steps: 20 });
  await expect(toggle).toHaveCSS("opacity", "1");
  await toggle.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const boxes = await tree.locator("[data-row-hitbox]").evaluateAll((elements) =>
    elements.map((element) => ({
      y: Number(element.getAttribute("y")),
      height: Number(element.getAttribute("height")),
      width: Number(element.getAttribute("width")),
    })),
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
  await expect(page.locator("#svg-reuse")).toHaveCount(0);
  const labels = page.locator("[data-node-id] > text");
  const styles = await labels.evaluateAll((elements) =>
    elements.map((element) => ({
      paintOrder: getComputedStyle(element).paintOrder,
      strokeWidth: getComputedStyle(element).strokeWidth,
      fontSize: getComputedStyle(element).fontSize,
    })),
  );
  for (const style of styles)
    expect(style).toEqual({
      paintOrder: "stroke",
      strokeWidth: "2px",
      fontSize: `${diagramMetrics.fontSize}px`,
    });
  const staticConnector = page.locator("#edge-parent [data-edge-from] > path");
  const virtualConnector = page.locator("#deep-tree [data-connector]").first();
  for (const connector of [staticConnector, virtualConnector]) {
    await expect(connector).toHaveCSS("stroke-width", "1px");
    await expect(connector).toHaveCSS("stroke-opacity", "0.25");
  }
  await expect(page.locator("#edge-reference [data-edge-from] > path")).toHaveAttribute("d", / A /);
  await expect(page.locator("#edge-owner [data-edge-from] > path")).toHaveAttribute("d", / A /);
});

test("rebases a deep window without mounting the whole tree", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Deep tree" });
  await tree.scrollIntoViewIfNeeded();
  await tree.evaluate((element, rowHeight) => {
    element.scrollTop = 6000 * rowHeight;
  }, diagramMetrics.rowHeight);
  await expect(tree).toHaveAttribute("data-base-depth", "5998");
  expect(await tree.getByRole("treeitem").count()).toBeLessThanOrEqual(21);
  const dimensions = await tree.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.width);
  await tree.focus();
  await tree.press("End");
  await expect(tree.locator('[aria-selected="true"]')).toHaveAttribute("aria-level", "10000");
  await expect(tree.locator('[aria-selected="true"]')).toBeInViewport();
  await tree.press("Home");
  await tree.press("ArrowLeft");
  await expect(tree.getByRole("treeitem")).toHaveCount(1);
  await tree.press("ArrowRight");
  await tree.press("ArrowDown");
  await expect(tree.locator('[aria-selected="true"]')).toHaveAttribute("aria-level", "2");
});

test("keeps sibling positions correct after collapsing a branch", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Branching tree" });
  await tree.focus();
  await tree.press("ArrowDown");
  await tree.press("ArrowDown");
  const selected = tree.locator('[aria-selected="true"]');
  await expect(selected).toHaveAttribute("aria-level", "2");
  await expect(selected).toHaveAttribute("aria-setsize", "3");
  await tree.press("ArrowLeft");
  await expect(selected).toHaveAttribute("aria-expanded", "false");
  await tree.press("ArrowDown");
  await expect(selected).toHaveAttribute("aria-level", "2");
  await expect(selected).toHaveAttribute("aria-posinset", "2");
  await tree.press("End");
  await expect(selected).toBeInViewport();
  expect(await tree.getByRole("treeitem").count()).toBeLessThanOrEqual(21);
});
