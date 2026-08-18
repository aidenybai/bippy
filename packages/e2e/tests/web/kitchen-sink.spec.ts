// A single page mounting 50 real ecosystem libraries (state managers, form
// libraries, radix primitives, shadcn-style components, react-aria, UI
// kits, motion, dnd, virtualizers, overlays, charts) with bippy installed
// first. Asserts bippy's instrumentation and traversal survive the exotic
// fiber shapes these libraries produce: portals, providers, forwardRefs,
// memo wrappers, lazy trees, and third-party class components.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="lib-lucide-react"]', { timeout: 30_000 });
});

test.describe("kitchen sink: 50 React libraries", () => {
  test("all 50 library sections render without a single error boundary tripping", async ({
    page,
  }) => {
    const summary = await page.evaluate(() => ({
      expectedSections: window.__SECTION_NAMES__,
      renderedSections: Array.from(document.querySelectorAll('[data-testid^="lib-"]')).map(
        (sectionElement) => sectionElement.getAttribute("data-testid"),
      ),
      sectionErrors: Array.from(document.querySelectorAll('[data-testid="section-error"]')).map(
        (errorElement) => errorElement.getAttribute("data-section"),
      ),
    }));
    expect(summary.sectionErrors).toEqual([]);
    expect(summary.expectedSections.length).toBe(50);
    expect(summary.renderedSections.sort()).toEqual(
      summary.expectedSections.map((sectionName) => `lib-${sectionName}`).sort(),
    );
  });

  test("bippy instruments the full tree and observes the mount commits", async ({ page }) => {
    const status = await page.evaluate(() => ({
      isActive: window.__BIPPY__.isInstrumentationActive(),
      commitCount: window.__COMMIT_COUNT__,
      rendererCount: window.__BIPPY__._renderers.size,
    }));
    expect(status.isActive).toBe(true);
    expect(status.commitCount).toBeGreaterThan(0);
    expect(status.rendererCount).toBe(1);
  });

  test("fiber traversal classifies thousands of fibers from 50 libraries", async ({ page }) => {
    const traversal = await page.evaluate(() => {
      const rootElement = document.getElementById("root");
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(rootElement?.firstElementChild);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let totalFiberCount = 0;
      let hostFiberCount = 0;
      let compositeFiberCount = 0;
      const displayNames = new Set<string>();
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        totalFiberCount++;
        if (window.__BIPPY__.isHostFiber(fiber)) hostFiberCount++;
        if (window.__BIPPY__.isCompositeFiber(fiber)) {
          compositeFiberCount++;
          const displayName = window.__BIPPY__.getDisplayName(fiber.type);
          if (displayName) displayNames.add(displayName);
        }
      });
      return {
        totalFiberCount,
        hostFiberCount,
        compositeFiberCount,
        distinctDisplayNames: displayNames.size,
      };
    });
    expect(traversal).not.toBeNull();
    expect(traversal!.totalFiberCount).toBeGreaterThan(1000);
    expect(traversal!.hostFiberCount).toBeGreaterThan(200);
    expect(traversal!.compositeFiberCount).toBeGreaterThan(200);
    expect(traversal!.distinctDisplayNames).toBeGreaterThan(60);
  });

  test("getFiberFromHostInstance resolves a fiber for every library section", async ({ page }) => {
    const unresolvedSections = await page.evaluate(() => {
      const failures: string[] = [];
      for (const sectionElement of document.querySelectorAll('[data-testid^="lib-"]')) {
        const fiber = window.__BIPPY__.getFiberFromHostInstance(sectionElement);
        if (!fiber || !window.__BIPPY__.isFiber(fiber)) {
          failures.push(sectionElement.getAttribute("data-testid") ?? "unknown");
        }
      }
      return failures;
    });
    expect(unresolvedSections).toEqual([]);
  });

  test("interacting across libraries keeps commits flowing and trips no boundaries", async ({
    page,
  }) => {
    const interactionTargets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="interact-"]')).map(
        (interactionElement) => interactionElement.getAttribute("data-testid")!,
      ),
    );
    expect(interactionTargets.length).toBeGreaterThan(15);

    const commitCountBefore = await page.evaluate(() => window.__COMMIT_COUNT__);
    for (const interactionTestId of interactionTargets) {
      await page.getByTestId(interactionTestId).first().click();
      // Radix overlays trap focus; dismiss anything that opened before
      // moving to the next library's trigger.
      await page.keyboard.press("Escape");
    }

    const afterInteractions = await page.evaluate(() => ({
      commitCount: window.__COMMIT_COUNT__,
      sectionErrors: Array.from(document.querySelectorAll('[data-testid="section-error"]')).map(
        (errorElement) => errorElement.getAttribute("data-section"),
      ),
    }));
    expect(afterInteractions.sectionErrors).toEqual([]);
    expect(afterInteractions.commitCount).toBeGreaterThan(commitCountBefore + 10);
  });

  test("traverseRenderedFibers processes an update commit over the giant tree", async ({
    page,
  }) => {
    const phases = await page.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        let commitIndex = 0;
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, root) => {
            commitIndex++;
            const seenPhases = new Set<string>();
            window.__BIPPY__.traverseRenderedFibers(root, (_fiber, phase) => {
              seenPhases.add(phase);
            });
            if (commitIndex === 2) {
              resolve([...seenPhases]);
            } else {
              document.querySelector<HTMLElement>('[data-testid="interact-zustand"]')!.click();
            }
          },
        });
        document.querySelector<HTMLElement>('[data-testid="interact-zustand"]')!.click();
      });
    });
    expect(phases).toContain("update");
  });
});
