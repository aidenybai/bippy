import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";

const fixtureDirectory = path.resolve("fixtures/hmr-app");
const targetFilePath = path.join(fixtureDirectory, "src/target.tsx");
const originalSource = readFileSync(targetFilePath, "utf8");
const fixtureRequire = createRequire(path.join(fixtureDirectory, "package.json"));
const viteBinPath = path.join(
  path.dirname(fixtureRequire.resolve("vite/package.json")),
  "bin/vite.js",
);

const counterSource = (version) => `import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;

const syntaxErrorSource = `import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="broken" onClick={() => setCount(count + 1)}>
      {count
    </button>
  );
};
`;

const port = 5266;
writeFileSync(targetFilePath, counterSource("v1"));
const viteProcess = spawn(process.execPath, [viteBinPath, "--port", String(port), "--strictPort"], {
  cwd: fixtureDirectory,
  stdio: ["ignore", "pipe", "pipe"],
});
viteProcess.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
viteProcess.stderr.on("data", (chunk) => process.stdout.write(`[vite err] ${chunk}`));
await new Promise((resolveSleep) => setTimeout(resolveSleep, 1500));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (message) =>
  console.log(`[page ${message.type()}]`, message.text().slice(0, 160)),
);
page.on("pageerror", (error) => console.log("[pageerror]", error.message.slice(0, 200)));
page.on("load", () => console.log("[navigation] page loaded"));
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('[data-testid="target"][data-version="v1"]');
await page.click('[data-testid="target"]');
console.log("v1 mounted and clicked");

writeFileSync(targetFilePath, syntaxErrorSource);
await new Promise((resolveSleep) => setTimeout(resolveSleep, 2000));
console.log("overlay present:", await page.locator("vite-error-overlay").count());

writeFileSync(targetFilePath, counterSource("v2"));
await new Promise((resolveSleep) => setTimeout(resolveSleep, 4000));
console.log(
  "dom state:",
  await page.content().then((html) => /data-version="[^"]+/.exec(html)?.[0]),
);
console.log("overlay still present:", await page.locator("vite-error-overlay").count());

writeFileSync(targetFilePath, originalSource);
viteProcess.kill("SIGTERM");
await browser.close();
