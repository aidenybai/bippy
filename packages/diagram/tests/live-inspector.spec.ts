import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { WebSocket } from "ws";
import { createInspectionSession } from "../scripts/inspection-session";

const getRejectedStatus = (url: string, origin: string) =>
  new Promise<number | undefined>((resolve) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 2000 });
    socket.on("error", () => resolve(undefined));
    socket.on("unexpected-response", (request, response) => {
      resolve(response.statusCode);
      request.destroy();
    });
  });

test("captures real commits, preserves identity, and renders through the normal tree", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  const origin = baseURL ?? "http://localhost:3100";
  const session = await createInspectionSession({
    browser,
    targetUrl: `${origin}/fixtures/inspect-target`,
    viewerUrl: `${origin}/inspect`,
  });
  const { appPage, viewerPage } = session;
  const getNodes = () =>
    session.getMessage().frames.flatMap((frame) => frame.roots.flatMap((root) => root.nodes));
  try {
    await expect
      .poll(() => getNodes().some((node) => node.label === "MemoValue"), { timeout: 15000 })
      .toBe(true);
    const memo = getNodes().find((node) => node.label === "MemoValue");
    expect(memo?.componentType).toBe("memo");
    expect(memo?.ownerId).toBe(getNodes().find((node) => node.label === "CaptureExample")?.id);
    expect(getNodes().find((node) => node.id === memo?.parentId)?.label).toBe("section");
    expect(getNodes().find((node) => node.label === "ExampleBoundary")?.kind).toBe("boundary");
    expect(
      getNodes().some((node) => node.label === "LiveInspector" || node.label === "TreeView"),
    ).toBe(false);
    expect(JSON.stringify(session.getMessage())).not.toContain("private-value-sentinel");
    expect(JSON.stringify(session.getMessage())).not.toContain(
      "Private text is not part of the capture.",
    );
    const tree = viewerPage.getByRole("tree", { name: "Live parent tree", exact: true });
    await expect(tree).toBeVisible();
    expect(await tree.getByRole("treeitem").count()).toBeLessThan(80);
    await viewerPage.getByRole("button", { name: "Owner view", exact: true }).click();
    await expect(
      viewerPage.getByRole("tree", { name: "Live owner tree", exact: true }),
    ).toBeVisible();
    const captureRoot = session
      .getMessage()
      .frames.flatMap((frame) => frame.roots)
      .find((root) => root.nodes.some((node) => node.label === "CaptureExample"));
    expect(captureRoot).toBeDefined();
    expect(new Set(captureRoot?.edges.map((edge) => edge.kind))).toEqual(
      new Set(["data", "context", "update", "subscription"]),
    );
    expect(JSON.stringify(session.getMessage())).not.toContain("private-reference-sentinel");
    expect(JSON.stringify(session.getMessage())).not.toContain("private-store-sentinel");
    const search = viewerPage.getByRole("searchbox", {
      name: "Search Live parent tree",
      exact: true,
    });
    await search.fill("CaptureExample");
    await search.press("Enter");
    await viewerPage.keyboard.press("Space");
    await expect(
      viewerPage.getByRole("tree", { name: "Live dataflow tree", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => tree.locator('[data-edge-kind="update"]').count()).toBeGreaterThan(0);
    await expect.poll(() => tree.locator('[data-edge-kind="data"]').count()).toBeGreaterThan(0);
    await expect
      .poll(() => tree.getByRole("treeitem").filter({ hasText: "state / reducer" }).count())
      .toBeGreaterThan(0);
    await viewerPage.getByRole("button", { name: "Owner view", exact: true }).click();
    await viewerPage.screenshot({ path: "test-results/live-fibers-development.png" });
    const previous = session.getMessage().sequence;
    await appPage.getByRole("button", { name: "Increment", exact: true }).click();
    await expect(appPage.getByRole("status", { name: "Example count" })).toHaveText("1");
    await expect.poll(() => session.getMessage().sequence).toBeGreaterThan(previous);
    expect(getNodes().find((node) => node.label === "MemoValue")?.id).toBe(memo?.id);
    await viewerPage.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(viewerPage.getByRole("button", { name: "Resume", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const pausedUpdate = await viewerPage.getByTestId("inspection-sequence").textContent();
    await appPage.getByRole("button", { name: "Toggle leaf", exact: true }).click();
    await expect
      .poll(() => getNodes().some((node) => node.label === "ConditionalLeaf"))
      .toBe(false);
    await expect(viewerPage.getByTestId("inspection-sequence")).toHaveText(pausedUpdate ?? "");
    await viewerPage.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(viewerPage.getByTestId("inspection-sequence")).not.toHaveText(pausedUpdate ?? "");
    await appPage.getByRole("button", { name: "Toggle portal", exact: true }).click();
    await expect.poll(() => getNodes().some((node) => node.kind === "portal")).toBe(true);
    await expect.poll(() => getNodes().some((node) => node.label === "PortalContent")).toBe(true);
    const axe = await new AxeBuilder({ page: viewerPage })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    const documentId = session.getMessage().frames[0].documentId;
    await appPage.reload();
    await expect.poll(() => session.getMessage().frames[0]?.documentId).not.toBe(documentId);
    await expect.poll(() => getNodes().some((node) => node.label === "ConditionalLeaf")).toBe(true);
    await appPage.close();
    await expect(
      viewerPage.getByRole("status").filter({ hasText: "Connected · closed" }),
    ).toBeVisible();
  } finally {
    await session.stop();
  }
});

test("isolates frame roots and protects the loopback bridge with origin and session checks", async ({
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "http://localhost:3100";
  const session = await createInspectionSession({
    browser,
    targetUrl: `${origin}/fixtures/inspect-target`,
    viewerUrl: `${origin}/inspect`,
  });
  try {
    await expect.poll(() => session.getMessage().frames.length).toBe(1);
    expect(await getRejectedStatus(session.bridgeUrl, "https://untrusted.example")).toBe(401);
    const invalidToken = new URL(session.bridgeUrl);
    invalidToken.searchParams.set("session", "invalid");
    expect(await getRejectedStatus(invalidToken.toString(), origin)).toBe(401);
    await session.appPage.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.dataset.inspectionChild = "";
      frame.src = "/fixtures/inspect-target?child";
      document.body.append(frame);
    });
    await expect
      .poll(() => session.getMessage().frames.filter((frame) => frame.roots.length > 0).length)
      .toBe(2);
    expect(new Set(session.getMessage().frames.map((frame) => frame.id)).size).toBe(2);
    await expect(
      session.viewerPage.getByRole("group", { name: "React roots", exact: true }),
    ).toBeVisible();
    await session.appPage.evaluate(() =>
      document.querySelector("[data-inspection-child]")?.remove(),
    );
    await expect.poll(() => session.getMessage().frames.length).toBe(1);
  } finally {
    await session.stop();
  }
});
