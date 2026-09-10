import { describe, expect, it } from "vite-plus/test";
import { createModuleRecord } from "../src/graph/module-record.js";
import { parseSourceText } from "../src/parse/parse-source-file.js";

const exportedNames = (source: string): string[] =>
  createModuleRecord(parseSourceText("/app/node_modules/lib/index.js", source, "js")).exports.map(
    (entry) => (entry.kind === "re-export-all" ? `* from ${entry.specifier}` : entry.exportedName),
  );

describe("CommonJS exports behind inlined NODE_ENV guards", () => {
  it("takes the development branch of an `if` guard", () => {
    expect(
      exportedNames(`
        if (process.env.NODE_ENV === "production") {
          module.exports = require("./cjs/lib.production.js");
        } else {
          module.exports = require("./cjs/lib.development.js");
        }
      `),
    ).toEqual(["default", "* from ./cjs/lib.development.js"]);
    expect(
      exportedNames(`
        if (process.env.NODE_ENV !== "production") {
          (function () {
            var TAG = Symbol.for("lib.tag");
            exports.Tag = TAG;
          })();
        }
      `),
    ).toEqual(["Tag"]);
  });

  it("takes the development side of a `&&` or `||` guard around an IIFE", () => {
    expect(
      exportedNames(`
        "production" !== process.env.NODE_ENV &&
          (function () {
            exports.Tag = Symbol.for("lib.tag");
          })();
      `),
    ).toEqual(["Tag"]);
    expect(
      exportedNames(`
        "production" === process.env.NODE_ENV ||
          (function () {
            exports.Tag = Symbol.for("lib.tag");
          })();
      `),
    ).toEqual(["Tag"]);
  });

  it("drops the production side", () => {
    expect(
      exportedNames(`
        "production" === process.env.NODE_ENV &&
          (function () {
            exports.Minified = 1;
          })();
        exports.Tag = 2;
      `),
    ).toEqual(["Tag"]);
  });
});
