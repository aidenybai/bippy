// Property-based fiber fuzzing: deterministic seeds generate random trees
// (hosts, memo, forwardRef, fragments, keyed lists, Suspense, portals,
// context) and random mutations (key shuffles, subtree toggles, host
// retags, prop bumps). After every commit, bippy invariants are checked
// over every host node: fiber resolution roundtrips, host classification,
// double-buffer id stability, and getLatestFiber consistency.
import { expect, test } from "@playwright/test";

const FUZZ_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MUTATIONS_PER_SEED = 25;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__HARNESS_READY__ === true, undefined, {
    timeout: 15_000,
  });
});

for (const fuzzSeed of FUZZ_SEEDS) {
  test(`seed ${fuzzSeed}: ${MUTATIONS_PER_SEED} mutations hold all bippy invariants`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const result = await page.evaluate(
      ([seed, mutationCount]) => window.__FUZZ__(seed, mutationCount),
      [fuzzSeed, MUTATIONS_PER_SEED] as const,
    );

    expect(
      result.failures,
      `mutation log for reproduction: ${result.mutationLog.join(", ")}`,
    ).toEqual([]);
    // Every mutation must produce at least one commit (mount + 25 mutations).
    expect(result.commitCount).toBeGreaterThanOrEqual(MUTATIONS_PER_SEED + 1);
    expect(result.checkedHostNodes).toBeGreaterThan(50);
  });
}
