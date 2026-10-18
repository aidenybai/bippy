import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createInspectionSession } from "./inspection-session";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    headless: { type: "boolean", default: false },
    viewer: { type: "string", default: "http://localhost:3100/inspect" },
  },
});
const targetUrl = positionals[0] ?? "https://ui.shadcn.com/examples/dashboard";
const browser = await chromium.launch({ headless: values.headless });
try {
  const session = await createInspectionSession({ browser, targetUrl, viewerUrl: values.viewer });
  console.log(
    `App: ${targetUrl}\nInspector: ${session.viewerUrl}\nOnly structural fiber metadata is captured. Close the inspector or press Ctrl+C to stop.`,
  );
  let isClosing = false;
  const stop = async () => {
    if (isClosing) return;
    isClosing = true;
    await session.stop();
    await browser.close();
  };
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  session.viewerPage.once("close", () => {
    void stop();
  });
  browser.once("disconnected", () => {
    void session.stop();
  });
  if (session.viewerPage.isClosed()) await stop();
  if (browser.isConnected())
    await new Promise<void>((resolve) => browser.once("disconnected", () => resolve()));
} finally {
  await browser.close();
}
