import { describe, expect, it } from "vite-plus/test";
import { toLocalExportName } from "../conformance/verifier/harness/local-exports";
import { summarizeModule } from "../conformance/verifier/source-index";

describe("local exports", () => {
  it("lists only names declared at the top of a module", () => {
    const summary = summarizeModule(`
      const Header = () => <h1>Title</h1>;
      function Footer() { const Inner = () => null; return <Inner />; }
      export const Panel = () => <Header />;
    `);
    expect([...summary.localNames].sort()).toEqual(["Footer", "Header"]);
  });

  it("gives each local component an export name no module would choose", () => {
    expect(toLocalExportName("Header")).not.toBe("Header");
    expect(toLocalExportName("Header")).toContain("Header");
  });
});
