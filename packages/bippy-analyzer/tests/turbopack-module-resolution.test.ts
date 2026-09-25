import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it("compiles separate RSC, browser, and client-SSR export branches with native Turbopack", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../scripts/probe-turbopack-resolution.ts", import.meta.url)),
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", RAYON_NUM_THREADS: "2" },
    },
  );
  const report = JSON.parse(output);
  expect(report).toMatchObject({
    version: "15.5.18",
    routes: expect.arrayContaining(["/"]),
    markers: {
      server: expect.arrayContaining([expect.stringMatching(/^server\//)]),
      browser: expect.arrayContaining([expect.stringMatching(/^static\//)]),
      node: expect.arrayContaining([expect.stringMatching(/^server\//)]),
      fallback: [],
    },
  });
  for (const severity of ["bug", "fatal", "error"])
    expect(report.issues).not.toContainEqual(expect.objectContaining({ severity }));
}, 35000);
