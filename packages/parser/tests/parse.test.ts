import { describe, expect, it } from "vite-plus/test";
import { getSourceLanguage, parseSourceText } from "../src/parse/parse-source-file.js";

describe("source languages", () => {
  it("parses JSX inside `.js` modules the way CRA, Next and webpack loaders do", () => {
    const lang = getSourceLanguage("/app/src/index.js");
    expect(lang).toBe("jsx");
    const parsed = parseSourceText(
      "/app/src/index.js",
      "export const App = () => <main className=\"app\">{'hi'}</main>;",
      lang ?? "js",
    );
    expect(parsed.errors).toEqual([]);
  });

  it("keeps `.mjs`/`.cjs` as plain JavaScript", () => {
    expect(getSourceLanguage("/app/lib/helper.mjs")).toBe("js");
    expect(getSourceLanguage("/app/lib/helper.cjs")).toBe("js");
  });
});
