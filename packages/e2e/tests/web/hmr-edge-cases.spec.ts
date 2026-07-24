import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  buildUniqueMarker,
  countRefreshUpdatesMatching,
  readCurrentMarker,
  resolveFixtureFile,
  saveAndAwaitText,
  waitForRefreshListener,
  waitForRefreshUpdateMatching,
} from "./hmr-helpers";
import { waitForTestChild } from "./helpers";

const EDGE_TARGETS_FILE = "hmr-edge-targets.tsx";
const STALE_TARGET_FILE = "hmr-stale-target.tsx";

// editing hmr-edge-targets.tsx re-registers every family it exports, so any
// of its markers works as the DOM sync point for a save
const MEMO_MARKER_PREFIX = "memo-marker";
const STALE_MARKER_PREFIX = "stale-marker";
const STATEFUL_MARKER_PREFIX = "stateful-marker";

const STATEFUL_CLICK_COUNT = 3;

interface EdgeTargetsEdit {
  restore: () => Promise<void>;
  uniqueMarker: string;
}

const saveEdgeTargetsWithFreshMarker = async (
  page: Page,
  projectName: string,
  markerPrefix: string,
  syncTestId: string,
): Promise<EdgeTargetsEdit> => {
  const targetFilePath = resolveFixtureFile(projectName, EDGE_TARGETS_FILE);
  const originalSource = readFileSync(targetFilePath, "utf8");
  const currentMarker = readCurrentMarker(originalSource, markerPrefix);
  const uniqueMarker = buildUniqueMarker(markerPrefix);
  await saveAndAwaitText(
    page,
    targetFilePath,
    originalSource.replace(currentMarker, uniqueMarker),
    syncTestId,
    uniqueMarker,
  );
  return {
    restore: () =>
      saveAndAwaitText(page, targetFilePath, originalSource, syncTestId, currentMarker),
    uniqueMarker,
  };
};

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForRefreshListener(page);
});

test.describe("bippy/react-refresh edge cases", () => {
  test("collects a fiber for a memo-wrapped component", async ({ page }) => {
    const edit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      MEMO_MARKER_PREFIX,
      "hmr-memo-target",
    );
    try {
      // getDisplayName resolves a memo fiber through the wrapper to the
      // inner component's name
      await waitForRefreshUpdateMatching(page, {
        updatedFiberName: "HmrMemoInner",
        updatedName: "HmrMemoInner",
      });
    } finally {
      await edit.restore();
    }
  });

  test("collects one fiber per mounted instance of a list component", async ({ page }) => {
    const edit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      MEMO_MARKER_PREFIX,
      "hmr-memo-target",
    );
    try {
      await waitForRefreshUpdateMatching(page, {
        updatedFiberName: "HmrListItem",
        updatedFiberNameCount: 3,
      });
    } finally {
      await edit.restore();
    }
  });

  test("reports never-mounted components without collecting fibers for them", async ({ page }) => {
    const edit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      MEMO_MARKER_PREFIX,
      "hmr-memo-target",
    );
    try {
      // HmrUnmountedTarget is exported by the edited module (family
      // re-registered) but never rendered, so no fiber must be collected
      await waitForRefreshUpdateMatching(page, {
        updatedName: "HmrUnmountedTarget",
        withoutUpdatedFiberName: "HmrUnmountedTarget",
      });
    } finally {
      await edit.restore();
    }
  });

  test("preserves hook state across a hook-compatible edit", async ({ page }) => {
    const statefulTarget = page.getByTestId("hmr-stateful-target");
    for (let click = 0; click < STATEFUL_CLICK_COUNT; click++) {
      await statefulTarget.click();
    }
    await expect(statefulTarget).toContainText(`:${STATEFUL_CLICK_COUNT}`);

    const edit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      STATEFUL_MARKER_PREFIX,
      "hmr-stateful-target",
    );
    try {
      await expect(statefulTarget).toContainText(`${edit.uniqueMarker}:${STATEFUL_CLICK_COUNT}`);
      await waitForRefreshUpdateMatching(page, { updatedName: "HmrStatefulTarget" });
    } finally {
      await edit.restore();
    }
  });

  test("reports a component as stale when its hook signature changes", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, STALE_TARGET_FILE);
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, STALE_MARKER_PREFIX);
    const uniqueMarker = buildUniqueMarker(STALE_MARKER_PREFIX);

    // adding a hook changes the component's react-refresh signature, which
    // moves its family to staleFamilies: React remounts it instead of
    // preserving state
    const HOOK_ANCHOR = "useState(0);";
    if (!originalSource.includes(HOOK_ANCHOR)) {
      throw new Error("stale fixture drifted: hook anchor line not found");
    }
    const sourceWithChangedHooks = originalSource
      .replace(currentMarker, uniqueMarker)
      .replace(HOOK_ANCHOR, "useState(0);\n  useState(1);");

    try {
      await saveAndAwaitText(
        page,
        targetFilePath,
        sourceWithChangedHooks,
        "hmr-stale-target",
        uniqueMarker,
      );

      await waitForRefreshUpdateMatching(page, {
        staleFiberName: "HmrStaleTarget",
        staleName: "HmrStaleTarget",
      });
    } finally {
      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource,
        "hmr-stale-target",
        currentMarker,
      );
    }
  });

  test("second listeners compose and dispose only unwinds their own patch", async ({ page }) => {
    const didInstall = await page.evaluate(
      () => window.__BIPPY_HMR__?.installSecondListener() ?? false,
    );
    expect(didInstall).toBe(true);

    const firstEdit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      MEMO_MARKER_PREFIX,
      "hmr-memo-target",
    );
    try {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__BIPPY_HMR__?.secondListenerUpdatedNames.filter(
                (updatedName) => updatedName === "HmrMemoInner",
              ).length ?? 0,
          ),
        )
        .toBeGreaterThan(0);
    } finally {
      await firstEdit.restore();
    }

    await page.evaluate(() => window.__BIPPY_HMR__?.disposeSecondListener());
    const namesRecordedBeforeDispose = await page.evaluate(
      () => window.__BIPPY_HMR__?.secondListenerUpdatedNames.length ?? 0,
    );
    const primaryUpdatesBeforeSecondEdit = await countRefreshUpdatesMatching(page, {
      updatedName: "HmrMemoInner",
    });

    const secondEdit = await saveEdgeTargetsWithFreshMarker(
      page,
      test.info().project.name,
      MEMO_MARKER_PREFIX,
      "hmr-memo-target",
    );
    try {
      // the primary listener still observes the refresh...
      await expect
        .poll(() => countRefreshUpdatesMatching(page, { updatedName: "HmrMemoInner" }), {
          timeout: 10_000,
        })
        .toBeGreaterThan(primaryUpdatesBeforeSecondEdit);
      // ...while the disposed listener recorded nothing new
      const namesRecordedAfterDispose = await page.evaluate(
        () => window.__BIPPY_HMR__?.secondListenerUpdatedNames.length ?? 0,
      );
      expect(namesRecordedAfterDispose).toBe(namesRecordedBeforeDispose);
    } finally {
      await secondEdit.restore();
    }
  });
});
