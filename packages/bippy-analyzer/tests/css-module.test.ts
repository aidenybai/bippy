import { describe, expect, it } from "vite-plus/test";
import { isCssModulePath, parseCssModule } from "../src/graph/css-module.js";

const SCSS = `
// palette
$paper: #ffffff;
$primaryMain: #2196f3;
$primaryLight: $paper;
@spacing: 8px;

.card {
  color: $primaryMain;
  &.active, .card__title { font-weight: 700; }
  @media (min-width: 0.5em) { .row-tight { gap: 0.25rem; } }
  background: url(//cdn.example.com/x.png);
}

:export {
  paper: $paper;
  primaryLight: $primaryLight;
  primaryMain: $primaryMain;
  spacing: @spacing;
  shade: darken($paper, 10%);
  label: #{$paper}-ish;
  missing: $undefined;
}
`;

describe("CSS module stylesheets", () => {
  it("recognizes the bundler's CSS-module file names", () => {
    expect(isCssModulePath("/app/src/theme.module.scss")).toBe(true);
    expect(isCssModulePath("/app/src/Button.module.css")).toBe(true);
    expect(isCssModulePath("/app/src/global.scss")).toBe(false);
    expect(isCssModulePath("/app/src/module.ts")).toBe(false);
  });

  it("collects class selectors and resolves literal `:export` values through variables", () => {
    const { classNames, values } = parseCssModule(SCSS);
    expect(classNames.sort()).toEqual(["active", "card", "card__title", "row-tight"]);
    expect([...values]).toEqual([
      ["paper", "#ffffff"],
      ["primaryLight", "#ffffff"],
      ["primaryMain", "#2196f3"],
      ["spacing", "8px"],
      ["shade", null],
      ["label", null],
      ["missing", null],
    ]);
  });
});
