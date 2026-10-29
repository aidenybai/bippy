import { describe, expect, it } from "vite-plus/test";
import { compileFile } from "../../src/core/compile";

describe("a file the parser rejects", () => {
  it("reports the parse error instead of dropping the file silently", () => {
    expect(compileFile("broken.tsx", "export const Broken = () => <div>;").parseError).toMatch(
      /Unterminated JSX contents|Expected corresponding JSX closing tag/,
    );
  });

  it("has no parse error when the file parses", () => {
    expect(compileFile("fine.tsx", "export const Fine = () => <div />;").parseError).toBeNull();
  });
});
