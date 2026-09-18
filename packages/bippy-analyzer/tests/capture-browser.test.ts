import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createServer } from "vite";
import { BrowserCapturer } from "../src/harness/capture-browser.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";

const collectText = (fiber: RuntimeFiberSnapshot): string[] => [
  ...(fiber.text === null ? [] : [fiber.text]),
  ...fiber.children.flatMap(collectText),
];

it("keeps the initial capture pointer outside the viewport", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "capture-pointer-"));
  writeFileSync(
    join(rootDirectory, "index.html"),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  writeFileSync(
    join(rootDirectory, "main.tsx"),
    `
import { useState } from "react";
import { createRoot } from "react-dom/client";

const App = () => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      style={{ position: "fixed", inset: 0 }}
      onPointerEnter={() => setIsHovered(true)}
    >
      {isHovered ? "hovered" : "idle"}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
`,
  );
  const server = await createServer({
    root: rootDirectory,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  const capturer = new BrowserCapturer();
  try {
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("Vite did not expose a local URL");
    const capture = await capturer.capture({ url, settleMs: 100, timeoutMs: 10_000 });
    const text = capture.snapshot.roots.flatMap(collectText);
    expect(text).toContain("idle");
    expect(text).not.toContain("hovered");
  } finally {
    await capturer.close();
    await server.close();
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
