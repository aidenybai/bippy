import { describe, expect, it } from "vite-plus/test";
import { createLinker, createProject, getReactApiReference, type LinkedSymbol } from "@bippy/parser";

const createFixtureProject = (files: Record<string, string>) =>
  createProject({ rootDirectory: "/virtual", files });

const describeSymbol = (symbol: LinkedSymbol): string => {
  switch (symbol.kind) {
    case "declaration":
      return `declaration ${symbol.localName} in ${symbol.module.filePath}`;
    case "value":
      return `value ${symbol.node.type} in ${symbol.module.filePath}`;
    case "namespace":
      return `namespace ${symbol.module.filePath}`;
    case "external":
      return `external ${symbol.specifier}:${symbol.importedName}${symbol.memberPath.map((member) => `.${member}`).join("")}`;
    case "unresolved":
      return `unresolved ${symbol.name} (${symbol.reason})`;
  }
};

describe("linker", () => {
  it("resolves named imports through barrel re-exports and aliases", () => {
    const project = createFixtureProject({
      "src/app.tsx": `import { Button as UiButton } from "./ui";\nexport const App = () => <UiButton />;`,
      "src/ui/index.ts": `export { Button } from "./button";\nexport * from "./card";\nexport * as Icons from "./icons";`,
      "src/ui/button.tsx": `export const Button = () => <button />;`,
      "src/ui/card.tsx": `export function Card() { return <div />; }`,
      "src/ui/icons.tsx": `export const Check = () => <svg />;`,
    });
    const linker = createLinker(project);
    const app = project.getModule("src/app.tsx");
    if (!app) throw new Error("missing module");

    expect(describeSymbol(linker.resolveReference(app, ["UiButton"]))).toBe(
      "declaration Button in /virtual/src/ui/button.tsx",
    );
    const ui = project.getModule("src/ui/index.ts");
    if (!ui) throw new Error("missing module");
    expect(describeSymbol(linker.resolveExport(ui, "Card"))).toBe(
      "declaration Card in /virtual/src/ui/card.tsx",
    );
    expect(describeSymbol(linker.resolveExport(ui, "Icons"))).toBe(
      "namespace /virtual/src/ui/icons.tsx",
    );
    expect(describeSymbol(linker.resolveReference(ui, ["Icons", "Check"]))).toBe(
      "unresolved Icons (no top-level binding)",
    );
  });

  it("resolves namespace imports, default exports and object members", () => {
    const project = createFixtureProject({
      "src/app.tsx": `import * as UI from "./ui";\nimport Layout from "./layout";\nimport { Card } from "./card";`,
      "src/ui.tsx": `export const Button = () => null;\nexport default function Fallback() { return null; }`,
      "src/layout.tsx": `const Layout = ({ children }) => children;\nexport default Layout;`,
      "src/card.tsx": `const Header = () => null;\nexport const Card = Object.assign(() => null, {});\nCard.Header = Header;\nexport const Menu = { Item: () => null };`,
    });
    const linker = createLinker(project);
    const app = project.getModule("src/app.tsx");
    const card = project.getModule("src/card.tsx");
    if (!app || !card) throw new Error("missing module");

    expect(describeSymbol(linker.resolveReference(app, ["UI", "Button"]))).toBe(
      "declaration Button in /virtual/src/ui.tsx",
    );
    expect(describeSymbol(linker.resolveReference(app, ["UI", "default"]))).toBe(
      "declaration Fallback in /virtual/src/ui.tsx",
    );
    expect(describeSymbol(linker.resolveReference(app, ["Layout"]))).toBe(
      "declaration Layout in /virtual/src/layout.tsx",
    );
    expect(describeSymbol(linker.resolveReference(app, ["Card", "Header"]))).toBe(
      "declaration Header in /virtual/src/card.tsx",
    );
    expect(describeSymbol(linker.resolveReference(card, ["Menu", "Item"]))).toBe(
      "value ArrowFunctionExpression in /virtual/src/card.tsx",
    );
  });

  it("recognizes React APIs regardless of import style", () => {
    const project = createFixtureProject({
      "src/a.tsx": `import React, { memo, Fragment as F } from "react";\nimport * as ReactNs from "react";\nimport { createPortal } from "react-dom";`,
      "src/b.js": `var _react = _interopRequireDefault(require("react"));\nvar _jsxRuntime = require("react/jsx-runtime");\nvar _named = require("react");`,
    });
    const linker = createLinker(project);
    const moduleA = project.getModule("src/a.tsx");
    const moduleB = project.getModule("src/b.js");
    if (!moduleA || !moduleB) throw new Error("missing module");

    const apiOf = (module: typeof moduleA, chain: string[]) => {
      const symbol = linker.resolveReference(module, chain);
      return symbol.kind === "external" ? (getReactApiReference(symbol)?.api ?? null) : null;
    };

    expect(apiOf(moduleA, ["React", "memo"])).toBe("memo");
    expect(apiOf(moduleA, ["memo"])).toBe("memo");
    expect(apiOf(moduleA, ["F"])).toBe("Fragment");
    expect(apiOf(moduleA, ["ReactNs", "Suspense"])).toBe("Suspense");
    expect(apiOf(moduleA, ["createPortal"])).toBe("createPortal");
    expect(apiOf(moduleA, ["React", "Children", "map"])).toBeNull();
    expect(apiOf(moduleB, ["_react", "default", "createElement"])).toBe("createElement");
    expect(apiOf(moduleB, ["_jsxRuntime", "jsx"])).toBe("jsx");
    expect(apiOf(moduleB, ["_named", "forwardRef"])).toBe("forwardRef");
    expect(apiOf(moduleB, ["React", "lazy"])).toBe("lazy");
  });

  it("links CommonJS exports emitted by compilers", () => {
    const project = createFixtureProject({
      "src/entry.js": `const lib = require("./lib");\nconst { Named } = require("./lib");\nconst Def = require("./only-default");`,
      "src/lib.js": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.Named = exports.Other = void 0;\nconst Named = () => null;\nexports.Named = Named;\nObject.defineProperty(exports, "Getter", { enumerable: true, get: function () { return _inner.Inner; } });\nvar _inner = require("./inner");\n__exportStar(require("./star"), exports);`,
      "src/inner.js": `exports.Inner = function Inner() { return null; };`,
      "src/star.js": `exports.FromStar = () => null;`,
      "src/only-default.js": `module.exports = function OnlyDefault() { return null; };`,
    });
    const linker = createLinker(project);
    const entry = project.getModule("src/entry.js");
    if (!entry) throw new Error("missing module");

    expect(describeSymbol(linker.resolveReference(entry, ["lib", "Named"]))).toBe(
      "declaration Named in /virtual/src/lib.js",
    );
    expect(describeSymbol(linker.resolveReference(entry, ["Named"]))).toBe(
      "declaration Named in /virtual/src/lib.js",
    );
    expect(describeSymbol(linker.resolveReference(entry, ["lib", "Getter"]))).toBe(
      "value FunctionExpression in /virtual/src/inner.js",
    );
    expect(describeSymbol(linker.resolveReference(entry, ["lib", "FromStar"]))).toBe(
      "value ArrowFunctionExpression in /virtual/src/star.js",
    );
    expect(describeSymbol(linker.resolveReference(entry, ["Def"]))).toBe(
      "value FunctionExpression in /virtual/src/only-default.js",
    );
  });

  it("reports unresolvable references without throwing", () => {
    const project = createFixtureProject({
      "src/app.tsx": `import { Missing } from "./nowhere";\nimport { Thing } from "some-package";`,
    });
    const linker = createLinker(project);
    const app = project.getModule("src/app.tsx");
    if (!app) throw new Error("missing module");
    expect(describeSymbol(linker.resolveReference(app, ["Missing"]))).toBe(
      "external ./nowhere:Missing",
    );
    expect(describeSymbol(linker.resolveReference(app, ["Thing", "Sub"]))).toBe(
      "external some-package:Thing.Sub",
    );
    expect(describeSymbol(linker.resolveReference(app, ["Nope"]))).toBe(
      "unresolved Nope (no top-level binding)",
    );
  });
});
