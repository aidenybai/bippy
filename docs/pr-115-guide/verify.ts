import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

interface VerificationResult {
  viewport: string;
  interactions: string;
  externalRequests: number;
}

interface TraceExpectation {
  name: string;
  length: number;
  output: RegExp;
}

const revision = "c9cfc18ff6455211f9c53323ef35f75f67ba8684";
const documentUrl = new URL("../pr-115-explained.html", import.meta.url);
const html = await readFile(documentUrl, "utf8");
const sourcePaths = new Set(
  [
    ...html.matchAll(
      new RegExp(`https://github.com/aidenybai/bippy/blob/${revision}/([^"#]+)`, "g"),
    ),
  ].map((match) => match[1]),
);
for (const sourcePath of sourcePaths) {
  execFileSync("git", ["cat-file", "-e", `${revision}:${sourcePath}`], { stdio: "pipe" });
}
assert.ok(!/\{\{[A-Z_]+\}\}/.test(html));
assert.ok(!html.includes('href="source:'));
assert.ok(!/<script\b[^>]*\bsrc=/.test(html));
assert.ok(!/<link\b[^>]*\brel=["']stylesheet/.test(html));
assert.ok(
  !/comparison\.status|sample-passed|strictCoverage|data-report|id="corpus"|replay\.verification/.test(
    html,
  ),
);

const traces: TraceExpectation[] = [
  { name: "execution", length: 7, output: /Excluded: p \+ strong/ },
  { name: "mutation", length: 5, output: /state === alias remains true/ },
  { name: "updates", length: 4, output: /new render’s count = 1/ },
  { name: "tasks", length: 5, output: /sync → promise → microtask → nested → timer/ },
];
const results: VerificationResult[] = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.goto(documentUrl.href);
    assert.deepEqual(errors, []);
    await page.locator("html.js").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const brokenAnchors = await page.locator('a[href^="#"]').evaluateAll((links) =>
      links.flatMap((link) => {
        const target = link.getAttribute("href")?.slice(1);
        return target && !document.getElementById(target) ? [target] : [];
      }),
    );
    assert.deepEqual(brokenAnchors, []);
    const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
      const seen = new Set<string>();
      return elements.flatMap((element) => {
        if (seen.has(element.id)) return [element.id];
        seen.add(element.id);
        return [];
      });
    });
    assert.deepEqual(duplicateIds, []);
    const sectionIds = await page
      .locator("main > section[id]")
      .evaluateAll((sections) => sections.map((section) => section.id));
    assert.deepEqual(
      await page
        .locator("#section-select option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("value"))),
      sectionIds,
    );
    assert.equal(await page.locator(".sidebar nav a").count(), sectionIds.length);

    for (const trace of traces) {
      const container = page.locator(`[data-trace="${trace.name}"]`);
      assert.equal(await container.locator("[data-back]").isDisabled(), true);
      for (let step = 1; step < trace.length; step++)
        await container.locator("[data-next]").click();
      assert.equal(
        await container.locator("[data-step-count]").innerText(),
        `Step ${trace.length} of ${trace.length}`,
      );
      assert.equal(await container.locator("[data-next]").isDisabled(), true);
      assert.match(await container.locator("[data-output]").innerText(), trace.output);
      await container.locator("[data-back]").click();
      assert.equal(
        await container.locator("[data-step-count]").innerText(),
        `Step ${trace.length - 1} of ${trace.length}`,
      );
      await container.locator("[data-reset]").click();
      assert.equal(
        await container.locator("[data-step-count]").innerText(),
        `Step 1 of ${trace.length}`,
      );
    }
    const mutation = page.locator('[data-trace="mutation"]');
    assert.equal(await mutation.locator(".active-line").count(), 2);
    await mutation.locator("[data-next]").click();
    assert.equal(await mutation.locator(".active-line").innerText(), "if (flag) alias.count = 1;");
    await mutation.locator("[data-next]").click();
    assert.equal(await mutation.locator(".active-line").count(), 0);
    assert.match(await mutation.locator("[data-state]").innerText(), /A.count = 0/);
    await mutation.locator("[data-reset]").click();

    const updates = page.locator('[data-trace="updates"]');
    await page.locator('[data-update="updater"]').click();
    for (let step = 0; step < 3; step++) await updates.locator("[data-next]").click();
    assert.match(await updates.locator("[data-state]").innerText(), /current = 2\nnext = none/);
    assert.match(await updates.locator("[data-output]").innerText(), /old callback’s count = 0/);
    await page.locator('[data-update="replace"]').click();
    assert.equal(await updates.locator("[data-step-count]").innerText(), "Step 1 of 4");

    for (const [input, output] of [
      ["true", "4"],
      ["false", "6"],
      ["unknown", "4 when flag\n6 when !flag"],
    ]) {
      await page.locator(`[data-value="${input}"]`).click();
      assert.equal(await page.locator("#value-result").innerText(), output);
    }
    await page.locator("#closure-mutation").uncheck();
    assert.equal(await page.locator("#closure-result").innerText(), "before");
    await page.locator("#closure-mutation").check();
    assert.equal(await page.locator("#closure-result").innerText(), "after");
    await page.locator('[data-role="admin"]').click();
    assert.equal(await page.locator("#guard-output").innerText(), "button + a");
    await page.locator('[data-role="other"]').click();
    assert.equal(await page.locator("#guard-output").innerText(), "neither");
    await page.locator('[data-role="unknown"]').focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#guard-output").innerText(), /Never just one/);
    assert.equal(await page.locator('[data-role="unknown"]').getAttribute("aria-pressed"), "true");

    const detailsCount = await page.locator("details").count();
    await page.locator("#expand-details").click();
    assert.equal(await page.locator("details[open]").count(), detailsCount);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.locator("#expand-details").click();
    assert.equal(await page.locator("details[open]").count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    assert.equal(await page.locator("details[open]").count(), detailsCount);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    assert.equal(await page.locator("details[open]").count(), 0);
    if (viewport.width < 760) {
      await page.locator("#section-select").selectOption("hooks");
      await page.waitForFunction(() => location.hash === "#hooks");
      assert.equal(await page.locator("#section-select").inputValue(), "hooks");
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/bippy-pr-guide-${viewport.width}.png` });
    await page.locator('[data-trace="mutation"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/bippy-pr-guide-mechanics-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    results.push({
      viewport: `${viewport.width}×${viewport.height}`,
      interactions: "passed",
      externalRequests: requests.length,
    });
    await page.close();
  }
  const noScript = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await noScript.goto(documentUrl.href);
  assert.equal(await noScript.locator("noscript").isVisible(), true);
  assert.equal(await noScript.locator("main > section").count(), 17);
  await noScript.locator("details").first().locator("summary").click();
  assert.equal(await noScript.locator("details[open]").count(), 1);
  assert.equal(
    await noScript.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await noScript.close();
  console.log(
    JSON.stringify({ sourceLinksChecked: sourcePaths.size, results, noScript: "passed" }, null, 2),
  );
} finally {
  await browser.close();
}
