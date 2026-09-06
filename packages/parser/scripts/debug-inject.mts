import { chromium } from "playwright";
import { buildInjectBundle } from "../src/harness/capture-browser.js";

const inject = await buildInjectBundle();
console.log("bundle bytes", inject.length);
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(inject);
const page = await context.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 500)));
await page.goto(process.argv[2] ?? "http://localhost:3100/", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));
console.log(
  await page.evaluate(() => ({
    keys: Object.keys(globalThis).filter((k) => k.includes("BIPPY") || k.includes("REACT_DEVTOOLS")),
    hook: typeof (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
    renderers: (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size,
    commits: (globalThis as any).__BIPPY_PARSER_COMMITS__?.(),
  })),
);
await browser.close();
