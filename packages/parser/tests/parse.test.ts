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

describe("jsx pragmas", () => {
  const readPragma = (source: string) =>
    parseSourceText("/app/src/app.js", source, "jsx").jsxPragma;

  it("reads Babel's annotations from any comment, last one winning", () => {
    expect(
      readPragma(
        `/** @jsx jsx */\n/** @jsxFrag Frag */\nimport {jsx} from '@emotion/core';\nexport const App = () => <div css={{}} />;`,
      ),
    ).toEqual({ runtime: null, factory: "jsx", fragment: "Frag", importSource: null });
    expect(
      readPragma(
        `// @jsxRuntime automatic\n// @jsxImportSource @emotion/react\n/* @jsxImportSource preact */\nexport const App = () => <div />;`,
      ),
    ).toEqual({ runtime: "automatic", factory: null, fragment: null, importSource: "preact" });
    expect(
      readPragma(`/**\n * @jsxRuntime classic\n * @jsx h\n */\nexport const App = () => <div />;`),
    ).toEqual({
      runtime: "classic",
      factory: "h",
      fragment: null,
      importSource: null,
    });
  });

  it("ignores prose that mentions the annotations and files without any", () => {
    expect(
      readPragma(`// see the @jsx pragma docs for h\nexport const App = () => <div />;`),
    ).toBeNull();
    expect(readPragma(`export const App = () => <div />;`)).toBeNull();
  });
});
