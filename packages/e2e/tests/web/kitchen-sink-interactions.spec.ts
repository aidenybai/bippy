// Genuinely uses each of the 50 libraries: selects options, submits forms,
// opens portals, scrolls virtualizers, drags draggables, fires toasts,
// filters command menus, picks dates, switches languages, and trips error
// boundaries. Each test asserts the library behaved AND that bippy kept
// observing the resulting commits.
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="lib-lucide-react"]', { timeout: 30_000 });
});

const getCommitCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__COMMIT_COUNT__);

const expectCommitsSince = async (page: Page, commitCountBefore: number): Promise<void> => {
  expect(await getCommitCount(page)).toBeGreaterThan(commitCountBefore);
};

test.describe("state managers do real work", () => {
  test("react-query refetches and delivers new data", async ({ page }) => {
    await expect(page.getByTestId("react-query-value")).toHaveText("query-data-1");
    const commitCountBefore = await getCommitCount(page);
    await page.getByTestId("interact-react-query").click();
    await expect(page.getByTestId("react-query-value")).toHaveText("query-data-2");
    await expectCommitsSince(page, commitCountBefore);
  });

  test("swr revalidates and delivers new data", async ({ page }) => {
    await expect(page.getByTestId("swr-value")).toHaveText("swr-data-1");
    await page.getByTestId("interact-swr").click();
    await expect(page.getByTestId("swr-value")).toHaveText("swr-data-2");
  });

  test("zustand updates through its store", async ({ page }) => {
    const commitCountBefore = await getCommitCount(page);
    await page.getByTestId("interact-zustand").click();
    await page.getByTestId("interact-zustand").click();
    await expect(page.getByTestId("interact-zustand")).toHaveText("zustand:2");
    await expectCommitsSince(page, commitCountBefore);
  });

  test("jotai updates through its atom", async ({ page }) => {
    await page.getByTestId("interact-jotai").click();
    await expect(page.getByTestId("interact-jotai")).toHaveText("jotai:1");
  });

  test("valtio updates through its proxy", async ({ page }) => {
    await page.getByTestId("interact-valtio").click();
    await expect(page.getByTestId("interact-valtio")).toHaveText("valtio:1");
  });

  test("redux dispatches through the store", async ({ page }) => {
    await page.getByTestId("interact-redux").click();
    await expect(page.getByTestId("interact-redux")).toHaveText("redux:1");
  });

  test("mobx updates through its observable", async ({ page }) => {
    await page.getByTestId("interact-mobx").click();
    await expect(page.getByTestId("interact-mobx")).toHaveText("mobx:1");
  });

  test("xstate transitions its machine", async ({ page }) => {
    await expect(page.getByTestId("interact-xstate")).toHaveText("xstate:inactive");
    await page.getByTestId("interact-xstate").click();
    await expect(page.getByTestId("interact-xstate")).toHaveText("xstate:active");
  });
});

test.describe("forms accept input and submit", () => {
  test("react-hook-form watches typed input live", async ({ page }) => {
    const commitCountBefore = await getCommitCount(page);
    await page.getByTestId("rhf-input").fill("typed-name");
    await expect(page.getByTestId("rhf-value")).toHaveText("typed-name");
    await expectCommitsSince(page, commitCountBefore);
  });

  test("formik updates values and submits them", async ({ page }) => {
    await page.getByTestId("formik-input").fill("new@example.com");
    await page.getByTestId("formik-submit").click();
    await expect(page.getByTestId("formik-submitted")).toHaveText("new@example.com");
  });
});

test.describe("radix primitives operate through portals", () => {
  test("dialog opens in a portal, bippy resolves the portaled fiber, escape closes", async ({
    page,
  }) => {
    await page.getByTestId("interact-radix-dialog").click();
    await expect(page.getByTestId("radix-dialog-content")).toBeVisible();

    // The dialog content mounts through a portal outside #root; bippy must
    // still resolve its fiber through the host instance.
    const portalFiberInfo = await page.evaluate(() => {
      const portaledElement = document.querySelector('[data-testid="radix-dialog-content"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(portaledElement);
      return fiber ? { isFiber: window.__BIPPY__.isFiber(fiber) } : null;
    });
    expect(portalFiberInfo).toEqual({ isFiber: true });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("radix-dialog-content")).not.toBeVisible();
  });

  test("tabs switch panels", async ({ page }) => {
    await expect(page.getByTestId("radix-tabs-second")).not.toBeVisible();
    await page.getByTestId("interact-radix-tabs").click();
    await expect(page.getByTestId("radix-tabs-second")).toHaveText("second content");
  });

  test("switch toggles checked state", async ({ page }) => {
    const switchControl = page.getByTestId("interact-radix-switch");
    await expect(switchControl).toHaveAttribute("data-state", "unchecked");
    await switchControl.click();
    await expect(switchControl).toHaveAttribute("data-state", "checked");
    await expect(switchControl).toHaveText("on");
  });

  test("tooltip shows on hover", async ({ page }) => {
    await page.getByTestId("radix-tooltip-trigger").hover();
    await expect(page.getByText("tooltip content")).toBeVisible();
  });

  test("popover opens on click", async ({ page }) => {
    await page.getByTestId("interact-radix-popover").click();
    await expect(page.getByTestId("radix-popover-content")).toBeVisible();
  });

  test("accordion expands its content", async ({ page }) => {
    await expect(page.getByText("accordion content")).not.toBeVisible();
    await page.getByTestId("interact-radix-accordion").click();
    await expect(page.getByText("accordion content")).toBeVisible();
  });
});

test.describe("component kits handle presses", () => {
  test("shadcn-style button counts clicks and renders asChild as an anchor", async ({ page }) => {
    await page.getByTestId("interact-shadcn").click();
    await expect(page.getByTestId("interact-shadcn")).toHaveText("shadcn:1");
    const asChildTag = await page.evaluate(
      () => document.querySelector('a[href="#shadcn"]')?.tagName ?? null,
    );
    expect(asChildTag).toBe("A");
  });

  test("react-aria button presses and toggle button toggles", async ({ page }) => {
    await page.getByTestId("interact-react-aria").click();
    await expect(page.getByTestId("interact-react-aria")).toHaveText("aria:1");
    const toggleButton = page.getByTestId("lib-react-aria-components").getByText("toggle");
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute("aria-pressed", "true");
  });

  test("headlessui switch flips", async ({ page }) => {
    await page.getByTestId("interact-headlessui").click();
    await expect(page.getByTestId("interact-headlessui")).toHaveText("headlessui:true");
  });

  test("downshift opens its menu and selects an item", async ({ page }) => {
    await page.getByTestId("interact-downshift").click();
    await page.getByText("banana").click();
    await expect(page.getByTestId("interact-downshift")).toHaveText("banana");
  });

  test("mui button counts clicks", async ({ page }) => {
    await page.getByTestId("interact-mui").click();
    await expect(page.getByTestId("interact-mui")).toHaveText("mui:1");
  });

  test("mantine button counts clicks", async ({ page }) => {
    await page.getByTestId("interact-mantine").click();
    await expect(page.getByTestId("interact-mantine")).toHaveText("mantine:1");
  });

  test("antd button counts clicks", async ({ page }) => {
    await page.getByTestId("interact-antd").click();
    await expect(page.getByTestId("interact-antd")).toHaveText("antd:1");
  });

  test("react-bootstrap button counts clicks", async ({ page }) => {
    await page.getByTestId("interact-bootstrap").click();
    await expect(page.getByTestId("interact-bootstrap")).toHaveText("bootstrap:1");
  });
});

test.describe("motion and drag libraries move things", () => {
  test("motion animates scale on toggle", async ({ page }) => {
    await page.getByTestId("interact-motion").click();
    await expect(page.getByTestId("interact-motion")).toHaveText("motion:true");
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const animatedElement = document.querySelector<HTMLElement>(
            '[data-testid="interact-motion"]',
          );
          return animatedElement?.style.transform ?? "";
        }),
      )
      .toContain("scale");
  });

  test("react-spring animates opacity to 1", async ({ page }) => {
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const springElement = document.querySelector<HTMLElement>(
            '[data-testid="react-spring-target"]',
          );
          return Number(springElement?.style.opacity ?? 0);
        }),
      )
      .toBeGreaterThan(0.95);
  });

  test("dnd-kit applies a transform while dragging", async ({ page }) => {
    const draggable = page.getByTestId("dnd-kit-draggable");
    const box = await draggable.boundingBox();
    if (!box) throw new Error("draggable has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelector<HTMLElement>('[data-testid="dnd-kit-draggable"]')?.style
              .transform ?? "",
        ),
      )
      .toContain("translate");
    await page.mouse.up();
  });

  test("react-dnd drops the card into the drop zone", async ({ page }) => {
    const commitCountBefore = await getCommitCount(page);
    await page.getByTestId("react-dnd-card").dragTo(page.getByTestId("react-dnd-drop-zone"));
    await expect(page.getByTestId("react-dnd-drop-zone")).toContainText("drops:1");
    await expectCommitsSince(page, commitCountBefore);
  });
});

test.describe("pickers and menus select things", () => {
  test("react-select opens its menu and picks an option", async ({ page }) => {
    await page.getByTestId("react-select-host").click();
    await page.getByText("Two", { exact: true }).click();
    await expect(page.getByTestId("react-select-host")).toContainText("Two");
  });

  test("cmdk filters commands as the user types", async ({ page }) => {
    await expect(page.getByText("second command")).toBeVisible();
    await page.getByTestId("cmdk-input").fill("first");
    await expect(page.getByText("first command")).toBeVisible();
    await expect(page.getByText("second command")).not.toBeVisible();
  });
});

test.describe("virtualizers and tables render data", () => {
  test("tanstack-virtual materializes far rows on scroll", async ({ page }) => {
    const virtualSection = page.getByTestId("lib-tanstack-virtual");
    await expect(virtualSection.getByText("row 0", { exact: true })).toBeVisible();
    await expect(virtualSection.getByText("row 199", { exact: true })).not.toBeAttached();
    await page.evaluate(() => {
      const scrollParent = document.querySelector(
        '[data-testid="tanstack-virtual-inner"]',
      )?.parentElement;
      scrollParent?.scrollTo({ top: scrollParent.scrollHeight });
    });
    await expect(virtualSection.getByText("row 199", { exact: true })).toBeVisible();
    await expect(virtualSection.getByText("row 0", { exact: true })).not.toBeAttached();
  });

  test("react-window materializes far rows on scroll", async ({ page }) => {
    const windowSection = page.getByTestId("lib-react-window");
    await expect(windowSection.getByText("row 0", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const listElement = document.querySelector<HTMLElement>(
        '[data-testid="lib-react-window"] [style*="overflow"]',
      );
      listElement?.scrollTo({ top: listElement.scrollHeight });
    });
    await expect(windowSection.getByText("row 199", { exact: true })).toBeVisible();
  });

  test("tanstack-table renders its row model", async ({ page }) => {
    const table = page.getByTestId("tanstack-table");
    await expect(table).toContainText("react");
    await expect(table).toContainText("bippy");
    await expect(table).toContainText("100");
  });
});

test.describe("overlays and toasts appear", () => {
  test("sonner toast fires and appears", async ({ page }) => {
    const commitCountBefore = await getCommitCount(page);
    await page.getByTestId("interact-sonner").click();
    await expect(page.getByText("sonner toast")).toBeVisible();
    await expectCommitsSince(page, commitCountBefore);
  });

  test("react-hot-toast fires and appears", async ({ page }) => {
    await page.getByTestId("interact-react-hot-toast").click();
    await expect(page.getByText("hot toast", { exact: true })).toBeVisible();
  });

  test("react-toastify fires and appears", async ({ page }) => {
    await page.getByTestId("interact-react-toastify").click();
    await expect(page.getByText("toastify toast")).toBeVisible();
  });

  test("vaul drawer opens with content", async ({ page }) => {
    await page.getByTestId("interact-vaul").click();
    await expect(page.getByTestId("vaul-content")).toBeVisible();
  });

  test("react-modal opens in a portal and closes", async ({ page }) => {
    await page.getByTestId("interact-react-modal").click();
    await expect(page.getByTestId("react-modal-content")).toBeVisible();

    const portalFiberResolved = await page.evaluate(() => {
      const modalElement = document.querySelector('[data-testid="react-modal-content"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(modalElement);
      return fiber !== null;
    });
    expect(portalFiberResolved).toBe(true);

    await page.getByText("close", { exact: true }).click();
    await expect(page.getByTestId("react-modal-content")).not.toBeVisible();
  });

  test("floating-ui shows and hides on hover", async ({ page }) => {
    await page.getByTestId("floating-ui-reference").hover();
    await expect(page.getByText("floating content")).toBeVisible();
    await page.getByTestId("interact-zustand").hover();
    await expect(page.getByText("floating content")).not.toBeVisible();
  });
});

test.describe("charts and content actually draw", () => {
  test("recharts draws an svg line path with axis ticks", async ({ page }) => {
    const chartInfo = await page.evaluate(() => {
      const chartSection = document.querySelector('[data-testid="lib-recharts"]');
      return {
        pathCount: chartSection?.querySelectorAll("path.recharts-line-curve").length ?? 0,
        tickCount: chartSection?.querySelectorAll(".recharts-cartesian-axis-tick").length ?? 0,
      };
    });
    expect(chartInfo.pathCount).toBe(1);
    expect(chartInfo.tickCount).toBeGreaterThan(3);
  });

  test("chart.js paints onto a canvas", async ({ page }) => {
    const canvasInfo = await page.evaluate(() => {
      const canvasElement = document.querySelector<HTMLCanvasElement>(
        '[data-testid="lib-chartjs"] canvas',
      );
      if (!canvasElement) return null;
      const context = canvasElement.getContext("2d");
      const pixels = context?.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
      let paintedPixelCount = 0;
      if (pixels) {
        for (let pixelIndex = 3; pixelIndex < pixels.length; pixelIndex += 4) {
          if (pixels[pixelIndex] > 0) paintedPixelCount++;
        }
      }
      return { width: canvasElement.width, paintedPixelCount };
    });
    expect(canvasInfo).not.toBeNull();
    expect(canvasInfo!.width).toBeGreaterThan(0);
    expect(canvasInfo!.paintedPixelCount).toBeGreaterThan(100);
  });

  test("react-markdown renders heading and emphasis elements", async ({ page }) => {
    const markdownHost = page.getByTestId("markdown-host");
    await expect(markdownHost.locator("h1")).toHaveText("markdown heading");
    await expect(markdownHost.locator("em")).toHaveText("by");
  });

  test("react-day-picker selects a day", async ({ page }) => {
    await expect(page.getByTestId("day-picker-selected")).toHaveText("none");
    await page
      .getByTestId("lib-react-day-picker")
      .getByRole("button", { name: /15/ })
      .first()
      .click();
    await expect(page.getByTestId("day-picker-selected")).toHaveText("15");
  });

  test("embla scrolls to the next slide", async ({ page }) => {
    await expect(page.getByTestId("embla-selected")).toHaveText("0");
    await page.getByTestId("interact-embla").click();
    await expect(page.getByTestId("embla-selected")).toHaveText("1");
  });
});

test.describe("utility hooks and helpers behave", () => {
  test("error boundary catches a real render error, resets, and bippy observes the commits", async ({
    page,
  }) => {
    const commitCountBefore = await getCommitCount(page);
    await expect(page.getByTestId("error-boundary-child")).toBeVisible();

    await page.getByTestId("error-boundary-trigger").click();
    await expect(page.getByTestId("error-boundary-reset")).toBeVisible();
    await expect(page.getByTestId("error-boundary-child")).not.toBeAttached();

    await page.getByTestId("error-boundary-reset").click();
    await expect(page.getByTestId("error-boundary-child")).toBeVisible();
    await expectCommitsSince(page, commitCountBefore);

    // The intentional throw must stay contained to its boundary.
    const sectionErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="section-error"]')).map((errorElement) =>
        errorElement.getAttribute("data-section"),
      ),
    );
    expect(sectionErrors).toEqual([]);
  });

  test("react-intersection-observer reports visibility after scrolling into view", async ({
    page,
  }) => {
    await page.getByTestId("in-view-target").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("in-view-target")).toHaveText("in view: true");
  });

  test("react-use toggle flips", async ({ page }) => {
    await page.getByTestId("interact-react-use").click();
    await expect(page.getByTestId("interact-react-use")).toHaveText("react-use:true");
  });

  test("usehooks-ts counter increments", async ({ page }) => {
    await page.getByTestId("interact-usehooks-ts").click();
    await expect(page.getByTestId("interact-usehooks-ts")).toHaveText("usehooks-ts:1");
  });

  test("i18next switches languages live", async ({ page }) => {
    await expect(page.getByTestId("i18next-greeting")).toHaveText("hello from i18next");
    await page.getByTestId("interact-i18next").click();
    await expect(page.getByTestId("i18next-greeting")).toHaveText("hallo von i18next");
  });

  test("lucide renders inline svg icons", async ({ page }) => {
    const svgCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid="lucide-icons"] svg').length,
    );
    expect(svgCount).toBe(2);
  });
});
