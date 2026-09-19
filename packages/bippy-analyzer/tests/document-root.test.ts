import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

it("mounts document singletons and body portals through a document root", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "document-root-"));
  try {
    const entryPath = join(rootDirectory, "entry.jsx");
    writeFileSync(
      entryPath,
      `
        import { createPortal } from "react-dom";

        export default () => (
          <html>
            <head><title>Document root</title></head>
            <body>
              <input autoFocus />
              {createPortal(<aside />, document.body)}
            </body>
          </html>
        );
      `,
    );
    const renderer = await createStaticRenderer({ rootDirectory, renderIntoDocument: true });

    const result = await renderer.renderComponent(entryPath);
    const pattern = formatPattern(getRenderPattern(result));

    expect(result.diagnostics).toEqual([]);
    expect(pattern).toMatch(
      /<html>\n\s+<head>\n\s+<title>\n\s+<body>\n\s+<input>\n\s+<Portal>\n\s+<aside>/,
    );
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
