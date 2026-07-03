export const runScenarios = async (page) => {
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", null, {
    timeout: 10_000,
  });
  await page.waitForSelector('[data-testid="test-child"]', { timeout: 10_000 });

  console.log("[scenario] fiber lookup sweep (getFiberFromHostInstance over all elements x200)");
  await page.evaluate(
    ({ passCount }) => {
      const elements = Array.from(document.querySelectorAll("*"));
      for (let passIndex = 0; passIndex < passCount; passIndex++) {
        for (const element of elements) {
          window.__BIPPY__.getFiberFromHostInstance(element);
        }
      }
    },
    { passCount: 200 },
  );

  console.log("[scenario] full fiber walks (traverseFiber x500)");
  await page.evaluate(
    ({ walkCount }) => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;
      for (let walkIndex = 0; walkIndex < walkCount; walkIndex++) {
        window.__BIPPY__.traverseFiber(rootFiber, () => {});
      }
    },
    { walkCount: 500 },
  );

  console.log("[scenario] per-fiber classification + props/state/context traversal (x300)");
  await page.evaluate(
    ({ passCount }) => {
      const bippy = window.__BIPPY__;
      const element = document.querySelector('[data-testid="test-child"]');
      let rootFiber = bippy.getFiberFromHostInstance(element);
      while (rootFiber.return) rootFiber = rootFiber.return;
      const fibers = [];
      bippy.traverseFiber(rootFiber, (fiber) => {
        fibers.push(fiber);
      });
      for (let passIndex = 0; passIndex < passCount; passIndex++) {
        for (const fiber of fibers) {
          bippy.isCompositeFiber(fiber);
          bippy.isHostFiber(fiber);
          bippy.didFiberRender(fiber);
          bippy.getDisplayName(fiber.type);
          bippy.getFiberId(fiber);
          bippy.traverseProps(fiber, () => {});
          bippy.traverseState(fiber, () => {});
          bippy.traverseContexts(fiber, () => {});
          bippy.getNearestHostFiber(fiber);
          bippy.getNearestHostFibers(fiber);
          bippy.getFiberStack(fiber);
          bippy.getTimings(fiber);
          bippy.isValidFiber(fiber);
        }
      }
    },
    { passCount: 300 },
  );

  console.log("[scenario] commit instrumentation under re-render storm (x400 commits)");
  await page.evaluate(
    async ({ commitCount }) => {
      const bippy = window.__BIPPY__;
      bippy.instrument({
        onCommitFiberRoot: (rendererId, root) => {
          bippy.traverseRenderedFibers(root, () => {});
        },
      });
      const button = document.querySelector('[data-testid="increment"]');
      for (let commitIndex = 0; commitIndex < commitCount; commitIndex++) {
        if (button) {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
        if (commitIndex % 20 === 19) {
          await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        }
      }
      await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    },
    { commitCount: 400 },
  );

  console.log("[scenario] source resolution (getSource/getOwnerStack over composites x50)");
  await page.evaluate(
    async ({ passCount }) => {
      const bippy = window.__BIPPY__;
      const element = document.querySelector('[data-testid="test-child"]');
      let rootFiber = bippy.getFiberFromHostInstance(element);
      while (rootFiber.return) rootFiber = rootFiber.return;
      const compositeFibers = [];
      bippy.traverseFiber(rootFiber, (fiber) => {
        if (bippy.isCompositeFiber(fiber)) compositeFibers.push(fiber);
      });
      for (let passIndex = 0; passIndex < passCount; passIndex++) {
        for (const fiber of compositeFibers) {
          try {
            await bippy.getSource(fiber);
            await bippy.getOwnerStack(fiber);
          } catch {}
        }
      }
    },
    { passCount: 50 },
  );
};
